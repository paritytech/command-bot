import { EmitterWebhookEventName } from "@octokit/webhooks/dist-types/types"
import { IssueCommentCreatedEvent } from "@octokit/webhooks-types/schema"
import path from "path"
import { Probot } from "probot"

import {
  defaultParseTryRuntimeBotCommandOptions,
  isRequesterAllowed,
  parsePullRequestBotCommand,
  parsePullRequestBotCommandArgs,
} from "./core"
import {
  createComment,
  ExtendedOctokit,
  getOctokit,
  getPostPullRequestResult,
  updateComment,
} from "./github"
import {
  getNextTaskId,
  PullRequestTask,
  queuedTasks,
  queueTask,
  serializeTaskQueuedDate,
} from "./task"
import { Context, PullRequestError } from "./types"
import { displayCommand, displayError, getLines } from "./utils"

export const botPullRequestCommentMention = "/try-runtime"

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
  const { logger, repositoryCloneDirectory, cargoTargetDir } = ctx

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
  let commentId: number | undefined = undefined

  const getError = (body: string) => {
    return new PullRequestError(pr, { body, requester, commentId })
  }

  try {
    const commandLines = getLines(comment.body)
      .map((line) => {
        return parsePullRequestBotCommand(
          line,
          defaultParseTryRuntimeBotCommandOptions,
        )
      })
      .filter((line) => {
        return !!line
      })

    const command = commandLines[0]
    if (command === undefined) {
      return
    }

    if (commandLines.length > 1) {
      return getError("Only one try-runtime-bot command is allowed per comment")
    }

    if (!(await isRequesterAllowed(ctx, octokit, requester))) {
      return getError(
        "Requester could not be detected as a member of an allowed organization.",
      )
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
            gitRef.owner === pr.owner &&
            gitRef.repo === pr.repo &&
            gitRef.prNumber === pr.number
          ) {
            return getError(
              "try-runtime is already being executed for this pull request",
            )
          }
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

        const parsedArgs = parsePullRequestBotCommandArgs(ctx, otherArgs)
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
          ...pr,
          id: getNextTaskId(),
          tag: "PullRequestTask",
          requester,
          execPath,
          args,
          env: {
            ...command.env,
            CARGO_TERM_COLOR: "never",
            ...(cargoTargetDir ? { CARGO_TARGET_DIR: cargoTargetDir } : {}),
          },
          commentId,
          installationId,
          gitRef: {
            owner: pr.owner,
            repo: pr.repo,
            contributor,
            branch,
            prNumber: pr.number,
          },
          commandDisplay: displayCommand({ execPath, args, secretsToHide: [] }),
          timesRequeued: 0,
          timesRequeuedSnapshotBeforeExecution: 0,
          timesExecuted: 0,
          repoPath: path.join(repositoryCloneDirectory, pr.repo),
          queuedDate: serializeTaskQueuedDate(queuedDate),
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
        const commentIdsToCancel: number[] = []

        for (const { task, cancel } of queuedTasks.values()) {
          if (task.tag !== "PullRequestTask") {
            continue
          }
          const { gitRef } = task
          if (
            gitRef.owner === pr.owner &&
            gitRef.repo === pr.repo &&
            gitRef.prNumber === pr.number
          ) {
            void cancel()
            commentIdsToCancel.push(task.commentId)
          }
        }

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
