import { EmitterWebhookEventName } from "@octokit/webhooks/dist-types/types";
import { IssueComment, IssueCommentCreatedEvent } from "@octokit/webhooks-types";

import { ExtendedOctokit } from "src/github";
import { Context } from "src/types";

export type PullRequestData = {
  owner: string;
  repo: string;
  number: number;
};

export type PullRequestCommentMeta = {
  body: string;
  botCommentId?: number;
  requesterCommentId: number;
  requester?: string;
};

export type CommentData = {
  owner: string;
  repo: string;
  issue_number: number;
};

export type WebhookEvents = Extract<EmitterWebhookEventName, "issue_comment.created">;

export type WebhookEventPayload<E extends WebhookEvents> = E extends "issue_comment.created"
  ? IssueCommentCreatedEvent
  : never;

export class PullRequestError {
  constructor(public pr: PullRequestData, public comment: PullRequestCommentMeta) {}
}

export type WebhookHandler<E extends WebhookEvents> = (
  ctx: Context,
  octokit: ExtendedOctokit,
  event: WebhookEventPayload<E>,
) => Promise<PullRequestError | SkipEvent | FinishedEvent | unknown>;

export class SkipEvent {
  constructor(public reason: string = "") {}
}
export class FinishedEvent {
  constructor(public pr: PullRequestData, public comment: IssueComment) {}
}
