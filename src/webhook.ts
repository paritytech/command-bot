import { Octokit, RestEndpointMethodTypes } from "@octokit/rest"
import assert from "assert"
import { Mutex } from "async-mutex"
import ld from "lodash"
import { Probot } from "probot"
import { EventTypesPayload } from "../node_modules/probot/node_modules/@octokit/webhooks"
import { DB } from "./db"
import { cancelHandles, queue } from "./executor"
import {
  AppState,
  PullRequestError,
  PullRequestParams,
  PullRequestTask,
} from "./types"
import {
  getCommand,
  getLines,
  getPostPullRequestResult,
  getPullRequestHandleId,
} from "./utils"
import path from "path"
import { gitDir } from "./constants"
import {
  updateComment,
  createComment,
  getOctokit,
  isOrganizationMember,
  ExtendedOctokit,
} from "./github"

type WebhookHandler<E extends keyof EventTypesPayload> = (
  event: {
    octokit: ExtendedOctokit
  } & EventTypesPayload[E],
) => Promise<PullRequestError | void> | PullRequestError | void

export const setupEvent = function <E extends keyof EventTypesPayload>(
  bot: Probot,
  event: E,
  handler: WebhookHandler<E>,
) {
  bot.on(event, async function (data) {
    const { octokit: probotOctokit } = data
    const octokit = getOctokit(probotOctokit)

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
      bot.log(`Exception caught in webhook handler\n${err.stack}`)
    }
  })
}

// Mutexes are used so that payloads are handled one-at-a-time; this is will
// not get the bot stuck until the command finishes, however, since queueing
// should be asynchronous
const mutex = new Mutex()
export const getWebhooksHandlers = function ({
  botMention,
  db,
  log,
  nodesAddresses,
  getFetchEndpoint,
  version,
  allowedOrganizations,
}: Pick<
  AppState,
  | "botMention"
  | "db"
  | "log"
  | "nodesAddresses"
  | "getFetchEndpoint"
  | "version"
  | "allowedOrganizations"
>) {
  const botMentionPrefix = "/try-runtime"

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
          log,
        })
      ) {
        return true
      }
    }

    return false
  }

  const onIssueCommentCreated: WebhookHandler<"issue_comment.created"> = function ({
    payload,
    octokit,
  }) {
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

        const { execPath: botMention, ...command } = getCommand(commandLine)
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
              const arg = otherArgs[i]

              for (const prefix of addressPrefix) {
                if (arg.startsWith(prefix)) {
                  const node = arg.slice(prefix.length)

                  if (!node) {
                    return getError(
                      `Must specify one address in the form \`ws://name\` (found \`${arg}\`). ${nodeOptionsDisplay}`,
                    )
                  }

                  const nodeAddress = nodesAddresses[node]
                  if (!nodeAddress) {
                    return getError(
                      `Nodes are referred to by name. No node named "${node}" is available. ${nodeOptionsDisplay}`,
                    )
                  }

                  otherArgs[i] = `${prefix}${nodeAddress}`
                  continue toNextArg
                }
              }
            }

            const args = [
              "run",
              // --quiet should be kept so that the command's output buffer
              // doesn't blow up with a bunch of compilation stuff; bear in
              // mind the output is posted on Github issues which have limited
              // output size
              // https://github.community/t/maximum-length-for-the-comment-body-in-issues-and-pr/148867/2
              "--quiet",
              "--release",
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
              return getError(`Failed to get branch owner from the Github API`)
            }
            const branch = prResponse.data.head?.ref
            if (!branch) {
              return getError(`Failed to get branch name from the Github API`)
            }

            const commentBody = `Starting try-runtime for branch: "${branch}". Comment will be updated.`.trim()
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

            const repoPath = path.join(gitDir, repo)

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
              getFetchEndpoint,
              handleId,
              onResult: getPostPullRequestResult({
                taskData,
                octokit,
                handleId,
              }),
              db,
              log,
              taskData,
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
            break
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
