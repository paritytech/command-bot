import { createAppAuth } from "@octokit/auth-app"
import { MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk"
import path from "path"
import { Probot, Server } from "probot"

import { AccessDB, getDb, TaskDB } from "src/db"

import { setupApi } from "./api"
import { setupBot } from "./bot"
import { Logger } from "./logger"
import { ensureDir, initDatabaseDir } from "./shell"
import { requeueUnterminatedTasks } from "./task"
import { Context } from "./types"
import { Err, Ok } from "./utils"

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
    shouldPostPullRequestComment,
    allowedOrganizations,
    dataPath,
    matrix: matrixConfiguration,
    cargoTargetDir,
    nodesAddresses,
    masterToken,
  }: Pick<
    Context,
    | "deployment"
    | "shouldPostPullRequestComment"
    | "allowedOrganizations"
    | "nodesAddresses"
    | "masterToken"
  > & {
    appId: number
    clientId: string
    clientSecret: string
    privateKey: string
    startDate: Date
    logger: Logger
    dataPath: string
    matrix:
      | {
          homeServer: string
          accessToken: string
        }
      | undefined
    cargoTargetDir: string | undefined
  },
) => {
  if (cargoTargetDir) {
    await ensureDir(cargoTargetDir)
  }

  const repositoryCloneDirectoryPath = path.join(dataPath, "repositories")
  const repositoryCloneDirectory = await ensureDir(repositoryCloneDirectoryPath)

  const taskDbPath = await initDatabaseDir(path.join(dataPath, "db"))
  const taskDb = new TaskDB(getDb(taskDbPath))

  const accessDbPath = await initDatabaseDir(path.join(dataPath, "access_db"))
  const accessDb = new AccessDB(getDb(accessDbPath))

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

  const matrixClientSetup: Ok<MatrixClient | null> | Err<unknown> =
    await (matrixConfiguration === undefined
      ? Promise.resolve(new Ok(null))
      : new Promise((resolve) => {
          const matrixClient = new MatrixClient(
            matrixConfiguration.homeServer,
            matrixConfiguration.accessToken,
            new SimpleFsStorageProvider(path.join(dataPath, "matrix.json")),
          )
          matrixClient
            .start()
            .then(() => {
              resolve(new Ok(matrixClient))
            })
            .catch((error) => {
              resolve(new Err(error))
            })
        }))
  if (matrixClientSetup instanceof Err) {
    throw matrixClientSetup.value
  }

  const { value: matrix } = matrixClientSetup

  if (deployment !== undefined && matrix === null) {
    throw new Error("Matrix configuration is expected for deployments")
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
    masterToken,
    nodesAddresses,
    startDate,
    shouldPostPullRequestComment,
    cargoTargetDir: process.env.CARGO_TARGET_DIR,
  }

  void requeueUnterminatedTasks(ctx, bot)

  setupBot(ctx, bot)

  setupApi(ctx, server)
}
