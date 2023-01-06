import assert from "assert"
import yargs from "yargs"

import { botPullRequestCommentMention } from "src/bot"
import { ParsedBotCommand } from "src/bot/types"
import { fetchCommandsConfiguration, PIPELINE_SCRIPTS_REF } from "src/commands"
import { LoggerContext } from "src/logger"
import { validateSingleShellCommand } from "src/shell"
import { arrayify } from "src/utils"

export const parsePullRequestBotCommandLine = async (
  rawCommandLine: string,
  ctx: LoggerContext,
): Promise<undefined | Error | ParsedBotCommand> => {
  const { logger } = ctx
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
      logger.debug({ botArgs, botOptionsLinePart }, "Parsed bot arguments")

      const configurationNameLongArg = "configuration"
      const configurationNameShortArg = "c"
      const configurationName = botArgs[configurationNameLongArg] ?? botArgs[configurationNameShortArg]
      if (typeof configurationName !== "string") {
        return new Error(
          `Configuration ("-${configurationNameShortArg}" or "--${configurationNameLongArg}") should be specified exactly once`,
        )
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

      const commandsConfiguration = await fetchCommandsConfiguration(ctx, variables[PIPELINE_SCRIPTS_REF])
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

      assert(configuration.commandStart, "command start should exist")

      const command = await validateSingleShellCommand(ctx, [...configuration.commandStart, commandLinePart].join(" "))
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
