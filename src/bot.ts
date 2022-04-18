import { EmitterWebhookEventName } from "@octokit/webhooks/dist-types/types"
import { IssueCommentCreatedEvent } from "@octokit/webhooks-types/schema"
import path from "path"
import { Probot } from "probot"

import {
  botMentionPrefix,
  defaultTryRuntimeGetCommandOptions,
} from "./constants"
import {
  isRequesterAllowed,
  parseTryRuntimeBotCommand,
  parseTryRuntimeBotCommandArgs,
} from "./core"
import { queueTask } from "./executor"
import {
  createComment,
  ExtendedOctokit,
  getOctokit,
  getPostPullRequestResult,
  updateComment,
} from "./github"
import { getNextTaskId, queuedTasks } from "./task"
import { Context, PullRequestError, PullRequestTask } from "./types"
import { displayCommand, displayError, getLines } from "./utils"

export type WebhookEvents = Extract<
  EmitterWebhookEventName,
  "issue_comment.created"
>

type WebhookEventPayload<E extends WebhookEvents> =
  E extends "issue_comment.created" ? IssueCommentCreatedEvent : never

type WebhookHandler<E extends WebhookEvents> = (
  ctx: Context,
  octokit: ExtendedOctokit,
  event: WebhookEventPayload<E>,
) => Promise<PullRequestError | undefined>

const onIssueCommentCreated: WebhookHandler<"issue_comment.created"> = async (
  ctx: Context,
  octokit,
  payload,
) => {
  const { logger, serverInfo, repositoryCloneDirectory } = ctx

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

  const repo = repository.name
  const owner = repository.owner.login
  const pullNumber = issue.number
  const prParams = { owner, repo, pull_number: pullNumber }
  const commentParams = { owner, repo, issue_number: pullNumber }
  let commentId: number | undefined = undefined

  const getError = (body: string) => {
    return new PullRequestError(prParams, { body, requester, commentId })
  }

  const cancelPullRequestTasks = () => {
    const commentIds: number[] = []

    for (const { task, cancel } of queuedTasks.values()) {
      if (task.tag !== "PullRequestTask") {
        continue
      }
      const { gitRef } = task
      if (
        gitRef.owner === owner &&
        gitRef.repo === repo &&
        gitRef.number === prParams.pull_number
      ) {
        void cancel()
        commentIds.push(task.commentId)
      }
    }

    return commentIds
  }

  try {
    const commandLine = getLines(comment.body).find((line) => {
      return line.includes(botMentionPrefix)
    })
    if (!commandLine) {
      return
    }

    if (!(await isRequesterAllowed(ctx, octokit, requester))) {
      return getError(
        "Requester could not be detected as a member of an allowed organization.",
      )
    }

    const { execPath: botMention, ...command } = parseTryRuntimeBotCommand(
      commandLine,
      defaultTryRuntimeGetCommandOptions,
    )
    if (botMention !== botMentionPrefix) {
      return
    }

    const [subCommand, ...otherArgs] = command.args

    switch (subCommand) {
      case "queue": {
        const installationId = installation?.id
        if (!installationId) {
          return getError(
            "Github Installation ID was not found in webhook payload",
          )
        }

        for (const { task } of queuedTasks.values()) {
          if (task.tag !== "PullRequestTask") {
            continue
          }
          const { gitRef } = task
          if (
            gitRef.owner === owner &&
            gitRef.repo === repo &&
            gitRef.number === prParams.pull_number
          ) {
            return getError(
              "try-runtime is already being executed for this pull request",
            )
          }
        }

        const prResponse = await octokit.pulls.get(prParams)

        const contributor = prResponse.data.head?.user?.login
        if (!contributor) {
          return getError(`Failed to get branch owner from the Github API`)
        }

        const branch = prResponse.data.head?.ref
        if (!branch) {
          return getError(`Failed to get branch name from the Github API`)
        }

        const commentBody =
          `Preparing try-runtime command for branch: \`${branch}\`. Comment will be updated.\n\n`.trim()
        const commentCreationResponse = await createComment(ctx, octokit, {
          ...commentParams,
          body: commentBody,
        })
        if (commentCreationResponse.status !== 201) {
          return getError(
            `When trying to create a comment in the pull request, Github API responded with unexpected status ${
              prResponse.status
            }\n(${JSON.stringify(commentCreationResponse.data)})`,
          )
        }
        commentId = commentCreationResponse.id

        const parsedArgs = parseTryRuntimeBotCommandArgs(ctx, otherArgs)
        if (typeof parsedArgs === "string") {
          return getError(parsedArgs)
        }

        const queuedDate = new Date()

        const execPath = "cargo"
        const args = [
          "run",
          /*
            Application requirement: always run the command in release mode.
            See https://github.com/paritytech/try-runtime-bot/issues/26#issue-1049555966
          */
          "--release",
          /*
            "--quiet" should be kept so that the output doesn't get polluted
            with a bunch of compilation stuff; bear in mind the output is posted
            on Github comments which have limited character count
          */
          "--quiet",
          "--features=try-runtime",
          "try-runtime",
          ...parsedArgs,
        ]

        const task: PullRequestTask = {
          ...prParams,
          id: getNextTaskId(),
          tag: "PullRequestTask",
          requester,
          execPath,
          args,
          env: { ...command.env, CARGO_TERM_COLOR: "never" },
          commentId,
          installationId,
          gitRef: {
            owner,
            repo,
            contributor,
            branch,
            number: prParams.pull_number,
          },
          commandDisplay: displayCommand({ execPath, args, secretsToHide: [] }),
          timesRequeued: 0,
          timesRequeuedSnapshotBeforeExecution: 0,
          timesExecuted: 0,
          repoPath: path.join(repositoryCloneDirectory, repo),
          serverId: serverInfo.id,
          queuedDate: queuedDate.toISOString(),
        }

        const message = await queueTask(ctx, task, {
          onResult: getPostPullRequestResult(ctx, octokit, task),
        })
        await updateComment(ctx, octokit, {
          ...commentParams,
          comment_id: commentId,
          body: `${commentBody}\n${message}`,
        })

        break
      }
      case "cancel": {
        const commentIdsToCancel: number[] = cancelPullRequestTasks()

        if (commentIdsToCancel.length === 0) {
          return getError(
            "try-runtime is already being executed for this pull request",
          )
        }

        for (const commentIdToCancel of commentIdsToCancel) {
          await updateComment(ctx, octokit, {
            ...commentParams,
            comment_id: commentIdToCancel,
            body: `@${requester} command was cancelled`.trim(),
          })
        }

        break
      }
      default: {
        return getError(`Invalid sub-command: ${subCommand}`)
      }
    }
  } catch (rawError) {
    cancelPullRequestTasks()
    return getError(
      `Exception caught in webhook handler\n${displayError(rawError)}`,
    )
  }
}

