import assert from "assert"
import { Mutex } from "async-mutex"
import cp from "child_process"
import fs from "fs"
import path from "path"
import { Probot } from "probot"
import { promisify } from "util"

import { getSortedTasks } from "src/db"

import { getDeploymentsLogsMessage } from "./core"
import { getPostPullRequestResult, updateComment } from "./github"
import { Logger } from "./logger"
import { queuedTasks } from "./task"
import { CommandOutput, Context, Octokit, Task, ToString } from "./types"
import {
  cleanupProjects,
  displayCommand,
  displayDuration,
  displayError,
  ensureDir,
  getSendMatrixResult,
  intoError,
  redact,
  removeDir,
} from "./utils"

const cpExec = promisify(cp.exec)

export enum RetryContext {
  CompilationError = "compilation error",
}
export class Retry {
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
export type ShellExecutor = (
  execPath: string,
  args: string[],
  opts?: {
    allowedErrorCodes?: number[]
    options?: cp.SpawnOptionsWithoutStdio & { cwd?: string }
    testAllowedErrorMessage?: (stderr: string) => boolean
    secretsToHide?: string[]
    shouldTrackProgress?: boolean
    shouldCaptureAllStreams?: boolean
  },
) => Promise<CommandOutput>
const getShellExecutor = ({
  logger,
  projectsRoot,
  onChild,
  isDeployed,
}: {
  logger: Logger
  projectsRoot: string
  onChild?: (child: cp.ChildProcess) => void
  isDeployed: boolean
}): ShellExecutor => {
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
              child.on("close", async (exitCode) => {
                try {
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
                        isDeployed &&
                        process.env.CARGO_TARGET_DIR &&
                        retries.find(({ motive }) => {
                          return motive === cleanupMotiveForCargoTargetDir
                        }) === undefined
                      ) {
                        await removeDir(process.env.CARGO_TARGET_DIR)
                        await ensureDir(process.env.CARGO_TARGET_DIR)
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

                          const executor = getShellExecutor({
                            logger,
                            projectsRoot,
                            isDeployed,
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
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          resolveExecution(intoError(error))
        }
      }

      void execute([])
    })
  }
}

const prepareBranch = async function* (
  {
    repoPath,
    gitRef: { contributor, owner, repo, branch },
  }: Pick<Task, "repoPath" | "gitRef">,

  {
    run,
    getFetchEndpoint,
  }: {
    run: ShellExecutor
    getFetchEndpoint: () => Promise<{ token: string; url: string }>
  },
) {
  yield run("mkdir", ["-p", repoPath])

  const { token, url } = await getFetchEndpoint()

  const runInRepo = (...[execPath, args, options]: Parameters<typeof run>) => {
    return run(execPath, args, {
      ...options,
      secretsToHide: [token, ...(options?.secretsToHide ?? [])],
      options: { cwd: repoPath, ...options?.options },
    })
  }

  // Clone the repository if it does not exist
  yield runInRepo(
    "git",
    ["clone", "--quiet", `${url}/${owner}/${repo}`, repoPath],
    {
      testAllowedErrorMessage: (err) => {
        return err.endsWith("already exists and is not an empty directory.")
      },
    },
  )

  // Clean up garbage files before checkout
  yield runInRepo("git", ["add", "."])
  yield runInRepo("git", ["reset", "--hard"])

  // Check out to the detached head so that any branch can be deleted
  const out = await runInRepo("git", ["rev-parse", "HEAD"], {
    options: { cwd: repoPath },
  })
  if (out instanceof Error) {
    return out
  }
  const detachedHead = out.trim()
  yield runInRepo("git", ["checkout", "--quiet", detachedHead], {
    testAllowedErrorMessage: (err) => {
      // Why the hell is this not printed to stdout?
      return err.startsWith("HEAD is now at")
    },
  })

  const prRemote = "pr"
  yield runInRepo("git", ["remote", "remove", prRemote], {
    testAllowedErrorMessage: (err) => {
      return err.includes("No such remote:")
    },
  })

  yield runInRepo("git", [
    "remote",
    "add",
    prRemote,
    `${url}/${contributor}/${repo}.git`,
  ])

  yield runInRepo("git", ["fetch", "--quiet", prRemote, branch])

  yield runInRepo("git", ["branch", "-D", branch], {
    testAllowedErrorMessage: (err) => {
      return err.endsWith("not found.")
    },
  })

  yield runInRepo("git", [
    "checkout",
    "--quiet",
    "--track",
    `${prRemote}/${branch}`,
  ])
}

const getTaskQueueMessage = async (
  state: Parameters<typeof getSortedTasks>[0],
  commandDisplay: string,
) => {
  const items = await getSortedTasks(state)

  if (items.length) {
    return `
Queued ${commandDisplay}

There are other items ahead of it in the queue: ${items.reduce(
      (acc, value, i) => {
        return `

${i + 1}:

\`\`\`
${JSON.stringify(value, null, 2)}
\`\`\`

`
      },
      "",
    )}`
  }

  return `\nExecuting:\n\n\`${commandDisplay}\``
}

