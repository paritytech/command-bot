import { Probot } from "probot";

import { extractPullRequestData } from "src/bot/parse/extractPullRequestData";
import {
  FinishedEvent,
  PullRequestError,
  SkipEvent,
  WebhookEventPayload,
  WebhookEvents,
  WebhookHandler,
} from "src/bot/types";
import { createComment, getOctokit, updateComment } from "src/github";
import { logger as parentLogger } from "src/logger";
import { counters, summaries } from "src/metrics";
import { Context } from "src/types";

export const setupEvent = <E extends WebhookEvents>(
  parentCtx: Context,
  bot: Probot,
  eventName: E,
  handler: WebhookHandler<E>,
): void => {
  bot.on(eventName, async (event) => {
    const eventLogger = parentLogger.child({ eventId: event.id, eventName });
    const ctx: Context = { ...parentCtx, logger: eventLogger };

    const { pr: prData } = extractPullRequestData(event.payload);

    eventLogger.debug({ event, eventName, pr: prData }, `Received bot event ${eventName}`);

    const installationId: number | undefined =
      "installation" in event.payload ? event.payload.installation?.id : undefined;
    const octokit = getOctokit(await bot.auth(installationId), ctx);

    const commandHandlingDurationTimer = summaries.commandHandlingDuration.startTimer({
      eventName,
      owner: prData.owner,
      repo: prData.repo,
      pr: prData.number,
    });

    void handler(ctx, octokit, event.payload as WebhookEventPayload<E>)
      .then(async (result) => {
        if (result instanceof PullRequestError) {
          const { pr, comment } = result;

          const sharedCommentParams = {
            owner: pr.owner,
            repo: pr.repo,
            issue_number: pr.number,
            body: `${comment.requester ? `@${comment.requester} ` : ""}${comment.body}`,
          };

          counters.commandsWarn.inc({
            owner: pr.owner,
            repo: pr.repo,
            pr: pr.number,
            command: sharedCommentParams.body,
          });

          eventLogger.warn(sharedCommentParams, `Got PullRequestError ${pr.repo}#${pr.number} -> ${comment.body}`);

          comment.botCommentId
            ? await updateComment(ctx, octokit, { ...sharedCommentParams, comment_id: comment.botCommentId })
            : await createComment(ctx, octokit, sharedCommentParams);
        } else if (result instanceof SkipEvent && !!result.reason.trim()) {
          counters.commandsSkip.inc({ reason: result.reason });
          eventLogger.debug(
            { command: event.payload.comment.body, payload: event.payload },
            `Skip command with reason: "${result.reason}"`,
          );
        } else if (result instanceof FinishedEvent) {
          counters.commandsFinished.inc({
            owner: result.pr.owner,
            repo: result.pr.repo,
            pr: result.pr.number,
            command: result.comment.body,
          });
          eventLogger.info({ result }, "Finished command");
        } else {
          const message = "Unknown result type";
          counters.commandsError.inc({ message });
          eventLogger.error({ event: event.payload, result }, message);
        }
      })
      .catch((error: Error) => {
        const msg = "Exception caught in webhook handler";
        counters.commandsFatal.inc({ message: `${msg}: ${error.message}` });
        eventLogger.fatal(error, msg);
      })
      .finally(() => {
        counters.commandsHandledTotal.inc({ eventName });
        eventLogger.debug(null, `"${eventName}" handler finished`);
        commandHandlingDurationTimer();
      });
  });
};
