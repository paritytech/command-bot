import assert from "assert"
import { differenceInMilliseconds } from "date-fns"
import fs from "fs"
import ld from "lodash"
import { MatrixClient } from "matrix-bot-sdk"
import path from "path"

import { Logger } from "./logger"
import { ApiTask, CommandOutput, State } from "./types"

export const getLines = function (str: string) {
  return str
    .split("\n")
    .map(function (line) {
      return line.trim()
    })
    .filter(function (line) {
      return !!line
    })
}

export const getCommand = function (
  commandLine: string,
  { baseEnv }: { baseEnv: Record<string, string> },
) {
  const parts = commandLine.split(" ").filter(function (value) {
    return !!value
  })

  const [envArgs, command] = ld.partition(parts, function (value) {
    return value.match(/^[A-Za-z_]+=/)
  })

  const env: Record<string, string> = baseEnv
  for (const rawValue of envArgs) {
    const matches = rawValue.match(/^([A-Za-z_]+)=(.*)/)
    assert(matches)

    const [, name, value] = matches
    assert(name)
    assert(value !== undefined && value !== null)

    env[name] = value
  }

  const [execPath, ...args] = command

  return { execPath, args, env }
}

export const redactSecrets = function (str: string, secrets: string[] = []) {
  for (const secret of secrets) {
    if (!secret) {
      continue
    }
    str = str.replace(secret, "{SECRET}")
  }
  return str
}

export const displayCommand = function ({
  execPath,
  args,
  secretsToHide,
}: {
  execPath: string
  args: string[]
  secretsToHide: string[]
}) {
  return redactSecrets(`${execPath} ${args.join(" ")}`, secretsToHide)
}

export const millisecondsDelay = function (milliseconds: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, milliseconds)
  })
}

export const ensureDir = function (dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export const removeDir = function (dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmdirSync(dir, { recursive: true })
  }
  return dir
}

export const initDatabaseDir = function (dir: string) {
  dir = ensureDir(dir)
  const lockPath = path.join(dir, "LOCK")
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath)
  }
  return dir
}

export const getDeploymentLogsMessage = function (
  deployment: State["deployment"],
) {
  if (deployment === undefined) {
    return ""
  }

  return `The logs for this command should be available on Grafana for the data source \`loki.${deployment.environment}\` and query \`{container=~"${deployment.container}"}\``
}

export class Retry {
  constructor(public context: "compilation error", public motive: string) {}
}

export const displayError = function (e: Error) {
  return `${e.toString()}\n${e.stack}`
}

export const getSendMatrixResult = function (
  matrix: MatrixClient,
  logger: Logger,
  {
    matrixRoom,
    handleId,
    commandDisplay,
  }: Pick<ApiTask, "matrixRoom" | "handleId" | "commandDisplay">,
) {
  return async function (message: CommandOutput) {
    try {
      const fileName = `${handleId}-log.txt`
      const buf = message instanceof Error ? displayError(message) : message
      const messagePrefix = `Handle ID ${handleId} has finished.`

      if (buf.length < 2048) {
        await matrix.sendHtmlText(
          matrixRoom,
          `${messagePrefix} Results will be displayed inline for <code>${escapeHtml(
            commandDisplay,
          )}</code>\n<pre>${escapeHtml(buf)}</pre>`,
        )
        return
      }

      const url = await matrix.uploadContent(
        Buffer.from(message instanceof Error ? displayError(message) : message),
        "text/plain",
        fileName,
      )
      await matrix.sendText(
        matrixRoom,
        `${messagePrefix} Results were uploaded as ${fileName} for ${commandDisplay}.`,
      )
      await matrix.sendMessage(matrixRoom, {
        msgtype: "m.file",
        body: fileName,
        url,
      })
    } catch (error) {
      logger.fatal(error?.body?.error, "Error when sending matrix message")
    }
  }
}

export const displayDuration = function (start: Date, finish: Date) {
  const delta = Math.abs(differenceInMilliseconds(finish, start))

  const days = Math.floor(delta / 1000 / 60 / 60 / 24)
  const hours = Math.floor((delta / 1000 / 60 / 60) % 24)
  const minutes = Math.floor((delta / 1000 / 60) % 60)
  const seconds = Math.floor((delta / 1000) % 60)

  const milliseconds =
    delta -
    days * 24 * 60 * 60 * 1000 -
    hours * 60 * 60 * 1000 -
    minutes * 60 * 1000 -
    seconds * 1000

  let buf = ""
  const separator = ", "
  for (const [name, value] of Object.entries({
    days,
    hours,
    minutes,
    seconds,
    milliseconds,
  })) {
    if (!value) {
      continue
    }
    buf = `${buf}${separator}${value} ${name}`
  }

  return buf.slice(separator.length)
}

export const escapeHtml = function (str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

const websocketPrefixes = ["wss://", "ws://"]
const urlArg = "--url="
const addressPrefixes = websocketPrefixes.concat(
  websocketPrefixes.map(function (prefix) {
    return `${urlArg}${prefix}`
  }),
)
export const getParsedArgs = function (
  nodesAddresses: State["nodesAddresses"],
  args: string[],
) {
  const nodeOptionsDisplay = `Available names are: ${Object.keys(
    nodesAddresses,
  ).join(", ")}.`

  const parsedArgs = []
  toNextArg: for (const arg of args) {
    for (const prefix of addressPrefixes) {
      if (!arg.startsWith(prefix)) {
        continue
      }

      const node = arg.slice(prefix.length)
      if (!node) {
        return `Must specify one address in the form \`${prefix}name\`. ${nodeOptionsDisplay}`
      }

      const nodeAddress = nodesAddresses[node]
      if (!nodeAddress) {
        return `Nodes are referred to by name. No node named "${node}" is available. ${nodeOptionsDisplay}`
      }

      parsedArgs.push(
        arg.startsWith(urlArg) ? `${urlArg}${nodeAddress}` : nodeAddress,
      )
      continue toNextArg
    }

    parsedArgs.push(arg)
  }

  return parsedArgs
}
