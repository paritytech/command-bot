import { EmitterWebhookEventName } from "@octokit/webhooks/dist-types/types"
import { IssueCommentCreatedEvent } from "@octokit/webhooks-types/schema"
import path from "path"
import { Probot } from "probot"

import { isRequesterAllowed } from "./core"
import { getSortedTasks } from "./db"
import {
  createComment,
  ExtendedOctokit,
  getOctokit,
  getPostPullRequestResult,
  updateComment,
} from "./github"
import {
  cancelTask,
  getNextTaskId,
  PullRequestTask,
  queueTask,
  serializeTaskQueuedDate,
} from "./task"
import { Context, PullRequestError } from "./types"
import { displayError, getLines } from "./utils"

export const botPullRequestCommentMention = "/cmd"

type ParsedBotCommand = {
  jobTags: string[]
  command: string
  subCommand: "queue" | "cancel"
}
export const parsePullRequestBotCommandLine = (rawCommandLine: string) => {
  let commandLine = rawCommandLine.trim()

  if (!commandLine.startsWith(botPullRequestCommentMention)) {
    return
  }

  commandLine = commandLine.slice(botPullRequestCommentMention.length).trim()

  const subCommand = (() => {
    const nextToken = /^\w+/.exec(commandLine)?.[0]
    if (!nextToken) {
      return new Error(`Must provide a subcommand in line ${rawCommandLine}.`)
    }
    switch (nextToken) {
      case "cancel":
      case "queue": {
        return nextToken
      }
      default: {
        return new Error(
          `Invalid subcommand "${nextToken}" in line ${rawCommandLine}.`,
        )
      }
    }
  })()
  if (subCommand instanceof Error) {
    return subCommand
  }

  commandLine = commandLine.slice(subCommand.length)

  switch (subCommand) {
    case "queue": {
      const startOfArgs = " $ "
      const indexOfArgsStart = commandLine.indexOf(startOfArgs)
      if (indexOfArgsStart === -1) {
        return new Error(`Could not find start of arguments ("${startOfArgs}")`)
      }

      const commandLinePart = commandLine.slice(
        indexOfArgsStart + startOfArgs.length,
      )

      const botOptionsLinePart = commandLine.slice(0, indexOfArgsStart)
      const botOptionsTokens = botOptionsLinePart.split(" ").filter((value) => {
        botOptionsLinePart
        return !!value
      })

      let activeOption: string | undefined = undefined
      const options: Map<string, string[]> = new Map()
      for (const tok of botOptionsTokens) {
        if (tok[0] === "-") {
          activeOption = tok
        } else if (activeOption) {
          options.set(activeOption, [...(options.get(activeOption) ?? []), tok])
        } else {
          return new Error(`Expected command option, got ${tok}`)
        }
      }

      const jobTags = (options.get("-t") ?? []).concat(
        options.get("--tag") ?? [],
      )

      if ((jobTags?.length ?? 0) === 0) {
        return new Error(
          `Unable to parse job tags from command line ${botOptionsLinePart}`,
        )
      }
      return { jobTags, command: commandLinePart.trim(), subCommand }
    }
    default: {
      return { jobTags: [], command: "", subCommand }
    }
  }
}

type WebhookEvents = Extract<EmitterWebhookEventName, "issue_comment.created">

type WebhookEventPayload<E extends WebhookEvents> =
  E extends "issue_comment.created" ? IssueCommentCreatedEvent : never

type WebhookHandler<E extends WebhookEvents> = (
  ctx: Context,
  octokit: ExtendedOctokit,
  event: WebhookEventPayload<E>,
) => Promise<PullRequestError | undefined>

