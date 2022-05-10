import assert from "assert"
import { Mutex } from "async-mutex"
import cp from "child_process"
import { randomUUID } from "crypto"
import { parseISO } from "date-fns"
import EventEmitter from "events"
import LevelErrors from "level-errors"
import { extractRequestError, MatrixClient } from "matrix-bot-sdk"
import { Probot } from "probot"

import { getSortedTasks } from "src/db"

import { prepareBranch } from "./core"
import { getPostPullRequestResult, updateComment } from "./github"
import {
  cancelGitlabPipeline,
  restoreTaskGitlabContext,
  runCommandInGitlabPipeline,
} from "./gitlab"
import { Logger } from "./logger"
import { CommandOutput, Context, GitRef } from "./types"
import { displayError, getNextUniqueIncrementalId, intoError } from "./utils"

export const queuedTasks: Map<string, EventEmitter> = new Map()
export const taskExecutionTerminationEvent = Symbol()

export type TaskGitlabPipeline = {
  id: number
  projectId: number
  jobWebUrl: string
}
type TaskBase<T> = {
  tag: T
  id: string
  queuedDate: string
  timesRequeued: number
  timesRequeuedSnapshotBeforeExecution: number
  timesExecuted: number
  gitRef: GitRef
  repoPath: string
  requester: string
  gitlab: {
    job: {
      tags: string[]
      image: string
      variables: Record<string, string>
    }
    pipeline: TaskGitlabPipeline | null
  }
  command: string
}

export type PullRequestTask = TaskBase<"PullRequestTask"> & {
  comment: {
    id: number
    htmlUrl: string
  }
  installationId: number
  gitRef: GitRef & { prNumber: number }
}

export type ApiTask = TaskBase<"ApiTask"> & {
  matrixRoom: string
}

export type Task = PullRequestTask | ApiTask

export const getNextTaskId = () => {
  return `${getNextUniqueIncrementalId()}-${randomUUID()}`
}

export const serializeTaskQueuedDate = (date: Date) => {
  return date.toISOString()
}

export const parseTaskQueuedDate = (str: string) => {
  return parseISO(str)
}

/*
  A Mutex is necessary because otherwise operations from two different commands
  could be interleaved in the same repository, thus leading to
  undefined/unwanted behavior.
  TODO: The Mutex could be per-repository instead of a single one for all
  repositories for better throughput.
*/
const tasksRepositoryLockMutex = new Mutex()

export const queueTask = async (
  parentCtx: Context,
  task: Task,
  {
    onResult,
    updateProgress,
  }: {
    onResult: (result: CommandOutput) => Promise<unknown>
    updateProgress: ((message: string) => Promise<unknown>) | null
  },
) => {
  assert(
    !queuedTasks.has(task.id),
    `Attempted to queue task ${task.id} when it's already registered in the taskMap`,
  )
  const taskEventChannel = new EventEmitter()
  queuedTasks.set(task.id, taskEventChannel)

  const ctx = {
    ...parentCtx,
    logger: parentCtx.logger.child({ taskId: task.id }),
  }
  const { logger, taskDb, getFetchEndpoint, gitlab } = ctx
  const { db } = taskDb

  await db.put(task.id, JSON.stringify(task))

  let terminateTaskExecution: (() => Promise<unknown>) | undefined = undefined
  let activeProcess: cp.ChildProcess | undefined = undefined
  let taskIsAlive = true
  const terminate = async () => {
    if (terminateTaskExecution) {
      await terminateTaskExecution()
      terminateTaskExecution = undefined
      taskEventChannel.emit(taskExecutionTerminationEvent)
    }

    taskIsAlive = false

    queuedTasks.delete(task.id)

    await db.del(task.id)

    if (activeProcess !== undefined) {
      activeProcess.kill()
      logger.info(`Killed child with PID ${activeProcess.pid ?? "?"}`)
      activeProcess = undefined
    }
  }

  const afterTaskRun = (result: CommandOutput | null) => {
    const wasAlive = taskIsAlive

    void terminate().catch((error) => {
      logger.error(error, "Failed to terminate task on afterTaskRun")
    })

    if (wasAlive && result !== null) {
      void onResult(result)
    }
  }

  const cancelledMessage = "Task was cancelled"
  void tasksRepositoryLockMutex
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

        const restoredTaskGitlabCtx = await restoreTaskGitlabContext(ctx, task)
        if (restoredTaskGitlabCtx !== undefined) {
          return restoredTaskGitlabCtx
        }

        if (taskIsAlive) {
          logger.info(task, "Starting task")
        } else {
          logger.info(task, "Task was cancelled before it could start")
          return cancelledMessage
        }

        const prepareBranchSteps = prepareBranch(ctx, task, {
          getFetchEndpoint: () => {
            return getFetchEndpoint(
              "installationId" in task ? task.installationId : null,
            )
          },
        })
        while (taskIsAlive) {
          const next = await prepareBranchSteps.next()
          if (next.done) {
            break
          }

          activeProcess = undefined

          if (typeof next.value !== "string") {
            return next.value
          }
        }
        if (!taskIsAlive) {
          return cancelledMessage
        }

        const pipelineCtx = await runCommandInGitlabPipeline(ctx, task)

        task.gitlab.pipeline = {
          id: pipelineCtx.id,
          jobWebUrl: pipelineCtx.jobWebUrl,
          projectId: pipelineCtx.projectId,
        }
        await db.put(task.id, JSON.stringify(task))

        if (updateProgress) {
          await updateProgress(
            `@${task.requester} ${pipelineCtx.jobWebUrl} was started for your command \`${task.command}\`. Check out https://${gitlab.domain}/${gitlab.pushNamespace}/${task.gitRef.repo}/-/pipelines?page=1&scope=all&username=${gitlab.accessTokenUsername} to know what else is being executed currently.`,
          )
        }

        return pipelineCtx
      } catch (error) {
        return intoError(error)
      }
    })
    .then((taskPipeline) => {
      if (
        taskPipeline instanceof Error ||
        typeof taskPipeline === "string" ||
        taskPipeline === null
      ) {
        return afterTaskRun(taskPipeline)
      }

      terminateTaskExecution = taskPipeline.terminate

      taskPipeline
        .waitUntilFinished(taskEventChannel)
        .then(() => {
          afterTaskRun(
            `${taskPipeline.jobWebUrl} has ${
              taskIsAlive ? "finished" : "was cancelled"
            }. If any artifacts were generated, you can download them from ${
              taskPipeline.jobWebUrl
            }/artifacts/download.`,
          )
        })
        .catch(afterTaskRun)
    })
    .catch(afterTaskRun)

  return `${task.command} was queued.`
}

