import { ensureDefined } from "@eng-automation/js";
import { Command, InvalidArgumentError, Option, OptionValues } from "commander";

import { botPullRequestCommentMention, botPullRequestIgnoreCommands } from "src/bot";
import { CancelCommand, CleanCommand, GenericCommand, HelpCommand, ParsedCommand } from "src/bot/parse/ParsedCommand";
import { SkipEvent } from "src/bot/types";
import { fetchCommandsConfiguration } from "src/command-configs/fetchCommandsConfiguration";
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

export type ExtendedCommander = Command & { parseResults: ParseResults | null };

export async function getCommanderFromConfiguration(ctx: LoggerContext, repo: string): Promise<ExtendedCommander> {
  const root = new Command(botPullRequestCommentMention) as ExtendedCommander;
  root.parseResults = null;
  let unknownCommand: string | undefined;
  let parsedCommand: ParseResults["parsedCommand"] = undefined;
  const { commandConfigs, docsPath } = await fetchCommandsConfiguration(ctx, "", repo);
  const helpStr = `Refer to [help docs](${docsPath}) and/or [source code](${config.pipelineScripts.repository}).`;

  // store env variables in "env"

  root.hook("postAction", (thisCommand, actionCommand) => {
    let currentCommand = actionCommand;
    const commandOptions = actionCommand.opts();
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

  for (const [commandKey, commandConfig] of Object.entries(commandConfigs)) {
    let command = new Command(commandKey);

    command
      .addOption(getVariablesOption())
      .exitOverride((e) => {
        console.log("exitOverride", e.message);
        parsedCommand = new Error(e.message);
      })
      .action((opts: OptionValues, _) => {
        const variables = ensureDefined(opts).variable as Record<string, string>;
        console.log(`${commandKey} action`, variables);
        parsedCommand = getGenericCommand({ commandKey, commandConfig, variables });
      });

    if (commandConfig.command.description) command.description(commandConfig.command.description);

    if (commandConfig.command.presets) {
      for (const [presetKey, presetConfig] of Object.entries(commandConfig.command.presets)) {
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
          const presetCommand = new Command(presetKey);

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

  // Don't do process.exit() on errors
  root.exitOverride(() => {
    console.log("Root exitOverride");
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
    .exitOverride((_) => {
      console.log(`exitOverride`, _);
    })
    .action((commandOptions: OptionValues, cmd: Command) => {
      actionCallBack(
        getGenericCommand({
          commandKey,
          commandConfig,
          commandOptions,
          variables: cmd.optsWithGlobals().variable as Record<string, string>,
        }),
      );
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
  }
  return option;
}

function optionValuesToFlags(options?: OptionValues): string {
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

function getVariablesOption(): Option {
  return new Option("-v, --variable <value>", "set variable in KEY=value format").argParser(
    (value: string, collected: Record<string, string>) => {
      if (!value) throw new InvalidArgumentError("");

      const splitValue = value.split("=");

      if (!splitValue[1]) {
        throw new InvalidArgumentError(`${value} is not in KEY=value format`);
      }

      const varName = ensureDefined(splitValue.shift());
      const varValue = splitValue.join("=");

      if (typeof collected !== "undefined") {
        collected[varName] = varValue;
      } else {
        collected = { [varName]: varValue };
      }

      return collected;
    },
  );
}
