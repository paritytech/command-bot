import EventEmitter from "events"
import { writeFile } from "fs/promises"
import Joi from "joi"
import fetch from "node-fetch"
import path from "path"
import yaml from "yaml"

import { CommandRunner } from "./shell"
import { Task, taskExecutionTerminationEvent, TaskGitlabPipeline } from "./task"
import { Context } from "./types"
import { validatedFetch } from "./utils"

export const runCommandInGitlabPipeline = async (ctx: Context, task: Task) => {
  const { logger, gitlab } = ctx

  const cmdRunner = new CommandRunner(ctx, {
    itemsToRedact: [gitlab.accessToken],
    cwd: task.repoPath,
  })

  /*
    Save the head SHA before doing any modifications to the branch so that
    scripts will be able to restore the branch as it was on GitHub
  */
  const headSha = await cmdRunner.run("git", ["rev-parse", "HEAD"])

  const getPipelineScriptsCloneCommand = ({
    withRef,
  }: {
    withRef: boolean
  }) => {
    return `git clone --depth 1 ${
      withRef ? `--branch "$PIPELINE_SCRIPTS_REF"` : ""
    } "$PIPELINE_SCRIPTS_REPOSITORY" "$PIPELINE_SCRIPTS_DIR"`
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

  const artifactsFolderPath = ".git/.artifacts"
  await writeFile(
    path.join(task.repoPath, ".gitlab-ci.yml"),
    yaml.stringify({
      workflow: {
        rules: [
          { if: `$CI_PIPELINE_SOURCE == "api"` },
          { if: `$CI_PIPELINE_SOURCE == "web"` },
        ],
      },
      command: {
        ...task.gitlab.job,
        script: [
          `echo "This job is related to task ${task.id}. ${jobTaskInfoMessage}."`,
          // prettier-ignore
          'if [ "${PIPELINE_SCRIPTS_REPOSITORY:-}" ]; then ' +
            'if [ "${PIPELINE_SCRIPTS_REF:-}" ]; then ' +
              getPipelineScriptsCloneCommand({ withRef: true }) + "; " +
            "else " +
              getPipelineScriptsCloneCommand({ withRef: false }) + "; " +
            "fi" + "; " +
          "fi",
          `export ARTIFACTS_DIR="$PWD/${artifactsFolderPath}"`,
          `mkdir -p "$ARTIFACTS_DIR"`,
          task.command,
        ],
        artifacts: {
          name: "${CI_JOB_NAME}_${CI_COMMIT_REF_NAME}",
          expire_in: "7 days",
          when: "always",
          paths: [artifactsFolderPath],
        },
        variables: {
          ...task.gitlab.job.variables,
          GH_CONTRIBUTOR: task.gitRef.contributor.owner,
          GH_CONTRIBUTOR_REPO: task.gitRef.contributor.repo,
          GH_CONTRIBUTOR_BRANCH: task.gitRef.contributor.branch,
          GH_HEAD_SHA: headSha,
          COMMIT_MESSAGE: task.command,
          PIPELINE_SCRIPTS_REPOSITORY: ctx.pipelineScripts?.repository,
          PIPELINE_SCRIPTS_REF: ctx.pipelineScripts?.ref,
          PIPELINE_SCRIPTS_DIR: ".git/.scripts",
        },
      },
    }),
  )

  const branchName = `cmd-bot/${
    "prNumber" in task.gitRef
      ? task.gitRef.prNumber
      : `${task.gitRef.contributor.owner}/${task.gitRef.contributor.branch}`
  }`
  await cmdRunner.run("git", ["branch", "-D", branchName], {
    testAllowedErrorMessage: (err) => {
      return err.endsWith("not found.")
    },
  })
  await cmdRunner.run("git", ["checkout", "-b", branchName])

  await cmdRunner.run("git", ["add", ".gitlab-ci.yml"])

  await cmdRunner.run("git", ["commit", "-m", task.command])

  const gitlabRemote = "gitlab"
  const gitlabProjectPath = `${gitlab.pushNamespace}/${task.gitRef.upstream.repo}`

  await cmdRunner.run("git", ["remote", "remove", gitlabRemote], {
    testAllowedErrorMessage: (err) => {
      return err.includes("No such remote:")
    },
  })

  await cmdRunner.run("git", [
    "remote",
    "add",
    gitlabRemote,
    `https://token:${gitlab.accessToken}@${gitlab.domain}/${gitlabProjectPath}.git`,
  ])

  /*
    It's not necessary to say "--option ci.skip" because the pipeline execution
    is conditional per workflow:rules
  */
  await cmdRunner.run("git", ["push", "--force", gitlabRemote, "HEAD"])

  const pipeline = await validatedFetch<{
    id: number
    project_id: number
  }>(
    fetch(
      `https://${gitlab.domain}/api/v4/projects/${encodeURIComponent(
        gitlabProjectPath,
      )}/pipeline?ref=${encodeURIComponent(branchName)}`,
      { method: "POST", headers: { "PRIVATE-TOKEN": gitlab.accessToken } },
    ),
    Joi.object()
      .keys({
        id: Joi.number().required(),
        project_id: Joi.number().required(),
      })
      .options({ allowUnknown: true }),
  )
  logger.info(pipeline, `Created pipeline for task ${task.id}`)

  const [job] = await validatedFetch<
    [
      {
        web_url: string
      },
    ]
  >(
    fetch(
      `https://${gitlab.domain}/api/v4/projects/${pipeline.project_id}/pipelines/${pipeline.id}/jobs`,
      { headers: { "PRIVATE-TOKEN": gitlab.accessToken } },
    ),
    Joi.array()
      .items(
        Joi.object()
          .keys({ web_url: Joi.string().required() })
          .options({ allowUnknown: true }),
      )
      .length(1)
      .required(),
  )
  logger.info(job, `Fetched job for task ${task.id}`)

  return getAliveTaskGitlabContext(ctx, {
    id: pipeline.id,
    projectId: pipeline.project_id,
    jobWebUrl: job.web_url,
  })
}

export const cancelGitlabPipeline = async (
  { gitlab, logger }: Context,
  pipeline: TaskGitlabPipeline,
) => {
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
    Joi.object()
      .keys({ id: Joi.number().required() })
      .options({ allowUnknown: true }),
  )
}

