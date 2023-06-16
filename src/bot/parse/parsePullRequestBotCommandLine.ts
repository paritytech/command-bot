import { botPullRequestCommentMention } from "src/bot";
import { guessCommand } from "src/bot/parse/guessCommand";
import { ParsedCommand } from "src/bot/parse/ParsedCommand";
import { SkipEvent } from "src/bot/types";
import { parseCommand } from "src/commander/parseCommand";
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

  const positionedCommandStartSymbol = "$ ";
  if (commandLine.includes(positionedCommandStartSymbol)) {
    const guesswork = await guessCommand(ctx, commandLine, repo);
    const suggestMessage = guesswork ? `I guess you meant \`${guesswork}\`` : "";
    return new Error(
      `Positioned arguments are not supported anymore. \nUse \`bot help\` to find out how to run your command. \n${suggestMessage}`,
    );
  }

  return await parseCommand(ctx, commandLine, repo);
};
