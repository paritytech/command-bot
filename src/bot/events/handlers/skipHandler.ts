import { EventHandler, EventHandlerError } from "src/bot/events/handlers/EventHandler";
import { eventName } from "src/bot/events/onIssueCommentCreated";
import { extractPullRequestData } from "src/bot/parse/extractPullRequestData";
import { SkipEvent } from "src/bot/types";
import { counters, getMetricsPrData } from "src/metrics";

export function skipHandler(this: EventHandler): void {
  // eslint-disable-next-line no-invalid-this
  const { ctx, payload, parsedCommand } = this;

  if (!(parsedCommand instanceof SkipEvent)) {
    throw new EventHandlerError();
  }

  const { logger } = ctx;
  const { pr } = extractPullRequestData(payload);
  const { comment } = payload;
  const skip = getMetricsPrData("skip", eventName, pr, parsedCommand.reason);
  counters.commandsRun.inc({ ...skip });
  logger.debug({ command: comment.body, payload, ...skip }, `Skip command with reason: "${parsedCommand.reason}"`);
}
