import { ParsedCommand } from "src/bot/parse/ParsedCommand";
import { SkipEvent } from "src/bot/types";
import { getCommanderFromConfiguration } from "src/commander/commander";
import { fetchConfigsCommander } from "src/commander/fetchConfigsCommander";
import { LoggerContext } from "src/logger";

export async function parseCommand(
  ctx: LoggerContext,
  raw: string,
  repo: string,
): Promise<ParsedCommand | SkipEvent | Error> {
  let error: Error = new Error("Command not found");
  const processArgv = raw.trim().split(" ");
  const configsCommander = fetchConfigsCommander(ctx, repo);

  // first parse the --variable and see if there is a branch override, to load the correct command configuration
  const parsedConfigs = await configsCommander.parseAsync(processArgv, { from: "user" }).catch((e) => {
    error = e as Error;
  });

  // now with commandConfigs we can build the actual commander
  if (parsedConfigs) {
    if (typeof parsedConfigs.result?.commandConfigs !== "undefined") {
      const commander = getCommanderFromConfiguration(
        ctx,
        parsedConfigs.result.docsPath,
        parsedConfigs.result.commandConfigs,
      );
      const cmdParsed = await commander.parseAsync(processArgv, { from: "user" }).catch((e) => {
        error = e as Error;
      });

      if (cmdParsed) {
        if (typeof cmdParsed.parseResults?.parsedCommand !== "undefined") {
          return cmdParsed.parseResults?.parsedCommand;
        } else {
          return error;
        }
      }
    } else {
      return error;
    }
  }

  return error;
}
