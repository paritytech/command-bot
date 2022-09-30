import { afterAll, beforeAll } from "@jest/globals"

import { getBotInstance, launchBot } from "./bot"
import { startGitDaemons, stopGitDaemons } from "./gitDaemons"
import { ensureCert, startMockServers, stopMockServers } from "./mockServers"
import { killAndWait } from "./util"

beforeAll(async () => {
  await ensureCert()
  const mockServers = await startMockServers()
  const gitDaemons = await startGitDaemons()

  await launchBot(mockServers.gitHub.url, mockServers.gitLab.url, gitDaemons)
})

afterAll(async () => {
  await new Promise((resolve) => getBotInstance()?.on("exit", resolve))
  getBotInstance()?.kill()
  const botInstance = getBotInstance()

  if (botInstance) {
    await killAndWait(botInstance)
  }
  await stopGitDaemons()

  await stopMockServers()
})
