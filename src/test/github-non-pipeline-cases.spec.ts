import { ensureDefined } from "@eng-automation/js";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { CompletedRequest, MockedEndpoint, requestHandlerDefinitions } from "mockttp";

import { getRestFixtures } from "./fixtures";
import { getIssueCommentPayload } from "./fixtures/github/issueComments";
import { DetachedExpectation, triggerWebhook } from "./helpers";
import { initRepo, startGitDaemons } from "./setup/gitDaemons";
import { getMockServers } from "./setup/mockServers";

const restFixtures = getRestFixtures({
  github: {
    org: "paritytech-stg",
    repo: "command-bot-test",
    prAuthor: "somedev123",
    headBranch: "prBranch1",
    comments: [],
  },
  gitlab: { cmdBranch: "cmd-bot/4-1" },
});

const jsonResponseHeaders = { "content-type": "application/json" };

const mockedEndpoints: Record<string, MockedEndpoint> = {};

type CommandDataProviderItem = {
  suitName: string;
  commandLine: string;
  expected: {
    startMessage?: string;
    startReaction?: string;
    finishReaction?: string;
  };
};
const commandsDataProvider: CommandDataProviderItem[] = [
  {
    suitName: "[help] command",
    commandLine: "testbot help",
    expected: {
      startMessage: "Here's a [link to docs](http://localhost:3000/static/docs/latest.html?repo=command-bot-test)",
    },
  },
  {
    suitName: "[help] command with branch override",
    commandLine: "testbot help -v PIPELINE_SCRIPTS_REF=tests",
    expected: {
      startMessage:
        "Here's a [link to docs](http://localhost:3000/static/docs/1245345a4376f18f3ef98195055876ff293f8622.html",
    },
  },
  {
    suitName: "[wrong] command",
    commandLine: "testbot hrlp", // intentional typo
    expected: {
      startMessage:
        '@somedev123 Unknown command "hrlp". Refer to [help docs](http://localhost:3000/static/docs/latest.html?repo=command-bot-test) and/or [source code](https://github.com/paritytech/command-bot-scripts).',
    },
  },
  {
    suitName: "[not allowed] command",
    commandLine: "testbot bench-all", // command-bot-test repo is not in a list of repos: [...] array
    expected: {
      startMessage:
        '@somedev123 Unknown command "bench-all". Refer to [help docs](http://localhost:3000/static/docs/latest.html?repo=command-bot-test) and/or [source code](https://github.com/paritytech/command-bot-scripts).',
    },
  },
  {
    suitName: "[cancel] command for no jobs",
    commandLine: "testbot cancel",
    expected: { startMessage: "@somedev123 No task is being executed for this pull request" },
  },

  {
    suitName: "[fmt] command with falsy args - won't be passed",
    commandLine: "testbot fmt 1",
    expected: {
      startMessage:
        '@somedev123 Unknown subcommand of "fmt". Refer to [help docs](http://localhost:3000/static/docs/latest.html?repo=command-bot-test) and/or [source code](https://github.com/paritytech/command-bot-scripts).',
    },
  },

  {
    suitName: "[merge/rebase] merge",
    commandLine: "testbot merge",
    expected: {
      startMessage: `@somedev123 \`bot merge\` and \`bot rebase\` are not supported anymore. Please use native Github "Auto-Merge" and "Update Branch" buttons instead. 
![image](https://github.com/paritytech/polkadot-sdk/assets/1177472/e0883113-9440-4517-9d42-d4255573a2be)`,
    },
  },

  {
    suitName: "[merge/rebase] merge force",
    commandLine: "testbot merge force",
    expected: {
      startMessage: `@somedev123 \`bot merge\` and \`bot rebase\` are not supported anymore. Please use native Github "Auto-Merge" and "Update Branch" buttons instead. 
![image](https://github.com/paritytech/polkadot-sdk/assets/1177472/e0883113-9440-4517-9d42-d4255573a2be)`,
    },
  },

  {
    suitName: "[merge/rebase] rebase",
    commandLine: "testbot rebase",
    expected: {
      startMessage: `@somedev123 \`bot merge\` and \`bot rebase\` are not supported anymore. Please use native Github "Auto-Merge" and "Update Branch" buttons instead. 
![image](https://github.com/paritytech/polkadot-sdk/assets/1177472/e0883113-9440-4517-9d42-d4255573a2be)`,
    },
  },
  // TODO: add test for clean after moving to opstooling-testing
  // {
  //   suitName: "[clean] command",
  //   commandLine: "testbot clean",
  //   expected: {
  //     startReaction: "eyes",
  //     finishReaction: "+1"
  //   },
  // },
];

