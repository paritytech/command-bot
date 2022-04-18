import cp from "child_process"
import { MatrixClient } from "matrix-bot-sdk"

import type { AccessDB, TaskDB } from "./db"
import { Logger } from "./logger"

export type GitRef = {
  contributor: string
  owner: string
  repo: string
  branch: string
}

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
  shouldPostPullRequestComment: boolean
}

export class PullRequestError {
  constructor(
    public pr: {
      owner: string
      repo: string
      number: number
    },
    public comment: {
      body: string
      commentId?: number
      requester?: string
    },
  ) {}
}

export type ToString = { toString: () => string }

export type CommandOutput = Error | string
export type CommandExecutor = (
  execPath: string,
  args: string[],
  opts?: {
    allowedErrorCodes?: number[]
    options?: cp.SpawnOptionsWithoutStdio & { cwd?: string }
    testAllowedErrorMessage?: (stderr: string) => boolean
    secretsToHide?: string[]
    shouldTrackProgress?: boolean
    shouldCaptureAllStreams?: boolean
  },
) => Promise<CommandOutput>
