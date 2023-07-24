import { EventHandler, EventHandlerError } from "src/bot/events/handlers/eventHandler";
import { HelpCommand } from "src/bot/parse/ParsedCommand";
import { cleanComments, reactToComment, removeReactionToComment } from "src/github";

export async function cleanHandler(this: EventHandler): Promise<void> {
  // eslint-disable-next-line no-invalid-this
  const { ctx, octokit, commentParams, parsedCommand, payload, pr } = this;
  if (!(parsedCommand instanceof HelpCommand)) {
    throw new EventHandlerError();
  }

  const { comment } = payload;

  const reactionParams = { owner: pr.owner, repo: pr.repo, comment_id: comment.id };
  const reactionId = await reactToComment(ctx, octokit, { ...reactionParams, content: "eyes" });
  await cleanComments(ctx, octokit, { ...commentParams });
  await Promise.all([
    reactionId ? await removeReactionToComment(ctx, octokit, { ...reactionParams, reaction_id: reactionId }) : null,
    await reactToComment(ctx, octokit, { ...reactionParams, content: "+1" }),
  ]);
}
