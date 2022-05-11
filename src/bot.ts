import { EmitterWebhookEventName } from "@octokit/webhooks/dist-types/types"
import { IssueCommentCreatedEvent } from "@octokit/webhooks-types/schema"
import path from "path"
import { Probot } from "probot"

import {
  CommandConfiguration,
  commandsConfiguration,
  isRequesterAllowed,
} from "./core"
import { getSortedTasks } from "./db"
import {
  createComment,
  ExtendedOctokit,
  getOctokit,
  getPostPullRequestResult,
  updateComment,
} from "./github"
import { validateSingleShellCommand } from "./shell"
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
export const botPullRequestCommentSubcommands: {
  [Subcommand in "queue" | "cancel"]: Subcommand
} = { queue: "queue", cancel: "cancel" }

type ParsedBotCommand =
  | {
      subcommand: "queue"
      configuration: CommandConfiguration
      variables: Record<string, string>
      command: string
    }
  | {
      subcommand: "cancel"
    }
const parsePullRequestBotCommandLine = async (
  ctx: Context,
  rawCommandLine: string,
) => {
  let commandLine = rawCommandLine.trim()

  // Add trailing whitespace so that /cmd can be differentiated from /cmd-[?]
  if (!commandLine.startsWith(`${botPullRequestCommentMention} `)) {
    return
  }

  commandLine = commandLine.slice(botPullRequestCommentMention.length).trim()

  const subcommand = (() => {
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
  if (subcommand instanceof Error) {
    return subcommand
  }

  commandLine = commandLine.slice(subcommand.length)

  switch (subcommand) {
    case "queue": {
      const commandStartSymbol = " $ "
      const indexOfCommandStart = commandLine.indexOf(commandStartSymbol)
      if (indexOfCommandStart === -1) {
        return new Error(
          `Could not find start of command ("${commandStartSymbol}")`,
        )
      }

      const commandLinePart = commandLine.slice(
        indexOfCommandStart + commandStartSymbol.length,
      )

      const botOptionsLinePart = commandLine.slice(0, indexOfCommandStart)
      const botOptionsTokens = botOptionsLinePart.split(" ").filter((value) => {
        botOptionsLinePart
        return !!value
      })

      let activeOption: string | undefined = undefined

      const options: Map<string, string[]> = new Map()
      const insertOption = (option: string, value: string) => {
        options.set(option, [...(options.get(option) ?? []), value])
      }

      for (const tok of botOptionsTokens) {
        if (activeOption) {
          insertOption(activeOption, tok)
          activeOption = undefined
        } else if (tok[0] === "-") {
          if (/* --foo=bar */ tok.includes("=")) {
            const [option, ...value] = tok.split("=")
            insertOption(option, value.join("="))
          } /* --foo bar */ else {
            activeOption = tok
          }
        } else {
          return new Error(
            `In line "${rawCommandLine}", expected command option but got ${tok}`,
          )
        }
      }
      if (activeOption) {
        return new Error(
          `In line "${rawCommandLine}", expected value for ${activeOption}`,
        )
      }

      const configurationValues = (options.get("-c") ?? []).concat(
        options.get("--configuration") ?? [],
      )
      if (configurationValues.length !== 1) {
        return new Error(
          `Received more than one configuration in "${rawCommandLine}",`,
        )
      }
      const configurationName = configurationValues[0]
      const configuration =
        configurationName in commandsConfiguration
          ? commandsConfiguration[
              configurationName as keyof typeof commandsConfiguration
            ]
          : undefined
      if (!configuration) {
        return new Error(
          `Could not find matching configuration ${configurationName}; available ones are ${Object.keys(
            commandsConfiguration,
          ).join(", ")}.`,
        )
      }

      const variables: Record<string, string> = {}
      const variablesArgs = (options.get("-v") ?? []).concat(
        options.get("--var") ?? [],
      )
      const valueSeparator = "="
      for (const tok of variablesArgs) {
        const valueSeparatorIndex = tok.indexOf(valueSeparator)
        if (valueSeparatorIndex === -1) {
          return new Error(
            `Variable token "${tok}" doesn't have the value separator '${valueSeparator}'`,
          )
        }
        variables[tok.slice(0, valueSeparatorIndex)] = tok.slice(
          valueSeparatorIndex + 1,
        )
      }

      const command = await validateSingleShellCommand(
        ctx,
        [...configuration.commandStart, commandLinePart].join(" "),
      )
      if (command instanceof Error) {
        return command
      }

      return { subcommand, configuration, variables, command }
    }
    default: {
      return { subcommand }
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
      const parsedCommand = await parsePullRequestBotCommandLine(ctx, line)

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
      logger.info(parsedCommand, "Processing parsed command")
      switch (parsedCommand.subcommand) {
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
                ...parsedCommand.configuration.gitlab.job,
                image: gitlab.jobImage,
                variables: parsedCommand.variables,
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
          const cancelledTasks: PullRequestTask[] = []
          const failedToCancelTasks: PullRequestTask[] = []

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
                failedToCancelTasks.push(task)
                logger.error(error, `Failed to cancel task ${task.id}`)
              }
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
                  cancelledTask.gitlab.pipeline === null
                    ? ""
                    : ` (${cancelledTask.gitlab.pipeline.jobWebUrl})`
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
                cancelledTasks.map((task) => {
                  return task.id
                }),
              )}\n\nFailed to cancel the following tasks: ${JSON.stringify(
                failedToCancelTasks.map((task) => {
                  return task.id
                }),
              )}`,
            )
          }

          if (cancelledTasks.length === 0) {
            return getError("No task is being executed for this pull request")
          }

          break
        }
        default: {
          const exhaustivenessCheck: never = parsedCommand
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
