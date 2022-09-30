import { ChildProcess, execFile, spawn } from "child_process"
import { promises as fs } from "fs"
import { ensureDefined } from "opstooling-js"
import path from "path"
import { promisify } from "util"

import { findFreePorts } from "./util"

const execFilePromise = promisify(execFile)

type GitDaemon = {
  url: string
  rootPath: string
  instance: ChildProcess
}

export type GitDaemons = {
  gitHub: GitDaemon
  gitLab: GitDaemon
}

const gitDaemons: GitDaemons | null = null

function startDaemon(name: string, port: number): GitDaemon {
  const rootPath = path.join(process.cwd(), "data", `test-git-${name}`)

  // // initialising mocks for both fork and target repo
  const instance = spawn("git", [
    "daemon",
    `--port=${port}`,
    `--base-path=${rootPath}`,
    "--export-all",
    "--enable=receive-pack",
  ])

  return { url: `git://localhost:${port}`, rootPath, instance }
}

export async function startGitDaemons(): Promise<GitDaemons> {
  if (gitDaemons !== null) {
    return gitDaemons
  }

  const freePorts = await findFreePorts(2)

  console.log(freePorts)

  return {
    gitHub: startDaemon("github", ensureDefined(freePorts[0])),
    gitLab: startDaemon("gitlab", ensureDefined(freePorts[1])),
  }
}

export function stopGitDaemons(): void {
  gitDaemons?.gitHub.instance.kill()
  gitDaemons?.gitLab.instance.kill()
}

export async function initRepo(
  gitDaemon: GitDaemon,
  owner: string,
  repoName: string,
  additionalBranches: string[],
): Promise<void> {
  const repoPath = path.join(gitDaemon.rootPath, owner, repoName)

  // Scrape repos clean, as we're doing pulls/pushes, and assert on results
  await fs.rm(repoPath, { force: true, recursive: true })
  await fs.mkdir(repoPath, { recursive: true })
  /* potentially we might want to have some meaningful setup for repositories,
     but for now we can pull and force-push to repos of any state */
  await execFilePromise("git", ["init", "--quiet", "-b", "master"], { cwd: repoPath })
  await fs.writeFile(path.join(repoPath, "README.md"), "bump")

  await execFilePromise("git", ["add", "README.md"], { cwd: repoPath })
  await execFilePromise("git", ["commit", "-m", "initial commit"], { cwd: repoPath })

  for (const branch of additionalBranches) {
    await execFilePromise("git", ["checkout", "-b", branch], { cwd: repoPath })
    await execFilePromise("git", ["commit", "--allow-empty", "-m", `commit in ${branch}`], { cwd: repoPath })
  }
}
