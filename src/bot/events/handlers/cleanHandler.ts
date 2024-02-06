import { EventHandler, EventHandlerError } from "src/bot/events/handlers/EventHandler";
import { CleanCommand } from "src/bot/parse/ParsedCommand";
import { cleanComments, reactToComment, removeReactionToComment } from "src/github";

export async function cleanHandler(this: EventHandler): Promise<void> {
  // eslint-disable-next-line no-invalid-this
  const { ctx, octokit, commentParams, parsedCommand, payload, pr } = this;
  if (!(parsedCommand instanceof CleanCommand)) {
    throw new EventHandlerError();
  }

  const { comment, sender } = payload;

  const reactionParams = { owner: pr.owner, repo: pr.repo, comment_id: comment.id };
  const reactionId = await reactToComment(ctx, octokit, { ...reactionParams, content: "eyes" });
  await cleanComments(ctx, octokit, comment, parsedCommand.all, { ...commentParams, requester: sender.login });
  await Promise.all([
    reactionId
      ? await removeReactionToComment(ctx, octokit, { ...reactionParams, reaction_id: reactionId }).catch((e) => {
          ctx.logger.error(e, "Failed to remove reaction");
        })
      : null,
    await reactToComment(ctx, octokit, { ...reactionParams, content: "+1" }),
  ]);
}
