import { Mutex } from "async-mutex"
import fs from "fs"
import path from "path"

import { cloneCommandBotScripts } from "src/command-configs/cloneCommandBotScripts"
import { collectCommandConfigs } from "src/command-configs/collectCommandConfigs"
import { getScriptsRepoRevision } from "src/command-configs/getScriptsRepoRevision"
import { renderHelpPage } from "src/command-configs/renderHelpPage"
import { CommandConfigs, FetchCommandConfigsResult } from "src/command-configs/types"
import { config } from "src/config"
import { LoggerContext } from "src/logger"
import { DOCS_DIR, DOCS_URL_PATH, GENERATED_DIR } from "src/setup"
import { CommandRunner } from "src/shell"

export const PIPELINE_SCRIPTS_REF = "PIPELINE_SCRIPTS_REF"

export async function fetchCommandsConfiguration(
  ctx: LoggerContext,
  overriddenBranch?: string,
): Promise<FetchCommandConfigsResult> {
  const cmdRunner = new CommandRunner(ctx)
  /* every re-deploy this folder will be cleaned,
     so each command will re-download scripts and re-render docs */
  const scriptsPath = path.join(GENERATED_DIR, "scripts")

  const commandConfigMutex = new Mutex()

  return await commandConfigMutex.runExclusive<FetchCommandConfigsResult>(async () => {
    await cmdRunner.run("mkdir", ["-p", scriptsPath])

    if (overriddenBranch && /([^\w\d\-_/]+)/g.test(overriddenBranch)) {
      throw new Error(
        `Scripts branch should match pattern /([^\\w\\d\\-_/]+)/, given: "${overriddenBranch}", does not match`,
      )
    }

    const { rev: scriptsRevision, headBranch } = await getScriptsRepoRevision(cmdRunner, overriddenBranch)

    const scriptsRevPath = path.join(scriptsPath, scriptsRevision)
    const commandsOutputPath = path.join(scriptsRevPath, "commands.json")
    const commandsHelpPath = path.join(DOCS_DIR, getDocsFilename(scriptsRevision))

    if (!fs.existsSync(scriptsRevPath) || !fs.existsSync(commandsOutputPath)) {
      await cloneCommandBotScripts(cmdRunner, scriptsRevPath, overriddenBranch)
      const commandConfigs = collectCommandConfigs(scriptsRevPath)

      fs.writeFileSync(commandsHelpPath, renderHelpPage({ config, commandConfigs, scriptsRevision, headBranch }))
      fs.writeFileSync(commandsOutputPath, JSON.stringify(commandConfigs))
    }

    return {
      commitHash: scriptsRevision,
      commandConfigs: JSON.parse(fs.readFileSync(commandsOutputPath).toString()) as CommandConfigs,
    }
  })
}

export function getDocsUrl(commitHash: string): string {
  return new URL(path.join(config.cmdBotUrl, DOCS_URL_PATH, getDocsFilename(commitHash))).toString()
}

function getDocsFilename(scriptsRevision: string): string {
  return `${scriptsRevision}.html`
}
