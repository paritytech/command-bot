import { Command, CommanderError, InvalidArgumentError, Option, OptionValues } from "commander";

import { botPullRequestIgnoreCommands } from "src/bot";
import { CancelCommand, CleanCommand, GenericCommand, HelpCommand, ParsedCommand } from "src/bot/parse/ParsedCommand";
import { SkipEvent } from "src/bot/types";
import { CommandConfigs } from "src/command-configs/types";
import { getVariablesOption, variablesExitOverride } from "src/commander/getVariablesOption";
import { config } from "src/config";
import { LoggerContext } from "src/logger";
import { CmdJson } from "src/schema/schema.cmd";

export type ParseResults = {
  command: string | undefined;
  // options are key-value
  commandOptions: Record<string, string>;
  commandOptionsRaw: string;
  // arguments are positional, used only for built-in commands
  commandArgs: string[];
  ignoredCommand: boolean;
  // if called like `bot sldkfjlkdsjf wekjerw dfdf`, this'll hold "sldkfjlkdsjf"
  unknownCommand: string | undefined;
  parsedCommand: ParsedCommand | SkipEvent | Error | undefined;
};

export type ExtendedCommander = Command & {
  parseResults?: ParseResults;
};
export function getCommanderFromConfiguration(
  ctx: LoggerContext,
  docsPath: string,
  commandConfigs: CommandConfigs,
): ExtendedCommander {
  const { botPullRequestCommentMention } = config;
  const root = new Command(botPullRequestCommentMention) as ExtendedCommander;
  let unknownCommand: string | undefined;
  let parsedCommand: ParseResults["parsedCommand"] = undefined;
  const helpStr = `Refer to [help docs](${docsPath}) and/or [source code](${config.pipelineScripts.repository}).`;

  root.addHelpCommand(false);
  root
    .command("help")
    .exitOverride()
    .action(() => {
      parsedCommand = new HelpCommand(docsPath);
    });

  root
    .command("clear")
    .alias("clean")
    .exitOverride()
    .action(() => {
      parsedCommand = new CleanCommand();
    });

  root
    .command("cancel [taskid]")
    .description("cancel previous command")
    .exitOverride()
    .action((taskId: string) => {
      parsedCommand = new CancelCommand(taskId || "");
    });

  for (const ignoredCommand of botPullRequestIgnoreCommands) {
    root
      .command(ignoredCommand, { hidden: true })
      .exitOverride()
      .action(() => {
        parsedCommand = new SkipEvent(`Ignored command: ${ignoredCommand}`);
      });
  }

  for (const [commandKey, commandConfig] of Object.entries(commandConfigs)) {
    let command = new Command(commandKey);
    command
      .addOption(getVariablesOption())
      .exitOverride(variablesExitOverride)
      .action((opts: OptionValues, cmd: Command) => {
        const variables = cmd.optsWithGlobals().variable as Record<string, string>;
        const childCommands = cmd.commands
          .map((childCommand) => childCommand.name())
          .filter((name) => name !== "default");

        parsedCommand =
          childCommands.length > 0
            ? new Error(`Missing arguments for command "${cmd.name()}". ${helpStr}`)
            : getGenericCommand({ commandKey, commandConfig, variables });
      });

    if (commandConfig.command.description) command.description(commandConfig.command.description);

    if (commandConfig.command.presets) {
      for (const [presetKey, presetConfig] of Object.entries(commandConfig.command.presets)) {
        const presetCommand = new Command(presetKey);
        // if a current preset is default, then we'll add options to the current command
        if (presetKey === "default") {
          command = addPresetOptions({
            presetConfig,
            presetCommand: command,
            commandKey,
            commandConfig,
            actionCallBack: (genericCommand) => {
              parsedCommand = genericCommand;
            },
          });
        } else {
          // keep adding presets as subcommands, including the default one
          command.addCommand(
            addPresetOptions({
              presetConfig,
              presetCommand,
              commandKey,
              commandConfig,
              actionCallBack: (genericCommand) => {
                parsedCommand = genericCommand;
              },
            }),
          );
        }
      }
    }

    root.addCommand(command);
  }

  root.exitOverride(() => {
    parsedCommand = new Error(`Unknown error. ${helpStr}`);
  });
  root.action((_, command) => {
    if (command.args.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      unknownCommand = command.args[0];
      parsedCommand = new Error(
        `Unknown command "${unknownCommand || ""}"; Available ones are ${Object.keys(commandConfigs).join(
          ", ",
        )}. ${helpStr}`,
      );
    }
  });

  root.hook("postAction", (thisCommand, actionCommand) => {
    let currentCommand = actionCommand;
    const commandOptions = actionCommand.optsWithGlobals();
    const commandStack = []; // This'll contain command and (optionally) preset, e.g. ["bench", "polkadot"]
    while (currentCommand.parent) {
      commandStack.unshift(currentCommand.name());
      currentCommand = currentCommand.parent;
    }
    const commandOptionsRaw = optionValuesToFlags(commandOptions);

    root.parseResults = {
      command: commandStack[0],
      commandOptions,
      commandOptionsRaw,
      commandArgs: actionCommand.args,
      ignoredCommand: botPullRequestIgnoreCommands.includes(commandStack[0]),
      unknownCommand,
      parsedCommand,
    };
  });

  return root;
}

