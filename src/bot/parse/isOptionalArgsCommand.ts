import { CmdJson } from "src/schema/schema.cmd";

// details: https://github.com/paritytech/command-bot/issues/171
export function isOptionalArgsCommand(cfg: CmdJson, command: string, repo: string): boolean {
  const presets = cfg?.command?.presets || {};
  const hasAnyPresets = Object.keys(presets)?.length > 0;

  if (!hasAnyPresets) {
    return true;
  }

  // presets with unspecified repos, means they could be used in all repos.
  // Like `bot help`
  const commonPresets = Object.values(presets).filter((preset) => !preset.repos || preset.repos.length === 0);

  // if there are presets for all repos: use them as a validation of args presence
  if (commonPresets.length > 0) {
    const hasArgsDefined = commonPresets.some((preset) => Object.keys(preset.args || {}).length > 0);

    if (!hasArgsDefined) {
      return true;
    }
  } else {
    // pick the presets by the current repo
    const repoPresets = Object.values(presets).filter((preset) => preset.repos?.includes(repo));

    // if no presets found -> return error that such command is not applicable to this repo
    if (repoPresets.length === 0) {
      throw new Error(`The command: "${command}" is not supported in **${repo}** repository`);
    } else if (repoPresets.length === 1) {
      const hasArgsDefined = repoPresets.some((preset) => Object.keys(preset.args || {}).length > 0);
      // If one preset with current repo is presented ->
      // see if this preset has args specified - expect command to provide args, otherwise - expect not
      if (!hasArgsDefined) {
        return true;
      }
    } else {
      // if more then one presets has found ->
      // see if all have args -> then args are required,
      // if at least one doesn't have args -> optional
      const everyPresetHasArgsDefined = repoPresets.every((preset) => Object.keys(preset.args || {}).length > 0);

      if (!everyPresetHasArgsDefined) {
        return true;
      }
    }
  }

  return false;
}
