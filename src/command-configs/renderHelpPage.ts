import path from "path"
import * as pug from "pug"

import { Config } from "src/config"
import { CommandConfigs } from "src/types"

export function renderHelpPage(params: {
  config: Config
  commandConfigs: CommandConfigs
  scriptsRevision: string
  headBranch: string
}): string {
  const tmplPath = path.join(__dirname, "renderHelpPage.pug")
  const { commandConfigs, scriptsRevision, headBranch, config } = params

  const repoLink = new URL(path.join(config.pipelineScripts.repository, "tree", headBranch)).toString()

  return pug.renderFile(tmplPath, { config, repoLink, commandConfigs, scriptsRevision, headBranch })
}
