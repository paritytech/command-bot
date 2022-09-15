import { afterAll, beforeAll } from "@jest/globals"

import { getBotInstance, launchBot } from "./bot"
import { startGitDaemons, stopGitDaemons } from "./gitDaemons"
import { ensureCert, startMockServers, stopMockServers } from "./mockServers"

beforeAll(async () => {
  await ensureCert()
  const mockServers = await startMockServers()
  const gitDaemons = await startGitDaemons()

  await launchBot(mockServers.gitHub.url, mockServers.gitLab.url, gitDaemons)
})

afterAll(async () => {
  getBotInstance()?.kill()
  stopGitDaemons()

  await stopMockServers()
})
