import { IssueCommentCreatedEvent } from "@octokit/webhooks-types";

import { cancelHandler } from "src/bot/events/handlers/cancelHandler";
import { cleanHandler } from "src/bot/events/handlers/cleanHandler";
import { genericHandler } from "src/bot/events/handlers/genericHandler";
import { helpHandler } from "src/bot/events/handlers/helpHandler";
import { skipHandler } from "src/bot/events/handlers/skipHandler";
import { extractPullRequestData } from "src/bot/parse/extractPullRequestData";
import { ParsedCommand } from "src/bot/parse/ParsedCommand";
import { CommentData, PullRequestCommentMeta, PullRequestData, PullRequestError, SkipEvent } from "src/bot/types";
import { Comment, ExtendedOctokit } from "src/github";
import { Context } from "src/types";

export class EventHandler {
  public pr!: PullRequestData;
  public createdComment?: Comment;

  constructor(
    public ctx: Context,
    public payload: IssueCommentCreatedEvent,
    public octokit: ExtendedOctokit,
    public parsedCommand: ParsedCommand | SkipEvent,
    public commentParams: CommentData,
  ) {
    this.pr = extractPullRequestData(payload).pr;
  }

  get requester(): string {
    return this.payload.comment.user.login;
  }

  public skipHandler = skipHandler.bind(this);
  public helpHandler = helpHandler.bind(this);
  public cleanHandler = cleanHandler.bind(this);
  public cancelHandler = cancelHandler.bind(this);
  public genericHandler = genericHandler.bind(this);
  public getError = ((body: string): PullRequestError => {
    const comment: PullRequestCommentMeta = {
      body,
      requester: this.requester,
      requesterCommentId: this.payload?.comment?.id,
    };

    if (this.createdComment?.id) {
      comment.botCommentId = this.createdComment.id;
    }

    return new PullRequestError(this.pr, comment);
  }).bind(this);
}

export class EventHandlerError extends Error {
  constructor(message: string = "Something went wrong with event handler data") {
    super(message);
  }
}
