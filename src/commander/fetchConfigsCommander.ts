import { Command } from "commander";

import { fetchCommandsConfiguration } from "src/command-configs/fetchCommandsConfiguration";
import { CommandConfigs } from "src/command-configs/types";
import { getVariablesOption, variablesExitOverride } from "src/commander/getVariablesOption";
import { config } from "src/config";
import { LoggerContext } from "src/logger";
import { PIPELINE_SCRIPTS_REF } from "src/setup";

type ExtendedFetchCommander = Command & {
  result?: {
    scriptsRef: string;
    docsPath: string;
    commandConfigs: CommandConfigs;
  };
};

export function fetchConfigsCommander(ctx: LoggerContext, repo: string): ExtendedFetchCommander {
  const { botPullRequestCommentMention } = config;
  const root = new Command(botPullRequestCommentMention) as ExtendedFetchCommander;
  let scriptsBranch: string | undefined;

  root.addOption(getVariablesOption());

  root.hook("postAction", async (cmd, actionCmd) => {
    const variable = actionCmd.optsWithGlobals().variable as Record<string, string>;

    if (variable?.[PIPELINE_SCRIPTS_REF]) {
      scriptsBranch = variable[PIPELINE_SCRIPTS_REF];
    }

    const { commandConfigs, docsPath } = await fetchCommandsConfiguration(ctx, scriptsBranch, repo);
    root.result = { scriptsRef: root.optsWithGlobals().dev as string, docsPath, commandConfigs };
  });

  root
    .allowExcessArguments(true)
    .allowUnknownOption(true)
    .exitOverride(variablesExitOverride)
    .action(() => {});

  return root;
}
