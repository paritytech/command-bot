import { ChildProcess, spawn } from "child_process"
import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"
import { promisify } from "util"

import { Logger } from "./logger"
import { Context, ToString } from "./types"
import { displayCommand, redact } from "./utils"

export const fsExists = promisify(fs.exists)
export const fsReadFile = promisify(fs.readFile)
export const fsWriteFile = promisify(fs.writeFile)
const fsMkdir = promisify(fs.mkdir)
const fsUnlink = promisify(fs.unlink)

export const ensureDir = async (dir: string) => {
  if (!(await fsExists(dir))) {
    await fsMkdir(dir, { recursive: true })
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

export class CommandRunner {
  private logger: Logger

  constructor(
    ctx: Context,
    private configuration: {
      itemsToRedact: string[]
      shouldTrackProgress: boolean
      cwd?: string
      onChild?: (child: ChildProcess) => void
    },
  ) {
    this.logger = ctx.logger.child({ commandId: randomUUID() })
  }

  async run(
    execPath: string,
    args: string[],
    {
      allowedErrorCodes,
      testAllowedErrorMessage,
      shouldCaptureAllStreams,
    }: {
      allowedErrorCodes?: number[]
      testAllowedErrorMessage?: (stderr: string) => boolean
      shouldCaptureAllStreams?: boolean
    } = {},
  ) {
    const { logger } = this
    return new Promise<string | Error>((resolve, reject) => {
      const { cwd, itemsToRedact, onChild, shouldTrackProgress } =
        this.configuration

      const commandDisplayed = displayCommand({ execPath, args, itemsToRedact })
      logger.info(`Executing command ${commandDisplayed}`)

      const child = spawn(execPath, args, { cwd, stdio: "pipe" })
      if (onChild) {
        onChild(child)
      }

      const commandOutputBuffer: ["stdout" | "stderr", string][] = []
      const getStreamHandler = (channel: "stdout" | "stderr") => {
        return (data: ToString) => {
          const str =
            itemsToRedact === undefined
              ? data.toString()
              : redact(data.toString(), itemsToRedact)
          const strTrim = str.trim()

          if (shouldTrackProgress && strTrim) {
            logger.info(strTrim, channel)
          }

          commandOutputBuffer.push([channel, str])
        }
      }
      child.stdout.on("data", getStreamHandler("stdout"))
      child.stderr.on("data", getStreamHandler("stderr"))

      child.on("close", (exitCode, signal) => {
        logger.info(
          `Process finished with exit code ${exitCode ?? "??"}${
            signal ? `and signal ${signal}` : ""
          }`,
        )

        if (signal) {
          return resolve(
            new Error(`Process got terminated by signal ${signal}`),
          )
        }

        if (exitCode) {
          const rawStderr = commandOutputBuffer
            .reduce((acc, [stream, value]) => {
              if (stream === "stderr") {
                return `${acc}${value}`
              } else {
                return acc
              }
            }, "")
            .trim()
          const stderr =
            itemsToRedact === undefined
              ? rawStderr
              : redact(rawStderr, itemsToRedact)
          if (
            !allowedErrorCodes?.includes(exitCode) &&
            (testAllowedErrorMessage === undefined ||
              !testAllowedErrorMessage(stderr))
          ) {
            return reject(new Error(stderr))
          }
        }

        const outputBuf = shouldCaptureAllStreams
          ? commandOutputBuffer.reduce((acc, [_, value]) => {
              return `${acc}${value}`
            }, "")
          : commandOutputBuffer.reduce((acc, [stream, value]) => {
              if (stream === "stdout") {
                return `${acc}${value}`
              } else {
                return acc
              }
            }, "")
        const rawOutput = outputBuf.trim()
        const output =
          itemsToRedact === undefined
            ? rawOutput
            : redact(rawOutput, itemsToRedact)

        resolve(output)
      })
    })
  }
}