const isPipelineFinished = async (
  ctx: Context,
  pipeline: TaskGitlabPipeline,
) => {
  const { gitlab } = ctx

  const { status } = await validatedFetch<{
    status: string
  }>(
    fetch(
      `https://${gitlab.domain}/api/v4/projects/${pipeline.projectId}/pipelines/${pipeline.id}`,
      { headers: { "PRIVATE-TOKEN": gitlab.accessToken } },
    ),
    Joi.object()
      .keys({ status: Joi.string().required() })
      .options({ allowUnknown: true }),
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

export const restoreTaskGitlabContext = async (ctx: Context, task: Task) => {
  const { pipeline } = task.gitlab
  if (!pipeline) {
    return
  }

  if (await isPipelineFinished(ctx, pipeline)) {
    return null
  }

  return getAliveTaskGitlabContext(ctx, pipeline)
}

const getAliveTaskGitlabContext = (
  ctx: Context,
  pipeline: TaskGitlabPipeline,
): TaskGitlabPipeline & {
  terminate: () => Promise<Error | undefined>
  waitUntilFinished: (taskEventChannel: EventEmitter) => Promise<unknown>
} => {
  const { logger } = ctx

  let wasTerminated = false
  return {
    ...pipeline,
    terminate: async () => {
      wasTerminated = true
      await cancelGitlabPipeline(ctx, pipeline)
      return undefined
    },
    waitUntilFinished: (taskEventChannel) => {
      return Promise.race([
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
            }, 16384)
          }
          void pollPipelineCompletion()
        }),
      ])
    },
  }
}
