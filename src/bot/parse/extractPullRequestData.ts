import { PullRequestData, WebhookEventPayload } from "src/bot/types";

export function extractPullRequestData(payload: WebhookEventPayload<"issue_comment.created">): { pr: PullRequestData } {
  const { issue, repository } = payload;
  const pr: PullRequestData = { owner: repository.owner.login, repo: repository.name, number: issue.number };

  return { pr };
}
