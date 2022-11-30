import { getGitlabCiYmlConfig } from "./gitlab";
import { logger } from "./logger";
import { Task } from "./task";

logger.options.minLogLevel = "fatal";

function getTaskStub(opts: { vars: Record<string, string> } = { vars: {} }): Task {
  const task: Task = {
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
  return task;
}

describe("getGitlabCiYmlConfig", () => {
  test(`PIPELINE_SCRIPTS_REF and other VARs are applied, while PIPELINE_SCRIPTS_REPOSITORY is not overrideable`, () => {
    const res = getGitlabCiYmlConfig(
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
