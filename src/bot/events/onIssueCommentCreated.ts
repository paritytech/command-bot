import { displayError, intoError } from "@eng-automation/js";
import path from "path";

import { extractPullRequestData } from "src/bot/parse/extractPullRequestData";
import { CancelCommand, CleanCommand, GenericCommand, HelpCommand, ParsedCommand } from "src/bot/parse/ParsedCommand";
import { parsePullRequestBotCommandLine } from "src/bot/parse/parsePullRequestBotCommandLine";
import { CommentData, FinishedEvent, PullRequestError, SkipEvent, WebhookHandler } from "src/bot/types";
import { isRequesterAllowed } from "src/core";
import { getSortedTasks } from "src/db";
import {
  cleanComments,
  createComment,
  getPostPullRequestResult,
  reactToComment,
  removeReactionToComment,
  updateComment,
} from "src/github";
import { cancelTask, getNextTaskId, PullRequestTask, queueTask, serializeTaskQueuedDate } from "src/task";
import { getLines } from "src/utils";

export const onIssueCommentCreated: WebhookHandler<"issue_comment.created"> = async (ctx, octokit, payload) => {
  const { repositoryCloneDirectory, gitlab, logger } = ctx;
  const { issue, comment, repository, installation } = payload;

  const { pr } = extractPullRequestData(payload);
  const commentParams: CommentData = { owner: pr.owner, repo: pr.repo, issue_number: pr.number };

  logger.options.context = { ...logger.options.context, repo: repository.name, comment: commentParams, pr };

  if (!("pull_request" in issue)) {
    return new SkipEvent("Skipping payload because it's not from a pull request");
  }

  const requester = comment.user?.login;

  if (!requester) {
    return new SkipEvent("Skipping payload because it has no requester");
  }

  if (payload.action !== "created") {
    return new SkipEvent("Skipping payload because it's not for created comments");
  }

  if (comment.user?.type !== "User") {
    return new SkipEvent(`Skipping payload because comment.user.type (${comment.user?.type}) is not "User"`);
  }

  let getError = (body: string) => new PullRequestError(pr, { body, requester, requesterCommentId: comment.id });

  try {
    const commands: ParsedCommand[] = [];
    for (const line of getLines(comment.body)) {
      const parsedCommand = await parsePullRequestBotCommandLine(line, ctx, pr.repo);

      if (parsedCommand instanceof SkipEvent) {
        return parsedCommand;
      }

      if (parsedCommand instanceof Error) {
        return getError(parsedCommand.message);
      }

      commands.push(parsedCommand);
    }

    if (commands.length === 0) {
      return new SkipEvent("No commands found within a comment");
    }

    if (!(await isRequesterAllowed(ctx, octokit, requester))) {
      return getError("Requester could not be detected as a member of an allowed organization.");
    }

    for (const parsedCommand of commands) {
      logger.debug({ parsedCommand }, "Processing parsed command");

      if (parsedCommand instanceof HelpCommand) {
        await createComment(ctx, octokit, {
          ...commentParams,
          body: `Here's a [link to docs](${parsedCommand.docsPath})`,
        });
      }

      if (parsedCommand instanceof CleanCommand) {
        const reactionParams = { owner: pr.owner, repo: pr.repo, comment_id: comment.id };
        const reactionId = await reactToComment(ctx, octokit, { ...reactionParams, content: "eyes" });
        await cleanComments(ctx, octokit, { ...commentParams });
        await Promise.all([
          reactionId
            ? await removeReactionToComment(ctx, octokit, { ...reactionParams, reaction_id: reactionId })
            : null,
          await reactToComment(ctx, octokit, { ...reactionParams, content: "+1" }),
        ]);
      }

      if (parsedCommand instanceof GenericCommand) {
        const installationId = installation?.id;
        if (!installationId) {
          return getError("Github Installation ID was not found in webhook payload");
        }

        const { data: fetchedPr } = await octokit.pulls.get({ owner: pr.owner, repo: pr.repo, pull_number: pr.number });

        const upstream = {
          owner: fetchedPr.base.repo.owner.login,
          repo: fetchedPr.base.repo.name,
          branch: fetchedPr.base.ref,
        };

        // Update pr in case the upstream repository has been renamed
        pr.owner = upstream.owner;
        pr.repo = upstream.repo;

        const contributorUsername = fetchedPr.head?.user?.login;
        if (!contributorUsername) {
          return getError("Failed to read repository owner username for contributor in pull request response");
        }

        const contributorRepository = fetchedPr.head?.repo?.name;
        if (!contributorRepository) {
          return getError("Failed to read repository name for contributor in pull request response");
        }

        const contributorBranch = fetchedPr.head?.ref;
        if (!contributorBranch) {
          return getError("Failed to read branch name for contributor in pull request response");
        }

        const contributor = { owner: contributorUsername, repo: contributorRepository, branch: contributorBranch };
        const commentBody = `Preparing command "${parsedCommand.command}". This comment will be updated later.`.trim();
        const createdComment = await createComment(ctx, octokit, { ...commentParams, body: commentBody });
        getError = (body: string) =>
          new PullRequestError(pr, {
            body,
            requester,
            botCommentId: createdComment.id,
            requesterCommentId: comment.id,
          });

        const queuedDate = new Date();

        const defaultVariables = parsedCommand.configuration.gitlab?.job.variables;
        const overriddenVariables = parsedCommand.variables;

        const task: PullRequestTask = {
          ...pr,
          id: getNextTaskId(),
          tag: "PullRequestTask",
          requester,
          command: parsedCommand.command,
          comment: { id: createdComment.id, htmlUrl: createdComment.htmlUrl },
          installationId,
          gitRef: { upstream, contributor, prNumber: pr.number },
          timesRequeued: 0,
          timesRequeuedSnapshotBeforeExecution: 0,
          timesExecuted: 0,
          repoPath: path.join(repositoryCloneDirectory, pr.repo),
          queuedDate: serializeTaskQueuedDate(queuedDate),
          gitlab: {
            job: {
              tags: parsedCommand.configuration.gitlab?.job.tags || [],
              image: gitlab.jobImage,
              variables: Object.assign(defaultVariables, overriddenVariables),
            },
            pipeline: null,
          },
        };

        const updateProgress = (message: string) =>
          updateComment(ctx, octokit, { ...commentParams, comment_id: createdComment.id, body: message });
        const queueMessage = await queueTask(ctx, task, {
          onResult: getPostPullRequestResult(ctx, octokit, task),
          updateProgress,
        });
        await updateProgress(queueMessage);
      }

      if (parsedCommand instanceof CancelCommand) {
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
            logger.error(
              { error, task: cancelledTask },
              `Failed to update the cancel comment of task ${cancelledTask.id}`,
            );
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
    }
  } catch (rawError) {
    const errMessage = intoError(rawError);
    const msg = `Exception caught in webhook handler\n${errMessage.message}`;
    logger.fatal(displayError(rawError), msg);
    return getError(msg);
  }

  return new FinishedEvent(pr, comment);
};
