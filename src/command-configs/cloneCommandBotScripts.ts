import { config } from "src/config";
import { CommandRunner } from "src/shell";

export async function cloneCommandBotScripts(
  cmdRunner: CommandRunner,
  scriptsRevPath: string,
  devBranch?: string,
): Promise<void> {
  await cmdRunner.run(
    "git",
    [
      "clone",
      "--quiet",
      "--depth",
      "1",
      ...["--branch", devBranch || config.pipelineScripts.ref],
      `${config.pipelineScripts.repository}`,
      scriptsRevPath,
    ],
    { testAllowedErrorMessage: (err) => err.endsWith("already exists and is not an empty directory.") },
  );
}
