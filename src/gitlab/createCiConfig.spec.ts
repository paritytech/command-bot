import { jest } from "@jest/globals";

import { createCiConfig } from "src/gitlab/createCiConfig";
import { logger } from "src/logger";
import { Task } from "src/task";

jest.mock("src/command-configs/fetchCommandsConfiguration");

logger.options.minLogLevel = "fatal";

function getTaskStub(opts: { vars: Record<string, string> } = { vars: {} }): Task {
  return {
    gitlab: {
      job: { tags: ["any"], variables: opts.vars, image: "image" },
      pipeline: { id: 12, jobWebUrl: "jobWebUrl", projectId: 99 },
    },
    gitRef: {
      upstream: { owner: "upstream_owner", repo: "upstream_repo", branch: "upstream_branch" },
      contributor: { owner: "contributor_owner", repo: "contributor_repo", branch: "contributor_branch" },
      prNumber: 123,
    },
    command: "echo 123",
    tag: "PullRequestTask",
    id: "123",
    queuedDate: "queuedDate",
    timesRequeued: 0,
    timesRequeuedSnapshotBeforeExecution: 0,
    timesExecuted: 0,
    repoPath: "repoPath",
    requester: "requester",
    comment: { id: 55, htmlUrl: "htmlUrl" },
    installationId: 888,
  };
}

describe("createCiConfig", () => {
  test(`PIPELINE_SCRIPTS_REF and other VARs are applied, while PIPELINE_SCRIPTS_REPOSITORY is not overrideable`, () => {
    const res = createCiConfig(
      "headSha",
      getTaskStub({
        vars: {
          CUSTOM_VAR: "IS_APPLIED",
          PIPELINE_SCRIPTS_REF: "OVERRIDDEN_REF_IS_APPLIED",
          PIPELINE_SCRIPTS_REPOSITORY: "OVERRIDDEN_REPO_NOT_APPLIED",
        },
      }),
      { ref: "OVERRIDABLE", repository: "NON_OVERRIDEABLE" },
      "job Task info message",
    );
    expect(res).toMatchSnapshot();
  });
});
