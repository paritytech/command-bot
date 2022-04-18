import { MatrixClient } from "matrix-bot-sdk"
import { Probot } from "probot"

import type { AccessDB, TaskDB } from "./db"
import { Logger } from "./logger"

export type PullRequestParams = {
  owner: string
  repo: string
  pull_number: number
}

type GitRef = {
  contributor: string
  owner: string
  repo: string
  branch: string
}

export type TaskBase<T> = {
  tag: T
  id: string
  serverId: string
  queuedDate: string
  timesRequeued: number
  timesRequeuedSnapshotBeforeExecution: number
  timesExecuted: number
  commandDisplay: string
  execPath: string
  args: string[]
  env: Record<string, string>
  gitRef: GitRef
  repoPath: string
  requester: string
}

export type PullRequestTask = TaskBase<"PullRequestTask"> & {
  commentId: number
  installationId: number
  gitRef: GitRef & { number: number }
}

export type ApiTask = TaskBase<"ApiTask"> & {
  matrixRoom: string
}

export type Task = PullRequestTask | ApiTask

export type CommandOutput = Error | string

export type Context = {
  appName: string
  startDate: Date
  taskDb: TaskDB
  accessDb: AccessDB
  getFetchEndpoint: (
    installationId: number | null,
  ) => Promise<{ token: string; url: string }>
  log: (str: string) => void
  allowedOrganizations: number[]
  logger: Logger
  repositoryCloneDirectory: string
  deployment: { environment: string; container: string } | undefined
  matrix: MatrixClient | null
  masterToken: string | null
  nodesAddresses: Record<string, string>
  serverInfo: {
    id: string
  }
  shouldPostPullRequestComment: boolean
}

export class PullRequestError {
  constructor(
    public params: PullRequestParams,
    public comment: {
      body: string
      commentId?: number
      requester?: string
    },
  ) {}
}

export type GetCommandOptions = { baseEnv: Record<string, string> }

export type Octokit = Awaited<ReturnType<Probot["auth"]>>

export type ToString = { toString: () => string }
