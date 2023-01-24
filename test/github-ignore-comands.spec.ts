import { beforeAll, describe, expect, test } from "@jest/globals"
import { ensureDefined } from "opstooling-js"

import { DetachedExpectation, triggerWebhook } from "./helpers"
import { initRepo, startGitDaemons } from "./setup/gitDaemons"
import { getBotInstance } from "./setup/bot"

type CommandDataProviderItem = {
  suitName: string
  commandLine: string
}
const commandsDataProvider: CommandDataProviderItem[] = [
  { suitName: "[merge] command to ignore", commandLine: "bot merge" },
  { suitName: "[merge *] command to ignore", commandLine: "bot merge force" },
  { suitName: "[rebase] command to ignore", commandLine: "bot rebase" },
]

beforeAll(async () => {
  const gitDaemons = await startGitDaemons()

  await initRepo(gitDaemons.gitHub, "paritytech-stg", "command-bot-test.git", [])
  await initRepo(gitDaemons.gitHub, "somedev123", "command-bot-test.git", ["prBranch1"])
  await initRepo(gitDaemons.gitLab, "paritytech-stg", "command-bot-test.git", [])
})

describe.each(commandsDataProvider)(
  "$suitName: Non pipeline scenario (GitHub webhook)",
  ({ suitName, commandLine }) => {
    test("cmd-bot creates comment or ignores", async () => {
      const bot = ensureDefined(getBotInstance())
      const skipTriggeredPromise = new Promise((resolve, reject) => {
        bot.stdout?.on("data", (dataBuffer: Buffer) => {
          const data = dataBuffer.toString()
          if (data.includes(`Skip command "${commandLine}"`)) {
            resolve(undefined)
          } else if (data.includes("handler finished")) {
            reject("Expected to see \"Skip command\" output first")
          }
        })
      })
      await triggerWebhook("startCommandComment", { body: commandLine })
      await expect(skipTriggeredPromise).resolves.toEqual(undefined)
    })
  },
)
