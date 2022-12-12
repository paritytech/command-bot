import assert from "assert"
import { readFile, writeFile } from "fs/promises"
import path from "path"

import { ensureDirSync } from "./shell"
import { PipelineScripts } from "./types"
import { envNumberVar, envVar } from "./utils"
import { readFileSync, writeFileSync } from "fs"

const repository = envVar("PIPELINE_SCRIPTS_REPOSITORY")
const ref = process.env.PIPELINE_SCRIPTS_REF

const pipelineScripts: PipelineScripts = { repository, ref }

const disablePRComment = !!process.env.DISABLE_PR_COMMENT

const dataPath = envVar("DATA_PATH")
ensureDirSync(dataPath)

const appDbVersionPath = path.join(dataPath, "task-db-version")
const shouldClearTaskDatabaseOnStart = process.env.TASK_DB_VERSION
  ? ((appDbVersion) => {
      const currentDbVersion = (() => {
        try {
          return readFileSync(appDbVersionPath).toString().trim()
        } catch (error) {
          if (
            /*
          Test for the following error:
            [Error: ENOENT: no such file or directory, open '/foo'] {
              errno: -2,
              code: 'ENOENT',
              syscall: 'unlink',
              path: '/foo'
            }
          */
            !(error instanceof Error) ||
            (error as { code?: string })?.code !== "ENOENT"
          ) {
            throw error
          }
        }
      })()
      if (currentDbVersion !== appDbVersion) {
        writeFileSync(appDbVersionPath, appDbVersion)
        return true
      }
    })(process.env.TASK_DB_VERSION.trim())
  : false

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
assert(allowedOrganizations.length)

export const config = {
  matrix,
  dataPath,
  pipelineScripts,
  appDbVersionPath,
  allowedOrganizations,
  shouldClearTaskDatabaseOnStart,
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
}
