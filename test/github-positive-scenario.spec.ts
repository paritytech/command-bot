import { beforeAll, describe, expect, test } from "@jest/globals"
import { CompletedRequest, MockedEndpoint, requestHandlerDefinitions } from "mockttp"
import { ensureDefined, until } from "opstooling-js"

import { getRestFixtures } from "./fixtures"
import { getIssueCommentPayload } from "./fixtures/github/issueComments"
import { DetachedExpectation, triggerWebhook } from "./helpers"
import { initRepo, startGitDaemons } from "./setup/gitDaemons"
import { getMockServers } from "./setup/mockServers"

const restFixures = getRestFixtures({
  github: {
    org: "tripleightech",
    repo: "command-bot-test",
    prAuthor: "somedev123",
    headBranch: "prBranch1",
    comments: [{ author: "somedev123", body: "/cmd queue -c sample $ hi", id: 500 }],
  },
  gitlab: { cmdBranch: "cmd-bot/4" },
})

const jsonResponseHeaders = { "content-type": "application/json" }

const mockedEndpoints: Record<string, MockedEndpoint> = {}

describe("Positive scenario (GitHub webhook)", () => {
  let commentThatBotLeft: {
    author: string
    body: string
    id: number
  } | null = null

  beforeAll(async () => {
    const gitDaemons = await startGitDaemons()

    await initRepo(gitDaemons.gitHub, "tripleightech", "command-bot-test.git", [])
    await initRepo(gitDaemons.gitHub, "somedev123", "command-bot-test.git", ["prBranch1"])
    await initRepo(gitDaemons.gitLab, "tripleightech", "command-bot-test.git", [])

    const mockServers = ensureDefined(getMockServers())

    await mockServers.gitHub
      .forPost("/app/installations/25299948/access_tokens")
      .thenReply(200, restFixures.github.appInstallationToken, jsonResponseHeaders)

    await mockServers.gitHub.forGet("/organizations/123/members/somedev123").thenReply(204)

    await mockServers.gitHub
      .forGet("/repos/tripleightech/command-bot-test/pulls/4")
      .thenReply(200, restFixures.github.pullRequest, jsonResponseHeaders)

    mockedEndpoints.pipeline = await mockServers.gitLab
      .forGet("/api/v4/projects/tripleightech%2Fcommand-bot-test/repository/branches/cmd-bot%2F4")
      .thenReply(200, restFixures.gitlab.branches, jsonResponseHeaders)
  })

  test("Phase 1: cmd-bot creates comment", async () => {
    const mockServers = ensureDefined(getMockServers())

    const de = new DetachedExpectation()
    await mockServers.gitHub
      .forPost("/repos/tripleightech/command-bot-test/issues/4/comments")
      .thenCallback(async (request: CompletedRequest): Promise<requestHandlerDefinitions.CallbackResponseResult> => {
        const comment = (await request.body.getJson()) as { body: string }
        commentThatBotLeft = { author: "cmd-bot", body: comment.body, id: 555 }

        de.expect(() => {
          expect(commentThatBotLeft?.body).toMatch("Preparing command")
          expect(commentThatBotLeft?.body).toMatch("echo hi")
        })

        return {
          body: getIssueCommentPayload({ org: "tripleightech", repo: "command-bot-test", comment: commentThatBotLeft }),
          headers: jsonResponseHeaders,
          status: 201,
        }
      })

    await mockServers.gitHub
      .forPatch("/repos/tripleightech/command-bot-test/issues/comments/555")
      .thenCallback(async (request: CompletedRequest) => {
        const comment = (await request.body.getJson()) as { body: string }
        const existingComment = ensureDefined(commentThatBotLeft)
        existingComment.body = comment.body
        return {
          body: getIssueCommentPayload({ org: "tripleightech", repo: "command-bot-test", comment: existingComment }),
          headers: jsonResponseHeaders,
          status: 200,
        }
      })

    await triggerWebhook("queueCommandComment")
    await de.promise
  })

  test("Phase 2: cmd-bot start pipeline", async () => {
    const mockServers = ensureDefined(getMockServers())

    const mockedPipelineEndpoint = await mockServers.gitLab
      .forPost("/api/v4/projects/tripleightech%2Fcommand-bot-test/pipeline")
      .withQuery({ ref: "cmd-bot/4" })
      .thenReply(201, restFixures.gitlab.pendingPipeline, jsonResponseHeaders)

    await mockServers.gitLab
      .forGet("/api/v4/projects/1/pipelines/61")
      .thenReply(200, restFixures.gitlab.pendingPipeline, jsonResponseHeaders)

    await mockServers.gitLab
      .forGet("/api/v4/projects/tripleightech%2Fcommand-bot-test/pipelines/61/jobs")
      .thenReply(200, restFixures.gitlab.jobs, jsonResponseHeaders)

    await until(async () => !(await mockedPipelineEndpoint.isPending()), 100, 50)
  })

  test("Phase 3: cmd-bot updates the comment with a link to the pipeline", async () => {
    const comment = ensureDefined(commentThatBotLeft)

    await until(
      () => comment.body.includes("/cmd cancel"),
      100,
      50,
      "Expected bot to edit commit so it would include pipeline cancellation command." +
        `Comment body now is: ${comment.body}`,
    )
  })

  test("Phase 4: after job completes, bot posts new comment with result", async () => {
    const mockServers = ensureDefined(getMockServers())

    await mockServers.gitLab
      .forGet("/api/v4/projects/1/pipelines/61")
      .thenReply(200, restFixures.gitlab.successPipeline, jsonResponseHeaders)

    // TODO: current logic tries to cancel even successful pipelines when wrapping it up for some reason
    await mockServers.gitLab
      .forPost("/api/v4/projects/1/pipelines/61/cancel")
      .thenReply(200, restFixures.gitlab.cancelledPipeline, jsonResponseHeaders)

    const de = new DetachedExpectation()
    await mockServers.gitHub
      .forPost("/repos/tripleightech/command-bot-test/issues/4/comments")
      .thenCallback(async (request: CompletedRequest): Promise<requestHandlerDefinitions.CallbackResponseResult> => {
        const comment = (await request.body.getJson()) as { body: string }
        commentThatBotLeft = { author: "cmd-bot", body: comment.body, id: 555 }

        de.expect(() => expect(commentThatBotLeft?.body).toMatch("@somedev123 Command `echo hi` has finished."))

        return {
          body: getIssueCommentPayload({ org: "tripleightech", repo: "command-bot-test", comment: commentThatBotLeft }),
          headers: jsonResponseHeaders,
          status: 201,
        }
      })
    await de.promise
  })
})