export const setupEvent = <E extends WebhookEvents>(
  parentCtx: Context,
  bot: Probot,
  eventName: E,
  handler: WebhookHandler<E>,
) => {
  bot.on(eventName, async (event) => {
    const { logger } = parentCtx
    const eventLogger = logger.child({ eventId: event.id, eventName })
    const ctx = { ...parentCtx, eventLogger }

    eventLogger.info({ event, eventName }, "Received bot event")

    const installationId: number | undefined =
      "installation" in event.payload
        ? event.payload.installation?.id
        : undefined
    const octokit = getOctokit(ctx, await bot.auth(installationId))

    try {
      const result = await handler(
        ctx,
        octokit,
        event.payload as WebhookEventPayload<E>,
      )
      if (result instanceof PullRequestError) {
        const {
          params: { pull_number, ...params },
          comment: { body, commentId, requester },
        } = result
        const sharedCommentParams = {
          ...params,
          issue_number: pull_number,
          body: `${requester ? `@${requester} ` : ""}${body}`,
        }

        if (commentId) {
          await updateComment(ctx, octokit, {
            ...sharedCommentParams,
            comment_id: commentId,
          })
        } else {
          await createComment(ctx, octokit, sharedCommentParams)
        }
      }
    } catch (error) {
      logger.fatal(error, "Exception caught in webhook handler")
    }
  })
}

export const setupBot = (ctx: Context, bot: Probot) => {
  setupEvent(ctx, bot, "issue_comment.created", onIssueCommentCreated)
}