beforeAll(async () => {
  const gitDaemons = await startGitDaemons();

  await initRepo(gitDaemons.gitHub, "paritytech-stg", "command-bot-test.git", []);
  await initRepo(gitDaemons.gitHub, "somedev123", "command-bot-test.git", ["prBranch1"]);
  await initRepo(gitDaemons.gitLab, "paritytech-stg", "command-bot-test.git", []);

  const mockServers = ensureDefined(getMockServers());

  await mockServers.gitHub
    .forPost("/app/installations/25299948/access_tokens")
    .thenReply(200, restFixtures.github.appInstallationToken, jsonResponseHeaders);

  await mockServers.gitHub.forGet("/organizations/123/members/somedev123").thenReply(204);

  await mockServers.gitHub
    .forGet("/repos/paritytech-stg/command-bot-test/pulls/4")
    .thenReply(200, restFixtures.github.pullRequest, jsonResponseHeaders);

  mockedEndpoints.pipeline = await mockServers.gitLab
    .forGet(/\/api\/v4\/projects\/paritytech-stg%2Fcommand-bot-test\/repository\/branches\/cmd-bot%2F4-\d+/)
    .thenReply(200, restFixtures.gitlab.branches, jsonResponseHeaders);
});

describe.each(commandsDataProvider)(
  "$suitName: Non pipeline scenario (GitHub webhook)",
  // eslint-disable-next-line unused-imports/no-unused-vars-ts
  ({ suitName, commandLine, expected }) => {
    let commentThatBotLeft: {
      author: string;
      body: string;
      id: number;
    } | null = null;

    test("cmd-bot creates comment or ignores", async () => {
      const mockServers = ensureDefined(getMockServers());

      const de = new DetachedExpectation();

      mockedEndpoints.botComments = await mockServers.gitHub
        .forPost("/repos/paritytech-stg/command-bot-test/issues/4/comments")
        .thenCallback(async (request: CompletedRequest): Promise<requestHandlerDefinitions.CallbackResponseResult> => {
          const comment = (await request.body.getJson()) as { body: string };
          commentThatBotLeft = { author: "cmd-bot", body: comment.body, id: 555 };

          de.expect(() => {
            expect(commentThatBotLeft?.body).toMatch(expected?.startMessage || "");
          });

          return {
            body: getIssueCommentPayload({
              org: "paritytech-stg",
              repo: "command-bot-test",
              comment: commentThatBotLeft,
            }),
            headers: jsonResponseHeaders,
            status: 201,
          };
        });

      mockedEndpoints.botUpdatesComment = await mockServers.gitHub
        .forPatch("/repos/paritytech-stg/command-bot-test/issues/comments/555")
        .thenCallback(async (request: CompletedRequest) => {
          const comment = (await request.body.getJson()) as { body: string };
          const existingComment = ensureDefined(commentThatBotLeft);
          existingComment.body = comment.body;
          return {
            body: getIssueCommentPayload({ org: "paritytech-stg", repo: "command-bot-test", comment: existingComment }),
            headers: jsonResponseHeaders,
            status: 200,
          };
        });

      await triggerWebhook("startCommandComment", { body: commandLine });
      await de.promise;
    });
  },
);
