import { Probot } from "probot";

import { onIssueCommentCreated } from "src/bot/events/onIssueCommentCreated";
import { setupEvent } from "src/bot/setupEvent";
import { Context } from "src/types";

// just do nothing, completely skip
export const botPullRequestIgnoreCommands = ["merge", "rebase"];
export const botPullRequestCommentSubcommands: {
  [Subcommand in "cancel"]: Subcommand;
} = { cancel: "cancel" };

export const setupBot = (ctx: Context, bot: Probot): void => {
  setupEvent(ctx, bot, "issue_comment.created", onIssueCommentCreated);

  // test to see whether this even is caught
  bot.onError((event) => {
    ctx.logger.error(event, "On any Error");
  });

  bot.webhooks.onError((event) => {
    ctx.logger.error(event, "On Webhook Error");
  });
};
