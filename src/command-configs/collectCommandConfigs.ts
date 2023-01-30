import assert from "assert";
import fs from "fs";
import glob from "glob";
import path from "path";

import { CommandConfigs } from "src/command-configs/types";
import { CmdJson } from "src/schema/schema.cmd";

const CMD_ROOT_FOLDER = "commands";

/**
 * CommandBot parsed and prepared configs, adapted to push commands to GitLab
 * @param scriptsRevPath Path to a cloned folder with particular revision, like: data/scripts/167e3c9e7dd0bcdf65cd794e1fe9504b4d03d597
 */
export function collectCommandConfigs(scriptsRevPath: string): CommandConfigs {
  const commandsRootPath = path.join(scriptsRevPath, CMD_ROOT_FOLDER);
  const files: string[] = glob.sync("**/*.cmd.json", { cwd: commandsRootPath });

  return files.reduce((configs, file) => {
    // infer command name from the filename
    const cmdName = file.replace(/.*\/([\w-_]+)\.cmd\.json/, "$1");
    const commandPath = path.join(commandsRootPath, file);
    // parse command file contents and save to stack
    configs[cmdName] = JSON.parse(fs.readFileSync(commandPath, "utf8")) as CmdJson;

    const cfg = configs[cmdName]?.command.configuration;
    if (!cfg.commandStart) {
      cfg.commandStart = getCommandStartConfig(cmdName);
    }
    assert(cfg.commandStart, "CommandStart should be set");

    return configs;
  }, {} as CommandConfigs);
}

function getCommandStartConfig(commandName: string): string[] {
  return [`"$PIPELINE_SCRIPTS_DIR/${CMD_ROOT_FOLDER}/${commandName}/${commandName}.sh"`];
}
