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
      winnerPreset = { name: presets[0][0], argsValues: buildGuessedCommandArgs(presets[0][1], args) };
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

          acc[presetName] = { rank: matchedCount, preset };
        }

        return acc;
      }, {} as { [key: string]: { rank: number; preset: typeof presets[0][1] } });

      const [winnerPresetId, winnerGuess] = Object.entries(bestMatch).sort((a, b) => b[1].rank - a[1].rank)[0];

      if (Object.values(winnerGuess).length > 0) {
        winnerPreset = { argsValues: buildGuessedCommandArgs(winnerGuess.preset, args), name: winnerPresetId };
      }
    }

    return winnerPreset;
  }
}

function buildGuessedCommandArgs(
  preset: NonNullable<CmdJson["command"]["presets"]>[keyof NonNullable<CmdJson["command"]["presets"]>],
  args: string,
): { [key: string]: string } {
  // sort preset.args so that type_rule is the last one

  return Object.entries(preset.args || {})
    .sort(([, a], [, b]) => {
      if (typeof a.type_rule === "string") {
        return 1;
      }
      if (typeof b.type_rule === "string") {
        return -1;
      }
      return 0;
    })
    .reduce((a, argEntry) => {
      const [argName, arg] = argEntry;
      if (Array.isArray(arg.type_one_of)) {
        const match = args
          .split(" ")
          .find((argToMatch) => (arg.type_one_of as string[])?.find((type) => argToMatch.includes(type)));

        if (match) {
          a[argName] = match;
          args = args.replace(match, "").trim();
        }
      } else if (typeof arg.type_string === "string") {
        a[argName] = arg.type_string;

        args = args.replace(a[argName], "").trim();
      } else if (typeof arg.type_rule === "string") {
        // assume that this arg is provided anyway
        const isTheLastOne = args.split(" ").length === 1;
        a[argName] = isTheLastOne ? args : (arg.example as string) || "custom_string";
      } else {
        console.log("unknown arg type", arg);
      }
      return a;
    }, {} as { [key: string]: string });
}
