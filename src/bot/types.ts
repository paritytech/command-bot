import { EmitterWebhookEventName } from "@octokit/webhooks/dist-types/types"
import { IssueCommentCreatedEvent } from "@octokit/webhooks-types"

import { ExtendedOctokit } from "src/github"
import { CmdJson } from "src/schema/schema.cmd"
import { Context, PullRequestError } from "src/types"

export type QueueCommand = {
  subcommand: "queue"
  configuration: Pick<CmdJson["command"]["configuration"], "gitlab" | "commandStart"> & {
    optionalCommandArgs?: boolean
  }
  variables: {
    [k: string]: unknown
  }
  command: string
}
export type CancelCommand = {
  subcommand: "cancel"
  taskId: string
}

export type ParsedBotCommand = QueueCommand | CancelCommand

export type WebhookEvents = Extract<EmitterWebhookEventName, "issue_comment.created">

export type WebhookEventPayload<E extends WebhookEvents> = E extends "issue_comment.created"
  ? IssueCommentCreatedEvent
  : never

export type WebhookHandler<E extends WebhookEvents> = (
  ctx: Context,
  octokit: ExtendedOctokit,
  event: WebhookEventPayload<E>,
) => Promise<PullRequestError | undefined>
