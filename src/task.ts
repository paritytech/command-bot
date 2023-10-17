import assert from "assert";
import { Mutex } from "async-mutex";
import cp from "child_process";
import { randomUUID } from "crypto";
import { parseISO } from "date-fns";
import EventEmitter from "events";
import LevelErrors from "level-errors";
import { Probot } from "probot";

import { getApiTaskEndpoint } from "src/api";
import { botPullRequestCommentSubcommands } from "src/bot";
import { config } from "src/config";
import { prepareBranch } from "src/core";
import { getSortedTasks } from "src/db";
import { getPostPullRequestResult, updateComment } from "src/github";
import { cancelGitlabPipeline, restoreTaskGitlabContext, runCommandInGitlabPipeline } from "src/gitlab";
import { CommandOutput, Context, GitRef } from "src/types";
import { displayError, getNextUniqueIncrementalId, intoError } from "src/utils";

export const queuedTasks: Map<string, EventEmitter> = new Map();
export const taskExecutionTerminationEvent = Symbol();

export type TaskGitlabPipeline = {
  id: number;
  projectId: number;
  jobWebUrl: string;
};
type TaskBase<T> = {
  tag: T;
  id: string;
  queuedDate: string;
  timesRequeued: number;
  timesRequeuedSnapshotBeforeExecution: number;
  timesExecuted: number;
  gitRef: GitRef;
  repoPath: string;
  requester: string;
  gitlab: {
    job: {
      timeout?: string;
      tags: string[];
      image: string;
      variables: {
        [k: string]: unknown;
      };
    };
    pipeline: TaskGitlabPipeline | null;
  };
  command: string;
};

export type GitRefPR = GitRef & { prNumber: number };

export type PullRequestTask = TaskBase<"PullRequestTask"> & {
  comment: {
    id: number;
    htmlUrl: string;
  };
  installationId: number;
  gitRef: GitRefPR;
};

export type ApiTask = TaskBase<"ApiTask">;

export type Task = PullRequestTask | ApiTask;

export const getNextTaskId = (): string => `${getNextUniqueIncrementalId()}-${randomUUID()}`;

export const serializeTaskQueuedDate = (date: Date): string => date.toISOString();

export const parseTaskQueuedDate = (str: string): Date => parseISO(str);

/*
  A Mutex is necessary because otherwise operations from two different commands
  could be interleaved in the same repository, thus leading to
  undefined/unwanted behavior.
  TODO: The Mutex could be per-repository instead of a single one for all
  repositories for better throughput.
*/
const tasksRepositoryLockMutex = new Mutex();

