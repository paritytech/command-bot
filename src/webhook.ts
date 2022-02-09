import { IssueCommentCreatedEvent } from "@octokit/webhooks-types/schema"
import { Mutex } from "async-mutex"
import path from "path"
import { Probot } from "probot"

import {
  botMentionPrefix,
  defaultTryRuntimeGetCommandOptions,
} from "./constants"
import {
  getPullRequestTaskHandle,
  getRegisterPullRequestHandle,
  queue,
} from "./executor"
import {
  createComment,
  ExtendedOctokit,
  getOctokit,
  getPostPullRequestResult,
  getPullRequestHandleId,
  isOrganizationMember,
  updateComment,
} from "./github"
import { Logger } from "./logger"
import {
  PullRequestError,
  PullRequestTask,
  State,
  WebhookEvents,
} from "./types"
import { displayCommand, getCommand, getLines, getParsedArgs } from "./utils"

type WebhookEventPayload<E extends WebhookEvents> =
  E extends "issue_comment.created" ? IssueCommentCreatedEvent : never

type WebhookHandler<E extends WebhookEvents> = (
  logger: Logger,
  octokit: ExtendedOctokit,
  event: WebhookEventPayload<E>,
) => Promise<PullRequestError | void>

export const setupEvent = function <E extends WebhookEvents>(
  bot: Probot,
  eventName: E,
  handler: WebhookHandler<E>,
  logger: Logger,
) {
  bot.on(eventName, async function (event) {
    logger.debug(event, `Got event for ${eventName}`)

    const installationId: number | undefined =
      "installation" in event.payload
        ? event.payload.installation?.id
        : undefined
    const octokit = getOctokit(await bot.auth(installationId))

    try {
      const result = await handler(
        logger.child({ event: eventName, eventId: event.id }),
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
          await updateComment(octokit, {
            ...sharedCommentParams,
            comment_id: commentId,
          })
        } else {
          await createComment(octokit, sharedCommentParams)
        }
      }
    } catch (error) {
      logger.fatal(error, "Exception caught in webhook handler")
    }
  })
}

// Mutexes are used so that payloads are handled one-at-a-time; this is will
// not get the bot stuck until the command finishes, however, since queueing
// should be asynchronous
const mutex = new Mutex()
export const getWebhooksHandlers = function (state: State) {
  const {
    logger,
    version,
    allowedOrganizations,
    repositoryCloneDirectory,
    nodesAddresses,
  } = state

  const isRequesterAllowed = async function (
    octokit: ExtendedOctokit,
    username: string,
  ) {
    for (const organizationId of allowedOrganizations) {
      if (
        await isOrganizationMember({
          organizationId,
          username,
          octokit,
          logger,
        })
      ) {
        return true
      }
    }

    return false
  }

  const onIssueCommentCreated: WebhookHandler<"issue_comment.created"> =
    async function (eventName, octokit, payload) {
      // Note: async-mutex implements a "fair mutex" which means requests will be
      // queued in the same order as they're received; if changing to a different
      // library then verify that this aspect is maintained.
      await mutex.runExclusive(async function () {
        const { issue, comment, repository, installation } = payload

        if (!("pull_request" in issue)) {
          logger.debug(
            payload,
            `Skipping payload in ${eventName} because it's not from a pull request`,
          )
          return
        }

        const requester = comment.user?.login

        if (!requester) {
          logger.debug(payload, "Skipping payload because it has no requester")
          return
        }

        if (payload.action !== "created") {
          logger.debug(
            payload,
            "Skipping payload because it's not for created comments",
          )
          return
        }

        if (comment.user?.type !== "User") {
          logger.debug(
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
        const handleId = getPullRequestHandleId(prParams)
        let commentId: number | undefined = undefined

        const getError = function (body: string) {
          return new PullRequestError(prParams, { body, requester, commentId })
        }

        try {
          const commandLine = getLines(comment.body).find(function (line) {
            return line.includes(botMentionPrefix)
          })
          if (!commandLine) {
            return
          }

          if (!(await isRequesterAllowed(octokit, requester))) {
            return getError(
              "Requester could not be detected as a member of an allowed organization.",
            )
          }

          const { execPath: botMention, ...command } = getCommand(
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

              if (getPullRequestTaskHandle(handleId) !== undefined) {
                return getError(
                  "try-runtime is already being executed for this pull request",
                )
              }

              const prResponse = await octokit.pulls.get(prParams)
              if (prResponse.status !== 200) {
                return getError(
                  `When trying to fetch the pull request, Github API responded with unexpected status ${
                    prResponse.status
                  }\n(${JSON.stringify(prResponse.data)})`,
                )
              }

              const contributor = prResponse.data.head?.user?.login
              if (!contributor) {
                return getError(
                  `Failed to get branch owner from the Github API`,
                )
              }

              const branch = prResponse.data.head?.ref
              if (!branch) {
                return getError(`Failed to get branch name from the Github API`)
              }

              const commentBody =
                `Preparing try-runtime command for branch: \`${branch}\`. Comment will be updated.\n\n`.trim()
              const commentCreationResponse = await createComment(octokit, {
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

              const parsedArgs = getParsedArgs(nodesAddresses, otherArgs)
              if (typeof parsedArgs === "string") {
                return getError(parsedArgs)
              }

              const execPath = "cargo"
              const args = [
                "run",
                // application requirement: always run the command in release mode
                // see https://github.com/paritytech/try-runtime-bot/issues/26#issue-1049555966
                "--release",
                // "--quiet" should be kept so that the output doesn't get
                // polluted with a bunch of compilation stuff; bear in mind the
                // output is posted on Github comments which have limited
                // character count
                "--quiet",
                "--features=try-runtime",
                "try-runtime",
                ...parsedArgs,
              ]

              const taskData: PullRequestTask = {
                ...prParams,
                tag: "PullRequestTask",
                handleId,
                requester,
                execPath,
                args,
                env: command.env,
                commentId,
                installationId,
                gitRef: { owner, repo, contributor, branch },
                version,
                commandDisplay: displayCommand({
                  execPath,
                  args,
                  secretsToHide: [],
                }),
                timesRequeued: 0,
                timesRequeuedSnapshotBeforeExecution: 0,
                timesExecuted: 0,
                repoPath: path.join(repositoryCloneDirectory, repo),
              }

              const message = await queue({
                taskData,
                onResult: getPostPullRequestResult({
                  taskData,
                  octokit,
                  state,
                }),
                state,
                registerHandle: getRegisterPullRequestHandle(taskData),
              })
              await updateComment(octokit, {
                ...commentParams,
                comment_id: commentId,
                body: `${commentBody}\n${message}`,
              })

              break
            }
            case "cancel": {
              const cancelItem = getPullRequestTaskHandle(handleId)
              if (cancelItem === undefined) {
                return getError(`No command is running for this pull request`)
              }

              const {
                cancel,
                task: { commentId },
              } = cancelItem

              await cancel()
              await updateComment(octokit, {
                ...commentParams,
                comment_id: commentId,
                body: `@${requester} command was cancelled`.trim(),
              })

              break
            }
            default: {
              return getError(`Unknown sub-command ${subCommand}`)
            }
          }
        } catch (error) {
          const cancelHandle = getPullRequestTaskHandle(handleId)

          if (cancelHandle !== undefined) {
            const { cancel } = cancelHandle
            await cancel()
          }

          return getError(
            `Exception caught in webhook handler\n${error.toString()}: ${
              error.stack
            }`,
          )
        }
      })
    }

  return { onIssueCommentCreated }
}
