import assert from "assert"
import path from "path"

import { isNewDBVersionRequested } from "src/db"
import { ensureDirSync } from "src/shell"
import { PipelineScripts } from "src/types"
import { envNumberVar, envVar } from "src/utils"

const repository = envVar("PIPELINE_SCRIPTS_REPOSITORY")
assert(!repository.endsWith(".git"), "PIPELINE_SCRIPTS_REPOSITORY shouldn't end with .git")
const ref = process.env.PIPELINE_SCRIPTS_REF

const pipelineScripts: PipelineScripts = { repository, ref }

const disablePRComment = !!process.env.DISABLE_PR_COMMENT

const dataPath = envVar("DATA_PATH")
ensureDirSync(dataPath)

export const appDbVersionPath = path.join(dataPath, "task-db-version")
const taskDbVersion = process.env.TASK_DB_VERSION?.trim() || ""

export type MatrixConfig = {
  homeServer: string
  accessToken: string
}
const matrix: MatrixConfig | undefined = (() => {
  if (process.env.MATRIX_HOMESERVER) {
    return { homeServer: process.env.MATRIX_HOMESERVER, accessToken: envVar("MATRIX_ACCESS_TOKEN") }
  } else {
    return undefined
  }
})()

const allowedOrganizations = envVar("ALLOWED_ORGANIZATIONS")
  .split(",")
  .filter((value) => value.length !== 0)
  .map((value) => {
    const parsedValue = parseInt(value)
    assert(parsedValue)
    return parsedValue
  })

export type Config = {
  matrix: MatrixConfig | undefined
  dataPath: string
  pipelineScripts: PipelineScripts
  appDbVersionPath: string
  allowedOrganizations: number[]
  shouldClearTaskDatabaseOnStart: boolean
  disablePRComment: boolean
  startDate: Date
  pingPort: number | undefined
  isDeployment: boolean
  githubBaseUrl: string | undefined
  githubRemoteUrl: string | undefined
  webhookPort: number | undefined
  webhookProxy: string | undefined
  webhookSecret: string
  masterToken: string
  appId: number
  privateKey: string
  clientId: string
  clientSecret: string
  gitlabAccessToken: string
  gitlabAccessTokenUsername: string
  gitlabDomain: string
  gitlabPushNamespace: string
  gitlabJobImage: string
  cmdBotUrl: string
}

export const config: Config = {
  matrix,
  dataPath,
  pipelineScripts,
  appDbVersionPath,
  allowedOrganizations,
  shouldClearTaskDatabaseOnStart: isNewDBVersionRequested(appDbVersionPath, taskDbVersion),
  disablePRComment,
  startDate: new Date(),
  pingPort: process.env.PING_PORT ? parseInt(process.env.PING_PORT, 10) || undefined : undefined,
  isDeployment: !!process.env.IS_DEPLOYMENT,
  githubBaseUrl: process.env.GITHUB_BASE_URL,
  githubRemoteUrl: process.env.GITHUB_REMOTE_URL,
  webhookPort: process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT, 10) || undefined : undefined,
  webhookProxy: process.env.WEBHOOK_PROXY_URL,
  webhookSecret: envVar("WEBHOOK_SECRET"),
  masterToken: envVar("MASTER_TOKEN"),
  appId: envNumberVar("APP_ID"),
  privateKey: Buffer.from(envVar("PRIVATE_KEY_BASE64"), "base64").toString(),
  clientId: envVar("CLIENT_ID"),
  clientSecret: envVar("CLIENT_SECRET"),
  gitlabAccessToken: envVar("GITLAB_ACCESS_TOKEN"),
  gitlabAccessTokenUsername: envVar("GITLAB_ACCESS_TOKEN_USERNAME"),
  gitlabDomain: envVar("GITLAB_DOMAIN"),
  gitlabPushNamespace: envVar("GITLAB_PUSH_NAMESPACE"),
  gitlabJobImage: envVar("GITLAB_JOB_IMAGE"),
  cmdBotUrl: envVar("CMD_BOT_URL"),
}
