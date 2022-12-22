import assert from "assert"
import { Mutex } from "async-mutex"
import fs from "fs"
import glob from "glob"
import path from "path"

import { config } from "src/config"
import { CmdJson } from "src/schema/schema.cmd"
import { CommandRunner } from "src/shell"
import { CommandConfigs } from "src/types"

const CMD_ROOT_FOLDER = "commands"

export async function fetchCommandsConfiguration(devBranch?: string): Promise<CommandConfigs> {
  const cmdRunner = new CommandRunner()
  const scriptsFolder = "scripts"
  const scriptsPath = path.join(config.dataPath, scriptsFolder)

  const commandConfigMutex = new Mutex()

  return await commandConfigMutex.runExclusive<CommandConfigs>(async () => {
    await cmdRunner.run("mkdir", ["-p", scriptsPath])

    if (devBranch && /([^\w\d\-_/]+)/g.test(devBranch)) {
      throw new Error(`Scripts branch should match pattern /([^\\w\\d\\-_/]+)/, given: "${devBranch}", does not match`)
    }

    const scriptsBranch = devBranch || "HEAD"
    let scriptsRevision = await cmdRunner.run("git", [
      "ls-remote",
      `${config.pipelineScripts.repository}`,
      scriptsBranch,
    ])
    if (scriptsRevision instanceof Error) {
      throw scriptsRevision
    }

    if (!scriptsRevision) {
      throw new Error(`Can't find a revision of ${config.pipelineScripts.repository}#${scriptsBranch}`)
    }

    // grab only revision
    scriptsRevision = scriptsRevision
      .trim()
      .split("\t")
      .filter((rev) => !!rev)[0]

    const scriptsRevPath = path.join(scriptsPath, scriptsRevision)
    const commandsRootPath = path.join(scriptsRevPath, CMD_ROOT_FOLDER)
    const commandsOutputPath = path.join(scriptsRevPath, "commands.json")
    const scriptsBranchForClone = devBranch ? ["--branch", devBranch] : []

    if (!fs.existsSync(scriptsRevPath) || !fs.existsSync(commandsOutputPath)) {
      await cmdRunner.run(
        "git",
        [
          "clone",
          "--quiet",
          "--depth",
          "1",
          ...scriptsBranchForClone,
          `${config.pipelineScripts.repository}`,
          scriptsRevPath,
        ],
        { testAllowedErrorMessage: (err) => err.endsWith("already exists and is not an empty directory.") },
      )

      const files: string[] = glob.sync("**/*.cmd.json", { cwd: commandsRootPath })

      const commandConfig: CommandConfigs = files.reduce((configs, file) => {
        // infer command name from the filename
        const cmdName = file.replace(/.*\/([\w-_]+)\.cmd\.json/, "$1")
        const commandPath = path.join(commandsRootPath, file)
        // parse command file contents and save to stack
        configs[cmdName] = JSON.parse(fs.readFileSync(commandPath, "utf8")) as CmdJson

        const cfg = configs[cmdName]?.command.configuration
        if (!cfg.commandStart) {
          cfg.commandStart = getCommandStartConfig(cmdName)
        }
        assert(cfg.commandStart, "CommandStart should be set")

        return configs
      }, {} as CommandConfigs)

      fs.writeFileSync(commandsOutputPath, JSON.stringify(commandConfig))
    }

    return JSON.parse(fs.readFileSync(commandsOutputPath).toString()) as CommandConfigs
  })
}

function getCommandStartConfig(commandName: string): string[] {
  return [`"$PIPELINE_SCRIPTS_DIR/${CMD_ROOT_FOLDER}/${commandName}/${commandName}.sh"`]
}