const mutex = new Mutex()
export const queueTask = async (
  ctx: Context,
  task: Task,
  {
    onResult,
  }: {
    onResult: (result: CommandOutput) => Promise<unknown>
  },
) => {
  assert(
    queuedTasks.get(task.id) === undefined,
    `Attempted to queue task ${task.id} when it's already registered in the taskMap`,
  )

  let taskProcess: cp.ChildProcess | undefined = undefined
  let taskIsAlive = true
  const terminate = async () => {
    taskIsAlive = false

    queuedTasks.delete(task.id)

    await db.del(task.id)

    logger.info(
      { task, queue: await getSortedTasks(ctx) },
      "Queue state after termination of task",
    )

    if (taskProcess === undefined) {
      return
    }

    taskProcess.kill()
    logger.info(
      `Killed child with PID ${taskProcess.pid ?? "?"} (${commandDisplay})`,
    )

    taskProcess = undefined
  }

  queuedTasks.set(task.id, { task, cancel: terminate })

  const { execPath, args, commandDisplay, repoPath } = task
  const {
    deployment,
    logger,
    taskDb,
    getFetchEndpoint,
    appName,
    repositoryCloneDirectory,
  } = ctx
  const { db } = taskDb

  let suffixMessage = getDeploymentsLogsMessage(ctx)
  if (!fs.existsSync(repoPath)) {
    suffixMessage +=
      "\n**Note:** project will be cloned for the first time, so all dependencies will be compiled from scratch; this might take a long time"
  } else if (
    process.env.CARGO_TARGET_DIR
      ? !fs.existsSync(process.env.CARGO_TARGET_DIR)
      : !fs.existsSync(path.join(repoPath, "target"))
  ) {
    suffixMessage +=
      '\n**Note:** "target" directory does not exist, so all dependencies will be compiled from scratch; this might take a long time'
  }

  const message = await getTaskQueueMessage(ctx, commandDisplay)
  const cancelledMessage = "Command was cancelled"

  const afterExecution = async (result: CommandOutput) => {
    const wasAlive = taskIsAlive

    await terminate()

    if (wasAlive) {
      void onResult(result)
    }
  }

  await db.put(task.id, JSON.stringify(task))

  mutex
    .runExclusive(async () => {
      try {
        await db.put(
          task.id,
          JSON.stringify({
            ...task,
            timesRequeuedSnapshotBeforeExecution: task.timesRequeued,
            timesExecuted: task.timesExecuted + 1,
          }),
        )

        if (taskIsAlive) {
          logger.info(
            { task, currentTaskQueue: await getSortedTasks(ctx) },
            `Starting task of ${commandDisplay}`,
          )
        } else {
          logger.info(task, "Task was cancelled before it could start")
          return cancelledMessage
        }

        const run = getShellExecutor({
          logger,
          projectsRoot: repositoryCloneDirectory,
          isDeployed: deployment !== undefined,
          onChild: (createdChild) => {
            taskProcess = createdChild
          },
        })

        const prepare = prepareBranch(task, {
          run,
          getFetchEndpoint: () => {
            return getFetchEndpoint(
              "installationId" in task ? task.installationId : null,
            )
          },
        })
        while (taskIsAlive) {
          const next = await prepare.next()
          if (next.done) {
            break
          }

          taskProcess = undefined

          if (typeof next.value !== "string") {
            return next.value
          }
        }
        if (!taskIsAlive) {
          return cancelledMessage
        }

        const startTime = new Date()
        const result = await run(execPath, args, {
          options: { env: { ...process.env, ...task.env }, cwd: repoPath },
          shouldTrackProgress: true,
          shouldCaptureAllStreams: true,
        })
        const endTime = new Date()

        const resultDisplay =
          result instanceof Error ? displayError(result) : result

        return taskIsAlive
          ? `${appName} took ${displayDuration(
              startTime,
              endTime,
            )} (from ${startTime.toISOString()} to ${endTime.toISOString()} server time) for ${commandDisplay}
            ${resultDisplay}`
          : cancelledMessage
      } catch (error) {
        return intoError(error)
      }
    })
    .then(afterExecution)
    .catch(afterExecution)

  return `${message}\n${suffixMessage}`
}

