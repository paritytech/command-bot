import { Probot } from "probot"

import {
  FinishedEvent,
  PullRequestError,
  SkipEvent,
  WebhookEventPayload,
  WebhookEvents,
  WebhookHandler,
} from "src/bot/types"
import { createComment, getOctokit, updateComment } from "src/github"
import { logger as parentLogger } from "src/logger"
import { Context } from "src/types"

export const setupEvent = <E extends WebhookEvents>(
  parentCtx: Context,
  bot: Probot,
  eventName: E,
  handler: WebhookHandler<E>,
): void => {
  bot.on(eventName, async (event) => {
    const eventLogger = parentLogger.child({ eventId: event.id, eventName })
    const ctx: Context = { ...parentCtx, logger: eventLogger }

    eventLogger.debug({ event, eventName }, `Received bot event ${eventName}`)

    const installationId: number | undefined =
      "installation" in event.payload ? event.payload.installation?.id : undefined
    const octokit = getOctokit(await bot.auth(installationId), ctx)

    void handler(ctx, octokit, event.payload as WebhookEventPayload<E>)
      .then(async (result) => {
        if (result instanceof PullRequestError) {
          const { pr, comment } = result

          const sharedCommentParams = {
            owner: pr.owner,
            repo: pr.repo,
            issue_number: pr.number,
            body: `${comment.requester ? `@${comment.requester} ` : ""}${comment.body}`,
          }

          eventLogger.warn(sharedCommentParams, `Got PullRequestError ${pr.repo}#${pr.number} -> ${comment.body}`)

          comment.botCommentId
            ? await updateComment(ctx, octokit, { ...sharedCommentParams, comment_id: comment.botCommentId })
            : await createComment(ctx, octokit, sharedCommentParams)
        } else if (result instanceof SkipEvent && !!result.reason.trim()) {
          eventLogger.debug(
            event.payload,
            `Skip command "${event.payload.comment.body}" with reason: "${result.reason}"`,
          )
        } else if (result instanceof FinishedEvent) {
          eventLogger.info({ result }, "Finished command")
        } else {
          eventLogger.error({ event: event.payload, result }, "Unknown result type")
        }
      })
      .catch((error) => {
        eventLogger.fatal(error, "Exception caught in webhook handler")
      })
      .finally(() => {
        eventLogger.debug(null, `"${eventName}" handler finished`)
      })
  })
}
