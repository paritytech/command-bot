import { delay } from "@eng-automation/js";
import { afterAll, beforeAll } from "@jest/globals";

import { getBotInstance, launchBot } from "./bot";
import { startGitDaemons, stopGitDaemons } from "./gitDaemons";
import { ensureCert, startMockServers, stopMockServers } from "./mockServers";
import { killAndWait } from "./util";

beforeAll(async () => {
  console.log("beforeAll start");
  await ensureCert();

  const mockServers = await startMockServers();
  console.log("MockServers launched");

  const gitDaemons = await startGitDaemons();
  console.log("GitDaemons launched");

  await launchBot(mockServers.gitHub.url, mockServers.gitLab.url, gitDaemons);
  console.log("Bot launched");

  await delay(2000);
});

afterAll(async () => {
  const botInstance = getBotInstance();
  if (botInstance) {
    await killAndWait(botInstance);
    console.log("Bot stopped");
  }
  await stopGitDaemons();
  console.log("GitDaemons stopped");

  await stopMockServers();
  console.log("MockServers stopped");

  await delay(2000);
});
