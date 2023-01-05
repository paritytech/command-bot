import { Probot } from "probot"

import { onIssueCommentCreated } from "src/bot/events/onIssueCommentCreated"
import { setupEvent } from "src/bot/setupEvent"
import { Context } from "src/types"

export const botPullRequestCommentMention = "/cmd"
export const botPullRequestCommentSubcommands: {
  [Subcommand in "queue" | "cancel"]: Subcommand
} = { queue: "queue", cancel: "cancel" }

export const setupBot = (ctx: Context, bot: Probot): void => {
  setupEvent(ctx, bot, "issue_comment.created", onIssueCommentCreated)
}
