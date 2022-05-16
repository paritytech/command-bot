import { ExtendedOctokit, isOrganizationMember } from "./github"
import { CommandRunner } from "./shell"
import { Task } from "./task"
import { Context } from "./types"

/*
  TODO: Move command configurations to configuration repository or database so
  that it can be updated dynamically, without redeploying the application
*/
export type CommandConfiguration = {
  gitlab: {
    job: {
      tags: string[]
      variables: Record<string, string>
    }
  }
  commandStart: string[]
}
export const commandsConfiguration: {
  [K in "try-runtime" | "bench-bot"]: CommandConfiguration
} = {
  "try-runtime": {
    gitlab: {
      job: {
        tags: ["linux-docker"],
        variables: { RUST_LOG: "remote-ext=info" },
      },
    },
    commandStart: [
      "cargo",
      "run",
      /*
        Requirement: always run the command in release mode.
        See https://github.com/paritytech/try-runtime-bot/issues/26#issue-1049555966
      */
      "--release",
      /*
        "--quiet" should be kept so that the output doesn't get polluted
        with a bunch of compilation stuff
      */
      "--quiet",
      "--features=try-runtime",
      "try-runtime",
    ],
  },
  "bench-bot": {
    gitlab: { job: { tags: ["bench-bot"], variables: {} } },
    commandStart: ['"$PIPELINE_SCRIPTS_DIR/bench-bot.sh"'],
  },
}

export const isRequesterAllowed = async (
  ctx: Context,
  octokit: ExtendedOctokit,
  username: string,
) => {
  const { allowedOrganizations } = ctx

  for (const organizationId of allowedOrganizations) {
    if (
      await isOrganizationMember(ctx, { organizationId, username, octokit })
    ) {
      return true
    }
  }

  return false
}

export const prepareBranch = async function* (
  ctx: Context,
  { repoPath, gitRef: { contributor, owner, repo, branch } }: Task,
  {
    getFetchEndpoint,
  }: {
    getFetchEndpoint: () => Promise<{ token: string; url: string }>
  },
) {
  const { token, url } = await getFetchEndpoint()

  const cmdRunner = new CommandRunner(ctx, { itemsToRedact: [token] })

  yield cmdRunner.run("mkdir", ["-p", repoPath])

  const repoCmdRunner = new CommandRunner(ctx, {
    itemsToRedact: [token],
    cwd: repoPath,
  })

  // Clone the repository if it does not exist
  yield repoCmdRunner.run(
    "git",
    ["clone", "--quiet", `${url}/${owner}/${repo}`, repoPath],
    {
      testAllowedErrorMessage: (err) => {
        return err.endsWith("already exists and is not an empty directory.")
      },
    },
  )

  // Clean up garbage files before checkout
  yield repoCmdRunner.run("git", ["add", "."])
  yield repoCmdRunner.run("git", ["reset", "--hard"])

  // Check out to the detached head so that any branch can be deleted
  const out = await repoCmdRunner.run("git", ["rev-parse", "HEAD"])
  if (out instanceof Error) {
    return out
  }
  const detachedHead = out.trim()
  yield repoCmdRunner.run("git", ["checkout", "--quiet", detachedHead], {
    testAllowedErrorMessage: (err) => {
      // Why the hell is this not printed to stdout?
      return err.startsWith("HEAD is now at")
    },
  })

  const prRemote = "pr"
  yield repoCmdRunner.run("git", ["remote", "remove", prRemote], {
    testAllowedErrorMessage: (err) => {
      return err.includes("No such remote:")
    },
  })

  yield repoCmdRunner.run("git", [
    "remote",
    "add",
    prRemote,
    `${url}/${contributor}/${repo}.git`,
  ])

  yield repoCmdRunner.run("git", ["fetch", "--quiet", prRemote, branch])

  yield repoCmdRunner.run("git", ["branch", "-D", branch], {
    testAllowedErrorMessage: (err) => {
      return err.endsWith("not found.")
    },
  })

  yield repoCmdRunner.run("git", [
    "checkout",
    "--quiet",
    "--track",
    `${prRemote}/${branch}`,
  ])
}
