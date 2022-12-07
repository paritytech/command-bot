import { ChildProcess, spawn } from "child_process"
import { randomUUID } from "crypto"
import { mkdir, rm } from "fs/promises"
import { Logger } from "opstooling-js"
import path from "path"
import { Readable as ReadableStream } from "stream"

import { logger } from "./logger"
import { ToString } from "./types"
import { obfuscate } from "./utils"

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
  private commandOutputBuffer: ["stdout" | "stderr", string][] = []

  constructor(
    private configuration?: {
      itemsToObfuscate?: string[]
      shouldTrackProgress?: boolean
      cwd?: string
      onChild?: (child: ChildProcess) => void
    },
  ) {
    this.logger = logger.child({ commandId: randomUUID() })
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
    const { logger: log, commandOutputBuffer } = this
    return await new Promise<string | Error>((resolve, reject) => {
      const { cwd, itemsToObfuscate, onChild } = this.configuration || {}

      const rawCommand = `${execPath} ${args.join(" ")}`
      const commandDisplayed = itemsToObfuscate?.length ? obfuscate(rawCommand, itemsToObfuscate) : rawCommand
      log.info(`Executing command ${commandDisplayed}`)

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

      // clear
      commandOutputBuffer.splice(0, commandOutputBuffer.length)

      child.stdout.on("data", this.getStreamHandler("stdout"))
      child.stderr.on("data", this.getStreamHandler("stderr"))

      child.on("close", (exitCode, signal) => {
        log.info(
          `Command "${commandDisplayed}" finished with exit code ${exitCode ?? "??"}${
            signal ? `and signal ${signal}` : ""
          }`,
        )

        if (signal) {
          return resolve(new Error(`Process got terminated by signal ${signal}`))
        }

        if (exitCode) {
          const rawStderr = commandOutputBuffer
            .reduce((acc, [stream, value]) => (stream === "stderr" ? `${acc}${value}` : acc), "")
            .trim()
          const stderr = itemsToObfuscate?.length ? obfuscate(rawStderr, itemsToObfuscate) : rawStderr
          if (
            !allowedErrorCodes?.includes(exitCode) &&
            (testAllowedErrorMessage === undefined || !testAllowedErrorMessage(stderr))
          ) {
            return reject(new Error(stderr))
          }
        }

        const outputBuf = shouldCaptureAllStreams
          ? commandOutputBuffer.reduce((acc, [_, value]) => `${acc}${value}`, "")
          : commandOutputBuffer.reduce((acc, [stream, value]) => (stream === "stdout" ? `${acc}${value}` : acc), "")
        const rawOutput = outputBuf.trim()
        const output = itemsToObfuscate?.length ? obfuscate(rawOutput, itemsToObfuscate) : rawOutput

        resolve(output)
      })
    })
  }

  private getStreamHandler(channel: "stdout" | "stderr") {
    const { itemsToObfuscate, shouldTrackProgress } = this.configuration || {}
    return (data: ToString) => {
      const str = itemsToObfuscate?.length ? obfuscate(data.toString(), itemsToObfuscate) : data.toString()
      const strTrim = str.trim()

      if (shouldTrackProgress && strTrim) {
        this.logger.info(strTrim, channel)
      }

      this.commandOutputBuffer.push([channel, str])
    }
  }
}

export const validateSingleShellCommand = async (command: string): Promise<string | Error> => {
  const cmdRunner = new CommandRunner()
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
  return command.trim()
}