export const requeueUnterminated = async (ctx: Context, bot: Probot) => {
  const { taskDb, logger, matrix } = ctx
  const { db } = taskDb

  /*
    Items left over from previous server instances which were not finished properly
    for some reason (e.g. the server was restarted).
  */
  const unterminatedItems = await getSortedTasks(ctx, {
    fromOtherServerInstances: true,
  })

  for (const {
    taskData: { timesRequeued, ...taskData },
    id,
  } of unterminatedItems) {
    await db.del(id)

    const prepareRequeuedTask = <T>(task: T) => {
      logger.info(task, "Prepare requeue")
      return { ...task, timesRequeued: timesRequeued + 1 }
    }

    type RequeueComponent = {
      requeue: () => Promise<unknown> | unknown
      announceCancel: (msg: string) => Promise<unknown> | unknown
    }
    const getRequeueResult = async (): Promise<RequeueComponent | Error> => {
      try {
        switch (taskData.tag) {
          case "PullRequestTask": {
            const {
              gitRef: { owner, repo, number: prNumber },
              commentId,
              requester,
            } = taskData

            const octokit = await (
              bot.auth as (installationId?: number) => Promise<Octokit>
            )(taskData.installationId)

            const announceCancel = (message: string) => {
              return updateComment(ctx, octokit, {
                owner,
                repo,
                pull_number: prNumber,
                comment_id: commentId,
                body: `@${requester} ${message}`,
              })
            }

            const requeuedTask = prepareRequeuedTask(taskData)
            const requeue = () => {
              return queueTask(ctx, requeuedTask, {
                onResult: getPostPullRequestResult(ctx, octokit, requeuedTask),
              })
            }

            return { requeue, announceCancel }
          }
          case "ApiTask": {
            if (matrix === null) {
              return {
                announceCancel: () => {
                  logger.warn(
                    taskData,
                    "ApiTask cannot be requeued because Matrix client is missing",
                  )
                },
                requeue: () => {},
              }
            }

            const { matrixRoom } = taskData
            const sendMatrixMessage = (msg: string) => {
              return matrix.sendText(matrixRoom, msg)
            }

            const requeuedTask = prepareRequeuedTask(taskData)
            return {
              announceCancel: sendMatrixMessage,
              requeue: () => {
                return queueTask(ctx, requeuedTask, {
                  onResult: getSendMatrixResult(matrix, logger, requeuedTask),
                })
              },
            }
          }
          default: {
            const exhaustivenessCheck: never = taskData
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            throw new Error(`Not exhaustive: ${exhaustivenessCheck}`)
          }
        }
      } catch (error) {
        return intoError(error)
      }
    }
    const requeueResult = await getRequeueResult()
    if (requeueResult instanceof Error) {
      logger.fatal(requeueResult, "Exception while trying to requeue a task")
      continue
    }

    const { announceCancel, requeue } = requeueResult
    if (
      timesRequeued &&
      /*
        Check if the task was requeued and got to execute, but it failed for
        some reason, in which case it will not be retried further; in
        comparison, it might have been requeued and not had a chance to execute
        due to other crash-inducing command being in front of it, thus it's not
        reasonable to avoid rescheduling this command if it's not his fault
      */
      timesRequeued === taskData.timesRequeuedSnapshotBeforeExecution
    ) {
      await announceCancel(
        `Command was rescheduled and failed to finish (check for task.id ${id} in the logs); execution will not automatically be restarted further.`,
      )
    } else {
      try {
        await requeue()
      } catch (error) {
        const errorMessage = displayError(error)
        await announceCancel(
          `Caught exception while trying to reschedule the command; it will not be rescheduled further. Error message: ${errorMessage}.`,
        )
      }
    }
  }
}
