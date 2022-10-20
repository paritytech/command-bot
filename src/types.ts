import { MatrixClient } from "matrix-bot-sdk"
import { Logger } from "opstooling-js"

import type { AccessDB, TaskDB } from "./db"

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

export type PipelineScripts =
  | {
      repository: string
      ref: string | undefined
    }
  | undefined

export type Context = {
  startDate: Date
  taskDb: TaskDB
  accessDb: AccessDB
  getFetchEndpoint: (installationId: number | null) => Promise<{ token: string | null; url: string }>
  log: (str: string) => void
  allowedOrganizations: number[]
  logger: Logger
  isDeployment: boolean
  matrix: MatrixClient | null
  masterToken: string
  shouldPostPullRequestComment: boolean
  repositoryCloneDirectory: string
  gitlab: {
    accessToken: string
    domain: string
    pushNamespace: string
    jobImage: string
    accessTokenUsername: string
  }
  pipelineScripts: PipelineScripts
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
