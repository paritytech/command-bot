import path from "path";
import * as pug from "pug";

import { CommandConfigs } from "src/command-configs/types";
import { Config } from "src/config";
import { CmdJson } from "src/schema/schema.cmd";

export function renderHelpPage(params: {
  config: Config;
  commandConfigs: CommandConfigs;
  scriptsRevision: string;
  headBranch: string;
}): string {
  const tmplPath = path.join(__dirname, "help", "main.pug");
  const { commandConfigs, scriptsRevision, headBranch, config } = params;

  const repoLink = new URL(path.join(config.pipelineScripts.repository, "tree", headBranch)).toString();
  const commandStart = config.botPullRequestCommentMention;

  const preparedConfigs = prepareConfigs(commandConfigs);

  // getting list of possible repos, to be able to filter out relevant commands
  const reposSet = new Set<string>();
  for (const cmdConfig of Object.values(preparedConfigs)) {
    for (const preset of Object.values(cmdConfig.command.presets ?? {})) {
      for (const repo of preset.repos ?? []) {
        reposSet.add(repo);
      }
    }
  }
  const repos = [...reposSet];

  // TODO: depends on headBranch, if overridden: add `-v PIPELINE_SCRIPTS_REF=branch` to all command examples same for PATCH_repo=xxx
  // TODO: Simplify the PIPELINE_SCRIPTS_REF to something more rememberable */
  return pug.renderFile(tmplPath, {
    config,
    repoLink,
    commandConfigs: preparedConfigs,
    scriptsRevision,
    headBranch,
    commandStart,
    repos,
  });
}

function prepareConfigs(cmdConfigs: CommandConfigs): CommandConfigs {
  const newCmdConfigs: CommandConfigs = {};

  // these commands are added here, as they are defined inside of bot
  newCmdConfigs.help = mockStaticConfig("Generates the help page & provides a link.");
  newCmdConfigs.clean = mockStaticConfig("Clears bot comments in the PR.");

  // clean up excluded
  for (const cmdName in cmdConfigs) {
    const isExcluded = cmdConfigs[cmdName].command.excluded === true;

    if (!isExcluded) {
      newCmdConfigs[cmdName] = cmdConfigs[cmdName];
    }
  }

  return newCmdConfigs;
}

// append local (or "hardcoded") commands into documentation
function mockStaticConfig(description: string) {
  const config: CmdJson = { command: { description, configuration: {} } };
  return config;
}
