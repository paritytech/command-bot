import EventEmitter from "events"
import { writeFile } from "fs/promises"
import Joi from "joi"
import fetch from "node-fetch"
import { envNumberVar } from "opstooling-js"
import path from "path"
import yaml from "yaml"

import { CommandRunner } from "./shell"
import { Task, taskExecutionTerminationEvent, TaskGitlabPipeline } from "./task"
import { Context, PipelineScripts } from "./types"
import { millisecondsDelay, validatedFetch } from "./utils"

// Integration tests don't like waiting for 16 seconds
const pipelineUpdateInterval = process.env.GITLAB_PIPELINE_UPDATE_INTERVAL
  ? envNumberVar("GITLAB_PIPELINE_UPDATE_INTERVAL")
  : 16384

const getPipelineScriptsCloneCommand = ({ withRef }: { withRef: boolean }) =>
  `git clone --progress --verbose --depth 1 ${
    withRef ? `--branch "$PIPELINE_SCRIPTS_REF"` : ""
  } "$PIPELINE_SCRIPTS_REPOSITORY" "$PIPELINE_SCRIPTS_DIR"`

export const runCommandInGitlabPipeline = async (ctx: Context, task: Task): Promise<GitlabTaskContext> => {
  const { logger, gitlab, pipelineScripts } = ctx

  const cmdRunner = new CommandRunner({ itemsToRedact: [gitlab.accessToken], cwd: task.repoPath })

  /*
    Save the head SHA before doing any modifications to the branch so that
    scripts will be able to restore the branch as it was on GitHub
  */
  const headSha = await cmdRunner.run("git", ["rev-parse", "HEAD"])

  if (headSha instanceof Error) {
    throw headSha
  }

  const jobTaskInfoMessage = (() => {
    switch (task.tag) {
      case "PullRequestTask": {
        return `The task was generated from a comment in ${task.comment.htmlUrl}`
      }
      case "ApiTask": {
        return `The task was generated from an API call by ${task.requester}`
      }
      default: {
        const exhaustivenessCheck: never = task
        throw new Error(
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          `jobTaskInfoMessage is not exhaustive: ${exhaustivenessCheck}`,
        )
      }
    }
  })()

  await writeFile(
    path.join(task.repoPath, ".gitlab-ci.yml"),
    yaml.stringify(getGitlabCiYmlConfig(headSha, task, pipelineScripts, jobTaskInfoMessage)),
  )

  const branchName = `cmd-bot/${
    "prNumber" in task.gitRef
      ? task.gitRef.prNumber
      : `${task.gitRef.contributor.owner}/${task.gitRef.contributor.branch}`
  }`
  await cmdRunner.run("git", ["branch", "-D", branchName], {
    testAllowedErrorMessage: (err) => err.endsWith("not found."),
  })
  await cmdRunner.run("git", ["checkout", "-b", branchName])

  await cmdRunner.run("git", ["add", ".gitlab-ci.yml"])

  await cmdRunner.run("git", ["commit", "-m", task.command])

  const gitlabRemote = "gitlab"
  const gitlabProjectPath = `${gitlab.pushNamespace}/${task.gitRef.upstream.repo}`

  let gitlabRemoteUrl: string
  // This variable is set by integration tests
  if (process.env.GITLAB_REMOTE_URL) {
    gitlabRemoteUrl = `${process.env.GITLAB_REMOTE_URL}/${gitlabProjectPath}.git`
  } else {
    gitlabRemoteUrl = `https://token:${gitlab.accessToken}@${gitlab.domain}/${gitlabProjectPath}.git`
  }

  await cmdRunner.run("git", ["remote", "remove", gitlabRemote], {
    testAllowedErrorMessage: (err) => err.includes("No such remote:"),
  })

  await cmdRunner.run("git", ["remote", "add", gitlabRemote, gitlabRemoteUrl])

  /*
    It's not necessary to say "--option ci.skip" because the pipeline execution
    is conditional per workflow:rules
  */
  await cmdRunner.run("git", ["push", "--force", gitlabRemote, "HEAD"])

  const gitlabProjectApi = `https://${gitlab.domain}/api/v4/projects/${encodeURIComponent(gitlabProjectPath)}`
  const branchNameUrlEncoded = encodeURIComponent(branchName)

  /*
    Wait until the branch is actually present on GitLab after pushing it. We've
    noted this measure is required in
    https://github.com/paritytech/polkadot/pull/5524#issuecomment-1128029579
    because the pipeline creation request was sent too soon, before GitLab
    registered the branch, therefore causing the "Reference not found" message.
  */
  let wasBranchRegistered = false
  const waitForBranchMaxTries = 3
  const waitForBranchRetryDelay = 1024

  const branchPresenceUrl = `${gitlabProjectApi}/repository/branches/${branchNameUrlEncoded}`
  for (let waitForBranchTryCount = 0; waitForBranchTryCount < waitForBranchMaxTries; waitForBranchTryCount++) {
    logger.info(branchPresenceUrl, `Sending request to see if the branch for task ${task.id} is ready`)
    const response = await fetch(branchPresenceUrl, { headers: { "PRIVATE-TOKEN": gitlab.accessToken } })
    if (
      // The branch was not yet registered on GitLab; wait for it...
      response.status === 404
    ) {
      logger.info(`Branch of task ${task.id} was not found. Waiting before retrying...`)
      await millisecondsDelay(waitForBranchRetryDelay)
    } else if (response.ok) {
      wasBranchRegistered = true
      break
    } else {
      throw new Error(`Request to ${branchPresenceUrl} failed: ${await response.text()}`)
    }
  }

  if (!wasBranchRegistered) {
    throw new Error(
      `Task's branch was not registered on GitLab after ${waitForBranchMaxTries * waitForBranchRetryDelay}ms`,
    )
  }

  const pipelineCreationUrl = `${gitlabProjectApi}/pipeline?ref=${branchNameUrlEncoded}`
  logger.info(pipelineCreationUrl, `Sending request to create a pipeline for task ${task.id}`)
  const pipeline = await validatedFetch<{
    id: number
    project_id: number
  }>(
    fetch(pipelineCreationUrl, { method: "POST", headers: { "PRIVATE-TOKEN": gitlab.accessToken } }),
    Joi.object()
      .keys({ id: Joi.number().required(), project_id: Joi.number().required() })
      .options({ allowUnknown: true }),
  )
  logger.info(pipeline, `Created pipeline for task ${task.id}`)

  const jobFetchUrl = `${gitlabProjectApi}/pipelines/${pipeline.id}/jobs`
  logger.info(jobFetchUrl, `Sending request to fetch the GitLab job created for task ${task.id}`)
  const [job] = await validatedFetch<
    [
      {
        web_url: string
      },
    ]
  >(
    fetch(jobFetchUrl, { headers: { "PRIVATE-TOKEN": gitlab.accessToken } }),
    Joi.array()
      .items(Joi.object().keys({ web_url: Joi.string().required() }).options({ allowUnknown: true }))
      .length(1)
      .required(),
  )
  logger.info(job, `Fetched job for task ${task.id}`)

  return getAliveTaskGitlabContext(ctx, { id: pipeline.id, projectId: pipeline.project_id, jobWebUrl: job.web_url })
}

