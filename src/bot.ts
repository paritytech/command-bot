import { EmitterWebhookEventName } from "@octokit/webhooks/dist-types/types"
import { IssueCommentCreatedEvent } from "@octokit/webhooks-types/schema"
import assert from "assert"
import path from "path"
import { Probot } from "probot"
import yargs from "yargs"

import { fetchCommandsConfiguration } from "src/commands"

import { isRequesterAllowed } from "./core"
import { getSortedTasks } from "./db"
import { createComment, ExtendedOctokit, getOctokit, getPostPullRequestResult, updateComment } from "./github"
import { logger } from "./logger"
import { CmdJson } from "./schema/schema.cmd"
import { validateSingleShellCommand } from "./shell"
import { cancelTask, getNextTaskId, PullRequestTask, queueTask, serializeTaskQueuedDate } from "./task"
import { Context, PullRequestError } from "./types"
import { arrayify, displayError, getLines } from "./utils"

export const botPullRequestCommentMention = "/cmd"
export const botPullRequestCommentSubcommands: {
  [Subcommand in "queue" | "cancel"]: Subcommand
} = { queue: "queue", cancel: "cancel" }

type QueueCommand = {
  subcommand: "queue"
  configuration: Pick<CmdJson["command"]["configuration"], "gitlab" | "commandStart"> & {
    optionalCommandArgs?: boolean
  }
  variables: {
    [k: string]: unknown
  }
  command: string
}
type CancelCommand = {
  subcommand: "cancel"
  taskId: string
}

export type ParsedBotCommand = QueueCommand | CancelCommand

