import assert from "assert"
import Joi from "joi"
import fetch from "node-fetch"
import { normalizeValue } from "opstooling-js"

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
  const valNumber = parseInt(val, 10)
  assert(valNumber, `${name} is not a number`)
  return valNumber
}

export const getLines = (str: string): string[] =>
  str
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !!line)

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

export const validatedFetch = async <T>(
  response: ReturnType<typeof fetch>,
  schema: Joi.AnySchema,
  { decoding }: { decoding: "json" } = { decoding: "json" },
): Promise<T> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
