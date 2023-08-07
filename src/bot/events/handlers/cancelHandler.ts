import { EventHandler, EventHandlerError } from "src/bot/events/handlers/EventHandler";
import { CancelCommand } from "src/bot/parse/ParsedCommand";
import { PullRequestError } from "src/bot/types";
import { getSortedTasks } from "src/db";
import { updateComment } from "src/github";
import { cancelTask, PullRequestTask } from "src/task";

export async function cancelHandler(this: EventHandler): Promise<PullRequestError | undefined> {
  // eslint-disable-next-line no-invalid-this
  const { ctx, payload, octokit, commentParams, parsedCommand, pr, requester, getError } = this;
  const { logger } = ctx;
  const { comment } = payload;

  if (!(parsedCommand instanceof CancelCommand)) {
    throw new EventHandlerError();
  }

  const { taskId } = parsedCommand;

  const cancelledTasks: PullRequestTask[] = [];
  const failedToCancelTasks: PullRequestTask[] = [];

  for (const { task } of await getSortedTasks(ctx)) {
    if (task.tag !== "PullRequestTask") {
      continue;
    }

    if (taskId) {
      if (task.id !== taskId) {
        continue;
      }
    } else {
      if (
        task.gitRef.upstream.owner !== pr.owner ||
        task.gitRef.upstream.repo !== pr.repo ||
        task.gitRef.prNumber !== pr.number
      ) {
        continue;
      }
    }

    try {
      await cancelTask(ctx, task);
      cancelledTasks.push(task);
    } catch (error) {
      failedToCancelTasks.push(task);
      logger.error(error, `Failed to cancel task ${task.id}`);
    }
  }

  for (const cancelledTask of cancelledTasks) {
    if (cancelledTask.comment.id === undefined) {
      continue;
    }
    try {
      await updateComment(ctx, octokit, {
        ...commentParams,
        comment_id: cancelledTask.comment.id,
        body: `@${requester} \`${cancelledTask.command}\`${
          cancelledTask.gitlab.pipeline === null ? "" : ` (${cancelledTask.gitlab.pipeline.jobWebUrl})`
        } was cancelled in ${comment.html_url}`,
      });
    } catch (error) {
      logger.error({ error, task: cancelledTask }, `Failed to update the cancel comment of task ${cancelledTask.id}`);
    }
  }

  if (failedToCancelTasks.length) {
    return getError(
      `Successfully cancelled the following tasks: ${JSON.stringify(
        cancelledTasks.map((task) => task.id),
      )}\n\nFailed to cancel the following tasks: ${JSON.stringify(failedToCancelTasks.map((task) => task.id))}`,
    );
  }

  if (cancelledTasks.length === 0) {
    if (taskId) {
      return getError(`No task matching ${taskId} was found`);
    } else {
      return getError("No task is being executed for this pull request");
    }
  }
}