export const parsePullRequestBotCommandLine = async (
  rawCommandLine: string,
): Promise<undefined | Error | ParsedBotCommand> => {
  let commandLine = rawCommandLine.trim()

  // Add trailing whitespace so that /cmd can be differentiated from /cmd-[?]
  if (!commandLine.startsWith(`${botPullRequestCommentMention} `)) {
    return
  }

  // remove "/cmd "
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
        return new Error(`Invalid subcommand "${nextToken}" in line ${rawCommandLine}.`)
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
      const [botOptionsLinePart, commandLinePart] = commandLine.split(commandStartSymbol)

      const botArgs = await yargs(
        botOptionsLinePart.split(" ").filter((value) => {
          botOptionsLinePart
          return !!value
        }),
      ).argv
      logger.info({ botArgs, botOptionsLinePart }, "Parsed bot arguments")

      const configurationNameLongArg = "configuration"
      const configurationNameShortArg = "c"
      const configurationName = botArgs[configurationNameLongArg] ?? botArgs[configurationNameShortArg]
      if (typeof configurationName !== "string") {
        return new Error(
          `Configuration ("-${configurationNameShortArg}" or "--${configurationNameLongArg}") should be specified exactly once`,
        )
      }

      const commandsConfiguration = await fetchCommandsConfiguration()
      const configuration = commandsConfiguration[configurationName]?.command?.configuration

      if (typeof configuration === "undefined" || !Object.keys(configuration).length) {
        return new Error(
          `Could not find matching configuration ${configurationName}; available ones are ${Object.keys(
            commandsConfiguration,
          ).join(", ")}.`,
        )
      }

      // if presets has nothing - then it means that the command doesn't need any arguments and runs as is
      if (Object.keys(commandsConfiguration[configurationName]?.command?.presets || [])?.length === 0) {
        configuration.optionalCommandArgs = true
      }

      if (!commandLinePart && configuration.optionalCommandArgs !== true) {
        return new Error(`Could not find start of command ("${commandStartSymbol}")`)
      }

      const variables: Record<string, string> = {}
      const variableValueSeparator = "="
      for (const tok of arrayify(botArgs.var).concat(arrayify(botArgs.v))) {
        switch (typeof tok) {
          case "string": {
            const valueSeparatorIndex = tok.indexOf(variableValueSeparator)
            if (valueSeparatorIndex === -1) {
              return new Error(`Variable token "${tok}" doesn't have a value separator ('${variableValueSeparator}')`)
            }
            variables[tok.slice(0, valueSeparatorIndex)] = tok.slice(valueSeparatorIndex + 1)
            break
          }
          default: {
            return new Error(`Variable token "${String(tok)}" should be a string of the form NAME=VALUE`)
          }
        }
      }

      assert(configuration.commandStart, "command start should exist")

      const command = await validateSingleShellCommand([...configuration.commandStart, commandLinePart].join(" "))
      if (command instanceof Error) {
        return command
      }

      return { subcommand, configuration, variables, command }
    }
    case "cancel": {
      return { subcommand, taskId: commandLine.trim() }
    }
    default: {
      const exhaustivenessCheck: never = subcommand
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Subcommand is not handled: ${exhaustivenessCheck}`)
    }
  }
}

type WebhookEvents = Extract<EmitterWebhookEventName, "issue_comment.created">

type WebhookEventPayload<E extends WebhookEvents> = E extends "issue_comment.created" ? IssueCommentCreatedEvent : never

type WebhookHandler<E extends WebhookEvents> = (
  ctx: Context,
  octokit: ExtendedOctokit,
  event: WebhookEventPayload<E>,
) => Promise<PullRequestError | undefined>

const onIssueCommentCreated: WebhookHandler<"issue_comment.created"> = async (ctx, octokit, payload) => {
  const { repositoryCloneDirectory, gitlab } = ctx

  const { issue, comment, repository, installation } = payload

  if (!("pull_request" in issue)) {
    logger.info(payload, `Skipping payload because it's not from a pull request`)
    return
  }

  const requester = comment.user?.login

  if (!requester) {
    logger.info(payload, "Skipping payload because it has no requester")
    return
  }

  if (payload.action !== "created") {
    logger.info(payload, "Skipping payload because it's not for created comments")
    return
  }

  if (comment.user?.type !== "User") {
    logger.info(payload, `Skipping payload because comment.user.type (${comment.user?.type}) is not "User"`)
    return
  }

  const pr = { owner: repository.owner.login, repo: repository.name, number: issue.number }
  const commentParams = { owner: pr.owner, repo: pr.repo, issue_number: pr.number }

  let getError = (body: string) => new PullRequestError(pr, { body, requester })

  try {
    const commands: ParsedBotCommand[] = []
    for (const line of getLines(comment.body)) {
      const parsedCommand = await parsePullRequestBotCommandLine(line)

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
      logger.info(parsedCommand, "Processing parsed command")
      switch (parsedCommand.subcommand) {
        case "queue": {
          const installationId = installation?.id
          if (!installationId) {
            return getError("Github Installation ID was not found in webhook payload")
          }

          const { data: fetchedPr } = await octokit.pulls.get({
            owner: pr.owner,
            repo: pr.repo,
            pull_number: pr.number,
          })

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

          break
        }
        case "cancel": {
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
              )}\n\nFailed to cancel the following tasks: ${JSON.stringify(
                failedToCancelTasks.map((task) => task.id),
              )}`,
            )
          }

          if (cancelledTasks.length === 0) {
            if (taskId) {
              return getError(`No task matching ${taskId} was found`)
            } else {
              return getError("No task is being executed for this pull request")
            }
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
    return getError(`Exception caught in webhook handler\n${displayError(rawError)}`)
  }
}

const setupEvent = <E extends WebhookEvents>(
  parentCtx: Context,
  bot: Probot,
  eventName: E,
  handler: WebhookHandler<E>,
) => {
  bot.on(eventName, async (event) => {
    const eventLogger = logger.child({ eventId: event.id, eventName })
    const ctx: Context = { ...parentCtx, logger: eventLogger }

    eventLogger.info(`Received bot event ${eventName}`, null, [event, eventName])

    const installationId: number | undefined =
      "installation" in event.payload ? event.payload.installation?.id : undefined
    const octokit = getOctokit(await bot.auth(installationId))

    void handler(ctx, octokit, event.payload as WebhookEventPayload<E>)
      .then(async (result) => {
        if (result instanceof PullRequestError) {
          const { pr, comment } = result

          const sharedCommentParams = {
            owner: pr.owner,
            repo: pr.repo,
            issue_number: pr.number,
            body: `${comment.requester ? `@${comment.requester} ` : ""}${comment.body}`,
          }

          if (comment.commentId) {
            await updateComment(ctx, octokit, { ...sharedCommentParams, comment_id: comment.commentId })
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

export const setupBot = (ctx: Context, bot: Probot): void => {
  setupEvent(ctx, bot, "issue_comment.created", onIssueCommentCreated)
}
