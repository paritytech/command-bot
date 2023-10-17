import { ensureDefined, until } from "@eng-automation/js";
import { beforeAll, describe, test } from "@jest/globals";
import { CompletedRequest, MockedEndpoint } from "mockttp";

import { getRestFixtures } from "./fixtures";
import { getIssueCommentPayload } from "./fixtures/github/issueComments";
import { triggerWebhook } from "./helpers";
import { initRepo, startGitDaemons } from "./setup/gitDaemons";
import { getMockServers } from "./setup/mockServers";

const restFixures = getRestFixtures({
  github: {
    org: "paritytech-stg",
    repo: "command-bot-test",
    prAuthor: "somedev123",
    headBranch: "prBranch1",
    comments: [{ author: "somedev123", body: "testbot sample --input=hi", id: 500 }],
  },
  gitlab: { cmdBranch: "cmd-bot/4-1" },
});

const jsonResponseHeaders = { "content-type": "application/json" };

const mockedEndpoints: Record<string, MockedEndpoint> = {};

describe("Job failure (GitHub webhook)", () => {
  let lastCommentBody: string = "";

  const getCommentResponse = async (request: CompletedRequest) => {
    const comment = (await request.body.getJson()) as { body: string };
    lastCommentBody = comment.body;
    return {
      body: getIssueCommentPayload({
        org: "paritytech-stg",
        repo: "command-bot-test",
        comment: { author: "cmd-bot", body: comment.body, id: 555 },
      }),
      headers: jsonResponseHeaders,
      status: request.method === "POST" ? 201 : 200,
    };
  };

  beforeAll(async () => {
    const gitDaemons = await startGitDaemons();

    await initRepo(gitDaemons.gitHub, "paritytech-stg", "command-bot-test.git", []);
    await initRepo(gitDaemons.gitHub, "somedev123", "command-bot-test.git", ["prBranch1"]);
    await initRepo(gitDaemons.gitLab, "paritytech-stg", "command-bot-test.git", []);

    const mockServers = ensureDefined(getMockServers());

    await mockServers.gitHub
      .forPost("/app/installations/25299948/access_tokens")
      .thenReply(200, restFixures.github.appInstallationToken, jsonResponseHeaders);

    await mockServers.gitHub.forGet("/organizations/123/members/somedev123").thenReply(204);

    await mockServers.gitHub
      .forGet("/repos/paritytech-stg/command-bot-test/pulls/4")
      .thenReply(200, restFixures.github.pullRequest, jsonResponseHeaders);

    mockedEndpoints.pipeline = await mockServers.gitLab
      .forGet(/\/api\/v4\/projects\/paritytech-stg%2Fcommand-bot-test\/repository\/branches\/cmd-bot%2F4-\d+/)
      .thenReply(200, restFixures.gitlab.branches, jsonResponseHeaders);
  });

  test("Phase 1: waiting for the job to start", async () => {
    const mockServers = ensureDefined(getMockServers());

    await mockServers.gitHub
      .forPost("/repos/paritytech-stg/command-bot-test/issues/4/comments")
      .thenCallback(getCommentResponse);

    await mockServers.gitHub
      .forPatch("/repos/paritytech-stg/command-bot-test/issues/comments/555")
      .thenCallback(getCommentResponse);

    await triggerWebhook("startCommandComment");

    const mockedPipelineEndpoint = await mockServers.gitLab
      .forPost("/api/v4/projects/paritytech-stg%2Fcommand-bot-test/pipeline")
      .withQuery({ ref: "cmd-bot/4-1" })
      .thenReply(201, restFixures.gitlab.pendingPipeline, jsonResponseHeaders);

    await mockServers.gitLab
      .forGet("/api/v4/projects/1/pipelines/61")
      .thenReply(200, restFixures.gitlab.pendingPipeline, jsonResponseHeaders);

    await mockServers.gitLab
      .forGet("/api/v4/projects/paritytech-stg%2Fcommand-bot-test/pipelines/61/jobs")
      .thenReply(200, restFixures.gitlab.jobs, jsonResponseHeaders);

    await until(async () => !(await mockedPipelineEndpoint.isPending()), 250, 50);
  });

  test("Phase 2: pipeline fails", async () => {
    const mockServers = ensureDefined(getMockServers());

    const mockedEndpoint = await mockServers.gitLab
      .forGet("/api/v4/projects/1/pipelines/61")
      .thenReply(200, restFixures.gitlab.failedPipeline, jsonResponseHeaders);

    // TODO: current logic tries to cancel even failed pipelines when wrapping it up for some reason
    await mockServers.gitLab
      .forPost("/api/v4/projects/1/pipelines/61/cancel")
      .thenReply(200, restFixures.gitlab.cancelledPipeline, jsonResponseHeaders);

    await until(async () => !(await mockedEndpoint.isPending()), 250, 50);
  });

  // TODO: bot should comment about status of the job
  test("Phase 3: cmd-bot comments that task was finished", async () => {
    await until(
      () => lastCommentBody.match(/has finished/) !== null,
      100,
      50,
      `Expected comment body to include "has finished". Instead, got: ${lastCommentBody}`,
    );
  });
});
