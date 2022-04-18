import assert from "assert"
import { differenceInMilliseconds } from "date-fns"

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

let lastIncrementalId = 0
export const getNextUniqueIncrementalId = () => {
  const nextIncrementalId = ++lastIncrementalId
  assert(
    Number.isSafeInteger(nextIncrementalId),
    "getNextUniqueIncrementalId overflowed the next ID",
  )
  return nextIncrementalId
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
