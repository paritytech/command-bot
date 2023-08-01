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
import { counters, getMetricsPrData, summaries } from "src/metrics";
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

          const warn = getMetricsPrData("warn", eventName, prData, comment.body);
          counters.commandsRun.inc({ ...warn, repo: pr.repo, pr: pr.number });

          eventLogger.warn(sharedCommentParams, `Got PullRequestError ${pr.repo}#${pr.number} -> ${comment.body}`);

          comment.botCommentId
            ? await updateComment(ctx, octokit, { ...sharedCommentParams, comment_id: comment.botCommentId })
            : await createComment(ctx, octokit, sharedCommentParams);
        } else if (result instanceof FinishedEvent) {
          const ok = getMetricsPrData("ok", eventName, prData, result.comment.body);
          counters.commandsRun.inc({ ...ok, repo: result.pr.repo, pr: result.pr.number });
          eventLogger.info({ result }, "Finished command");
        } else if (result instanceof SkipEvent) {
          eventLogger.debug({ result }, "Skipping command");
        } else {
          const message = "Unknown result type";
          const error = getMetricsPrData("error", eventName, prData, message);
          counters.commandsRun.inc({ ...error });
          eventLogger.error({ event: event.payload, result, ...error }, message);
        }
      })
      .catch((error: Error) => {
        const msg = "Exception caught in webhook handler";
        const fatal = getMetricsPrData("fatal", eventName, prData, `${msg}: ${error.message}`);
        counters.commandsRun.inc({ ...fatal });
        eventLogger.fatal({ body: error, ...fatal }, msg);
      })
      .finally(() => {
        eventLogger.debug({ pr: prData }, `"${eventName}" handler finished`);
        commandHandlingDurationTimer();
      });
  });
};
