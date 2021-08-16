import { Octokit } from "@octokit/rest"
import assert from "assert"
import fs from "fs"
import ld from "lodash"

import { githubCommentCharacterLimit } from "./constants"
import { cancelHandles } from "./executor"
import { createComment } from "./github"
import {
  CommandOutput,
  PullRequestParams,
  PullRequestTask,
  State,
} from "./types"

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

  return { execPath, args, env }
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
  state: { logger, deployment },
}: {
  taskData: PullRequestTask
  octokit: Octokit
  handleId: string
  state: Pick<State, "deployment" | "logger">
}) {
  return async function (result: CommandOutput) {
    try {
      logger.info({ result, taskData }, "Posting pull request result")

      cancelHandles.delete(handleId)

      const { owner, repo, requester, pull_number, commandDisplay } = taskData

      const before = `
@${requester} Results are ready for ${commandDisplay}

<details>
<summary>Output</summary>

\`\`\`
`

      const after = `
\`\`\`

</details>`

      let resultDisplay =
        typeof result === "string"
          ? result
          : `${result.toString()}\n${result.stack}`
      let truncateMessageWarning: string
      if (
        before.length + resultDisplay.length + after.length >
        githubCommentCharacterLimit
      ) {
        truncateMessageWarning = `\nThe command's output was too big to be fully displayed. Please go to the logs for the full output. ${getDeploymentLogsMessage(
          deployment,
        )}`
        const truncationIndicator = "[truncated]..."
        resultDisplay = `${truncationIndicator}${resultDisplay.slice(
          0,
          githubCommentCharacterLimit -
            (before.length +
              truncationIndicator.length +
              after.length +
              truncateMessageWarning.length),
        )}`
      } else {
        truncateMessageWarning = ""
      }

      await createComment(octokit, {
        owner,
        repo,
        issue_number: pull_number,
        body: `${before}${resultDisplay}${after}${truncateMessageWarning}`,
      })
    } catch (error) {
      logger.fatal(
        { error, result, taskData },
        "Caught error while trying to post pull request result",
      )
    }
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

export const removeDir = function (dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmdirSync(dir, { recursive: true })
  }
  return dir
}

export const getDeploymentLogsMessage = function (
  deployment: State["deployment"],
) {
  if (deployment === undefined) {
    return ""
  }

  return `The logs for this command should be available on Grafana for the data source \`loki.${deployment.environment}\` and query \`{container=~"${deployment.container}"}\``
}

export class Retry {
  constructor(public context: "compilation error", public motive: string) {}
}