export const queueTask = async (
  parentCtx: Context,
  task: Task,
  {
    onResult,
    updateProgress,
  }: {
    onResult: (result: CommandOutput) => Promise<unknown>;
    updateProgress: ((message: string) => Promise<unknown>) | null;
  },
): Promise<string> => {
  assert(!queuedTasks.has(task.id), `Attempted to queue task ${task.id} when it's already registered in the taskMap`);
  const taskEventChannel = new EventEmitter();
  queuedTasks.set(task.id, taskEventChannel);

  const { botPullRequestCommentMention } = config;
  const ctx = { ...parentCtx, logger: parentCtx.logger.child({ taskId: task.id }) };
  const { taskDb, getFetchEndpoint, gitlab, logger } = ctx;
  const { db } = taskDb;

  await db.put(task.id, JSON.stringify(task));

  let terminateTaskExecution: (() => Promise<unknown>) | undefined = undefined;
  let activeProcess: cp.ChildProcess | undefined = undefined;
  let taskIsAlive = true;
  const terminate = async () => {
    if (terminateTaskExecution) {
      await terminateTaskExecution();
      logger.info({ task }, `terminateTaskExecution, command: ${task.command}, task: ${task.id}`);
      terminateTaskExecution = undefined;
      taskEventChannel.emit(taskExecutionTerminationEvent);
    }

    taskIsAlive = false;

    queuedTasks.delete(task.id);

    await db.del(task.id);

    if (activeProcess !== undefined) {
      activeProcess.kill();
      logger.info(`Killed child with PID ${activeProcess.pid ?? "?"}`);
      activeProcess = undefined;
    }
  };

  const afterTaskRun = (result: CommandOutput | null) => {
    const wasAlive = taskIsAlive;

    if (result instanceof Error) {
      logger.error(result, "AfterTaskRun returned an error");
    } else {
      logger.debug(result, "AfterTaskRun handler");
    }

    void terminate().catch((error) => {
      logger.error(error, "Failed to terminate task on afterTaskRun");
    });

    if (wasAlive && result !== null) {
      void onResult(result);
    }
  };

  const additionalTaskCancelInstructions = (() => {
    switch (task.tag) {
      case "PullRequestTask": {
        return `\n\nComment \`${botPullRequestCommentMention} ${botPullRequestCommentSubcommands.cancel} ${task.id}\` to cancel this command or \`${botPullRequestCommentMention} ${botPullRequestCommentSubcommands.cancel}\` to cancel all commands in this pull request.`;
      }
      case "ApiTask": {
        return `Send a DELETE request to ${getApiTaskEndpoint(task)} for cancelling this task.`;
      }
      default: {
        const exhaustivenessCheck: never = task;
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`Not exhaustive: ${exhaustivenessCheck}`);
      }
    }
  })();

  const cancelledMessage = "Task was cancelled";

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
        );

        const restoredTaskGitlabCtx = await restoreTaskGitlabContext(ctx, task);
        if (restoredTaskGitlabCtx !== undefined) {
          return restoredTaskGitlabCtx;
        }

        if (taskIsAlive) {
          logger.info(task, "Starting task");
        } else {
          logger.info(task, "Task was cancelled before it could start");
          return cancelledMessage;
        }

        const prepareBranchSteps = prepareBranch(ctx, task, {
          getFetchEndpoint: () => getFetchEndpoint("installationId" in task ? task.installationId : null),
        });
        while (taskIsAlive) {
          const next = await prepareBranchSteps.next();
          if (next.done) {
            break;
          }

          activeProcess = undefined;

          if (typeof next.value !== "string") {
            return next.value;
          }
        }
        if (!taskIsAlive) {
          logger.info(task, "Task was cancelled!");
          return cancelledMessage;
        }

        const pipelineCtx = await runCommandInGitlabPipeline(ctx, task);

        task.gitlab.pipeline = {
          id: pipelineCtx.id,
          jobWebUrl: pipelineCtx.jobWebUrl,
          projectId: pipelineCtx.projectId,
        };
        await db.put(task.id, JSON.stringify(task));

        if (updateProgress) {
          await updateProgress(
            `@${task.requester} ${pipelineCtx.jobWebUrl} was started for your command \`${task.command}\`. Check out https://${gitlab.domain}/${gitlab.pushNamespace}/${task.gitRef.upstream.repo}/-/pipelines?page=1&scope=all&username=${gitlab.accessTokenUsername} to know what else is being executed currently. ${additionalTaskCancelInstructions}`,
          );
        }

        return pipelineCtx;
      } catch (error) {
        return intoError(error);
      }
    })
    .then((taskPipeline) => {
      if (taskPipeline instanceof Error || typeof taskPipeline === "string" || taskPipeline === null) {
        return afterTaskRun(taskPipeline);
      }

      terminateTaskExecution = taskPipeline.terminate;

      taskPipeline
        .waitUntilFinished(taskEventChannel)
        .then(() => {
          afterTaskRun(
            `${taskPipeline.jobWebUrl} has ${
              taskIsAlive ? "finished" : "was cancelled"
            }. If any artifacts were generated, you can download them from ${
              taskPipeline.jobWebUrl
            }/artifacts/download.`,
          );
        })
        .catch(afterTaskRun);
    })
    .catch(afterTaskRun);

  return `${task.command} was queued. ${additionalTaskCancelInstructions}`;
};