export function getGitlabCiYmlConfig(
  headSha: string,
  task: Task,
  pipelineScripts: PipelineScripts,
  jobTaskInfoMessage: string,
): object {
  const artifactsFolderPath = ".git/.artifacts"
  return {
    workflow: { rules: [{ if: `$CI_PIPELINE_SOURCE == "api"` }, { if: `$CI_PIPELINE_SOURCE == "web"` }] },
    command: {
      timeout: "24 hours",
      ...task.gitlab.job,
      script: [
        `echo "This job is related to task ${task.id}. ${jobTaskInfoMessage}."`,
        /*
          The scripts repository might be left over from a previous run in the
          same Gitlab shell executor
        */
        'rm -rf "$PIPELINE_SCRIPTS_DIR"',
        // prettier-ignore
        'if [ "${PIPELINE_SCRIPTS_REPOSITORY:-}" ]; then ' +
        'if [ "${PIPELINE_SCRIPTS_REF:-}" ]; then ' +
        getPipelineScriptsCloneCommand({ withRef: true }) + "; " +
        "else " +
        getPipelineScriptsCloneCommand({ withRef: false }) + "; " +
        "fi" + "; " +
        "fi",
        `export ARTIFACTS_DIR="$PWD/${artifactsFolderPath}"`,
        /*
          The artifacts directory might be left over from a previous run in
          the same Gitlab shell executor
        */
        'rm -rf "$ARTIFACTS_DIR"',
        'mkdir -p "$ARTIFACTS_DIR"',
        task.command,
      ],
      artifacts: {
        name: "${CI_JOB_NAME}_${CI_COMMIT_REF_NAME}",
        expire_in: "7 days",
        when: "always",
        paths: [artifactsFolderPath],
      },
      variables: {
        // overrideable variables
        PIPELINE_SCRIPTS_REF: pipelineScripts?.ref,
        ...task.gitlab.job.variables,
        // non-overrideable variables
        GH_OWNER: task.gitRef.upstream.owner,
        GH_OWNER_REPO: task.gitRef.upstream.repo,
        ...(task.gitRef.upstream.branch ? { GH_OWNER_BRANCH: task.gitRef.upstream.branch } : {}),
        GH_CONTRIBUTOR: task.gitRef.contributor.owner,
        GH_CONTRIBUTOR_REPO: task.gitRef.contributor.repo,
        GH_CONTRIBUTOR_BRANCH: task.gitRef.contributor.branch,
        GH_HEAD_SHA: headSha,
        COMMIT_MESSAGE: task.command,
        PIPELINE_SCRIPTS_REPOSITORY: pipelineScripts?.repository,
        PIPELINE_SCRIPTS_DIR: ".git/.scripts",
      },
    },
  }
}

