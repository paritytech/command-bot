import { Mutex } from "async-mutex"
import fs from "fs"
import path from "path"

import { cloneCommandBotScripts } from "src/command-configs/cloneCommandBotScripts"
import { collectCommandConfigs } from "src/command-configs/collectCommandConfigs"
import { getScriptsRepoRevision } from "src/command-configs/getScriptsRepoRevision"
import { renderHelpPage } from "src/command-configs/renderHelpPage"
import { config } from "src/config"
import { LoggerContext } from "src/logger"
import { CommandRunner } from "src/shell"
import { CommandConfigs } from "src/types"

export const PIPELINE_SCRIPTS_REF = "PIPELINE_SCRIPTS_REF"

export async function fetchCommandsConfiguration(
  ctx: LoggerContext,
  overriddenBranch?: string,
): Promise<CommandConfigs> {
  const cmdRunner = new CommandRunner(ctx)
  const scriptsFolder = "scripts"
  const scriptsPath = path.join(config.dataPath, scriptsFolder)

  const commandConfigMutex = new Mutex()

  return await commandConfigMutex.runExclusive<CommandConfigs>(async () => {
    await cmdRunner.run("mkdir", ["-p", scriptsPath])

    if (overriddenBranch && /([^\w\d\-_/]+)/g.test(overriddenBranch)) {
      throw new Error(
        `Scripts branch should match pattern /([^\\w\\d\\-_/]+)/, given: "${overriddenBranch}", does not match`,
      )
    }

    const { rev: scriptsRevision, headBranch } = await getScriptsRepoRevision(cmdRunner, overriddenBranch)

    const scriptsRevPath = path.join(scriptsPath, scriptsRevision)
    const commandsOutputPath = path.join(scriptsRevPath, "commands.json")
    const commandsHelpPath = path.join(scriptsRevPath, "help.html")

    if (!fs.existsSync(scriptsRevPath) || !fs.existsSync(commandsOutputPath)) {
      await cloneCommandBotScripts(cmdRunner, scriptsRevPath, overriddenBranch)
      const commandConfigs = collectCommandConfigs(scriptsRevPath)
      fs.writeFileSync(commandsHelpPath, renderHelpPage({ config, commandConfigs, scriptsRevision, headBranch }))
      fs.writeFileSync(commandsOutputPath, JSON.stringify(commandConfigs))
    }

    return JSON.parse(fs.readFileSync(commandsOutputPath).toString()) as CommandConfigs
  })
}
