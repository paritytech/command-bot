import { fetchCommandsConfiguration } from "src/command-configs/fetchCommandsConfiguration";
import { optionValuesToFlags } from "src/commander/commander";
import { LoggerContext } from "src/logger";
import { CmdJson } from "src/schema/schema.cmd";

/**
 * DISCLAIMER: don't even try to understand this code :D it's a mess
 * This is throw-away shitcode💩, to simplify the migration messaging
 * to be deleted soon after migration 🙏
 */

export async function guessCommand(ctx: LoggerContext, command: string, repo: string): Promise<string> {
  const { commandConfigs } = await fetchCommandsConfiguration(ctx, undefined, repo);

  // extract first wor from command
  const commandName = command.split(" ")[0];
  // extract args from command
  const [_, args] = command.split("$ ");

  const presets = commandConfigs[commandName]?.command?.presets || {};

  if (Object.keys(presets)?.length > 0) {
    const relatedPresets = Object.entries(presets).filter((preset) => preset[1].repos?.includes(repo));
    const commonPresets = Object.entries(presets).filter((preset) => !preset[1].repos);

    const guessPreset = getWinnerPreset(args, relatedPresets) || getWinnerPreset(args, commonPresets);

    if (guessPreset) {
      return `${commandName} ${guessPreset.name} ${optionValuesToFlags(guessPreset.argsValues)}`;
    }
  }

  return "";
}

function getWinnerPreset(
  args: string,
  presets: [string, NonNullable<CmdJson["command"]["presets"]>[keyof NonNullable<CmdJson["command"]["presets"]>]][],
):
  | {
      name: string;
      argsValues: { [key: string]: string };
    }
  | undefined {
  let winnerPreset: { name: string; argsValues: { [key: string]: string } } | undefined = undefined;
  if (presets?.length > 0) {
    if (presets?.length === 1) {
      const winnerGuess = Object.entries(presets[0][1]?.args || {}).reduce((acc, argEntry) => {
        const [argName, arg] = argEntry;
        if (arg.type_rule === "string") {
          // assume that this arg is provided anyway
          acc[argName] = "custom_string";
        }
        if (Array.isArray(arg.type_one_of)) {
          const match = arg.type_one_of.find((type: string) => args.includes(type)) as string | undefined;
          if (match) {
            acc[argName] = match as string;
          }
        }

        if (typeof arg.type_string === "string") {
          acc[argName] = arg.type_string as string;
        }

        if (typeof arg.type_rule === "string") {
          acc[argName] = (arg.example as string) || "custom_string";
        }

        return acc;
      }, {} as { [key: string]: string });
      winnerPreset = { name: presets[0][0], argsValues: winnerGuess };
    } else {
      const bestMatch = presets.reduce((acc, presetEntry) => {
        const [presetName, preset] = presetEntry;
        if (preset.args && Object.values(preset.args).length > 0) {
          const matchedCount = Object.entries(preset.args).reduce((a, argEntry) => {
            const [_, arg] = argEntry;
            if (Array.isArray(arg.type_one_of)) {
              const match = args
                .split(" ")
                .find((argToMatch) => (arg.type_one_of as string[])?.find((type) => argToMatch.includes(type)));
              if (match) {
                a = a + 1;
              }
            }

            if (typeof arg.type_string === "string" && args.includes(arg.type_string)) {
              a = a + 1;
            }
            return a;
          }, 0);

          acc[presetName] = { rank: matchedCount, guessedCommand: buildGuessedCommandArgs(preset, args) };
        }

        return acc;
      }, {} as { [key: string]: { rank: number; guessedCommand: { [key: string]: string } } });

      const [winnerPresetId, winnerGuess] = Object.entries(bestMatch).sort((a, b) => b[1].rank - a[1].rank)[0];

      if (Object.values(winnerGuess).length > 0) {
        winnerPreset = { argsValues: winnerGuess.guessedCommand, name: winnerPresetId };
      }
    }

    return winnerPreset;
  }
}

function buildGuessedCommandArgs(
  preset: NonNullable<CmdJson["command"]["presets"]>[keyof NonNullable<CmdJson["command"]["presets"]>],
  args: string,
): { [key: string]: string } {
  return Object.entries(preset.args || {}).reduce((a, argEntry) => {
    const [argName, arg] = argEntry;
    if (Array.isArray(arg.type_one_of)) {
      const match = args
        .split(" ")
        .find((argToMatch) => (arg.type_one_of as string[])?.find((type) => argToMatch.includes(type)));
      if (match) {
        a[argName] = match;
      }
    }

    if (typeof arg.type_rule === "string") {
      // assume that this arg is provided anyway
      a[argName] = (arg.example as string) || "custom_string";
    }

    if (typeof arg.type_string === "string" && args.includes(arg.type_string)) {
      a[argName] = arg.type_string;
    }
    return a;
  }, {} as { [key: string]: string });
}
