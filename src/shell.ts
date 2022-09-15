import { ChildProcess, spawn } from "child_process"
import { randomUUID } from "crypto"
import { mkdir, rm } from "fs/promises"
import path from "path"
import { Readable as ReadableStream } from "stream"

import { Logger } from "./logger"
import { Context, ToString } from "./types"
import { displayCommand, redact } from "./utils"

export const ensureDir = async (dir: string): Promise<void> => {
  // mkdir doesn't throw an error if the directory already exists
  await mkdir(dir, { recursive: true })
}

export const initDatabaseDir = async (dir: string): Promise<void> => {
  await ensureDir(dir)
  await rm(path.join(dir, "LOCK"), {
    // ignore error if the file does not exist
    force: true,
  })
}

export class CommandRunner {
  private logger: Logger

  constructor(
    ctx: Context,
    private configuration: {
      itemsToRedact: string[]
      shouldTrackProgress?: boolean
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
      stdinInput,
    }: {
      allowedErrorCodes?: number[]
      testAllowedErrorMessage?: (stderr: string) => boolean
      shouldCaptureAllStreams?: boolean
      stdinInput?: string
    } = {},
  ): Promise<string | Error> {
    const { logger } = this
    return await new Promise<string | Error>((resolve, reject) => {
      const { cwd, itemsToRedact, onChild, shouldTrackProgress } = this.configuration

      const commandDisplayed = displayCommand({ execPath, args, itemsToRedact })
      logger.info(`Executing command ${commandDisplayed}`)

      const child = spawn(execPath, args, { cwd, stdio: "pipe" })
      if (onChild) {
        onChild(child)
      }

      if (stdinInput) {
        const stdinStream = new ReadableStream()
        stdinStream.push(stdinInput)
        stdinStream.push(null)
        stdinStream.pipe(child.stdin)
      }

      const commandOutputBuffer: ["stdout" | "stderr", string][] = []
      const getStreamHandler = (channel: "stdout" | "stderr") => (data: ToString) => {
        const str = itemsToRedact === undefined ? data.toString() : redact(data.toString(), itemsToRedact)
        const strTrim = str.trim()

        if (shouldTrackProgress && strTrim) {
          logger.info(strTrim, channel)
        }

        commandOutputBuffer.push([channel, str])
      }
      child.stdout.on("data", getStreamHandler("stdout"))
      child.stderr.on("data", getStreamHandler("stderr"))

      child.on("close", (exitCode, signal) => {
        logger.info(
          `Command "${commandDisplayed}" finished with exit code ${exitCode ?? "??"}${
            signal ? `and signal ${signal}` : ""
          }`,
        )

        if (signal) {
          return resolve(new Error(`Process got terminated by signal ${signal}`))
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
          const stderr = itemsToRedact === undefined ? rawStderr : redact(rawStderr, itemsToRedact)
          if (
            !allowedErrorCodes?.includes(exitCode) &&
            (testAllowedErrorMessage === undefined || !testAllowedErrorMessage(stderr))
          ) {
            return reject(new Error(stderr))
          }
        }

        const outputBuf = shouldCaptureAllStreams
          ? commandOutputBuffer.reduce((acc, [_, value]) => `${acc}${value}`, "")
          : commandOutputBuffer.reduce((acc, [stream, value]) => {
              if (stream === "stdout") {
                return `${acc}${value}`
              } else {
                return acc
              }
            }, "")
        const rawOutput = outputBuf.trim()
        const output = itemsToRedact === undefined ? rawOutput : redact(rawOutput, itemsToRedact)

        resolve(output)
      })
    })
  }
}

export const validateSingleShellCommand = async (ctx: Context, command: string): Promise<string | Error> => {
  const { logger } = ctx
  const cmdRunner = new CommandRunner(ctx, { itemsToRedact: [] })
  const commandAstText = await cmdRunner.run("shfmt", ["--tojson"], { stdinInput: command })
  if (commandAstText instanceof Error) {
    return new Error(`Command AST could not be parsed for "${command}"`)
  }
  const commandAst = JSON.parse(commandAstText) as {
    Stmts: { Cmd: { Type?: string } }[]
  }
  logger.info(commandAst.Stmts[0].Cmd, `Parsed AST for "${command}"`)
  if (commandAst.Stmts.length !== 1 || commandAst.Stmts[0].Cmd.Type !== "CallExpr") {
    return new Error(`Command "${command}" failed validation: the resulting command line should have a single command`)
  }
  return command
}