function addPresetOptions(cfg: {
  presetCommand: Command;
  presetConfig: NonNullable<CmdJson["command"]["presets"]>[keyof NonNullable<CmdJson["command"]["presets"]>];
  commandKey: string;
  commandConfig: CmdJson;
  actionCallBack: (genericCommand: GenericCommand) => void;
}): Command {
  const { presetConfig, presetCommand, commandConfig, commandKey, actionCallBack } = cfg;
  if (presetConfig.description) presetCommand.description(presetConfig.description);

  if (presetConfig.args) {
    for (const [argKey, argConfig] of Object.entries(presetConfig.args)) {
      const option = convertOption(argKey, argConfig);
      presetCommand.addOption(option);
    }
  }

  presetCommand
    .exitOverride((e) => {
      throw new Error((e as CommanderError).message.replace("error: ", ""));
    })
    .action((commandOptions: OptionValues, cmd: Command) => {
      // extract global variable from the rest of the default options
      const { variable: variables, ...rest } = cmd.optsWithGlobals() as { [key: string]: Record<string, string> };
      actionCallBack(getGenericCommand({ commandKey, commandConfig, commandOptions: rest, variables }));
    });

  return presetCommand;
}

function convertOption(
  argKey: string,
  argConfig: {
    [k: string]: unknown;
  },
): Option {
  const flags = `--${argKey} <value>`;

  // argConfig.label should always be string, but TS doesn't believe it
  const option = new Option(flags, argConfig.label as string);

  if (Array.isArray(argConfig.type_one_of)) {
    option.choices(argConfig.type_one_of);
    option.default(argConfig.type_one_of[0]);
  } else if (typeof argConfig.type_string === "string" && argConfig.type_string) {
    option.default(argConfig.type_string);
  } else if (typeof argConfig.type_rule === "string") {
    // FIXME: currently rules are defined as "/^([a-z_]+)([:]{2}[a-z_]+)?$/", with extra slashes
    const ruleRegex = new RegExp(argConfig.type_rule.substring(1, argConfig.type_rule.length - 1));
    const commandParser = (value: string): string => {
      if (!value.match(ruleRegex)) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new InvalidArgumentError(`argument ${argKey} is not matching rule ${argConfig.type_rule}`);
      }
      return value;
    };
    option.argParser(commandParser);
    option.makeOptionMandatory(true);
  }
  return option;
}

export function optionValuesToFlags(options?: OptionValues): string {
  return Object.entries(options || {})
    .map(([key, value]) => {
      if (value === true) {
        return `--${key}`;
      }
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      return `--${key}=${value}`;
    })
    .join(" ");
}

function getGenericCommand(settings: {
  commandKey: string;
  commandConfig: CmdJson;
  commandOptions?: OptionValues;
  variables?: Record<string, string>;
}): GenericCommand {
  const { commandKey, commandConfig, commandOptions, variables } = settings;
  const commandStr = `${[
    ...(commandConfig.command.configuration.commandStart || []),
    optionValuesToFlags(commandOptions),
  ]
    .join(" ")
    .trim()}`;
  return new GenericCommand(commandKey, commandConfig.command.configuration, variables || {}, commandStr);
}
