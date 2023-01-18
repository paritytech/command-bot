import { Command, InvalidArgumentError, Option } from "commander"

import { botPullRequestIgnoreCommands } from "src/bot"

import { CommandConfigs } from "./types"
import { ensureDefined } from "opstooling-js"

export type ParseResults = {
  command: string | undefined
  // options are key-value
  commandOptions: Record<string, string>
  // arguments are positional, used only for built-in commands
  commandArgs: string[]
  ignoredCommand: boolean
  // if called like `bot sldkfjlkdsjf wekjerw dfdf`, this'll hold "sldkfjlkdsjf"
  unknownCommand: string | undefined
}

export type ExtendedCommander = Command & { parseResults: ParseResults | null }

export function getCommanderFromConfiguration(config: CommandConfigs): ExtendedCommander {
  const root = new Command("bot") as ExtendedCommander
  root.parseResults = null
  let unknownCommand: string | undefined

  root.hook("postAction", (thisCommand, actionCommand) => {
    let currentCommand = actionCommand
    const commandStack = [] // This'll contain command and (optionally) preset, e.g. ["bench", "polkadot"]
    while (currentCommand.parent) {
      commandStack.unshift(currentCommand.name())
      currentCommand = currentCommand.parent
    }

    root.parseResults = {
      command: commandStack[0],
      commandOptions: actionCommand.opts(),
      commandArgs: actionCommand.args,
      ignoredCommand: botPullRequestIgnoreCommands.includes(commandStack[0]),
      unknownCommand
    }
  })

  root.option<Record<string, string>>(
    "-v --variable <value>",
    "set variable in KEY=value format",
    (value: string, collected: Record<string, string>) => {
      if (!value) throw new InvalidArgumentError("")

      const splitValue = value.split("=")
      if (!splitValue[1]) {
        throw new InvalidArgumentError(`${value} is not in KEY=value format`)
      }

      const varName = ensureDefined(splitValue.shift())
      const varValue = splitValue.join("=")

      collected[varName] = varValue
      return collected
    },
    {},
  )

  for (const [commandKey, commandConfig] of Object.entries(config)) {
    const command = new Command(commandKey)

    command.enablePositionalOptions()
    command.action(() => {})
    command.exitOverride()

    if (commandConfig.command.description) command.description(commandConfig.command.description)

    if (commandConfig.command.presets) {
      for (const [presetKey, presetConfig] of Object.entries(commandConfig.command.presets)) {
        const presetCommand =
          presetKey === "default"
            ? command
            : command
                .command(presetKey)
                .action(() => {})
                .exitOverride()
        if (presetConfig.args) {
          for (const [argKey, argConfig] of Object.entries(presetConfig.args)) {
            const option = convertOption(argKey, argConfig)
            presetCommand.addOption(option)
          }
        }
      }
    }

    root.addCommand(command)
  }

  root.addHelpCommand(false)
  root
    .command("help")
    .exitOverride()
    .action(() => {})

  root
    .command("cancel [taskid]")
    .description("cancel previous command")
    .exitOverride()
    .action(() => {})

  for (const ignoredCommand of botPullRequestIgnoreCommands) {
    root
      .command(ignoredCommand, { hidden: true })
      .exitOverride()
      .action(() => {})
  }

  root.enablePositionalOptions()

  // Don't do process.exit() on errors
  root.exitOverride()
  root.action((_, command) => {
    if (command.args.length > 0) {
      unknownCommand = command.args[0]
    }
  })

  return root
}

function convertOption(
  argKey: string,
  argConfig: {
    [k: string]: unknown
  },
): Option {
  const flags = argConfig.short ? `-${argConfig.short} --${argKey} <value>` : `--${argKey} <value>`

  // argConfig.label should always be string, but TS doesn't believe it
  const option = new Option(flags, argConfig.label as string)

  if (Array.isArray(argConfig.type_one_of)) {
    option.choices(argConfig.type_one_of)
    // TODO: proper support of type_many_of
  } else if (Array.isArray(argConfig.type_many_of)) {
    option.choices(argConfig.type_many_of)
  } else if (typeof argConfig.type_rule === "string") {
    // FIXME: currently rules are defined as "/^([a-z_]+)([:]{2}[a-z_]+)?$/", with extra slashes
    const ruleRegex = new RegExp(argConfig.type_rule.substring(1, argConfig.type_rule.length - 1))
    const commandParser = (value: string): string => {
      if (!value.match(ruleRegex)) {
        throw new InvalidArgumentError(`argument ${argKey} is not matching rule ${argConfig.type_rule}`)
      }
      return value
    }
    option.argParser(commandParser)
  }

  if (argConfig.default) {
    option.default(argConfig.default)
  }
  return option
}
