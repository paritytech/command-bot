import { ensureDefined } from "@eng-automation/js";
import { beforeAll, describe, expect, test } from "@jest/globals";

import { getRestFixtures } from "src/test/fixtures";
import { getMockServers } from "src/test/setup/mockServers";

import { triggerWebhook } from "./helpers";
import { getBotInstance } from "./setup/bot";
import { initRepo, startGitDaemons } from "./setup/gitDaemons";

const jsonResponseHeaders = { "content-type": "application/json" };

const restFixures = getRestFixtures({
  github: {
    org: "paritytech-stg",
    repo: "command-bot-test",
    prAuthor: "somedev123",
    headBranch: "prBranch1",
    comments: [{ author: "somedev123", body: "testbot merge", id: 500 }],
  },
  gitlab: { cmdBranch: "cmd-bot/4-1" },
});

type CommandDataProviderItem = {
  suitName: string;
  commandLine: string;
};
const commandsDataProvider: CommandDataProviderItem[] = [
  { suitName: "[merge] command to ignore", commandLine: "testbot merge" },
  { suitName: "[merge *] command to ignore", commandLine: "testbot merge force" },
  { suitName: "[rebase] command to ignore", commandLine: "testbot rebase" },
];

beforeAll(async () => {
  const gitDaemons = await startGitDaemons();
  const mockServers = ensureDefined(getMockServers());
  await mockServers.gitHub
    .forPost("/app/installations/25299948/access_tokens")
    .thenReply(200, restFixures.github.appInstallationToken, jsonResponseHeaders);

  await mockServers.gitHub.forGet("/organizations/123/members/somedev123").thenReply(204);

  await initRepo(gitDaemons.gitHub, "paritytech-stg", "command-bot-test.git", []);
  await initRepo(gitDaemons.gitHub, "somedev123", "command-bot-test.git", ["prBranch1"]);
  await initRepo(gitDaemons.gitLab, "paritytech-stg", "command-bot-test.git", []);
});

describe.skip.each(commandsDataProvider)(
  "$suitName: Non pipeline scenario (GitHub webhook)",
  // eslint-disable-next-line unused-imports/no-unused-vars-ts
  ({ suitName, commandLine }) => {
    test("cmd-bot creates comment or ignores", async () => {
      // name the webhook event ID, so later we can attribute logs correctly
      const eventId = Math.floor(Math.random() * 1e10).toString();
      const bot = ensureDefined(getBotInstance());
      const skipTriggeredPromise = new Promise((resolve, reject) => {
        bot.stdout?.on("data", (dataBuffer: Buffer) => {
          const data = dataBuffer.toString();
          if (data.includes(`Skip command with reason: "Ignored command:`) && data.includes(eventId)) {
            resolve("Skipped");
          } else if (data.includes("handler finished") && data.includes(eventId)) {
            reject('Expected to see "Skip command" output first');
          }
        });
      });
      await triggerWebhook("startCommandComment", { body: commandLine }, eventId);
      await expect(skipTriggeredPromise).resolves.toEqual("Skipped");
    });
  },
);
