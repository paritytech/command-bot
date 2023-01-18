import { displayError, intoError } from "opstooling-js"
import path from "path"

import { CancelCommand, GenericCommand, HelpCommand, ParsedCommand } from "src/bot/parse/ParsedCommand"
import { parsePullRequestBotCommandLine } from "src/bot/parse/parsePullRequestBotCommandLine"
import { CommentData, PullRequestData, WebhookHandler } from "src/bot/types"
import { getDocsUrl } from "src/command-configs/fetchCommandsConfiguration"
import { isRequesterAllowed } from "src/core"
import { getSortedTasks } from "src/db"
import { createComment, getPostPullRequestResult, updateComment } from "src/github"
import { cancelTask, getNextTaskId, PullRequestTask, queueTask, serializeTaskQueuedDate } from "src/task"
import { PullRequestError } from "src/types"
import { getLines } from "src/utils"

export const onIssueCommentCreated: WebhookHandler<"issue_comment.created"> = async (ctx, octokit, payload) => {
  const { repositoryCloneDirectory, gitlab, logger } = ctx
  const { issue, comment, repository, installation } = payload
  const pr: PullRequestData = { owner: repository.owner.login, repo: repository.name, number: issue.number }
  const commentParams: CommentData = { owner: pr.owner, repo: pr.repo, issue_number: pr.number }

  logger.options.context = { ...logger.options.context, repo: repository.name, comment: commentParams, pr }

  if (!("pull_request" in issue)) {
    logger.debug(payload, `Skipping payload because it's not from a pull request`)
    return
  }

  const requester = comment.user?.login

  if (!requester) {
    logger.debug(payload, "Skipping payload because it has no requester")
    return
  }

  if (payload.action !== "created") {
    logger.debug(payload, "Skipping payload because it's not for created comments")
    return
  }

  if (comment.user?.type !== "User") {
    logger.debug(payload, `Skipping payload because comment.user.type (${comment.user?.type}) is not "User"`)
    return
  }

  let getError = (body: string) => new PullRequestError(pr, { body, requester })

  try {
    const commands: ParsedCommand[] = []
    for (const line of getLines(comment.body)) {
      const parsedCommand = await parsePullRequestBotCommandLine(line, ctx)

      if (parsedCommand === undefined) {
        continue
      }

      if (parsedCommand instanceof Error) {
        return getError(parsedCommand.message)
      }

      commands.push(parsedCommand)
    }

    if (commands.length === 0) {
      return
    }

    if (!(await isRequesterAllowed(ctx, octokit, requester))) {
      return getError("Requester could not be detected as a member of an allowed organization.")
    }

    for (const parsedCommand of commands) {
      logger.debug({ parsedCommand }, "Processing parsed command")

      if (parsedCommand instanceof HelpCommand) {
        const url = getDocsUrl(parsedCommand.commitHash)
        await createComment(ctx, octokit, { ...commentParams, body: `Here's a [link to docs](${url})` })
      }

      if (parsedCommand instanceof GenericCommand) {
        const installationId = installation?.id
        if (!installationId) {
          return getError("Github Installation ID was not found in webhook payload")
        }

        const { data: fetchedPr } = await octokit.pulls.get({ owner: pr.owner, repo: pr.repo, pull_number: pr.number })

        const upstream = {
          owner: fetchedPr.base.repo.owner.login,
          repo: fetchedPr.base.repo.name,
          branch: fetchedPr.base.ref,
        }

        // Update pr in case the upstream repository has been renamed
        pr.owner = upstream.owner
        pr.repo = upstream.repo

        const contributorUsername = fetchedPr.head?.user?.login
        if (!contributorUsername) {
          return getError("Failed to read repository owner username for contributor in pull request response")
        }

        const contributorRepository = fetchedPr.head?.repo?.name
        if (!contributorRepository) {
          return getError("Failed to read repository name for contributor in pull request response")
        }

        const contributorBranch = fetchedPr.head?.ref
        if (!contributorBranch) {
          return getError("Failed to read branch name for contributor in pull request response")
        }

        const contributor = { owner: contributorUsername, repo: contributorRepository, branch: contributorBranch }
        const commentBody = `Preparing command "${parsedCommand.command}". This comment will be updated later.`.trim()
        const createdComment = await createComment(ctx, octokit, { ...commentParams, body: commentBody })
        getError = (body: string) => new PullRequestError(pr, { body, requester, commentId: createdComment.id })

        const queuedDate = new Date()

        const defaultVariables = parsedCommand.configuration.gitlab?.job.variables
        const overriddenVariables = parsedCommand.variables

        const task: PullRequestTask = {
          ...pr,
          id: getNextTaskId(),
          tag: "PullRequestTask",
          requester,
          command: parsedCommand.command,
          comment: { id: createdComment.id, htmlUrl: createdComment.htmlUrl },
          installationId,
          gitRef: { upstream, contributor, prNumber: pr.number },
          timesRequeued: 0,
          timesRequeuedSnapshotBeforeExecution: 0,
          timesExecuted: 0,
          repoPath: path.join(repositoryCloneDirectory, pr.repo),
          queuedDate: serializeTaskQueuedDate(queuedDate),
          gitlab: {
            job: {
              tags: parsedCommand.configuration.gitlab?.job.tags || [],
              image: gitlab.jobImage,
              variables: Object.assign(defaultVariables, overriddenVariables),
            },
            pipeline: null,
          },
        }

        const updateProgress = (message: string) =>
          updateComment(ctx, octokit, { ...commentParams, comment_id: createdComment.id, body: message })
        const queueMessage = await queueTask(ctx, task, {
          onResult: getPostPullRequestResult(ctx, octokit, task),
          updateProgress,
        })
        await updateProgress(queueMessage)
      }

      if (parsedCommand instanceof CancelCommand) {
        const { taskId } = parsedCommand

        const cancelledTasks: PullRequestTask[] = []
        const failedToCancelTasks: PullRequestTask[] = []

        for (const { task } of await getSortedTasks(ctx)) {
          if (task.tag !== "PullRequestTask") {
            continue
          }

          if (taskId) {
            if (task.id !== taskId) {
              continue
            }
          } else {
            if (
              task.gitRef.upstream.owner !== pr.owner ||
              task.gitRef.upstream.repo !== pr.repo ||
              task.gitRef.prNumber !== pr.number
            ) {
              continue
            }
          }

          try {
            await cancelTask(ctx, task)
            cancelledTasks.push(task)
          } catch (error) {
            failedToCancelTasks.push(task)
            logger.error(error, `Failed to cancel task ${task.id}`)
          }
        }

        for (const cancelledTask of cancelledTasks) {
          if (cancelledTask.comment.id === undefined) {
            continue
          }
          try {
            await updateComment(ctx, octokit, {
              ...commentParams,
              comment_id: cancelledTask.comment.id,
              body: `@${requester} \`${cancelledTask.command}\`${
                cancelledTask.gitlab.pipeline === null ? "" : ` (${cancelledTask.gitlab.pipeline.jobWebUrl})`
              } was cancelled in ${comment.html_url}`,
            })
          } catch (error) {
            logger.error(
              { error, task: cancelledTask },
              `Failed to update the cancel comment of task ${cancelledTask.id}`,
            )
          }
        }

        if (failedToCancelTasks.length) {
          return getError(
            `Successfully cancelled the following tasks: ${JSON.stringify(
              cancelledTasks.map((task) => task.id),
            )}\n\nFailed to cancel the following tasks: ${JSON.stringify(failedToCancelTasks.map((task) => task.id))}`,
          )
        }

        if (cancelledTasks.length === 0) {
          if (taskId) {
            return getError(`No task matching ${taskId} was found`)
          } else {
            return getError("No task is being executed for this pull request")
          }
        }
      }
    }
  } catch (rawError) {
    const errMessage = intoError(rawError)
    const msg = `Exception caught in webhook handler\n${errMessage.message}`
    logger.fatal(displayError(rawError), msg)
    return getError(msg)
  }
}
