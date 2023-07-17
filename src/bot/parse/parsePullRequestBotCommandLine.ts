import { guessCommand } from "src/bot/parse/guessCommand";
import { ParsedCommand } from "src/bot/parse/ParsedCommand";
import { SkipEvent } from "src/bot/types";
import { fetchCommandsConfiguration } from "src/command-configs/fetchCommandsConfiguration";
import { parseCommand } from "src/commander/parseCommand";
import { config } from "src/config";
import { LoggerContext } from "src/logger";

export const parsePullRequestBotCommandLine = async (
  rawCommandLine: string,
  ctx: LoggerContext,
  repo: string,
): Promise<SkipEvent | Error | ParsedCommand> => {
  let commandLine = rawCommandLine.trim();
  const { botPullRequestCommentMention } = config;

  // Add trailing whitespace so that bot can be differentiated
  if (!commandLine.startsWith(`${botPullRequestCommentMention} `)) {
    return new SkipEvent("Not a command");
  }

  // remove "bot "
  commandLine = commandLine.slice(botPullRequestCommentMention.length).trim();

  const positionedCommandStartSymbol = "$ ";
  if (commandLine.includes(positionedCommandStartSymbol)) {
    const { docsPath } = await fetchCommandsConfiguration(ctx, undefined, repo);
    const guesswork = await guessCommand(ctx, commandLine, repo);
    const suggestMessage = guesswork ? `I guess you meant \`${guesswork}\`, but I could be wrong.` : "";
    return new Error(
      `Positional arguments are not supported anymore. ${suggestMessage}\n[Read docs](${docsPath}) to find out how to run your command.`,
    );
  }

  return await parseCommand(ctx, commandLine, repo);
};