export const requeueUnterminatedTasks = async (ctx: Context, bot: Probot) => {
  const { taskDb, logger, matrix } = ctx
  const { db } = taskDb

  /*
    unterminatedItems are leftover tasks from previous server instances which
    were not finished properly for some reason (e.g. the server was restarted).
  */
  const unterminatedItems = await getSortedTasks(ctx, { onlyNotAlive: true })

  for (const {
    task: { timesRequeued, ...task },
    id,
  } of unterminatedItems) {
    await db.del(id)

    const prepareRequeuedTask = <T>(prevTask: T) => {
      logger.info(prevTask, "Prepare requeue")
      return { ...prevTask, timesRequeued: timesRequeued + 1 }
    }

    type RequeueComponent = {
      requeue: () => Promise<unknown> | unknown
      announceCancel: (msg: string) => Promise<unknown> | unknown
    }
    const getRequeueResult = async (): Promise<RequeueComponent | Error> => {
      try {
        switch (task.tag) {
          case "PullRequestTask": {
            const {
              gitRef: { owner, repo, prNumber: prNumber },
              comment,
              requester,
            } = task

            const octokit = await bot.auth(task.installationId)

            const announceCancel = (message: string) => {
              return updateComment(ctx, octokit, {
                owner,
                repo,
                pull_number: prNumber,
                comment_id: comment.id,
                body: `@${requester} ${message}`,
              })
            }

            const requeuedTask = prepareRequeuedTask(task)
            const requeue = () => {
              return queueTask(ctx, requeuedTask, {
                onResult: getPostPullRequestResult(ctx, octokit, requeuedTask),
                /*
                  Assumes the relevant progress update was already sent when
                  the task was queued for the first time, thus there's no need
                  to keep updating it
                  TODO: Update the item in the database to tell when
                  updateProgress no longer needs to be called.
                */
                updateProgress: null,
              })
            }

            return { requeue, announceCancel }
          }
          case "ApiTask": {
            if (matrix === null) {
              return {
                announceCancel: () => {
                  logger.warn(
                    task,
                    "ApiTask cannot be requeued because Matrix client is missing",
                  )
                },
                requeue: () => {},
              }
            }

            const { matrixRoom } = task
            const sendMatrixMessage = (msg: string) => {
              return matrix.sendText(matrixRoom, msg)
            }

            const requeuedTask = prepareRequeuedTask(task)
            return {
              announceCancel: sendMatrixMessage,
              requeue: () => {
                return queueTask(ctx, requeuedTask, {
                  onResult: getSendTaskMatrixResult(
                    matrix,
                    logger,
                    requeuedTask,
                  ),
                  /*
                    Assumes the relevant progress update was already sent when
                    the task was queued for the first time, thus there's no need
                    to keep updating it
                    TODO: Update the item in the database to tell when
                    updateProgress no longer needs to be called.
                  */
                  updateProgress: null,
                })
              },
            }
          }
          default: {
            const exhaustivenessCheck: never = task
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
      timesRequeued === task.timesRequeuedSnapshotBeforeExecution
    ) {
      await announceCancel(
        `Command was rescheduled and failed to finish (check for task id ${id} in the logs); execution will not automatically be restarted further.`,
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

export const getSendTaskMatrixResult = (
  matrix: MatrixClient,
  logger: Logger,
  task: ApiTask,
) => {
  return async (message: CommandOutput) => {
    try {
      await matrix.sendText(
        task.matrixRoom,
        `Task ID ${task.id} has finished with message "${
          message instanceof Error ? displayError(message) : message
        }"`,
      )
    } catch (rawError) {
      const error = intoError(rawError)
      logger.error(
        extractRequestError(error),
        "Caught error when sending Matrix message",
      )
    }
  }
}

export const cancelTask = async (ctx: Context, taskId: Task | string) => {
  const {
    taskDb: { db },
    logger,
  } = ctx

  const task =
    typeof taskId === "string"
      ? await (async () => {
          try {
            return JSON.parse(await db.get(taskId)) as Task
          } catch (error) {
            if (error instanceof LevelErrors.NotFoundError) {
              return error
            } else {
              throw error
            }
          }
        })()
      : taskId
  if (task instanceof Error) {
    return task
  }

  logger.info(task, "Cancelling task")

  if (task.gitlab.pipeline !== null) {
    await cancelGitlabPipeline(ctx, task.gitlab.pipeline)
  }

  await db.del(task.id)
}
