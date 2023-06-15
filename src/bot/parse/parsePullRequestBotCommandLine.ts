import { botPullRequestCommentMention, botPullRequestIgnoreCommands } from "src/bot";
import { ParsedCommand } from "src/bot/parse/ParsedCommand";
import { SkipEvent } from "src/bot/types";
import { getCommanderFromConfiguration } from "src/commander/commander";
import { LoggerContext } from "src/logger";

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

  //
  //     const positionedCommandStartSymbol = "$ ";
  // let command: string | Error;
  //
  //     // positioned arguments with " $ " separator
  //     if (commandLine.includes(positionedCommandStartSymbol)) {
  //       const [_, commandLinePart] = commandLine.split(positionedCommandStartSymbol);
  //
  //       try {
  //         if (isOptionalArgsCommand(commandConfigs[subcommand], subcommand, repo)) {
  //           configuration.optionalCommandArgs = true;
  //         }
  //       } catch (e) {
  //         if (e instanceof Error) {
  //           return new Error(`${e.message}. ${helpStr}`);
  //         }
  //         throw e;
  //       }
  //
  //       if (!commandLinePart && configuration.optionalCommandArgs !== true) {
  //         return new Error(`Missing arguments for command "${subcommand}". ${helpStr}`);
  //       }
  //
  //       assert(configuration.commandStart, "command start should exist");
  //
  //       command = await validateSingleShellCommand(ctx, [...configuration.commandStart, commandLinePart].join(" "));
  //       if (command instanceof Error) {
  //         command.message += ` ${helpStr}`;
  //         return command;
  //       }
  //     } else {
  // named arguments without " $ " separator, going through commander validator
  const commander = await getCommanderFromConfiguration(ctx, repo);

  const raw = `${subcommand} ${commandLine}`.trim().split(" ");
  console.log(`Parsing command: "${raw.join(" ")}"`);

  const cmdParsed = await commander.parseAsync(raw, { from: "user" }).catch((e) => {
    console.log(e);
  });

  if (cmdParsed) {
    console.log(cmdParsed.parseResults?.parsedCommand);

    if (
      cmdParsed.parseResults?.parsedCommand instanceof Error ||
      cmdParsed.parseResults?.parsedCommand instanceof ParsedCommand
    ) {
      return cmdParsed.parseResults?.parsedCommand;
    } else {
      return new Error("Command not found");
    }

    // return new Error((e as Error).message);
  }

  console.error(`Unknown error while parsing command: "${raw.join(" ")}"`);
  return new Error("Command not found");
};
