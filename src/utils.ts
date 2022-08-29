import assert from "assert"
import Joi from "joi"
import fetch from "node-fetch"

export const envVar = (name: string): string => {
  const val = process.env[name]
  if (typeof val !== "string") {
    throw new Error(`${name} was not found in the environment variables`)
  }
  return val
}

export const envNumberVar = (name: string): number => {
  const val = process.env[name]
  assert(val, `${name} was not found in the environment variables`)
  const valNumber = parseInt(val)
  assert(valNumber, `${name} is not a number`)
  return valNumber
}

export const getLines = (str: string): string[] =>
  str
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !!line)

export const displayCommand = ({
  execPath,
  args,
  itemsToRedact,
}: {
  execPath: string
  args: string[]
  itemsToRedact: string[]
}): string => redact(`${execPath} ${args.join(" ")}`, itemsToRedact)

export const millisecondsDelay = (milliseconds: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })

export const intoError = (value: unknown): Error => {
  if (value instanceof Error) {
    return value
  }
  return new Error(String(value))
}

export const displayError = (value: unknown): string => {
  const error = intoError(value)

  let errorMessage = `${error.toString()}${error.stack ? `\n${error.stack}` : ""}`
  if (error instanceof Joi.ValidationError) {
    errorMessage = `${errorMessage}\n${JSON.stringify(normalizeValue(error._original))}`
  }

  return errorMessage
}

let lastIncrementalId = 0
export const getNextUniqueIncrementalId = (): number => {
  const nextIncrementalId = ++lastIncrementalId
  assert(Number.isSafeInteger(nextIncrementalId), "getNextUniqueIncrementalId overflowed the next ID")
  return nextIncrementalId
}

export const redact = (str: string, items: string[], replacement: string = "{SECRET}"): string => {
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

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
const normalizers = {
  symbol: (value: any) => value.toString(),
  bigint: (value: any) => value.toString(),
  undefined: () => undefined,
  function: () => undefined,
  boolean: (value: any) => value,
  number: (value: any) => value,
  string: (value: any) => value,
  object: (value: any, previousObjects: unknown[] = [], showTopLevel = false) => {
    if (value === null) {
      return
    }

    previousObjects = previousObjects.concat([value])

    const isArray = Array.isArray(value)
    const isIterable = !isArray && Symbol.iterator in value
    const objAsArray = isArray ? value : isIterable ? Array.from(value as Iterable<unknown>) : undefined

    if (objAsArray === undefined && !(value instanceof Error)) {
      const asString =
        typeof value.toString === "function" && value.toString.length === 0 ? value.toString() : undefined
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
    } else if (showTopLevel) {
      return objAsArray ? [] : {}
    }
  },
}

const setNormalizedKeyValue = (source: any, output: any, key: any, previousObjects: unknown[]) => {
  if (previousObjects.indexOf(source[key]) !== -1) {
    return "[Circular]"
  }

  const value = normalizeValue(source[key], previousObjects)
  if (value === undefined) {
    return
  }

  output[key] = value
}

export const normalizeValue = (value: unknown, previousObjects: unknown[] = [], showTopLevel = false): unknown =>
  normalizers[typeof value](value, previousObjects, showTopLevel)
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */

export const validatedFetch = async <T>(
  response: ReturnType<typeof fetch>,
  schema: Joi.AnySchema,
  { decoding }: { decoding: "json" } = { decoding: "json" },
): Promise<T> => {
  const body = await (async () => {
    switch (decoding) {
      case "json": {
        return await (await response).json()
      }
      default: {
        const exhaustivenessCheck: never = decoding
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`Not exhaustive: ${exhaustivenessCheck}`)
      }
    }
  })()
  const validation = schema.validate(body)
  if (validation.error) {
    throw validation.error
  }
  return validation.value as T
}

export const arrayify = <T>(value: undefined | null | T | T[]): T[] => {
  if (value === undefined || value === null) {
    return []
  }
  if (Array.isArray(value)) {
    return value
  }
  return [value]
}
