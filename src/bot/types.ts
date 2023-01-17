import { EmitterWebhookEventName } from "@octokit/webhooks/dist-types/types"
import { IssueCommentCreatedEvent } from "@octokit/webhooks-types"

import { CancelCommand, GenericCommand } from "src/bot/ParsedCommand"
import { ExtendedOctokit } from "src/github"
import { Context, PullRequestError } from "src/types"

export type PullRequestData = {
  owner: string
  repo: string
  number: number
}

export type CommentData = {
  owner: string
  repo: string
  issue_number: number
}

export type ParsedBotCommand = GenericCommand | CancelCommand

export type WebhookEvents = Extract<EmitterWebhookEventName, "issue_comment.created">

export type WebhookEventPayload<E extends WebhookEvents> = E extends "issue_comment.created"
  ? IssueCommentCreatedEvent
  : never

export type WebhookHandler<E extends WebhookEvents> = (
  ctx: Context,
  octokit: ExtendedOctokit,
  event: WebhookEventPayload<E>,
) => Promise<PullRequestError | undefined>
