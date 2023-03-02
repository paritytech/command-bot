import { beforeAll, describe, expect, test } from "@jest/globals";
import { ensureDefined } from "opstooling-js";

import { triggerWebhook } from "./helpers";
import { getBotInstance } from "./setup/bot";
import { initRepo, startGitDaemons } from "./setup/gitDaemons";

type CommandDataProviderItem = {
  suitName: string;
  commandLine: string;
};
const commandsDataProvider: CommandDataProviderItem[] = [
  { suitName: "[merge] command to ignore", commandLine: "bot merge" },
  { suitName: "[merge *] command to ignore", commandLine: "bot merge force" },
  { suitName: "[rebase] command to ignore", commandLine: "bot rebase" },
];

beforeAll(async () => {
  const gitDaemons = await startGitDaemons();

  await initRepo(gitDaemons.gitHub, "paritytech-stg", "command-bot-test.git", []);
  await initRepo(gitDaemons.gitHub, "somedev123", "command-bot-test.git", ["prBranch1"]);
  await initRepo(gitDaemons.gitLab, "paritytech-stg", "command-bot-test.git", []);
});

describe.each(commandsDataProvider)(
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
