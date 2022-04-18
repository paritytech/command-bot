import assert from "assert"
import { differenceInMilliseconds } from "date-fns"
import fs from "fs"
import path from "path"
import { promisify } from "util"

import { CommandExecutor, CommandOutput } from "./types"

const fsExists = promisify(fs.exists)
const fsRmdir = promisify(fs.rmdir)
const fsMkdir = promisify(fs.mkdir)
const fsUnlink = promisify(fs.unlink)

export const envVar = (name: string) => {
  const val = process.env[name]
  if (typeof val !== "string") {
    throw new Error(`${name} was not found in the environment variables`)
  }
  return val
}

export const envNumberVar = (name: string) => {
  const val = process.env[name]
  assert(val, `${name} was not found in the environment variables`)
  const valNumber = parseInt(val)
  assert(valNumber, `${name} is not a number`)
  return valNumber
}

export const getLines = (str: string) => {
  return str
    .split("\n")
    .map((line) => {
      return line.trim()
    })
    .filter((line) => {
      return !!line
    })
}

export const displayCommand = ({
  execPath,
  args,
  secretsToHide,
}: {
  execPath: string
  args: string[]
  secretsToHide: string[]
}) => {
  return redact(`${execPath} ${args.join(" ")}`, secretsToHide, "{SECRET}")
}

export const millisecondsDelay = (milliseconds: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

export const ensureDir = async (dir: string) => {
  if (!(await fsExists(dir))) {
    await fsMkdir(dir, { recursive: true })
  }
  return dir
}

export const removeDir = async (dir: string) => {
  if (!(await fsExists(dir))) {
    await fsRmdir(dir, { recursive: true })
  }
  return dir
}

export const initDatabaseDir = async (dir: string) => {
  dir = await ensureDir(dir)
  const lockPath = path.join(dir, "LOCK")
  if (await fsExists(lockPath)) {
    await fsUnlink(lockPath)
  }
  return dir
}

export const intoError = (value: unknown) => {
  if (value instanceof Error) {
    return value
  }
  return new Error(String(value))
}

export const displayError = (value: unknown) => {
  const error = intoError(value)
  return `${error.toString()}${error.stack ? `\n${error.stack}` : ""}`
}

export const displayDuration = (start: Date, finish: Date) => {
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

export const escapeHtml = (str: string) => {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
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

export const cleanupProjects = async (
  executor: CommandExecutor,
  projectsRoot: string,
  {
    includeDirs,
    excludeDirs = [],
  }: { includeDirs?: string[]; excludeDirs?: string[] } = {},
) => {
  const results: CommandOutput[] = []

  toNextProject: for await (const p of walkDirs(projectsRoot)) {
    if (!(await fsExists(path.join(p, ".git")))) {
      continue
    }

    if (
      includeDirs !== undefined &&
      includeDirs.filter((includeDir) => {
        return isDirectoryOrSubdirectory(includeDir, p)
      }).length === 0
    ) {
      continue toNextProject
    }

    for (const excludeDir of excludeDirs) {
      if (isDirectoryOrSubdirectory(excludeDir, p)) {
        continue toNextProject
      }
    }

    const projectDir = path.dirname(p)

    /*
      The project's directory might have been deleted as a result of a previous
      cleanup step
    */
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
      results.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  return results
}

const isDirectoryOrSubdirectory = (parent: string, child: string) => {
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

const arePathsEqual = (a: string, b: string) => {
  return a === b || normalizePath(a) === normalizePath(b)
}

let lastIncrementalId = 0
export const getNextUniqueIncrementalId = () => {
  const nextIncrementalId = ++lastIncrementalId
  assert(
    Number.isSafeInteger(nextIncrementalId),
    "getNextUniqueIncrementalId overflowed the next ID",
  )
  return nextIncrementalId
}

const normalizePath = (v: string) => {
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

export const redact = (str: string, items: string[], replacement: string) => {
  for (const item of items) {
    str = str.replaceAll(item, replacement)
  }
  return str
}

export class Ok<T> {
  constructor(public value: T) {}
}
export class Err<T> {
  constructor(public value: T) {}
}

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
const normalizers = {
  symbol: (value: any) => {
    return value.toString()
  },
  bigint: (value: any) => {
    return value.toString()
  },
  undefined: () => {
    return undefined
  },
  function: () => {
    return undefined
  },
  boolean: (value: any) => {
    return value
  },
  number: (value: any) => {
    return value
  },
  string: (value: any) => {
    return value
  },
  object: (value: any, previousObjects: unknown[] = []) => {
    if (value === null) {
      return
    }

    previousObjects = previousObjects.concat([value])

    const isArray = Array.isArray(value)
    const isIterable = !isArray && Symbol.iterator in value
    const objAsArray = isArray
      ? value
      : isIterable
      ? Array.from(value as Iterable<unknown>)
      : undefined

    if (objAsArray === undefined && !(value instanceof Error)) {
      const asString =
        typeof value.toString === "function" && value.toString.length === 0
          ? value.toString()
          : undefined
      if (typeof asString === "string" && asString !== "[object Object]") {
        return asString
      }
    }

    const { container, output } = (() => {
      if (isIterable) {
        const iteratorContainer = { type: value.constructor.name, items: [] }
        return { container: iteratorContainer, output: iteratorContainer.items }
      }
      const outputObj = objAsArray === undefined ? {} : []
      return { container: outputObj, output: outputObj }
    })()

    const sourceObj = objAsArray ?? value
    for (const key of Object.getOwnPropertyNames(sourceObj)) {
      setNormalizedKeyValue(sourceObj, output, key, previousObjects)
    }

    if (Object.keys(output).length > 0) {
      return container
    }
  },
}

const setNormalizedKeyValue = (
  source: any,
  output: any,
  key: any,
  previousObjects: unknown[],
) => {
  if (previousObjects.indexOf(source[key]) !== -1) {
    return "[Circular]"
  }

  const value = normalizeValue(source[key], previousObjects)
  if (value === undefined) {
    return
  }

  output[key] = value
}

export const normalizeValue = (
  value: unknown,
  previousObjects: unknown[] = [],
): unknown => {
  return normalizers[typeof value](value, previousObjects)
}
