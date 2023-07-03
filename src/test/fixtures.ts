import { getAppInstallationTokenPayload } from "./fixtures/github/appInstallationToken";
import { CommentWebhookParams, getCommentWebhookPayload } from "./fixtures/github/commentWebhook";
import { getIssueCommentsPayload } from "./fixtures/github/issueComments";
import { getPullRequestPayload } from "./fixtures/github/pullRequest";
import { getGitLabBranchesPayload } from "./fixtures/gitlab/branches";
import { getPipelineJobsPayload } from "./fixtures/gitlab/job";
import { getPipelinePayload } from "./fixtures/gitlab/pipeline";

export const webhookFixtures: Record<string, (params: CommentWebhookParams) => string> = {
  startCommandComment: (params) =>
    getCommentWebhookPayload({
      ...{ body: "testbot sample --input=hi", org: "paritytech-stg", repo: "command-bot-test", login: "somedev123" },
      ...params,
    }),
  cancelCommandComment: (params) =>
    getCommentWebhookPayload({
      ...{ body: "testbot cancel", org: "paritytech-stg", repo: "command-bot-test", login: "somedev123" },
      ...params,
    }),
};

export type RestFixturesParams = {
  github: {
    prAuthor: string;
    org: string;
    repo: string;
    headBranch: string;
    comments: { author: string; body: string; id: number }[];
  };
  gitlab: {
    cmdBranch: string;
  };
};

export type RestFixtures = {
  github: {
    appInstallationToken: string;
    pullRequest: string;
    issueComments: string;
  };
  gitlab: {
    branches: string;
    pendingPipeline: string;
    successPipeline: string;
    failedPipeline: string;
    cancelledPipeline: string;
    jobs: string;
  };
};

export function getRestFixtures(params: RestFixturesParams): RestFixtures {
  return {
    github: {
      appInstallationToken: getAppInstallationTokenPayload(),
      pullRequest: getPullRequestPayload({
        org: params.github.org,
        repo: params.github.repo,
        login: params.github.prAuthor,
        headBranch: params.github.headBranch,
      }),
      issueComments: getIssueCommentsPayload({
        org: params.github.org,
        repo: params.github.repo,
        comments: params.github.comments,
      }),
    },
    gitlab: {
      branches: getGitLabBranchesPayload({ branchName: params.gitlab.cmdBranch }),
      pendingPipeline: getPipelinePayload({ status: "pending" }),
      successPipeline: getPipelinePayload({ status: "success" }),
      failedPipeline: getPipelinePayload({ status: "failed" }),
      cancelledPipeline: getPipelinePayload({ status: "canceled" }),
      jobs: getPipelineJobsPayload({ status: "running" }),
    },
  };
}
