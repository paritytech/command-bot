import { createAppAuth } from "@octokit/auth-app"
import assert from "assert"
import { MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk"
import path from "path"
import { Probot, Server } from "probot"

import { AccessDB, getDb, getSortedTasks, TaskDB } from "src/db"

import { setupApi } from "./api"
import { setupBot } from "./bot"
import { requeueUnterminated } from "./executor"
import { Logger } from "./logger"
import { Context } from "./types"
import { ensureDir, initDatabaseDir, removeDir } from "./utils"

export const setup = async (
  bot: Probot,
  server: Server,
  {
    appId,
    clientId,
    clientSecret,
    privateKey,
    deployment,
    startDate,
    logger,
    serverInfo,
    shouldPostPullRequestComment,
  }: Pick<
    Context,
    "deployment" | "serverInfo" | "shouldPostPullRequestComment"
  > & {
    appId: number
    clientId: string
    clientSecret: string
    privateKey: string
    startDate: Date
    logger: Logger
  },
) => {
  const allowedOrganizations = (process.env.ALLOWED_ORGANIZATIONS ?? "")
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

  const dataPath = process.env.DATA_PATH
  assert(dataPath)

  if (process.env.CARGO_TARGET_DIR) {
    await ensureDir(process.env.CARGO_TARGET_DIR)
  }

  /*
    For the deployment this should always happen because TMPDIR targets a
    location on the persistent volume (ephemeral storage on Kubernetes cluster
    is too low for building Substrate)
  */
  if (process.env.CLEAR_TMPDIR_ON_START === "true") {
    assert(process.env.TMPDIR)
    await removeDir(process.env.TMPDIR)
    await ensureDir(process.env.TMPDIR)
  }

  const repositoryCloneDirectoryPath = path.join(dataPath, "repositories")
  if (process.env.CLEAR_REPOSITORIES_ON_START === "true") {
    logger.info("Clearing the repositories before starting")
    await removeDir(repositoryCloneDirectoryPath)
  }
  const repositoryCloneDirectory = await ensureDir(repositoryCloneDirectoryPath)

  const taskDbPath = await initDatabaseDir(path.join(dataPath, "db"))
  const taskDb = new TaskDB(getDb(taskDbPath))

  const accessDbPath = await initDatabaseDir(path.join(dataPath, "access_db"))
  const accessDb = new AccessDB(getDb(accessDbPath))

  if (process.env.CLEAR_DB_ON_START === "true") {
    logger.info("Clearing the database before starting")
    for (const { id } of await getSortedTasks(
      { taskDb, startDate, serverInfo, logger },
      { fromOtherServerInstances: true },
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
  const getFetchEndpoint = async (installationId: number | null) => {
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
    : new Promise<MatrixClient | Error>((resolve, reject) => {
        matrixClientPreStart
          .start()
          .then(() => {
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

  const ctx: Context = {
    appName: "try-runtime-bot",
    taskDb,
    accessDb,
    getFetchEndpoint,
    log: bot.log,
    allowedOrganizations,
    logger,
    repositoryCloneDirectory,
    deployment,
    matrix,
    masterToken: process.env.MASTER_TOKEN || null,
    nodesAddresses,
    startDate,
    serverInfo,
    shouldPostPullRequestComment,
  }

  void requeueUnterminated(ctx, bot)

  setupBot(ctx, bot)

  setupApi(ctx, server)
}
