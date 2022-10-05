import { beforeAll, describe, expect, test } from "@jest/globals"
import { CompletedRequest, MockedEndpoint, requestHandlerDefinitions } from "mockttp"
import { ensureDefined, until } from "opstooling-js"

import { getRestFixtures } from "./fixtures"
import { getIssueCommentPayload } from "./fixtures/github/issueComments"
import { DetachedExpectation, triggerWebhook } from "./helpers"
import { initRepo, startGitDaemons } from "./setup/gitDaemons"
import { getMockServers } from "./setup/mockServers"

const restFixtures = getRestFixtures({
  github: {
    org: "tripleightech",
    repo: "command-bot-test",
    prAuthor: "somedev123",
    headBranch: "prBranch1",
    comments: [],
  },
  gitlab: { cmdBranch: "cmd-bot/4" },
})

const jsonResponseHeaders = { "content-type": "application/json" }

const mockedEndpoints: Record<string, MockedEndpoint> = {}

type CommandDataProviderItem = {
  suitName: string
  commandLine: string
  expected: {
    startMessage: string
    finishMessage: string
  }
}
const commandsDataProvider: CommandDataProviderItem[] = [
  {
    suitName: "[sample] command",
    commandLine: "/cmd queue -c sample $ helloworld",
    expected: {
      startMessage: 'Preparing command "echo helloworld". This comment will be updated later.',
      finishMessage: "@somedev123 Command `echo helloworld` has finished.",
    },
  },
  {
    suitName: "[fmt] command with args",
    commandLine: "/cmd queue -c fmt $ 1",
    expected: {
      startMessage: 'Preparing command ""$PIPELINE_SCRIPTS_DIR/fmt.sh" 1". This comment will be updated later.',
      finishMessage: '@somedev123 Command `"$PIPELINE_SCRIPTS_DIR/fmt.sh" 1` has finished.',
    },
  },
  {
    suitName: "[fmt] command no args",
    commandLine: "/cmd queue -c fmt",
    expected: {
      startMessage: 'Preparing command ""$PIPELINE_SCRIPTS_DIR/fmt.sh"". This comment will be updated later.',
      finishMessage: '@somedev123 Command `"$PIPELINE_SCRIPTS_DIR/fmt.sh"` has finished.',
    },
  },
  {
    suitName: "[bench-bot] command",
    commandLine:
      "/cmd queue -v PIPELINE_SCRIPTS_REF=hello-is-this-even-used -c bench-bot $ runtime kusama-dev pallet_referenda",
    expected: {
      startMessage:
        'Preparing command ""$PIPELINE_SCRIPTS_DIR/bench-bot.sh" runtime kusama-dev pallet_referenda". This comment will be updated later.',
      finishMessage:
        '@somedev123 Command `"$PIPELINE_SCRIPTS_DIR/bench-bot.sh" runtime kusama-dev pallet_referenda` has finished.',
    },
  },
  {
    suitName: "[try-runtime] command",
    commandLine:
      "/cmd queue -v RUST_LOG=remote-ext=debug,runtime=trace -c try-runtime $ --chain=kusama-dev --execution=Wasm --no-spec-name-check on-runtime-upgrade live --uri wss://kusama-try-runtime-node.parity-chains.parity.io:443",
    expected: {
      startMessage:
        'Preparing command ""$PIPELINE_SCRIPTS_DIR/try-runtime-bot.sh" --chain=kusama-dev --execution=Wasm --no-spec-name-check on-runtime-upgrade live --uri wss://kusama-try-runtime-node.parity-chains.parity.io:443". This comment will be updated later.',
      finishMessage:
        '@somedev123 Command `"$PIPELINE_SCRIPTS_DIR/try-runtime-bot.sh" --chain=kusama-dev --execution=Wasm --no-spec-name-check on-runtime-upgrade live --uri wss://kusama-try-runtime-node.parity-chains.parity.io:443` has finished. Result: https://example.com/foo/bar/-/jobs/6 has finished. If any artifacts were generated, you can download them from https://example.com/foo/bar/-/jobs/6/artifacts/download.',
    },
  },
]

