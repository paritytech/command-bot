import { config } from "src/config";
import { CommandRunner } from "src/shell";

/**
 * We need a revision to create unique folder of particular snapshot of commands & configs
 */
export async function getScriptsRepoRevision(
  cmdRunner: CommandRunner,
  devBranch?: string,
): Promise<{ headBranch: string; rev: string }> {
  const branch = devBranch || config.pipelineScripts.ref || "HEAD";
  let scriptsRevision = await cmdRunner.run("git", ["ls-remote", `${config.pipelineScripts.repository}`, branch]);
  if (scriptsRevision instanceof Error) {
    throw scriptsRevision;
  }

  if (!scriptsRevision) {
    throw new Error(`Can't find a revision of ${config.pipelineScripts.repository}#${branch}`);
  }

  // parse only revision
  scriptsRevision = scriptsRevision
    .trim()
    .split("\t")
    .filter((rev) => !!rev)[0];

  return { headBranch: branch, rev: scriptsRevision };
}
