import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/rest"
import assert from "assert"
import fs from "fs"
import http from "http"
import path from "path"
import { Probot, run } from "probot"
import stoppable from "stoppable"

import { botMentionPrefix } from "src/constants"
import { getDb, getSortedTasks } from "src/db"

import { queue } from "./executor"
import { updateComment } from "./github"
import { Logger } from "./logger"
import { State } from "./types"
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

let deployment: State["deployment"] = undefined
if (process.env.IS_DEPLOYMENT === "true") {
  assert(process.env.DEPLOYMENT_ENVIRONMENT)
  assert(process.env.DEPLOYMENT_CONTAINER)
  deployment = {
    environment: process.env.DEPLOYMENT_ENVIRONMENT,
    container: process.env.DEPLOYMENT_CONTAINER,
  }
}

const setupProbot = async function (state: State) {
  const { bot, logger } = state

  const { onIssueCommentCreated } = getWebhooksHandlers(state)
  setupEvent(bot, "issue_comment.created", onIssueCommentCreated, logger)
}

const requeueUnterminated = async function (state: State) {
  const { db, version, logger, bot } = state

  // Items which are not from this version still remaining in the database are
  // deemed unterminated.
  const unterminatedItems = await getSortedTasks(db, {
    match: { version, isInverseMatch: true },
  })

  for (const {
    taskData: { timesRequeued, ...taskData },
    id,
  } of unterminatedItems) {
    await db.del(id)

    const octokit = await (
      bot.auth as (installationId?: number) => Promise<Octokit>
    )(taskData.installationId)
    const announceCancel = function (message: string) {
      const { owner, repo, pull_number, commentId, requester } = taskData
      return updateComment(octokit, {
        owner,
        repo,
        pull_number,
        comment_id: commentId,
        body: `@${requester} ${message}`,
      })
    }

    if (
      timesRequeued &&
      // Check if the task was requeued and got to execute, but it failed for
      // some reason, in which case it will not be retried further; in
      // comparison, it might have been requeued and not had a chance to execute
      // due to other crash-inducing command being in front of it, thus it's not
      // reasonable to avoid rescheduling this command if it's not his fault
      timesRequeued === taskData.timesRequeuedSnapshotBeforeExecution
    ) {
      await announceCancel(
        `command was rescheduled and failed to finish (check for taskId ${id} in the logs); execution will not automatically be restarted further.`,
      )
    } else {
      try {
        logger.info(`Requeuing ${JSON.stringify(taskData)}`)
        const nextTaskData = { ...taskData, timesRequeued: timesRequeued + 1 }
        const handleId = getPullRequestHandleId(taskData)
        await queue({
          handleId,
          taskData: nextTaskData,
          onResult: getPostPullRequestResult({
            taskData: nextTaskData,
            octokit,
            handleId,
            state,
          }),
          state,
        })
      } catch (error) {
        let errorMessage = error.toString()
        if (errorMessage.endsWith(".") === false) {
          errorMessage = `${errorMessage}.`
        }
        await announceCancel(
          `caught exception while trying to reschedule the command; it will not be rescheduled further. Error message: ${errorMessage}.`,
        )
      }
    }
  }
}

const main = async function (bot: Probot) {
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

  const version = new Date().toISOString()
  const logger = new Logger({ name: "app" })

  assert(process.env.WESTEND_WEBSOCKET_ADDRESS)
  assert(process.env.POLKADOT_WEBSOCKET_ADDRESS)
  assert(process.env.KUSAMA_WEBSOCKET_ADDRESS)
  const nodesAddresses = {
    kusama: process.env.KUSAMA_WEBSOCKET_ADDRESS,
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

  // For the deployment this should always happen because TMPDIR targets a
  // location on the persistent volume (ephemeral storage on Kubernetes cluster
  // is too low for building Substrate)
  if (process.env.CLEAR_TMPDIR_ON_START === "true") {
    assert(process.env.TMPDIR)
    removeDir(process.env.TMPDIR)
    ensureDir(process.env.TMPDIR)
  }

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
      await authInstallation({ type: "installation", installationId })
    ).token

    const url = `https://x-access-token:${token}@github.com`

    return { url, token }
  }

  const state: State = {
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

  await requeueUnterminated(state)

  setupProbot(state)
  logger.info("Probot has started!")
}

run(main)
