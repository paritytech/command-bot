import assert from "assert"
import { differenceInMilliseconds } from "date-fns"
import fs from "fs"
import ld from "lodash"
import { MatrixClient } from "matrix-bot-sdk"
import path from "path"
import { promisify } from "util"

import { ShellExecutor } from "./executor"
import { Logger } from "./logger"
import { ApiTask, CommandOutput, State } from "./types"

const fsExists = promisify(fs.exists)

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

  const env: Record<string, string> = { ...baseEnv }
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
  return new Promise<void>(function (resolve) {
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
  context: string
  motive: string
  stderr: string

  constructor(options: {
    context: "compilation error"
    motive: string
    stderr: string
  }) {
    this.context = options.context
    this.motive = options.motive
    this.stderr = options.stderr
  }
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

      const lineCount = (buf.match(/\n/g) || "").length + 1
      if (lineCount < 128) {
        await matrix.sendHtmlText(
          matrixRoom,
          `${messagePrefix} Results will be displayed inline for <code>${escapeHtml(
            commandDisplay,
          )}</code>\n<hr>${escapeHtml(buf)}`,
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
      logger.fatal(
        error?.body?.error,
        "Caught error when sending matrix message",
      )
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

const escapeHtml = function (str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

// This expression catches the following forms: --foo, -foo, -foo=, --foo=
const optionPrefixExpression = /^-[^=\s]+[=\s]*/

// This expression catches the following forms: ws://foo, wss://foo, etc.
const uriPrefixExpression = /^ws\w*:\/\//

export const getParsedArgs = function (
  nodesAddresses: State["nodesAddresses"],
  args: string[],
) {
  const nodeOptionsDisplay = `Available names are: ${Object.keys(
    nodesAddresses,
  ).join(", ")}.`

  const parsedArgs = []
  for (const rawArg of args) {
    const optionPrefix = optionPrefixExpression.exec(rawArg)
    const { argPrefix, arg } =
      optionPrefix === null
        ? { argPrefix: "", arg: rawArg }
        : {
            argPrefix: optionPrefix[0],
            arg: rawArg.slice(optionPrefix[0].length),
          }

    const uriPrefixMatch = uriPrefixExpression.exec(arg)
    if (uriPrefixMatch === null) {
      parsedArgs.push(rawArg)
      continue
    }
    const [uriPrefix] = uriPrefixMatch

    const invalidNodeAddressExplanation = `Argument "${arg}" started with ${uriPrefix} and therefore it was interpreted as a node address, but it is invalid`

    const node = arg.slice(uriPrefix.length)
    if (!node) {
      return `${invalidNodeAddressExplanation}. Must specify one address in the form \`${uriPrefix}name\`. ${nodeOptionsDisplay}`
    }

    const nodeAddress = nodesAddresses[node]
    if (!nodeAddress) {
      return `${invalidNodeAddressExplanation}. Nodes are referred to by name. No node named "${node}" is available. ${nodeOptionsDisplay}`
    }

    parsedArgs.push(`${argPrefix}${nodeAddress}`)
  }

  return parsedArgs
}

const walkDirs: (dir: string) => AsyncGenerator<string> = async function* (
  dir,
) {
  for await (const d of await fs.promises.opendir(dir)) {
    if (!d.isDirectory()) {
      continue
    }

    const fullPath = path.join(dir, d.name)
    yield fullPath

    yield* walkDirs(fullPath)
  }
}

export const cleanupProjects = async function (
  executor: ShellExecutor,
  projectsRoot: string,
  {
    includeDirs,
    excludeDirs = [],
  }: { includeDirs?: string[]; excludeDirs?: string[] } = {},
) {
  const results: CommandOutput[] = []

  toNextProject: for await (const p of walkDirs(projectsRoot)) {
    if (!(await fsExists(path.join(p, ".git")))) {
      continue
    }

    if (includeDirs !== undefined) {
      if (
        includeDirs.filter(function (includeDir) {
          return isDirectoryOrSubdirectory(includeDir, p)
        }).length === 0
      ) {
        continue toNextProject
      }
    }

    for (const excludeDir of excludeDirs) {
      if (isDirectoryOrSubdirectory(excludeDir, p)) {
        continue toNextProject
      }
    }

    const projectDir = path.dirname(p)

    // The project's directory might have been deleted as a result of a previous
    // cleanup step
    if (!(await fsExists(projectDir))) {
      continue
    }

    try {
      results.push(
        await executor(
          "sh",
          ["-c", "git add . && git reset --hard && git clean -xdf"],
          { options: { cwd: projectDir } },
        ),
      )
    } catch (error) {
      results.push(error)
    }
  }

  return results
}

const isDirectoryOrSubdirectory = function (parent: string, child: string) {
  if (arePathsEqual(parent, child)) {
    return true
  }

  const relativePath = path.relative(parent, child)
  if (
    relativePath &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  ) {
    return true
  }

  return false
}

const arePathsEqual = function (a: string, b: string) {
  return a === b || normalizePath(a) === normalizePath(b)
}

const normalizePath = function normalizePath(v: string) {
  for (const [pattern, replacement] of [
    [/\\/g, "/"],
    [/(\w):/, "/$1"],
    [/(\w+)\/\.\.\/?/g, ""],
    [/^\.\//, ""],
    [/\/\.\//, "/"],
    [/\/\.$/, ""],
    [/\/$/, ""],
  ] as const) {
    while (pattern.test(v)) {
      v = v.replace(pattern, replacement)
    }
  }

  return v
}
