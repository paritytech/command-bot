import { Octokit } from "@octokit/rest"
import { EmitterWebhookEvent as WebhookEvent } from "@octokit/webhooks"
import { EmitterWebhookEventName as WebhookEvents } from "@octokit/webhooks/dist-types/types"
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
import { PullRequestError, PullRequestTask, State } from "./types"
import { displayCommand, getCommand, getLines } from "./utils"

type WebhookHandler<E extends WebhookEvents> = (
  event: {
    octokit: ExtendedOctokit
  } & WebhookEvent<E>,
) => Promise<PullRequestError | void> | PullRequestError | void

export const setupEvent = function <E extends WebhookEvents>(
  bot: Probot,
  event: E,
  handler: WebhookHandler<E>,
  logger: Logger,
) {
  bot.on(event, async function (data) {
    const installationId: number | undefined = (data.payload as any)
      .installation?.id
    const octokit = getOctokit(
      await (bot.auth as (installationId?: number) => Promise<Octokit>)(
        installationId,
      ),
    )

    try {
      const result = await handler({ ...data, octokit })
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
  const { logger, version, allowedOrganizations, repositoryCloneDirectory } =
    state

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
    function ({ payload, octokit }) {
      // Note: async-mutex implements a "fair mutex" which means requests will be
      // queued in the same order as they're received; if changing to a different
      // library then verify that this aspect is maintained.
      return mutex.runExclusive(async function () {
        const { issue, comment, repository, installation } = payload
        const requester = comment.user?.login

        if (
          !requester ||
          // eslint-disable-next-line no-prototype-builtins
          !issue.hasOwnProperty("pull_request") ||
          payload.action !== "created" ||
          comment.user?.type !== "User"
        ) {
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
                `Preparing try-runtime command for branch: "${branch}". Comment will be updated.`.trim()
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

              const execPath = "cargo"
              const args = [
                "run",
                // "--quiet" should be kept so that the output doesn't get
                // polluted with a bunch of compilation stuff; bear in mind the
                // output is posted on Github issues which have limited
                // character count
                "--quiet",
                "--features=try-runtime",
                "try-runtime",
                ...otherArgs,
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
