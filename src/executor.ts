import { Mutex } from "async-mutex"
import cp from "child_process"
import fs from "fs"
import path from "path"
import { promisify } from "util"

import { getSortedTasks } from "src/db"

import { getPostPullRequestResult, updateComment } from "./github"
import { Logger } from "./logger"
import {
  ApiTask,
  CommandOutput,
  Octokit,
  PullRequestTask,
  State,
  Task,
} from "./types"
import {
  cleanupProjects,
  displayCommand,
  displayDuration,
  ensureDir,
  getDeploymentLogsMessage,
  getSendMatrixResult,
  redactSecrets,
  removeDir,
  Retry,
} from "./utils"

const cpExec = promisify(cp.exec)

type RegisterHandleOptions = { terminate: () => Promise<void> }
type RegisterHandle = (options: RegisterHandleOptions) => void
type CancelHandles<T> = Map<string, { cancel: () => Promise<void>; task: T }>

const handlesGetter = function <T>(handles: CancelHandles<T>) {
  return function (handleId: string) {
    return handles.get(handleId)
  }
}

const pullRequestTaskHandles: CancelHandles<PullRequestTask> = new Map()
export const getRegisterPullRequestHandle = function (task: PullRequestTask) {
  return function ({ terminate }: RegisterHandleOptions) {
    pullRequestTaskHandles.set(task.handleId, { cancel: terminate, task })
  }
}
export const getPullRequestTaskHandle = handlesGetter(pullRequestTaskHandles)