export const requeueUnterminatedTasks = async (ctx: Context, bot: Probot): Promise<void> => {
  const { taskDb, logger } = ctx;
  const { db } = taskDb;

  /*
    unterminatedItems are leftover tasks from previous server instances which
    were not finished properly for some reason (e.g. the server was restarted).
  */
  const unterminatedItems = await getSortedTasks(ctx, { onlyNotAlive: true });

  for (const {
    task: { timesRequeued, ...task },
    id,
  } of unterminatedItems) {
    await db.del(id);

    const prepareRequeuedTask = <T>(prevTask: T) => {
      logger.info(prevTask, "Prepare requeue");
      return { ...prevTask, timesRequeued: timesRequeued + 1 };
    };

    type RequeueComponent = {
      requeue: () => Promise<unknown> | unknown;
      announceCancel: (msg: string) => Promise<unknown> | unknown;
    };
    const getRequeueResult = async (): Promise<RequeueComponent | Error> => {
      try {
        switch (task.tag) {
          case "PullRequestTask": {
            const {
              gitRef: { upstream, prNumber },
              comment,
              requester,
            } = task;

            const octokit = await bot.auth(task.installationId);

            const announceCancel = (message: string) =>
              updateComment(ctx, octokit, {
                owner: upstream.owner,
                repo: upstream.repo,
                pull_number: prNumber,
                comment_id: comment.id,
                body: `@${requester} ${message}`,
              });

            const requeuedTask = prepareRequeuedTask(task);
            const requeue = () =>
              queueTask(ctx, requeuedTask, {
                onResult: getPostPullRequestResult(ctx, octokit, requeuedTask),
                /*
                  Assumes the relevant progress update was already sent when
                  the task was queued for the first time, thus there's no need
                  to keep updating it
                  TODO: Update the item in the database to tell when
                  updateProgress no longer needs to be called.
                */
                updateProgress: null,
              });

            return { requeue, announceCancel };
          }
          case "ApiTask": {
            const requeuedTask = prepareRequeuedTask(task);
            return {
              announceCancel: apiTaskResult(ctx),
              requeue: () =>
                queueTask(ctx, requeuedTask, {
                  onResult: apiTaskResult(ctx),
                  /*
                    Assumes the relevant progress update was already sent when
                    the task was queued for the first time, thus there's no need
                    to keep updating it
                    TODO: Update the item in the database to tell when
                    updateProgress no longer needs to be called.
                  */
                  updateProgress: null,
                }),
            };
          }
          default: {
            const exhaustivenessCheck: never = task;
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            throw new Error(`Not exhaustive: ${exhaustivenessCheck}`);
          }
        }
      } catch (error) {
        return intoError(error);
      }
    };

    const requeueResult = await getRequeueResult();
    if (requeueResult instanceof Error) {
      logger.fatal(requeueResult, "Exception while trying to requeue a task");
      continue;
    }

    const { announceCancel, requeue } = requeueResult;
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
      );
    } else {
      try {
        await requeue();
      } catch (error) {
        const errorMessage = displayError(error);
        await announceCancel(
          `Caught exception while trying to reschedule the command; it will not be rescheduled further. Error message: ${errorMessage}.`,
        );
      }
    }
  }
};

export const apiTaskResult =
  (ctx: Context) =>
  async (message: CommandOutput): Promise<void> =>
    await new Promise((resolve) => {
      ctx.logger.info({}, message);
      resolve();
    });

export const cancelTask = async (ctx: Context, taskId: Task | string): Promise<Error | undefined> => {
  const {
    taskDb: { db },
    logger,
  } = ctx;

  const task =
    typeof taskId === "string"
      ? await (async () => {
          try {
            return JSON.parse(await db.get(taskId)) as Task;
          } catch (error) {
            if (error instanceof LevelErrors.NotFoundError) {
              return error;
            } else {
              throw error;
            }
          }
        })()
      : taskId;
  if (task instanceof Error) {
    return task;
  }

  logger.info(task, "Cancelling task");

  if (task.gitlab.pipeline !== null) {
    await cancelGitlabPipeline(ctx, task.gitlab.pipeline);
  }

  await db.del(task.id);
};
