import { Octokit } from "@octokit/rest"
import { Mutex } from "async-mutex"
import cp from "child_process"
import fs from "fs"
import path from "path"

import { getSortedTasks } from "src/db"

import { getPostPullRequestResult, updateComment } from "./github"
import { Logger } from "./logger"
import { ApiTask, CommandOutput, PullRequestTask, State, Task } from "./types"
import {
  displayCommand,
  displayDuration,
  getDeploymentLogsMessage,
  getSendMatrixResult,
  redactSecrets,
  Retry,
} from "./utils"

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

export type ShellExecutor = (
  execPath: string,
  args: string[],
  opts?: {
    allowedErrorCodes?: number[]
    options?: cp.ExecFileOptions
    testAllowedErrorMessage?: (stderr: string) => boolean
    secretsToHide?: string[]
    shouldTrackProgress?: boolean
  },
) => Promise<CommandOutput>

export const getShellExecutor = function ({
  logger,
  onChild,
}: {
  logger: Logger
  onChild?: (child: cp.ChildProcess) => void
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
      const execute = async function (retryMotive: string) {
        try {
          const commandDisplayed = displayCommand({
            execPath,
            args,
            secretsToHide: secretsToHide ?? [],
          })
          logger.info(
            `${retryMotive ? "Retrying" : "Executing"} ${commandDisplayed}`,
          )

          const child = cp.spawn(execPath, args, options)
          if (onChild) {
            onChild(child)
          }
          child.on("error", function (error) {
            resolve(error)
          })

          let stdout = ""
          let stderr = ""
          const getStreamHandler = function (channel: "stdout" | "stderr") {
            return function (data: { toString: () => string }) {
              const str = redactSecrets(data.toString(), secretsToHide)
              const strTrim = str.trim()

              if (shouldTrackProgress && strTrim) {
                logger.info(strTrim, channel)
              }

              switch (channel) {
                case "stdout": {
                  stdout += str
                  break
                }
                case "stderr": {
                  stderr += str
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
            child.on("close", function (code) {
              try {
                stdout = redactSecrets(stdout.trim(), secretsToHide)
                stderr = redactSecrets(stderr.trim(), secretsToHide)

                if (code) {
                  // https://github.com/rust-lang/rust/issues/51309
                  // Could happen due to lacking system constraints (we saw it
                  // happen due to out-of-memory)
                  if (stderr.includes("SIGKILL")) {
                    logger.fatal(
                      "Compilation process was killed while executing",
                    )
                  } else if (stderr.includes("No space left on device")) {
                    const cleanCmd =
                      "git add . && git reset --hard && git clean -xdf"
                    logger.info(
                      `Running ${cleanCmd} in ${
                        options?.cwd ?? "the current directory"
                      } before retrying the command due to lack of space in the device.`,
                    )
                    cp.execSync(cleanCmd, { cwd: options?.cwd })
                    resolve(new Retry("compilation error", cleanCmd))
                    return
                  } else {
                    const retryForCompilerIssue = stderr.match(
                      /This is a known issue with the compiler. Run `([^`]+)`/,
                    )
                    if (retryForCompilerIssue !== null) {
                      const retryCargoCleanCmd =
                        retryForCompilerIssue[1].replace(/_/g, "-")
                      logger.info(
                        `Running ${retryCargoCleanCmd} in ${
                          options?.cwd ?? "the current directory"
                        } before retrying the command due to a compiler error.`,
                      )
                      cp.execSync(retryCargoCleanCmd, { cwd: options?.cwd })
                      resolve(
                        new Retry("compilation error", retryCargoCleanCmd),
                      )
                      return
                    }
                  }
                }

                if (
                  code &&
                  (allowedErrorCodes === undefined ||
                    !allowedErrorCodes.includes(code)) &&
                  (testAllowedErrorMessage === undefined ||
                    !testAllowedErrorMessage(stderr))
                ) {
                  resolve(new Error(stderr))
                } else {
                  resolve(stdout || stderr)
                }
              } catch (error) {
                resolve(error)
              }
            })
          })

          if (result instanceof Retry) {
            // Avoid recursion if it failed with the same error as before
            if (result.motive === retryMotive) {
              resolve(
                new Error(
                  `Failed to recover from ${result.context}; stderr: ${stderr}`,
                ),
              )
            } else {
              execute(result.motive)
            }
          } else {
            resolve(result)
          }
        } catch (error) {
          resolve(error)
        }
      }

      execute("")
    })
  }
}

export const prepareBranch = async function* (
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

export const getQueueMessage = async function (
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

  return `Executing ${commandDisplay}`
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
  >
  registerHandle: RegisterHandle
}) {
  let child: cp.ChildProcess | undefined = undefined
  let isAlive = true
  const { execPath, args, commandDisplay, repoPath } = taskData
  const { deployment, logger, taskDb, getFetchEndpoint, getTaskId, appName } =
    state
  const { db } = taskDb

  let suffixMessage = getDeploymentLogsMessage(deployment)
  if (!fs.existsSync(repoPath)) {
    suffixMessage +=
      "\nNote: project will be cloned for the first time, so all dependencies will be compiled from scratch; this might take a long time"
  } else if (!fs.existsSync(path.join(repoPath, "target"))) {
    suffixMessage +=
      '\nNote: "target" directory does not exist, so all dependencies will be compiled from scratch; this might take a long time'
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
      onResult(result)
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