const apiTaskHandles: CancelHandles<ApiTask> = new Map()
export const getRegisterApiTaskHandle = function (task: ApiTask) {
  return function ({ terminate }: RegisterHandleOptions) {
    apiTaskHandles.set(task.handleId, { cancel: terminate, task })
  }
}
export const getApiTaskHandle = handlesGetter(apiTaskHandles)

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
  },
) => Promise<CommandOutput>
const getShellExecutor = function ({
  logger,
  projectsRoot,
  onChild,
  isDeployed,
}: {
  logger: Logger
  projectsRoot: string
  onChild?: (child: cp.ChildProcess) => void
  isDeployed: boolean
}): ShellExecutor {
  return function (
    execPath,
    args,
    {
      allowedErrorCodes,
      options,
      testAllowedErrorMessage,
      secretsToHide,
      shouldTrackProgress,
    } = {},
  ) {
    return new Promise(function (resolve) {
      const execute = async function (retries: Retry[]) {
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
          child.on("error", function (error) {
            resolve(error)
          })

          let stdoutBuf = ""
          let stderrBuf = ""
          const getStreamHandler = function (channel: "stdout" | "stderr") {
            return function (data: { toString: () => string }) {
              const str = redactSecrets(data.toString(), secretsToHide)
              const strTrim = str.trim()

              if (shouldTrackProgress && strTrim) {
                logger.info(strTrim, channel)
              }

              switch (channel) {
                case "stdout": {
                  stdoutBuf += str
                  break
                }
                case "stderr": {
                  stderrBuf += str
                  break
                }
                default: {
                  const exhaustivenessCheck: never = channel
                  throw new Error(`Not exhaustive: ${exhaustivenessCheck}`)
                }
              }
            }
          }

          child.stdout.on("data", getStreamHandler("stdout"))
          child.stderr.on("data", getStreamHandler("stderr"))

          const result = await new Promise<Retry | Error | string>(function (
            resolve,
          ) {
            child.on("close", async function (exitCode) {
              try {
                const stderr = redactSecrets(stderrBuf.trim(), secretsToHide)

                if (exitCode) {
                  // https://github.com/rust-lang/rust/issues/51309
                  // Could happen due to lacking system constraints (we saw it
                  // happen due to out-of-memory)
                  if (stderr.includes("SIGKILL")) {
                    logger.fatal(
                      "Compilation was terminated due to SIGKILL (might have something to do with system resource constraints)",
                    )
                  } else if (stderr.includes("No space left on device")) {
                    if (
                      isDeployed &&
                      process.env.CARGO_TARGET_DIR &&
                      retries.find(function ({ motive }) {
                        return motive === cleanupMotiveForCargoTargetDir
                      }) === undefined
                    ) {
                      await removeDir(process.env.CARGO_TARGET_DIR)
                      await ensureDir(process.env.CARGO_TARGET_DIR)
                      return resolve(
                        new Retry({
                          context: "compilation error",
                          motive: cleanupMotiveForCargoTargetDir,
                          stderr,
                        }),
                      )
                    }

                    if (cwd.startsWith(projectsRoot)) {
                      const cleanupMotiveForOtherDirectories = `Freeing disk space while excluding "${cwd}" from "${projectsRoot}" root`
                      const cleanupMotiveForThisDirectory = `Freeing disk space while including only "${cwd}" from "${projectsRoot}" root`

                      const hasAttemptedCleanupForOtherDirectories =
                        retries.find(function ({ motive }) {
                          return motive === cleanupMotiveForOtherDirectories
                        }) === undefined
                      const hasAttemptedCleanupForThisDirectory =
                        retries.find(function ({ motive }) {
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
                          const otherDirectoriesResults = await cleanupProjects(
                            executor,
                            projectsRoot,
                            { excludeDirs: [cwd] },
                          )
                          // Relevant check because the current project might be
                          // the only one we have available in this application.
                          if (otherDirectoriesResults.length) {
                            return resolve(
                              new Retry({
                                context: "compilation error",
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
                              context: "compilation error",
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
                          context: "compilation error",
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

                const stdout = redactSecrets(stdoutBuf.trim(), secretsToHide)
                resolve(stdout || stderr)
              } catch (error) {
                resolve(error)
              }
            })
          })

          if (result instanceof Retry) {
            // Avoid recursion if it failed with the same error as before
            if (retry?.motive === result.motive) {
              resolve(
                new Error(
                  `Failed to recover from ${result.context}; stderr: ${result.stderr}`,
                ),
              )
            } else {
              void execute(retries.concat(result))
            }
          } else {
            resolve(result)
          }
        } catch (error) {
          resolve(error)
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

  const repoCmd = function (
    ...[execPath, args, options]: Parameters<typeof run>
  ) {
    return run(execPath, args, {
      ...options,
      secretsToHide: [token, ...(options?.secretsToHide ?? [])],
      options: { cwd: repoPath, ...options?.options },
    })
  }

  // Clone the repository if it does not exist
  yield repoCmd(
    "git",
    ["clone", "--quiet", `${url}/${owner}/${repo}`, repoPath],
    {
      testAllowedErrorMessage: function (err) {
        return err.endsWith("already exists and is not an empty directory.")
      },
    },
  )

  // Clean up garbage files before checkout
  yield repoCmd("git", ["add", "."])
  yield repoCmd("git", ["reset", "--hard"])

  // Check out to the detached head so that any branch can be deleted
  let out = await repoCmd("git", ["rev-parse", "HEAD"], {
    options: { cwd: repoPath },
  })
  if (out instanceof Error) {
    return out
  }
  const detachedHead = out.trim()
  yield repoCmd("git", ["checkout", "--quiet", detachedHead], {
    testAllowedErrorMessage: function (err) {
      // Why the hell is this not printed to stdout?
      return err.startsWith("HEAD is now at")
    },
  })

  const prRemote = "pr"
  yield repoCmd("git", ["remote", "remove", prRemote], {
    testAllowedErrorMessage: function (err) {
      return err.includes("No such remote:")
    },
  })

  yield repoCmd("git", [
    "remote",
    "add",
    prRemote,
    `${url}/${contributor}/${repo}.git`,
  ])

  yield repoCmd("git", ["fetch", "--quiet", prRemote, branch])

  yield repoCmd("git", ["branch", "-D", branch], {
    testAllowedErrorMessage: function (err) {
      return err.endsWith("not found.")
    },
  })

  yield repoCmd("git", [
    "checkout",
    "--quiet",
    "--track",
    `${prRemote}/${branch}`,
  ])
}

const getQueueMessage = async function (
  state: Parameters<typeof getSortedTasks>[0],
  commandDisplay: string,
  version: string,
) {
  const items = await getSortedTasks(state, { match: { version } })

  if (items.length) {
    return `
Queued ${commandDisplay}

There are other items ahead of it in the queue: ${items.reduce(function (
      acc,
      value,
      i,
    ) {
      return `

${i + 1}:

\`\`\`
${JSON.stringify(value, null, 2)}
\`\`\`

`
    },
    "")}`
  }

  return `\nExecuting:\n\n\`${commandDisplay}\``
}

const mutex = new Mutex()
export const queue = async function ({
  taskData,
  onResult,
  state,
  registerHandle,
}: {
  taskData: Task
  onResult: (result: CommandOutput) => Promise<unknown>
  state: Pick<
    State,
    | "taskDb"
    | "logger"
    | "getFetchEndpoint"
    | "deployment"
    | "getTaskId"
    | "parseTaskId"
    | "appName"
    | "repositoryCloneDirectory"
  >
  registerHandle: RegisterHandle
}) {
  let child: cp.ChildProcess | undefined = undefined
  let isAlive = true
  const { execPath, args, commandDisplay, repoPath } = taskData
  const {
    deployment,
    logger,
    taskDb,
    getFetchEndpoint,
    getTaskId,
    appName,
    repositoryCloneDirectory,
  } = state
  const { db } = taskDb

  let suffixMessage = getDeploymentLogsMessage(deployment)
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

  const taskId = getTaskId()
  const message = await getQueueMessage(state, commandDisplay, taskData.version)
  const cancelledMessage = "Command was cancelled"

  const terminate = async function () {
    isAlive = false

    switch (taskData.tag) {
      case "PullRequestTask": {
        pullRequestTaskHandles.delete(taskData.handleId)
        break
      }
      case "ApiTask": {
        apiTaskHandles.delete(taskData.handleId)
        break
      }
      default: {
        const exhaustivenessCheck: never = taskData
        throw new Error(`Not exhaustive: ${exhaustivenessCheck}`)
      }
    }

    await db.del(taskId)

    logger.info(
      await getSortedTasks(state, { match: { version: taskData.version } }),
      `Queue after termination of task ${taskId}`,
    )

    if (child === undefined) {
      return
    }

    try {
      child.kill()
    } catch (error) {
      logger.fatal(
        error,
        `Failed to kill child with PID ${child.pid} (${commandDisplay})`,
      )
      return
    }

    logger.info(`Killed child with PID ${child.pid} (${commandDisplay})`)
    child = undefined
  }

  const afterExecution = async function (result: CommandOutput) {
    const wasAlive = isAlive

    await terminate()

    if (wasAlive) {
      void onResult(result)
    }
  }

  await db.put(taskId, JSON.stringify(taskData))

  mutex
    .runExclusive(async function () {
      try {
        await db.put(
          taskId,
          JSON.stringify({
            ...taskData,
            timesRequeuedSnapshotBeforeExecution: taskData.timesRequeued,
            timesExecuted: taskData.timesExecuted + 1,
          }),
        )

        if (isAlive) {
          logger.info(
            { handleId: taskData.handleId, taskId, commandDisplay },
            `Starting task of ${commandDisplay}`,
          )
          logger.info(
            await getSortedTasks(state, {
              match: { version: taskData.version },
            }),
            "Current task queue",
          )
        } else {
          logger.info(`taskId ${taskId} was cancelled before it could start`)
          return cancelledMessage
        }

        const run = getShellExecutor({
          logger,
          projectsRoot: repositoryCloneDirectory,
          isDeployed: deployment !== undefined,
          onChild: function (newChild) {
            child = newChild
          },
        })

        const prepare = prepareBranch(taskData, {
          run,
          getFetchEndpoint: function () {
            return getFetchEndpoint(
              "installationId" in taskData ? taskData.installationId : null,
            )
          },
        })
        while (isAlive) {
          const next = await prepare.next()
          if (next.done) {
            break
          }

          child = undefined

          if (typeof next.value !== "string") {
            return next.value
          }
        }
        if (!isAlive) {
          return cancelledMessage
        }

        const startTime = new Date()
        const result = await run(execPath, args, {
          options: { env: { ...process.env, ...taskData.env }, cwd: repoPath },
          shouldTrackProgress: true,
        })
        const endTime = new Date()

        return isAlive
          ? `${appName} took ${displayDuration(
              startTime,
              endTime,
            )} (from ${startTime.toISOString()} to ${endTime.toISOString()} server time) for ${commandDisplay}
            ${result}`
          : cancelledMessage
      } catch (error) {
        return error
      }
    })
    .then(afterExecution)
    .catch(afterExecution)

  registerHandle({ terminate })

  return `${message}\n${suffixMessage}`
}

export const requeueUnterminated = async function (state: State) {
  const { taskDb, version, logger, bot, matrix } = state
  const { db } = taskDb

  // Items which are not from this version still remaining in the database are
  // deemed unterminated.
  const unterminatedItems = await getSortedTasks(state, {
    match: { version, isInverseMatch: true },
  })

  for (const {
    taskData: { timesRequeued, ...taskData },
    id,
  } of unterminatedItems) {
    await db.del(id)

    const prepareRequeue = function <T>(taskData: T) {
      logger.info(taskData, "Prepare requeue")
      return { ...taskData, timesRequeued: timesRequeued + 1 }
    }

    type RequeueComponent = {
      requeue: () => Promise<unknown>
      announceCancel: (msg: string) => Promise<unknown>
    }
    const getRequeueResult = async function (): Promise<
      RequeueComponent | Error
    > {
      try {
        switch (taskData.tag) {
          case "PullRequestTask": {
            const { owner, repo, pull_number, commentId, requester } = taskData

            const octokit = await (
              bot.auth as (installationId?: number) => Promise<Octokit>
            )(taskData.installationId)

            const announceCancel = function (message: string) {
              return updateComment(octokit, {
                owner,
                repo,
                pull_number,
                comment_id: commentId,
                body: `@${requester} ${message}`,
              })
            }

            const nextTaskData = prepareRequeue(taskData)
            const requeue = async function () {
              await queue({
                taskData: nextTaskData,
                onResult: getPostPullRequestResult({
                  taskData: nextTaskData,
                  octokit,
                  state,
                }),
                state,
                registerHandle: getRegisterPullRequestHandle(nextTaskData),
              })
            }

            return { requeue, announceCancel }
          }
          case "ApiTask": {
            if (matrix === null) {
              return {
                announceCancel: async function () {
                  logger.fatal(
                    taskData,
                    "ApiTask cannot be requeued because Matrix client is missing",
                  )
                },
                requeue: async function () {},
              }
            }

            const { matrixRoom } = taskData
            const sendMatrixMessage = function (message: string) {
              return matrix.sendText(matrixRoom, message)
            }

            const nextTaskData = prepareRequeue(taskData)
            return {
              announceCancel: sendMatrixMessage,
              requeue: function () {
                return queue({
                  taskData: nextTaskData,
                  onResult: getSendMatrixResult(matrix, logger, taskData),
                  state,
                  registerHandle: getRegisterApiTaskHandle(nextTaskData),
                })
              },
            }
          }
          default: {
            const exhaustivenessCheck: never = taskData
            const error = new Error(`Not exhaustive: ${exhaustivenessCheck}`)
            throw error
          }
        }
      } catch (error) {
        return error
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
      // Check if the task was requeued and got to execute, but it failed for
      // some reason, in which case it will not be retried further; in
      // comparison, it might have been requeued and not had a chance to execute
      // due to other crash-inducing command being in front of it, thus it's not
      // reasonable to avoid rescheduling this command if it's not his fault
      timesRequeued === taskData.timesRequeuedSnapshotBeforeExecution
    ) {
      await announceCancel(
        `Command was rescheduled and failed to finish (check for taskId ${id} in the logs); execution will not automatically be restarted further.`,
      )
    } else {
      try {
        await requeue()
      } catch (error) {
        let errorMessage = error.toString()
        if (errorMessage.endsWith(".") === false) {
          errorMessage = `${errorMessage}.`
        }
        await announceCancel(
          `Caught exception while trying to reschedule the command; it will not be rescheduled further. Error message: ${errorMessage}.`,
        )
      }
    }
  }
}
