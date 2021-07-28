import { Octokit } from "@octokit/rest"
import assert from "assert"
import fs from "fs"
import ld from "lodash"

import { cancelHandles } from "./executor"
import { updateComment } from "./github"
import { CommandOutput, PullRequestParams, PullRequestTask } from "./types"

export const getLines = function (str: string) {
  return str
    .split("\n")
    .map(function (line) {
      return line.trim()
    })
    .filter(function (line) {
      return !!line
    })
}

export const getCommand = function (
  commandLine: string,
  { baseEnv = {} }: { baseEnv?: Record<string, string> },
) {
  const parts = commandLine.split(" ").filter(function (value) {
    return !!value
  })

  const [envArgs, command] = ld.partition(parts, function (value) {
    return value.match(/^[A-Za-z_]+=/)
  })

  const env: Record<string, string> = baseEnv
  for (const rawValue of envArgs) {
    const matches = rawValue.match(/^([A-Za-z_]+)=(.*)/)
    assert(matches)

    const [, name, value] = matches
    assert(name)
    assert(value !== undefined && value !== null)

    env[name] = value
  }

  const [execPath, ...args] = command

  return {
    execPath,
    args,
    env,
  }
}

export const redactSecrets = function (str: string, secrets: string[] = []) {
  for (const secret of secrets) {
    str = str.replace(secret, "{SECRET}")
  }
  return str
}

export const displayCommand = function ({
  execPath,
  args,
  secretsToHide,
}: {
  execPath: string
  args: string[]
  secretsToHide: string[]
}) {
  return redactSecrets(`${execPath} ${args.join(" ")}`, secretsToHide)
}

export const getPostPullRequestResult = function ({
  taskData,
  octokit,
  handleId,
}: {
  taskData: PullRequestTask
  octokit: Octokit
  handleId: string
}) {
  return async function (result: CommandOutput) {
    cancelHandles.delete(handleId)

    const { owner, repo, commentId, requester, pull_number } = taskData
    const resultDisplay =
      typeof result === "string"
        ? result
        : `${result.toString()}\n${result.stack}`

    await updateComment(octokit, {
      owner,
      repo,
      issue_number: pull_number,
      comment_id: commentId,
      body: `@${requester} ${resultDisplay}`,
    })
  }
}

export const getPullRequestHandleId = function ({
  owner,
  repo,
  pull_number,
}: PullRequestParams) {
  return `owner: ${owner}, repo: ${repo}, pull: ${pull_number}`
}

export const millisecondsDelay = function (milliseconds: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, milliseconds)
  })
}

export const ensureDir = function (dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}