export const cancelGitlabPipeline = async (
  { gitlab, logger }: Context,
  pipeline: TaskGitlabPipeline,
): Promise<void> => {
  logger.info(pipeline, "Cancelling GitLab pipeline")
  await validatedFetch(
    fetch(
      /*
        Note: this endpoint can be called any time, even if the pipeline has
        already finished
      */
      `https://${gitlab.domain}/api/v4/projects/${pipeline.projectId}/pipelines/${pipeline.id}/cancel`,
      { method: "POST", headers: { "PRIVATE-TOKEN": gitlab.accessToken } },
    ),
    Joi.object().keys({ id: Joi.number().required() }).options({ allowUnknown: true }),
  )
}

const isPipelineFinished = async (ctx: Context, pipeline: TaskGitlabPipeline) => {
  const { gitlab } = ctx

  const { status } = await validatedFetch<{
    status: string
  }>(
    fetch(`https://${gitlab.domain}/api/v4/projects/${pipeline.projectId}/pipelines/${pipeline.id}`, {
      headers: { "PRIVATE-TOKEN": gitlab.accessToken },
    }),
    Joi.object().keys({ status: Joi.string().required() }).options({ allowUnknown: true }),
  )
  switch (status) {
    case "success":
    case "skipped":
    case "canceled":
    case "failed": {
      return true
    }
  }
}

// FIXME: apparently, null and undefined here are different, and lead to different execution paths later
export const restoreTaskGitlabContext = async (
  ctx: Context,
  task: Task,
): Promise<GitlabTaskContext | null | undefined> => {
  const { pipeline } = task.gitlab
  if (!pipeline) {
    return
  }

  if (await isPipelineFinished(ctx, pipeline)) {
    return null
  }

  return getAliveTaskGitlabContext(ctx, pipeline)
}

type GitlabTaskContext = TaskGitlabPipeline & {
  terminate: () => Promise<Error | undefined>
  waitUntilFinished: (taskEventChannel: EventEmitter) => Promise<unknown>
}

const getAliveTaskGitlabContext = (ctx: Context, pipeline: TaskGitlabPipeline): GitlabTaskContext => {
  const { logger } = ctx

  let wasTerminated = false
  return {
    ...pipeline,
    terminate: async () => {
      wasTerminated = true
      await cancelGitlabPipeline(ctx, pipeline)
      return undefined
    },
    waitUntilFinished: (taskEventChannel) =>
      Promise.race([
        new Promise<void>((resolve) => {
          taskEventChannel.on(taskExecutionTerminationEvent, () => {
            wasTerminated = true
            resolve()
          })
        }),
        new Promise<void>((resolve, reject) => {
          /*
            Avoid potentially cancelling a costly long-running job if the GitLab
            request fails randomly
          */
          let subsequentErrors: unknown[] = []
          const pollPipelineCompletion = async () => {
            if (wasTerminated) {
              return resolve()
            }
            try {
              if (await isPipelineFinished(ctx, pipeline)) {
                return resolve()
              }
              subsequentErrors = []
            } catch (error) {
              subsequentErrors.push(error)
              if (subsequentErrors.length > 2) {
                logger.error(
                  { errors: subsequentErrors, pipeline },
                  `GitLab pipeline status polling failed ${subsequentErrors.length} in a row. Aborting...`,
                )
                return reject(error)
              }
            }
            setTimeout(() => {
              void pollPipelineCompletion()
            }, pipelineUpdateInterval)
          }
          void pollPipelineCompletion()
        }),
      ]),
  }
}
