import { MatrixClient } from "matrix-bot-sdk"
import { Logger } from "opstooling-js"

import type { AccessDB, TaskDB } from "src/db"
import { CmdJson } from "src/schema/schema.cmd"

export type GitRef = {
  contributor: {
    owner: string
    repo: string
    branch: string
  }
  upstream: {
    owner: string
    repo: string
    branch?: string
  }
}

export type PipelineScripts = {
  repository: string
  ref: string | undefined
}

export type Context = {
  taskDb: TaskDB
  accessDb: AccessDB
  getFetchEndpoint: (installationId: number | null) => Promise<{ token: string | null; url: string }>
  log: (str: string) => void
  allowedOrganizations: number[]
  logger: Logger
  matrix: MatrixClient | null
  disablePRComment: boolean
  repositoryCloneDirectory: string
  gitlab: {
    accessToken: string
    domain: string
    pushNamespace: string
    jobImage: string
    accessTokenUsername: string
  }
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

export type CommandConfigs = { [key: string]: CmdJson }
