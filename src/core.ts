import { ExtendedOctokit, isOrganizationMember } from "./github";
import { CommandRunner } from "./shell";
import { Task } from "./task";
import { Context } from "./types";

/*
  TODO: Move command configurations to configuration repository or database so
  that it can be updated dynamically, without redeploying the application
*/
const getBenchBotCommand = ({ tags }: { tags: string[] }) => {
  return { gitlab: { job: { tags, variables: {} } }, commandStart: ['"$PIPELINE_SCRIPTS_DIR/bench-bot.sh"'] };
};
export type CommandConfiguration = {
  gitlab: {
    job: {
      tags: string[];
      variables: Record<string, string>;
    };
  };
  commandStart: string[];
  // allows to be run without arguments after " $ "
  optionalCommandArgs?: boolean;
};
export const commandsConfiguration: {
  [K in "try-runtime" | "bench-bot" | "test-bench-bot" | "fmt" | "sample"]: CommandConfiguration;
} = {
  "try-runtime": {
    gitlab: { job: { tags: ["linux-docker"], variables: {} } },
    commandStart: ['"$PIPELINE_SCRIPTS_DIR/try-runtime-bot.sh"'],
  },
  fmt: {
    gitlab: { job: { tags: ["linux-docker"], variables: {} } },
    commandStart: ['"$PIPELINE_SCRIPTS_DIR/fmt.sh"'],
    optionalCommandArgs: true,
  },
  "bench-bot": getBenchBotCommand({ tags: ["bench-bot"] }),
  "test-bench-bot": getBenchBotCommand({ tags: ["test-bench-bot"] }),
  // "sample" is used for testing purposes only
  sample: { gitlab: { job: { tags: ["kubernetes-parity-build"], variables: {} } }, commandStart: ["echo"] },
};

export const isRequesterAllowed = async (
  ctx: Context,
  octokit: ExtendedOctokit,
  username: string,
): Promise<boolean> => {
  const { allowedOrganizations } = ctx;

  for (const organizationId of allowedOrganizations) {
    if (await isOrganizationMember({ organizationId, username, octokit })) {
      return true;
    }
  }

  return false;
};

/* TODO: this whole generator doesn't make much sense,
     as in the only place of usage, all intermediate values are being dropped */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const prepareBranch = async function* (
  ctx: Context,
  { repoPath, gitRef: { contributor, upstream } }: Task,
  {
    getFetchEndpoint,
  }: {
    getFetchEndpoint: () => Promise<{ token: string | null; url: string }>;
  },
) {
  const { token, url } = await getFetchEndpoint();

  const itemsToRedact: string[] = [];
  if (typeof token === "string") {
    itemsToRedact.push(token);
  }

  const cmdRunner = new CommandRunner({ itemsToRedact });

  yield cmdRunner.run("mkdir", ["-p", repoPath]);

  const repoCmdRunner = new CommandRunner({ itemsToRedact, cwd: repoPath });

  // Clone the repository if it does not exist
  yield repoCmdRunner.run("git", ["clone", "--quiet", `${url}/${upstream.owner}/${upstream.repo}.git`, repoPath], {
    testAllowedErrorMessage: (err) => err.endsWith("already exists and is not an empty directory."),
  });

  // Clean up garbage files before checkout
  yield repoCmdRunner.run("git", ["add", "."]);
  yield repoCmdRunner.run("git", ["reset", "--hard"]);

  // Check out to the detached head so that any branch can be deleted
  const out = await repoCmdRunner.run("git", ["rev-parse", "HEAD"]);
  if (out instanceof Error) {
    return out;
  }
  const detachedHead = out.trim();
  yield repoCmdRunner.run("git", ["checkout", "--quiet", detachedHead], {
    testAllowedErrorMessage: (err) =>
      // Why the hell is this not printed to stdout?
      err.startsWith("HEAD is now at"),
  });

  const prRemote = "pr";
  yield repoCmdRunner.run("git", ["remote", "remove", prRemote], {
    testAllowedErrorMessage: (err) => err.includes("No such remote:"),
  });

  yield repoCmdRunner.run("git", ["remote", "add", prRemote, `${url}/${contributor.owner}/${contributor.repo}.git`]);

  yield repoCmdRunner.run("git", ["fetch", "--quiet", prRemote, contributor.branch]);

  yield repoCmdRunner.run("git", ["branch", "-D", contributor.branch], {
    testAllowedErrorMessage: (err) => err.endsWith("not found."),
  });

  yield repoCmdRunner.run("git", ["checkout", "--quiet", "--track", `${prRemote}/${contributor.branch}`]);
};