beforeAll(async () => {
  const gitDaemons = await startGitDaemons()

  await initRepo(gitDaemons.gitHub, "tripleightech", "command-bot-test.git", [])
  await initRepo(gitDaemons.gitHub, "somedev123", "command-bot-test.git", ["prBranch1"])
  await initRepo(gitDaemons.gitLab, "tripleightech", "command-bot-test.git", [])

  const mockServers = ensureDefined(getMockServers())

  await mockServers.gitHub
    .forPost("/app/installations/25299948/access_tokens")
    .thenReply(200, restFixtures.github.appInstallationToken, jsonResponseHeaders)

  await mockServers.gitHub.forGet("/organizations/123/members/somedev123").thenReply(204)

  await mockServers.gitHub
    .forGet("/repos/tripleightech/command-bot-test/pulls/4")
    .thenReply(200, restFixtures.github.pullRequest, jsonResponseHeaders)

  mockedEndpoints.pipeline = await mockServers.gitLab
    .forGet("/api/v4/projects/tripleightech%2Fcommand-bot-test/repository/branches/cmd-bot%2F4")
    .thenReply(200, restFixtures.gitlab.branches, jsonResponseHeaders)
})

describe.each(commandsDataProvider)(
  "$suitName: Positive scenario (GitHub webhook)",
  // eslint-disable-next-line unused-imports/no-unused-vars-ts
  ({ suitName, commandLine, expected }) => {
    let commentThatBotLeft: {
      author: string
      body: string
      id: number
    } | null = null

    test("Phase 1: cmd-bot creates comment", async () => {
      const mockServers = ensureDefined(getMockServers())

      const de = new DetachedExpectation()
      await mockServers.gitHub
        .forPost("/repos/tripleightech/command-bot-test/issues/4/comments")
        .thenCallback(async (request: CompletedRequest): Promise<requestHandlerDefinitions.CallbackResponseResult> => {
          const comment = (await request.body.getJson()) as { body: string }
          commentThatBotLeft = { author: "cmd-bot", body: comment.body, id: 555 }

          de.expect(() => {
            expect(commentThatBotLeft?.body).toMatch(expected.startMessage)
          })

          return {
            body: getIssueCommentPayload({
              org: "tripleightech",
              repo: "command-bot-test",
              comment: commentThatBotLeft,
            }),
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

      await triggerWebhook("queueCommandComment", { body: commandLine })
      await de.promise
    })

    test("Phase 2: cmd-bot start pipeline", async () => {
      const mockServers = ensureDefined(getMockServers())

      const mockedPipelineEndpoint = await mockServers.gitLab
        .forPost("/api/v4/projects/tripleightech%2Fcommand-bot-test/pipeline")
        .withQuery({ ref: "cmd-bot/4" })
        .thenReply(201, restFixtures.gitlab.pendingPipeline, jsonResponseHeaders)

      await mockServers.gitLab
        .forGet("/api/v4/projects/1/pipelines/61")
        .thenReply(200, restFixtures.gitlab.pendingPipeline, jsonResponseHeaders)

      await mockServers.gitLab
        .forGet("/api/v4/projects/tripleightech%2Fcommand-bot-test/pipelines/61/jobs")
        .thenReply(200, restFixtures.gitlab.jobs, jsonResponseHeaders)

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
        .thenReply(200, restFixtures.gitlab.successPipeline, jsonResponseHeaders)

      // TODO: current logic tries to cancel even successful pipelines when wrapping it up for some reason
      await mockServers.gitLab
        .forPost("/api/v4/projects/1/pipelines/61/cancel")
        .thenReply(200, restFixtures.gitlab.cancelledPipeline, jsonResponseHeaders)

      const de = new DetachedExpectation()
      await mockServers.gitHub
        .forPost("/repos/tripleightech/command-bot-test/issues/4/comments")
        .thenCallback(async (request: CompletedRequest): Promise<requestHandlerDefinitions.CallbackResponseResult> => {
          const comment = (await request.body.getJson()) as { body: string }
          commentThatBotLeft = { author: "cmd-bot", body: comment.body, id: 555 }

          de.expect(() => expect(commentThatBotLeft?.body).toMatch(expected.finishMessage))

          return {
            body: getIssueCommentPayload({
              org: "tripleightech",
              repo: "command-bot-test",
              comment: commentThatBotLeft,
            }),
            headers: jsonResponseHeaders,
            status: 201,
          }
        })
      await de.promise
    })
  },
)
