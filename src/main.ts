import assert from "assert"
import { randomUUID } from "crypto"
import http from "http"
import { Logger as ProbotLogger, Probot, Server } from "probot"
import { getLog } from "probot/lib/helpers/get-log"
import stoppable from "stoppable"

import { Logger } from "./logger"
import { setup } from "./setup"
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

  const shouldPostPullRequestComment = (() => {
    const value = process.env.POST_COMMENT
    switch (value) {
      case "false":
      case undefined: {
        return false
      }
      case "true": {
        return true
      }
      default: {
        throw new Error(`Invalid $POST_COMMENT: ${value}`)
      }
    }
  })()

  const deployment = (() => {
    const value = process.env.IS_DEPLOYMENT
    switch (value) {
      case "true": {
        assert(process.env.DEPLOYMENT_ENVIRONMENT)
        assert(process.env.DEPLOYMENT_CONTAINER)
        return {
          environment: process.env.DEPLOYMENT_ENVIRONMENT,
          container: process.env.DEPLOYMENT_CONTAINER,
        }
      }
      case "false": {
        return
      }
      default: {
        throw new Error(
          `Invalid value for $IS_DEPLOYMENT: ${value ?? "undefined"}`,
        )
      }
    }
  })()

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

  const encodedPrivateKey = envVar("PRIVATE_KEY_BASE64")
  const privateKey = Buffer.from(encodedPrivateKey, "base64").toString()

  const clientId = envVar("CLIENT_ID")
  const clientSecret = envVar("CLIENT_SECRET")
  const webhookSecret = envVar("WEBHOOK_SECRET")

  let probotLogger: ProbotLogger | undefined = undefined
  switch (logFormat) {
    case "json": {
      probotLogger = getLog({
        level: "info",
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

  await server.load((probot) => {
    void setup(probot, server, {
      appId,
      clientId,
      clientSecret,
      privateKey,
      deployment,
      logger,
      startDate,
      serverInfo: { id: randomUUID() },
      shouldPostPullRequestComment,
    })
  })

  void server.start()
  logger.info("Probot has started!")
}

void main()
