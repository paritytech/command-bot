import assert from "assert"
import http from "http"
import path from "path"
import { Logger as ProbotLogger, Probot, Server } from "probot"
import { getLog } from "probot/lib/helpers/get-log"
import stoppable from "stoppable"

import { Logger } from "./logger"
import { setup } from "./setup"
import { ensureDir, fsExists, fsReadFile, fsWriteFile } from "./shell"
import { envNumberVar, envVar } from "./utils"

const main = async () => {
  const startDate = new Date()

  const logFormat = (() => {
    const value = process.env.LOG_FORMAT
    switch (value) {
      case "json": {
        return value
      }
      case undefined: {
        return null
      }
      default: {
        throw new Error(`Invalid $LOG_FORMAT: ${value}`)
      }
    }
  })()
  const minLogLevel = (() => {
    const value = process.env.MIN_LOG_LEVEL
    switch (value) {
      case undefined: {
        return "info"
      }
      case "info":
      case "warn":
      case "error": {
        return value
      }
      default: {
        throw new Error(`Invalid $MIN_LOG_LEVEL: ${value}`)
      }
    }
  })()
  const logger = new Logger({
    name: "try-runtime-bot",
    minLogLevel,
    logFormat,
    impl: console,
  })

  const masterToken = envVar("MASTER_TOKEN")

  const shouldPostPullRequestComment = (() => {
    const value = process.env.POST_COMMENT
    switch (value) {
      case "false": {
        return false
      }
      case undefined:
      case "true": {
        return true
      }
      default: {
        throw new Error(`Invalid $POST_COMMENT: ${value}`)
      }
    }
  })()

  const dataPath = envVar("DATA_PATH")
  await ensureDir(dataPath)

  const appDbVersionPath = path.join(dataPath, "task-db-version")
  const shouldClearTaskDatabaseOnStart = process.env.TASK_DB_VERSION
    ? await (async (appDbVersion) => {
        const currentDbVersion = await (async () => {
          if (await fsExists(appDbVersionPath)) {
            return (await fsReadFile(appDbVersionPath)).toString().trim()
          }
        })()
        if (currentDbVersion !== appDbVersion) {
          await fsWriteFile(appDbVersionPath, appDbVersion)
          return true
        }
      })(process.env.TASK_DB_VERSION.trim())
    : false

  if (process.env.PING_PORT) {
    // Signal that we have started listening until Probot kicks in
    const pingPort = parseInt(process.env.PING_PORT)
    const pingServer = stoppable(
      http.createServer((_, res) => {
        res.writeHead(200)
        res.end()
      }),
      0,
    )
    pingServer.listen(pingPort)
  }

  const appId = envNumberVar("APP_ID")
  const privateKey = Buffer.from(
    envVar("PRIVATE_KEY_BASE64"),
    "base64",
  ).toString()

  const clientId = envVar("CLIENT_ID")
  const clientSecret = envVar("CLIENT_SECRET")
  const webhookSecret = envVar("WEBHOOK_SECRET")

  let probotLogger: ProbotLogger | undefined = undefined
  switch (logFormat) {
    case "json": {
      probotLogger = getLog({
        level: "error",
        logFormat: "json",
        logLevelInString: true,
        logMessageKey: "msg",
      })
      break
    }
    case null: {
      break
    }
    default: {
      const exhaustivenessCheck: never = logFormat
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Not exhaustive: ${exhaustivenessCheck}`)
    }
  }
  const bot = Probot.defaults({
    appId,
    privateKey,
    secret: webhookSecret,
    logLevel: "info",
    ...(probotLogger === undefined
      ? {}
      : { log: probotLogger.child({ name: "probot" }) }),
  })
  const server = new Server({
    Probot: bot,
    ...(probotLogger === undefined
      ? {}
      : { log: probotLogger.child({ name: "server" }) }),
    webhookProxy: process.env.WEBHOOK_PROXY_URL,
  })

  const allowedOrganizations = envVar("ALLOWED_ORGANIZATIONS")
    .split(",")
    .filter((value) => {
      return value.length !== 0
    })
    .map((value) => {
      const parsedValue = parseInt(value)
      assert(parsedValue)
      return parsedValue
    })
  assert(allowedOrganizations.length)

  const matrix = (() => {
    if (process.env.MATRIX_HOMESERVER) {
      return {
        homeServer: process.env.MATRIX_HOMESERVER,
        accessToken: envVar("MATRIX_ACCESS_TOKEN"),
      }
    } else {
      return undefined
    }
  })()

  const nodesAddresses: Record<string, string> = {}
  const nodeEnvVarSuffix = "_WEBSOCKET_ADDRESS"
  for (const [envVarName, envVarValue] of Object.entries(process.env)) {
    if (!envVarValue || !envVarName.endsWith(nodeEnvVarSuffix)) {
      continue
    }
    const nodeName = envVarName
      .slice(0, envVarName.indexOf(nodeEnvVarSuffix))
      .toLowerCase()
    nodesAddresses[nodeName] = envVarValue
  }
  logger.info(nodesAddresses, "Registered nodes addresses")

  const gitlabAccessToken = envVar("GITLAB_ACCESS_TOKEN")
  const gitlabAccessTokenUsername = envVar("GITLAB_ACCESS_TOKEN_USERNAME")
  const gitlabDomain = envVar("GITLAB_DOMAIN")
  const gitlabPushNamespace = envVar("GITLAB_PUSH_NAMESPACE")
  const gitlabDefaultJobImage = envVar("GITLAB_DEFAULT_JOB_IMAGE")

  await server.load((probot) => {
    void setup(probot, server, {
      appId,
      clientId,
      clientSecret,
      privateKey,
      logger,
      startDate,
      shouldPostPullRequestComment,
      allowedOrganizations,
      dataPath,
      matrix,
      nodesAddresses,
      masterToken,
      shouldClearTaskDatabaseOnStart,
      isDeployment: !!process.env.IS_DEPLOYMENT,
      gitlab: {
        accessToken: gitlabAccessToken,
        accessTokenUsername: gitlabAccessTokenUsername,
        domain: gitlabDomain,
        pushNamespace: gitlabPushNamespace,
        defaultJobImage: gitlabDefaultJobImage,
      },
    })
  })

  void server.start()
  logger.info("Probot has started!")
}

void main()
