import assert from "assert";

import { botPullRequestCommentMention, botPullRequestIgnoreCommands } from "src/bot";
import { isOptionalArgsCommand } from "src/bot/parse/isOptionalArgsCommand";
import { CancelCommand, CleanCommand, GenericCommand, HelpCommand, ParsedCommand } from "src/bot/parse/ParsedCommand";
import { parseVariables } from "src/bot/parse/parseVariables";
import { SkipEvent } from "src/bot/types";
import { fetchCommandsConfiguration, PIPELINE_SCRIPTS_REF } from "src/command-configs/fetchCommandsConfiguration";
import { config } from "src/config";
import { LoggerContext } from "src/logger";
import { validateSingleShellCommand } from "src/shell";

export const parsePullRequestBotCommandLine = async (
  rawCommandLine: string,
  ctx: LoggerContext,
  repo: string,
): Promise<SkipEvent | Error | ParsedCommand> => {
  let commandLine = rawCommandLine.trim();

  // Add trailing whitespace so that bot can be differentiated from /cmd-[?]
  if (!commandLine.startsWith(`${botPullRequestCommentMention} `)) {
    return new SkipEvent("Not a command");
  }

  // remove "bot "
  commandLine = commandLine.slice(botPullRequestCommentMention.length).trim();

  // get first word as a subcommand
  const subcommand = commandLine.split(" ")[0];

  if (!subcommand) {
    return new Error(`Must provide a subcommand in line ${rawCommandLine}.`);
  }

  // ignore some commands
  if (botPullRequestIgnoreCommands.includes(subcommand)) {
    return new SkipEvent(`Ignored command: ${subcommand}`);
  }

  commandLine = commandLine.slice(subcommand.length).trim();

  switch (subcommand) {
    case "help": {
      const str = commandLine.trim();
      const variables = await parseVariables(ctx, str);
      if (variables instanceof Error) {
        return variables;
      }

      const { docsPath } = await fetchCommandsConfiguration(ctx, variables[PIPELINE_SCRIPTS_REF], repo);

      return new HelpCommand(docsPath);
    }
    case "cancel": {
      return new CancelCommand(commandLine.trim());
    }
    case "clear":
    case "clean": {
      return new CleanCommand();
    }
    default: {
      const commandStartSymbol = "$ ";
      const [botOptionsLinePart, commandLinePart] = commandLine.split(commandStartSymbol);

      const variables = await parseVariables(ctx, botOptionsLinePart);

      if (variables instanceof Error) {
        return variables;
      }

      const { commandConfigs, docsPath } = await fetchCommandsConfiguration(ctx, variables[PIPELINE_SCRIPTS_REF], repo);
      const configuration = commandConfigs[subcommand]?.command?.configuration;

      const helpStr = `Refer to [help docs](${docsPath}) and/or [source code](${config.pipelineScripts.repository}).`;

      if (typeof configuration === "undefined" || !Object.keys(configuration).length) {
        return new Error(
          `Unknown command "${subcommand}"; Available ones are ${Object.keys(commandConfigs).join(", ")}. ${helpStr}`,
        );
      }

      try {
        if (isOptionalArgsCommand(commandConfigs[subcommand], subcommand, repo)) {
          configuration.optionalCommandArgs = true;
        }
      } catch (e) {
        if (e instanceof Error) {
          return new Error(`${e.message}. ${helpStr}`);
        }
        throw e;
      }

      if (!commandLinePart && configuration.optionalCommandArgs !== true) {
        return new Error(`Missing arguments for command "${subcommand}". ${helpStr}`);
      }

      assert(configuration.commandStart, "command start should exist");

      const command = await validateSingleShellCommand(ctx, [...configuration.commandStart, commandLinePart].join(" "));
      if (command instanceof Error) {
        command.message += ` ${helpStr}`;
        return command;
      }

      return new GenericCommand(subcommand, configuration, variables, command);
    }
  }
};
