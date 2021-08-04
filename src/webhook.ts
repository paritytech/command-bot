import { Octokit } from "@octokit/rest"
import { EmitterWebhookEvent as WebhookEvent } from "@octokit/webhooks"
import { EmitterWebhookEventName as WebhookEvents } from "@octokit/webhooks/dist-types/types"
import { Mutex } from "async-mutex"
import path from "path"
import { Probot } from "probot"

import { cancelHandles, queue } from "./executor"
import {
  createComment,
  ExtendedOctokit,
  getOctokit,
  isOrganizationMember,
  updateComment,
} from "./github"
import { Logger } from "./logger"
import { AppState, PullRequestError, PullRequestTask } from "./types"
import {
  getCommand,
  getLines,
  getPostPullRequestResult,
  getPullRequestHandleId,
} from "./utils"

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
    } catch (err) {
      logger.fatal(err, "Exception caught in webhook handler")
    }
  })
}

// Mutexes are used so that payloads are handled one-at-a-time; this is will
// not get the bot stuck until the command finishes, however, since queueing
// should be asynchronous
const mutex = new Mutex()
export const getWebhooksHandlers = function (
  state: Pick<
    AppState,
    | "botMentionPrefix"
    | "db"
    | "logger"
    | "nodesAddresses"
    | "getFetchEndpoint"
    | "version"
    | "allowedOrganizations"
    | "repositoryCloneDirectory"
    | "deployment"
  >,
) {
  const {
    botMentionPrefix,
    logger,
    nodesAddresses,
    version,
    allowedOrganizations,
    repositoryCloneDirectory,
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
          return new PullRequestError(prParams, {
            body,
            requester,
            commentId,
          })
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

          const { execPath: botMention, ...command } = getCommand(commandLine, {
            baseEnv: { RUST_LOG: "remote-ext=info" },
          })
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

              if (cancelHandles.get(handleId) !== undefined) {
                return getError(
                  "try-runtime is already being executed for this pull request",
                )
              }

              const execPath = "cargo"
              const nodeOptionsDisplay = `Available names are: ${Object.keys(
                nodesAddresses,
              ).join(", ")}.`

              const addressPrefix = ["wss://", "ws://"]
              toNextArg: for (const i in otherArgs) {
                for (const prefix of addressPrefix) {
                  const arg = otherArgs[i]
                  if (arg.startsWith(prefix)) {
                    const node = arg.slice(prefix.length)

                    if (!node) {
                      return getError(
                        `Must specify one address in the form \`${prefix}name\` (found "${arg}"). ${nodeOptionsDisplay}`,
                      )
                    }

                    const nodeAddress = nodesAddresses[node]
                    if (!nodeAddress) {
                      return getError(
                        `Nodes are referred to by name. No node named "${node}" is available. ${nodeOptionsDisplay}`,
                      )
                    }

                    otherArgs[i] = nodeAddress
                    continue toNextArg
                  }
                }
              }

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

              const repoPath = path.join(repositoryCloneDirectory, repo)

              const taskData: PullRequestTask = {
                ...prParams,
                requester,
                execPath,
                args,
                env: command.env,
                commentId,
                installationId,
                prepareBranchParams: {
                  owner,
                  repo,
                  contributor,
                  branch,
                  repoPath,
                },
                version,
              }

              const message = await queue({
                handleId,
                taskData,
                onResult: getPostPullRequestResult({
                  taskData,
                  octokit,
                  handleId,
                  logger: state.logger,
                }),
                state,
              })

              await updateComment(octokit, {
                ...commentParams,
                comment_id: commentId,
                body: `${commentBody}\n${message}`,
              })

              break
            }
            case "cancel": {
              const cancelItem = cancelHandles.get(handleId)
              if (cancelItem === undefined) {
                return getError(`No command is running for this pull request`)
              }

              const { cancel, commentId } = cancelItem
              await cancel()
              cancelHandles.delete(handleId)

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
        } catch (err) {
          const cancelHandle = cancelHandles.get(handleId)

          if (cancelHandle) {
            const { cancel } = cancelHandle
            await cancel()
            cancelHandles.delete(handleId)
          }

          return getError(`Exception caught in webhook handler\n${err.stack}`)
        }
      })
    }

  return {
    onIssueCommentCreated,
  }
}