const onIssueCommentCreated: WebhookHandler<"issue_comment.created"> = async (
  ctx,
  octokit,
  payload,
) => {
  const { logger, repositoryCloneDirectory, gitlab } = ctx

  const { issue, comment, repository, installation } = payload

  if (!("pull_request" in issue)) {
    logger.info(
      payload,
      `Skipping payload because it's not from a pull request`,
    )
    return
  }

  const requester = comment.user?.login

  if (!requester) {
    logger.info(payload, "Skipping payload because it has no requester")
    return
  }

  if (payload.action !== "created") {
    logger.info(
      payload,
      "Skipping payload because it's not for created comments",
    )
    return
  }

  if (comment.user?.type !== "User") {
    logger.info(
      payload,
      `Skipping payload because comment.user.type (${comment.user?.type}) is not "User"`,
    )
    return
  }

  const pr = {
    owner: repository.owner.login,
    repo: repository.name,
    number: issue.number,
  }
  const commentParams = {
    owner: pr.owner,
    repo: pr.repo,
    issue_number: pr.number,
  }

  let getError = (body: string) => {
    return new PullRequestError(pr, { body, requester })
  }

  try {
    const commands: ParsedBotCommand[] = []
    for (const line of getLines(comment.body)) {
      const parsedCommand = parsePullRequestBotCommandLine(line)

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
      return getError(
        "Requester could not be detected as a member of an allowed organization.",
      )
    }

    for (const parsedCommand of commands) {
      switch (parsedCommand.subCommand) {
        case "queue": {
          const installationId = installation?.id
          if (!installationId) {
            return getError(
              "Github Installation ID was not found in webhook payload",
            )
          }

          const prResponse = await octokit.pulls.get({
            owner: pr.owner,
            repo: pr.repo,
            pull_number: pr.number,
          })

          const contributor = prResponse.data.head?.user?.login
          if (!contributor) {
            return getError(`Failed to get branch owner from the Github API`)
          }

          const branch = prResponse.data.head?.ref
          if (!branch) {
            return getError(`Failed to get branch name from the Github API`)
          }

          const commentBody =
            `Preparing command "${parsedCommand.command}". This comment will be updated later.`.trim()
          const createdComment = await createComment(ctx, octokit, {
            ...commentParams,
            body: commentBody,
          })
          if (createdComment.status !== 201) {
            return getError(
              `The GitHub API responded with unexpected status ${
                prResponse.status
              } when trying to create a comment in the pull request\n\`\`\`\n(${JSON.stringify(
                createdComment.data,
              )})\n\`\`\``,
            )
          }
          getError = (body: string) => {
            return new PullRequestError(pr, {
              body,
              requester,
              commentId: createdComment.id,
            })
          }

          const queuedDate = new Date()

          const task: PullRequestTask = {
            ...pr,
            id: getNextTaskId(),
            tag: "PullRequestTask",
            requester,
            command: parsedCommand.command,
            comment: { id: createdComment.id, htmlUrl: createdComment.htmlUrl },
            installationId,
            gitRef: {
              owner: pr.owner,
              repo: pr.repo,
              contributor,
              branch,
              prNumber: pr.number,
            },
            timesRequeued: 0,
            timesRequeuedSnapshotBeforeExecution: 0,
            timesExecuted: 0,
            repoPath: path.join(repositoryCloneDirectory, pr.repo),
            queuedDate: serializeTaskQueuedDate(queuedDate),
            gitlab: {
              job: {
                tags: parsedCommand.jobTags,
                image: gitlab.defaultJobImage,
              },
              pipeline: null,
            },
          }

          const updateProgress = (message: string) => {
            return updateComment(ctx, octokit, {
              ...commentParams,
              comment_id: createdComment.id,
              body: message,
            })
          }
          const queueMessage = await queueTask(ctx, task, {
            onResult: getPostPullRequestResult(ctx, octokit, task),
            updateProgress,
          })
          await updateProgress(queueMessage)

          break
        }
        case "cancel": {
          const cancelledTasks: { id: string; commentId?: number }[] = []

          for (const { task } of await getSortedTasks(ctx)) {
            if (task.tag !== "PullRequestTask") {
              continue
            }
            const { gitRef } = task
            if (
              gitRef.owner === pr.owner &&
              gitRef.repo === pr.repo &&
              gitRef.prNumber === pr.number
            ) {
              try {
                await cancelTask(ctx, task)
                cancelledTasks.push(task)
              } catch (error) {
                logger.error(error, `Failed to cancel task ${task.id}`)
              }
            }
          }

          if (cancelledTasks.length === 0) {
            return getError(
              "try-runtime is not being executed for this pull request",
            )
          }

          for (const cancelledTask of cancelledTasks) {
            if (cancelledTask.commentId === undefined) {
              continue
            }
            await updateComment(ctx, octokit, {
              ...commentParams,
              comment_id: cancelledTask.commentId,
              body: `@${requester} command was cancelled`.trim(),
            })
          }

          break
        }
        default: {
          const exhaustivenessCheck: never = parsedCommand.subCommand
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          return getError(`Invalid sub-command: ${exhaustivenessCheck}`)
        }
      }
    }
  } catch (rawError) {
    return getError(
      `Exception caught in webhook handler\n${displayError(rawError)}`,
    )
  }
}

const setupEvent = <E extends WebhookEvents>(
  parentCtx: Context,
  bot: Probot,
  eventName: E,
  handler: WebhookHandler<E>,
) => {
  bot.on(eventName, async (event) => {
    const { logger } = parentCtx
    const eventLogger = logger.child({ eventId: event.id, eventName })
    const ctx: Context = { ...parentCtx, logger: eventLogger }

    eventLogger.info({ event, eventName }, "Received bot event")

    const installationId: number | undefined =
      "installation" in event.payload
        ? event.payload.installation?.id
        : undefined
    const octokit = getOctokit(ctx, await bot.auth(installationId))

    void handler(ctx, octokit, event.payload as WebhookEventPayload<E>)
      .then(async (result) => {
        if (result instanceof PullRequestError) {
          const { pr, comment } = result

          const sharedCommentParams = {
            owner: pr.owner,
            repo: pr.repo,
            issue_number: pr.number,
            body: `${comment.requester ? `@${comment.requester} ` : ""}${
              comment.body
            }`,
          }

          if (comment.commentId) {
            await updateComment(ctx, octokit, {
              ...sharedCommentParams,
              comment_id: comment.commentId,
            })
          } else {
            await createComment(ctx, octokit, sharedCommentParams)
          }
        }
      })
      .catch((error) => {
        logger.fatal(error, "Exception caught in webhook handler")
      })
  })
}

export const setupBot = (ctx: Context, bot: Probot) => {
  setupEvent(ctx, bot, "issue_comment.created", onIssueCommentCreated)
}
