import { Probot } from "probot";

import { onIssueCommentCreated } from "src/bot/events/onIssueCommentCreated";
import { setupEvent } from "src/bot/setupEvent";
import { Context } from "src/types";

export const botPullRequestCommentMention = "bot";
// just do nothing, completely skip
export const botPullRequestIgnoreCommands = ["merge", "rebase"];
export const botPullRequestCommentSubcommands: {
  [Subcommand in "cancel"]: Subcommand;
} = { cancel: "cancel" };

export const setupBot = (ctx: Context, bot: Probot): void => {
  setupEvent(ctx, bot, "issue_comment.created", onIssueCommentCreated);

  bot.onError((event) => {
    ctx.logger.error(event, "----> Error");
  });

  bot.webhooks.onError((event) => {
    ctx.logger.error(event, "----> Error");
  });
};
