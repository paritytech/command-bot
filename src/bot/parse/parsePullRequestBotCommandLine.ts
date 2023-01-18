import { parse as shellQuoteParse } from "shell-quote"

import { CancelCommand, GenericCommand, HelpCommand, ParsedCommand } from "src/bot/parse/ParsedCommand"
import { fetchCommandsConfiguration, getDocsUrl } from "src/command-configs/fetchCommandsConfiguration"
import { LoggerContext } from "src/logger"
import { ExtendedCommander, getCommanderFromConfiguration } from "src/command-configs/commander"
import { ensureDefined } from "opstooling-js"
import { botPullRequestCommentMention } from "src/bot"
import { CommanderError } from "commander"

export const parsePullRequestBotCommandLine = async (
  rawCommandLine: string,
  ctx: LoggerContext,
): Promise<undefined | Error | ParsedCommand> => {
  let commandLine = rawCommandLine.trim()
  let configRef: string | undefined = undefined

  if (commandLine.startsWith("PIPELINE_SCRIPTS_REF=")) {
    const configRefMatch = commandLine.match(/^PIPELINE_SCRIPTS_REF=(\S+)\s+(.*)$/)

    configRef = ensureDefined(configRefMatch?.[1])
    commandLine = ensureDefined(configRefMatch?.[2])
  }

  // Add trailing whitespace so that bot can be differentiated from /cmd-[?]
  if (!commandLine.startsWith(`${botPullRequestCommentMention} `)) {
    return
  }
  // removing `bot ` from the argv
  commandLine = commandLine.substring(botPullRequestCommentMention.length + 1)

  const quotedCommandLine = shellQuoteParse(commandLine)
  const argvCommandLine: string[] = []

  for (const item of quotedCommandLine) {
    if (typeof item !== "string") {
      // Ditching all commands with shell operators and so on
      return new Error(`Command "${commandLine} is invalid`)
    }
    argvCommandLine.push(item)
  }
  const { commandConfigs, commitHash } = await fetchCommandsConfiguration(ctx, configRef)

  const commander = getCommanderFromConfiguration(commandConfigs)
  const parseError = parseCommand(commander, argvCommandLine)

  if (parseError) {
    return parseError
  }

  const parseResults = ensureDefined(commander.parseResults)

  if (parseResults.ignoredCommand) {
    return
  }

  switch (parseResults.command) {
    case "help": {
      return new HelpCommand(commitHash)
    }
    case "cancel": {
      return new CancelCommand(parseResults.commandArgs[0] || "")
    }
    case undefined: {
      return new Error(
        `Could not find matching configuration for command "${
          parseResults.unknownCommand
        }"; Available ones are ${Object.keys(commandConfigs).join(", ")}. Refer to [help docs](${getDocsUrl(
          commitHash,
        )}) for more details.`,
      )
    }
    default: {
      const configuration = commandConfigs[parseResults.command]?.command?.configuration
      // TODO 4th argument doesn't make much sense now
      return new GenericCommand(
        parseResults.command,
        configuration,
        commander.opts().variable,
        parseResults.commandOptions,
      )
    }
  }
}

function parseCommand(commander: ExtendedCommander, argv: string[]): Error | undefined {
  try {
    commander.parse(argv, { from: "user" })
  } catch (e) {
    if (e instanceof CommanderError) {
      // Special case of unknown command. See `commander.ts`
      if (e.message.includes("too many arguments. Expected")) {
        return new Error("Unknown command")
      }
      return new Error(e.message)
    }
    throw e
  }
}
