import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/rest"
import assert from "assert"
import fs from "fs"
import path from "path"
import { Probot, run } from "probot"

import { botMentionPrefix } from "src/constants"
import { getDb, getSortedTasks } from "src/db"

import { queue } from "./executor"
import { Logger } from "./logger"
import { AppState } from "./types"
import {
  ensureDir,
  getPostPullRequestResult,
  getPullRequestHandleId,
  removeDir,
} from "./utils"
import { getWebhooksHandlers, setupEvent } from "./webhook"

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

let deployment: AppState["deployment"] = undefined
if (process.env.IS_DEPLOYMENT === "true") {
  assert(process.env.DEPLOYMENT_ENVIRONMENT)
  assert(process.env.DEPLOYMENT_CONTAINER)
  deployment = {
    environment: process.env.DEPLOYMENT_ENVIRONMENT,
    container: process.env.DEPLOYMENT_CONTAINER,
  }
}

const setupProbot = async function (state: AppState) {
  const { bot, logger } = state

  const { onIssueCommentCreated } = getWebhooksHandlers(state)
  setupEvent(bot, "issue_comment.created", onIssueCommentCreated, logger)
}

const requeueUnterminated = async function (state: AppState) {
  const { db, version, logger, bot } = state

  // Items which are not from this version still remaining in the database are
  // deemed unterminated.
  const unterminatedItems = await getSortedTasks(db, {
    match: { version, isInverseMatch: true },
  })

  for (const { taskData, id } of unterminatedItems) {
    await db.del(id)

    const octokit = await (
      bot.auth as (installationId?: number) => Promise<Octokit>
    )(taskData.installationId)
    const handleId = getPullRequestHandleId(taskData)

    logger.info(`Requeuing ${JSON.stringify(taskData)}`)
    await queue({
      handleId,
      taskData,
      onResult: getPostPullRequestResult({ taskData, octokit, handleId }),
      state,
    })
  }
}

const main = async function (bot: Probot) {
  const logger = new Logger({ name: "app" })

  const version = new Date().toISOString()

  assert(process.env.ROCOCO_WEBSOCKET_ADDRESS)
  assert(process.env.WESTEND_WEBSOCKET_ADDRESS)
  assert(process.env.POLKADOT_WEBSOCKET_ADDRESS)
  assert(process.env.KUSAMA_WEBSOCKET_ADDRESS)
  const nodesAddresses = {
    kusama: process.env.KUSAMA_WEBSOCKET_ADDRESS,
    rococo: process.env.ROCOCO_WEBSOCKET_ADDRESS,
    polkadot: process.env.POLKADOT_WEBSOCKET_ADDRESS,
    westend: process.env.WESTEND_WEBSOCKET_ADDRESS,
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

  assert(process.env.DATA_PATH)

  const repositoryCloneDirectoryPath = path.join(
    process.env.DATA_PATH,
    "repositories",
  )
  if (process.env.CLEAR_REPOSITORIES_ON_START === "true") {
    logger.info("Clearing the repositories before starting")
    removeDir(repositoryCloneDirectoryPath)
  }
  const repositoryCloneDirectory = ensureDir(repositoryCloneDirectoryPath)

  const dbPath = ensureDir(path.join(process.env.DATA_PATH, "db"))
  const lockPath = path.join(dbPath, "LOCK")
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath)
  }
  const db = getDb(dbPath)
  if (process.env.CLEAR_DB_ON_START === "true") {
    logger.info("Clearing the database before starting")
    for (const { id } of await getSortedTasks(db, {
      match: { version, isInverseMatch: true },
    })) {
      await db.del(id)
    }
  }

  const authInstallation = createAppAuth({
    appId,
    privateKey,
    clientId,
    clientSecret,
  })

  const getFetchEndpoint = async function (installationId: number) {
    const token = (
      await authInstallation({
        type: "installation",
        installationId,
      })
    ).token

    const url = `https://x-access-token:${token}@github.com`

    return { url, token }
  }

  const appState: AppState = {
    bot,
    db,
    appId,
    getFetchEndpoint,
    clientSecret,
    clientId,
    log: bot.log,
    botMentionPrefix,
    version,
    nodesAddresses,
    allowedOrganizations,
    logger,
    repositoryCloneDirectory,
    deployment,
  }

  await requeueUnterminated(appState)
  setupProbot(appState)

  logger.info("Probot has started!")
}

run(main)
