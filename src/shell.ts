import cp from "child_process"
import fs from "fs"
import path from "path"
import { promisify } from "util"

import { CommandExecutor, CommandOutput, Context, ToString } from "./types"
import { displayCommand, intoError, redact } from "./utils"

export const fsExists = promisify(fs.exists)
export const fsReadFile = promisify(fs.readFile)
export const fsWriteFile = promisify(fs.writeFile)
const fsRmdir = promisify(fs.rmdir)
const fsMkdir = promisify(fs.mkdir)
const fsUnlink = promisify(fs.unlink)
const cpExec = promisify(cp.exec)

enum RetryContext {
  CompilationError = "compilation error",
}
class Retry {
  context: RetryContext
  motive: string
  stderr: string

  constructor(options: {
    context: RetryContext
    motive: string
    stderr: string
  }) {
    this.context = options.context
    this.motive = options.motive
    this.stderr = options.stderr
  }
}

const cleanupMotiveForCargoTargetDir = "Freeing disk space for CARGO_TARGET_DIR"

export const getShellCommandExecutor = (
  ctx: Context,
  {
    projectsRoot,
    onChild,
  }: {
    projectsRoot: string
    onChild?: (child: cp.ChildProcess) => void
  },
): CommandExecutor => {
  const { logger, cargoTargetDir, deployment } = ctx

  return (
    execPath,
    args,
    {
      allowedErrorCodes,
      options,
      testAllowedErrorMessage,
      secretsToHide,
      shouldTrackProgress,
      shouldCaptureAllStreams,
    } = {},
  ) => {
    return new Promise((resolveExecution) => {
      const execute = async (retries: Retry[]) => {
        try {
          const cwd = options?.cwd ?? process.cwd()
          const commandDisplayed = displayCommand({
            execPath,
            args,
            secretsToHide: secretsToHide ?? [],
          })

          const previousRetries = retries.slice(0, -1)
          const retry: Retry | undefined = retries.slice(-1)[0]
          if (retry === undefined) {
            logger.info(`Executing ${commandDisplayed}`)
          } else {
            logger.info(
              { previousRetries, retry },
              `Retrying ${commandDisplayed}`,
            )
          }

          const child = cp.spawn(execPath, args, options)
          if (onChild) {
            onChild(child)
          }
          child.on("error", (error) => {
            resolveExecution(error)
          })

          const commandOutputBuffer: ["stdout" | "stderr", string][] = []
          const getStreamHandler = (channel: "stdout" | "stderr") => {
            return (data: ToString) => {
              const str =
                secretsToHide === undefined
                  ? data.toString()
                  : redact(data.toString(), secretsToHide, "{SECRET}")
              const strTrim = str.trim()

              if (shouldTrackProgress && strTrim) {
                logger.info(strTrim, channel)
              }

              commandOutputBuffer.push([channel, str])
            }
          }
          child.stdout.on("data", getStreamHandler("stdout"))
          child.stderr.on("data", getStreamHandler("stderr"))

          const result = await new Promise<Retry | Error | string>(
            (resolve) => {
              // eslint-disable-next-line @typescript-eslint/no-misused-promises
              child.on("close", async (exitCode, signal) => {
                try {
                  logger.info(
                    `Process finished with exit code ${exitCode ?? "??"}${
                      signal ? `and signal ${signal}` : ""
                    }`,
                  )
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
                      secretsToHide === undefined
                        ? rawStderr
                        : redact(rawStderr, secretsToHide, "{SECRET}")

                    /*
                      https://github.com/rust-lang/rust/issues/51309
                      Could happen due to lacking system constraints (we saw it
                      happen due to out-of-memory)
                   */
                    if (stderr.includes("SIGKILL")) {
                      logger.fatal(
                        "Compilation was terminated due to SIGKILL (might have something to do with system resource constraints)",
                      )
                    } else if (stderr.includes("No space left on device")) {
                      if (
                        deployment !== undefined &&
                        cargoTargetDir &&
                        retries.find(({ motive }) => {
                          return motive === cleanupMotiveForCargoTargetDir
                        }) === undefined
                      ) {
                        await removeDir(cargoTargetDir)
                        await ensureDir(cargoTargetDir)
                        return resolve(
                          new Retry({
                            context: RetryContext.CompilationError,
                            motive: cleanupMotiveForCargoTargetDir,
                            stderr,
                          }),
                        )
                      }

                      if (cwd.startsWith(projectsRoot)) {
                        const cleanupMotiveForOtherDirectories = `Freeing disk space while excluding "${cwd}" from "${projectsRoot}" root`
                        const cleanupMotiveForThisDirectory = `Freeing disk space while including only "${cwd}" from "${projectsRoot}" root`

                        const hasAttemptedCleanupForOtherDirectories =
                          retries.find(({ motive }) => {
                            return motive === cleanupMotiveForOtherDirectories
                          }) === undefined
                        const hasAttemptedCleanupForThisDirectory =
                          retries.find(({ motive }) => {
                            return motive === cleanupMotiveForThisDirectory
                          }) === undefined

                        if (
                          hasAttemptedCleanupForOtherDirectories &&
                          hasAttemptedCleanupForThisDirectory
                        ) {
                          logger.fatal(
                            { previousRetries, retry },
                            "Already tried and failed to recover from lack of disk space",
                          )
                        } else {
                          logger.info(
                            `Running disk cleanup before retrying the command "${commandDisplayed}" in "${cwd}" due to lack of space in the device.`,
                          )

                          const executor = getShellCommandExecutor(ctx, {
                            projectsRoot,
                          })

                          if (!hasAttemptedCleanupForOtherDirectories) {
                            const otherDirectoriesResults =
                              await cleanupProjects(executor, projectsRoot, {
                                excludeDirs: [cwd],
                              })
                            /*
                              Relevant check because the current project might be
                              the only one we have available in this application.
                            */
                            if (otherDirectoriesResults.length) {
                              return resolve(
                                new Retry({
                                  context: RetryContext.CompilationError,
                                  motive: cleanupMotiveForOtherDirectories,
                                  stderr,
                                }),
                              )
                            }
                          }

                          const directoryResults = await cleanupProjects(
                            executor,
                            projectsRoot,
                            { includeDirs: [cwd] },
                          )
                          if (directoryResults.length) {
                            return resolve(
                              new Retry({
                                context: RetryContext.CompilationError,
                                motive: cleanupMotiveForThisDirectory,
                                stderr,
                              }),
                            )
                          } else {
                            logger.fatal(
                              `Expected to have found a project for "${cwd}" during cleanup for disk space`,
                            )
                          }
                        }
                      } else {
                        logger.fatal(
                          `Unable to recover from lack of disk space because the directory "${cwd}" is not included in the projects root "${projectsRoot}"`,
                        )
                      }
                    } else {
                      const retryForCompilerIssue = stderr.match(
                        /This is a known issue with the compiler. Run `([^`]+)`/,
                      )
                      if (retryForCompilerIssue !== null) {
                        const retryCargoCleanCmd =
                          retryForCompilerIssue[1].replace(/_/g, "-")
                        logger.info(
                          `Running ${retryCargoCleanCmd} in "${cwd}" before retrying the command due to a compiler error.`,
                        )
                        await cpExec(retryCargoCleanCmd, { cwd })
                        return resolve(
                          new Retry({
                            context: RetryContext.CompilationError,
                            motive: retryCargoCleanCmd,
                            stderr,
                          }),
                        )
                      }
                    }

                    if (
                      (allowedErrorCodes === undefined ||
                        !allowedErrorCodes.includes(exitCode)) &&
                      (testAllowedErrorMessage === undefined ||
                        !testAllowedErrorMessage(stderr))
                    ) {
                      return resolve(new Error(stderr))
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
                    secretsToHide === undefined
                      ? rawOutput
                      : redact(rawOutput, secretsToHide, "{SECRET}")

                  resolve(output)
                } catch (error) {
                  resolve(intoError(error))
                }
              })
            },
          )

          if (result instanceof Retry) {
            // Avoid recursion if it failed with the same error as before
            if (retry?.motive === result.motive) {
              resolveExecution(
                new Error(
                  `Failed to recover from ${result.context}; stderr: ${result.stderr}`,
                ),
              )
            } else {
              void execute(retries.concat(result))
            }
          } else {
            resolveExecution(result)
          }
        } catch (error) {
          resolveExecution(intoError(error))
        }
      }

      void execute([])
    })
  }
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

const cleanupProjects = async (
  executor: CommandExecutor,
  projectsRoot: string,
  {
    includeDirs,
    excludeDirs = [],
  }: { includeDirs?: string[]; excludeDirs?: string[] } = {},
) => {
  const results: CommandOutput[] = []

  toNextProject: for await (const projectRoot of walkDirs(projectsRoot)) {
    if (!(await fsExists(path.join(projectRoot, ".git")))) {
      continue
    }

    if (
      includeDirs !== undefined &&
      includeDirs.filter((includeDir) => {
        return isDirectoryOrSubdirectory(includeDir, projectRoot)
      }).length === 0
    ) {
      continue toNextProject
    }

    for (const excludeDir of excludeDirs) {
      if (isDirectoryOrSubdirectory(excludeDir, projectRoot)) {
        continue toNextProject
      }
    }

    const projectDir = path.dirname(projectRoot)

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

export const ensureDir = async (dir: string) => {
  if (!(await fsExists(dir))) {
    await fsMkdir(dir, { recursive: true })
  }
  return dir
}

const removeDir = async (dir: string) => {
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
