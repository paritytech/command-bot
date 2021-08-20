import { createAppAuth } from "@octokit/auth-app"
import assert from "assert"
import { isValid, parseISO } from "date-fns"
import http from "http"
import { MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk"
import path from "path"
import { Logger as ProbotLogger, Probot, Server } from "probot"
import { getLog } from "probot/lib/helpers/get-log"
import stoppable from "stoppable"

import { AccessDB, getDb, getSortedTasks, TaskDB } from "src/db"

import { setupApi } from "./api"
import { requeueUnterminated } from "./executor"
import { Logger } from "./logger"
import { State } from "./types"
import { ensureDir, initDatabaseDir, removeDir } from "./utils"
import { getWebhooksHandlers, setupEvent } from "./webhook"

const setupProbot = async function (state: State) {
  const { bot, logger } = state

  const { onIssueCommentCreated } = getWebhooksHandlers(state)
  setupEvent(bot, "issue_comment.created", onIssueCommentCreated, logger)
}

const taskIdSeparator = "-task-"
const serverSetup = async function (
  bot: Probot,
  server: Server,
  {
    appId,
    clientId,
    clientSecret,
    privateKey,
    deployment,
  }: {
    appId: number
    clientId: string
    clientSecret: string
    privateKey: string
    deployment: State["deployment"]
  },
) {
  const logger = new Logger({ name: "app" })

  const version = new Date().toISOString()

  let uniqueIdCounter = 0
  const getUniqueId = function () {
    return `${version}__${++uniqueIdCounter}`
  }
  const getTaskId = function () {
    return `${new Date().toISOString()}${taskIdSeparator}${getUniqueId()}`
  }
  const parseTaskId = function (taskId: string) {
    let rawDate: string
    let suffix: string | undefined

    let rawDateEnd = taskId.indexOf(taskIdSeparator)
    if (rawDateEnd === -1) {
      rawDate = taskId
      suffix = undefined
    } else {
      rawDate = taskId.slice(0, rawDateEnd)
      suffix = taskId.slice(rawDateEnd + taskIdSeparator.length)
    }

    const date = parseISO(rawDate)
    if (!isValid(date)) {
      return new Error(`Invalid date ${rawDate}`)
    }

    return { date, suffix }
  }

  const allowedOrganizations = (process.env.ALLOWED_ORGANIZATIONS ?? "")
    .split(",")
    .filter(function (value) {
      return value.length !== 0
    })
    .map(function (value) {
      const parsedValue = parseInt(value)
      assert(parsedValue)
      return parsedValue
    })
  assert(allowedOrganizations.length)

  const dataPath = process.env.DATA_PATH
  assert(dataPath)

  // For the deployment this should always happen because TMPDIR targets a
  // location on the persistent volume (ephemeral storage on Kubernetes cluster
  // is too low for building Substrate)
  if (process.env.CLEAR_TMPDIR_ON_START === "true") {
    assert(process.env.TMPDIR)
    removeDir(process.env.TMPDIR)
    ensureDir(process.env.TMPDIR)
  }

  const repositoryCloneDirectoryPath = path.join(dataPath, "repositories")
  if (process.env.CLEAR_REPOSITORIES_ON_START === "true") {
    logger.info("Clearing the repositories before starting")
    removeDir(repositoryCloneDirectoryPath)
  }
  const repositoryCloneDirectory = ensureDir(repositoryCloneDirectoryPath)

  const taskDbPath = initDatabaseDir(path.join(dataPath, "db"))
  const taskDb = new TaskDB(getDb(taskDbPath))

  const accessDbPath = initDatabaseDir(path.join(dataPath, "access_db"))
  const accessDb = new AccessDB(getDb(accessDbPath))

  if (process.env.CLEAR_DB_ON_START === "true") {
    logger.info("Clearing the database before starting")
    for (const { id } of await getSortedTasks(
      { taskDb, parseTaskId },
      { match: { version, isInverseMatch: true } },
    )) {
      await taskDb.db.del(id)
    }
  }

  const authInstallation = createAppAuth({
    appId,
    privateKey,
    clientId,
    clientSecret,
  })
  const getFetchEndpoint = async function (installationId: number | null) {
    let token: string
    let url: string

    if (installationId) {
      token = (await authInstallation({ type: "installation", installationId }))
        .token
      url = `https://x-access-token:${token}@github.com`
    } else {
      token = ""
      url = "http://github.com"
    }

    return { url, token }
  }

  const matrixClientPreStart: MatrixClient | Error | undefined = process.env
    .MATRIX_HOMESERVER
    ? process.env.MATRIX_ACCESS_TOKEN
      ? new MatrixClient(
          process.env.MATRIX_HOMESERVER,
          process.env.MATRIX_ACCESS_TOKEN,
          new SimpleFsStorageProvider(path.join(dataPath, "matrix.json")),
        )
      : new Error("Missing $MATRIX_ACCESS_TOKEN")
    : undefined
  if (matrixClientPreStart instanceof Error) {
    throw matrixClientPreStart
  }
  const matrix = await (matrixClientPreStart === undefined
    ? Promise.resolve(null)
    : new Promise<MatrixClient | Error>(function (resolve, reject) {
        matrixClientPreStart
          .start()
          .then(function () {
            resolve(matrixClientPreStart)
          })
          .catch(reject)
      }))
  if (matrix instanceof Error) {
    throw matrix
  }

  const nodesAddresses: Record<string, string> = {}
  const nodeEnvVarSuffix = "_WEBSOCKET_ADDRESS"
  for (const [envVar, envVarValue] of Object.entries(process.env)) {
    if (!envVarValue || !envVar.endsWith(nodeEnvVarSuffix)) {
      continue
    }
    const nodeName = envVar
      .slice(0, envVar.indexOf(nodeEnvVarSuffix))
      .toLowerCase()
    nodesAddresses[nodeName] = envVarValue
  }
  logger.info(nodesAddresses, "Registered nodes addresses")

  if (deployment !== undefined) {
    if (matrix === null) {
      throw new Error("Matrix configuration is expected for deployments")
    }
    if (!process.env.MASTER_TOKEN) {
      throw new Error("Master token is expected for deployments")
    }
  }

  const state: State = {
    appName: "try-runtime-bot",
    bot,
    taskDb,
    accessDb,
    getFetchEndpoint,
    log: bot.log,
    version,
    allowedOrganizations,
    logger,
    repositoryCloneDirectory,
    deployment,
    matrix,
    masterToken: process.env.MASTER_TOKEN || null,
    getUniqueId,
    getTaskId,
    parseTaskId,
    nodesAddresses,
  }

  await requeueUnterminated(state)

  setupProbot(state)

  setupApi(server, state)

  logger.info("Probot has started!")
}

const main = async function () {
  let deployment: State["deployment"] = undefined
  if (process.env.IS_DEPLOYMENT === "true") {
    assert(process.env.DEPLOYMENT_ENVIRONMENT)
    assert(process.env.DEPLOYMENT_CONTAINER)
    deployment = {
      environment: process.env.DEPLOYMENT_ENVIRONMENT,
      container: process.env.DEPLOYMENT_CONTAINER,
    }
  }

  if (process.env.PING_PORT) {
    // Signal that we have started listening until Probot kicks in
    const pingPort = parseInt(process.env.PING_PORT)
    const pingServer = stoppable(
      http.createServer(function (_, res) {
        res.writeHead(200)
        res.end()
      }),
      0,
    )
    pingServer.listen(pingPort)
  }

  assert(process.env.APP_ID)
  const appId = parseInt(process.env.APP_ID)
  assert(appId)

  assert(process.env.PRIVATE_KEY_BASE64)
  process.env.PRIVATE_KEY = Buffer.from(
    process.env.PRIVATE_KEY_BASE64,
    "base64",
  ).toString()
  assert(process.env.PRIVATE_KEY)
  const privateKey = process.env.PRIVATE_KEY

  assert(process.env.CLIENT_ID)
  const clientId = process.env.CLIENT_ID

  assert(process.env.CLIENT_SECRET)
  const clientSecret = process.env.CLIENT_SECRET

  assert(process.env.WEBHOOK_SECRET)
  const webhookSecret = process.env.WEBHOOK_SECRET

  let probotLogger: ProbotLogger | undefined = undefined
  switch (process.env.LOG_FORMAT) {
    case "json": {
      probotLogger = getLog({
        level: "info",
        logFormat: "json",
        logLevelInString: true,
        logMessageKey: "msg",
      })
      break
    }
  }
  const bot = Probot.defaults({
    appId,
    privateKey,
    secret: webhookSecret,
    logLevel: "info",
    ...(probotLogger ? { log: probotLogger.child({ name: "probot" }) } : {}),
  })
  const server = new Server({
    Probot: bot,
    ...(probotLogger ? { log: probotLogger.child({ name: "server" }) } : {}),
  })
  await server.load(function (bot: Probot) {
    return serverSetup(bot, server, {
      appId,
      clientId,
      clientSecret,
      privateKey,
      deployment,
    })
  })

  server.start()
}

main()
