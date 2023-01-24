import path from "path"
import * as pug from "pug"

import { botPullRequestCommentMention } from "src/bot"
import { CommandConfigs } from "src/command-configs/types"
import { Config } from "src/config"

export function renderHelpPage(params: {
  config: Config
  commandConfigs: CommandConfigs
  scriptsRevision: string
  headBranch: string
}): string {
  const tmplPath = path.join(__dirname, "renderHelpPage.pug")
  const { commandConfigs, scriptsRevision, headBranch, config } = params

  const repoLink = new URL(path.join(config.pipelineScripts.repository, "tree", headBranch)).toString()
  const commandStart = botPullRequestCommentMention

  /* TODO: depends on headBranch, if overridden: add `-v PIPELINE_SCRIPTS_REF=branch` to all command examples
          same for PATCH_repo=xxx
     TODO: Simplify the PIPELINE_SCRIPTS_REF to something more rememberable */
  return pug.renderFile(tmplPath, { config, repoLink, commandConfigs, scriptsRevision, headBranch, commandStart })
}
