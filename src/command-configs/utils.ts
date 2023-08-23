import { CommandConfigs } from "src/command-configs/types";

// getting list of possible repos from command configs
export function getSupportedRepoNames(
  commandConfigs: CommandConfigs,
  commandName?: string,
): { repos: string[]; includesGenericPresets: boolean } {
  let includesGenericPresets = false;
  const reposSet = new Set<string>();
  const commands = commandName ? [commandConfigs[commandName]] : Object.values(commandConfigs);
  for (const cmdConfig of commands) {
    const presets = Object.values(cmdConfig.command.presets ?? {});

    if (presets.length === 0) {
      includesGenericPresets = true;
    }

    for (const preset of presets) {
      const repos = preset.repos ?? [];
      // if repos are not specified, then this command is supported by all repos
      if (repos.length === 0) {
        includesGenericPresets = true;
      }
      for (const repo of repos) {
        reposSet.add(repo);
      }
    }
  }
  return { repos: Array.from(reposSet), includesGenericPresets };
}
