import { EventHandler, EventHandlerError } from "src/bot/events/handlers/EventHandler";
import { RebaseCommand } from "src/bot/parse/ParsedCommand";
import { createComment, reactToComment } from "src/github";

export async function rebaseHandler(this: EventHandler): Promise<void> {
  // eslint-disable-next-line no-invalid-this
  const { ctx, octokit, commentParams, parsedCommand, pr, payload } = this;
  const { comment } = payload;
  if (!(parsedCommand instanceof RebaseCommand)) {
    throw new EventHandlerError();
  }
  const reactionParams = { owner: pr.owner, repo: pr.repo, comment_id: comment.id };

  await reactToComment(ctx, octokit, { ...reactionParams, content: "eyes" });

  const { data: fetchedPr } = await octokit.pulls.get({ owner: pr.owner, repo: pr.repo, pull_number: pr.number });

  console.log(`fork?:`, fetchedPr?.head?.repo?.fork, fetchedPr.head);
  try {
    if (fetchedPr?.head?.repo?.fork) {
      const response = await octokit.repos.mergeUpstream({
        owner: fetchedPr.head?.repo?.owner?.login,
        repo: fetchedPr.head?.repo?.name,
        branch: fetchedPr.base.ref,
      });
      console.log(`resp: `, response);

      if (response.status === 200) {
        await createComment(ctx, octokit, { ...commentParams, body: `Rebased` });
        await reactToComment(ctx, octokit, { ...reactionParams, content: "+1" });
      } else {
        await createComment(ctx, octokit, { ...commentParams, body: `Failed to rebase: unknown error` });
        await reactToComment(ctx, octokit, { ...reactionParams, content: "confused" });
        ctx.logger.error({ response }, `Failed to rebase: unknown error`);
      }
    } else {
      const response = await octokit.repos.merge({
        owner: pr.owner,
        repo: pr.repo,
        base: fetchedPr.head.ref,
        head: fetchedPr.base.ref,
        commit_message: `Merge "${fetchedPr.base.ref}" into "${fetchedPr.head.ref}"`,
      });
      console.log(`resp: `, response);

      if (response.status === 201) {
        await createComment(ctx, octokit, { ...commentParams, body: `Rebased` });
        await reactToComment(ctx, octokit, { ...reactionParams, content: "+1" });
      } else if (response.status === 204) {
        await createComment(ctx, octokit, { ...commentParams, body: `Already up to date` });
        await reactToComment(ctx, octokit, { ...reactionParams, content: "rocket" });
      } else {
        await createComment(ctx, octokit, { ...commentParams, body: `Failed to rebase: unknown error` });
        await reactToComment(ctx, octokit, { ...reactionParams, content: "confused" });
        ctx.logger.error({ response }, `Failed to rebase: unknown error`);
      }
    }

    console.log(`PR: `, pr, fetchedPr, fetchedPr?.head?.repo?.owner);
  } catch (e) {
    let msg = `${(e as Error).message}`;

    if (msg.includes("Resource not accessible by integration")) {
      msg = `Downstream repo or ref is not accessible by this bot.`;
    }
    await createComment(ctx, octokit, { ...commentParams, body: `Failed to rebase: "${msg}"` });
    await reactToComment(ctx, octokit, { ...reactionParams, content: "-1" });
    ctx.logger.error({ error: e }, `Failed to rebase: "${msg}"`);
  }
}
