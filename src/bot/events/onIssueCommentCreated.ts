import { displayError, intoError } from "@eng-automation/js";

import { EventHandler } from "src/bot/events/handlers/EventHandler";
import { extractPullRequestData } from "src/bot/parse/extractPullRequestData";
import { CancelCommand, CleanCommand, GenericCommand, HelpCommand, ParsedCommand } from "src/bot/parse/ParsedCommand";
import { parsePullRequestBotCommandLine } from "src/bot/parse/parsePullRequestBotCommandLine";
import { CommentData, FinishedEvent, PullRequestError, SkipEvent, WebhookHandler } from "src/bot/types";
import { isRequesterAllowed } from "src/core";
import { getLines } from "src/utils";

export const eventName = "issue_comment.created";

export const onIssueCommentCreated: WebhookHandler<"issue_comment.created"> = async (ctx, octokit, payload) => {
  const { logger } = ctx;
  const { issue, comment, repository } = payload;

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

  const getError = (body: string) => new PullRequestError(pr, { body, requester, requesterCommentId: comment.id });

  try {
    const commands: (ParsedCommand | SkipEvent)[] = [];

    for (const line of getLines(comment.body)) {
      const parsedCommand = await parsePullRequestBotCommandLine(line, ctx, pr.repo);

      if (parsedCommand instanceof Error) {
        return getError(parsedCommand.message);
      } else if (parsedCommand instanceof SkipEvent) {
        const eventHandler = new EventHandler(ctx, payload, octokit, parsedCommand, commentParams);
        eventHandler.skipHandler();
      } else {
        commands.push(parsedCommand);
      }
    }

    if (commands.length === 0) {
      return new SkipEvent("No commands found within a comment");
    }

    if (!(await isRequesterAllowed(ctx, octokit, requester))) {
      return getError("Requester could not be detected as a member of an allowed organization.");
    }

    for (const parsedCommand of commands) {
      const eventHandler = new EventHandler(ctx, payload, octokit, parsedCommand, commentParams);
      let handlerResult: PullRequestError | undefined;
      logger.debug({ parsedCommand }, "Processing parsed command");

      if (parsedCommand instanceof HelpCommand) {
        await eventHandler.helpHandler();
      } else if (parsedCommand instanceof CleanCommand) {
        await eventHandler.cleanHandler();
      } else if (parsedCommand instanceof GenericCommand) {
        handlerResult = await eventHandler.genericHandler();
      } else if (parsedCommand instanceof CancelCommand) {
        handlerResult = await eventHandler.cancelHandler();
      }

      if (handlerResult instanceof PullRequestError) {
        return handlerResult;
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
