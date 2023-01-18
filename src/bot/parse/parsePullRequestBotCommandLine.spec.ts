import { jest } from "@jest/globals"

import { CancelCommand, GenericCommand, HelpCommand, ParsedCommand } from "src/bot/parse/ParsedCommand"
import { parsePullRequestBotCommandLine } from "src/bot/parse/parsePullRequestBotCommandLine"
import { logger } from "src/logger"

jest.mock("src/command-configs/fetchCommandsConfiguration")
jest.mock("src/db")

logger.options.minLogLevel = "fatal"

type DataProvider = {
  suitName: string
  commandLine: string
  expectedResponse?: undefined | ParsedCommand | Error
}

const dataProvider: DataProvider[] = [
  {
    suitName: "unrelated to bot comment returns nothing (ignores)",
    commandLine: "something from comments",
    expectedResponse: undefined,
  },
  {
    suitName: "check wrong set -v, validation should trigger error",
    commandLine: "bot -v INVAL_VAR bench runtime ",
    expectedResponse: new Error(
      "error: option '-v --variable <value>' argument 'INVAL_VAR' is invalid. INVAL_VAR is not in KEY=value format",
    ),
  },
  {
    suitName: "bench-bot",
    commandLine:
      "PIPELINE_SCRIPTS_REF=hello-is-this-even-used bot bench polkadot --runtime kusama-dev --pallet pallet_referenda",
    expectedResponse: new GenericCommand(
      "bench",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/bench/bench.sh"'],
        gitlab: { job: { tags: ["bench-bot"], variables: {} } },
      },
      {},
      { runtime: "kusama-dev", pallet: "pallet_referenda" },
    ),
  },
  {
    suitName: "bench-bot-with-vars",
    commandLine:
      "PIPELINE_SCRIPTS_REF=hello-is-this-even-used bot -v SOME_VAR=some_val bench polkadot --runtime kusama-dev --pallet pallet_referenda",
    expectedResponse: new GenericCommand(
      "bench",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/bench/bench.sh"'],
        gitlab: { job: { tags: ["bench-bot"], variables: {} } },
      },
      { SOME_VAR: "some_val" },
      { runtime: "kusama-dev", pallet: "pallet_referenda" },
    ),
  },
  {
    suitName: "try-runtime-bot",
    commandLine:
      "bot -v RUST_LOG=remote-ext=debug,runtime=trace -v SECOND=val try-runtime --chain=kusama-dev --uri wss://kusama-try-runtime-node.parity-chains.parity.io:443",
    expectedResponse: new GenericCommand(
      "try-runtime",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/try-runtime/try-runtime.sh"'],
        gitlab: { job: { tags: ["linux-docker"], variables: {} } },
      },
      { RUST_LOG: "remote-ext=debug,runtime=trace", SECOND: "val" },
      { chain: "kusama-dev", uri: "wss://kusama-try-runtime-node.parity-chains.parity.io:443" },
    ),
  },
  {
    suitName: "fmt with args should generate config with args",
    commandLine: "bot fmt $ 1",
    expectedResponse: new GenericCommand(
      "fmt",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/fmt/fmt.sh"'],
        gitlab: { job: { tags: ["linux-docker"], variables: {} } },
      },
      {},
      {},
    ),
  },
  {
    suitName: "fmt, no args should be allowed and return config",
    commandLine: "bot fmt",
    expectedResponse: new GenericCommand(
      "fmt",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/fmt/fmt.sh"'],
        gitlab: { job: { tags: ["linux-docker"], variables: {} } },
      },
      {},
      {},
    ),
  },
  /*
    Help cases
   */
  { suitName: "help", commandLine: "bot help", expectedResponse: new HelpCommand("123hash") },

  /*
    Cancel cases
   */
  { suitName: "cancel no-taskId", commandLine: "bot cancel", expectedResponse: new CancelCommand("") },
  { suitName: "cancel with taskId", commandLine: "bot cancel 123123", expectedResponse: new CancelCommand("123123") },

  /*
     Ignore cases
      */
  { suitName: "empty command line returns nothing (ignores)", commandLine: "", expectedResponse: undefined },
  { suitName: "no subcommand - ignore", commandLine: "bot ", expectedResponse: undefined },
  { suitName: "ignored command", commandLine: "bot merge", expectedResponse: undefined },
  { suitName: "ignored command 2", commandLine: "bot rebase", expectedResponse: undefined },

  /*
    Expected Error cases
   */
  {
    suitName: "nonexistent command, should return proper error",
    commandLine: "bot nope 123123",
    expectedResponse: new Error(
      'Could not find matching configuration for command "nope"; Available ones are bench, fmt, sample, try-runtime. Refer to [help docs](http://cmd-bot.docs.com/) for more details.',
    ),
  },
  {
    suitName: "not provided command, returns proper error",
    commandLine: "bot $",
    expectedResponse: new Error(
      'Could not find matching configuration for command "$"; Available ones are bench, fmt, sample, try-runtime. Refer to [help docs](http://cmd-bot.docs.com/) for more details.',
    ),
  },
  {
    suitName: "non existed config must return error with explanation",
    commandLine: "bot xz",
    expectedResponse: new Error(
      `Could not find matching configuration for command "xz"; Available ones are bench, fmt, sample, try-runtime. Refer to [help docs](http://cmd-bot.docs.com/) for more details.`,
    ),
  },
]

describe("parsePullRequestBotCommandLine", () => {
  for (const { suitName, commandLine, expectedResponse } of dataProvider) {
    test(`test commandLine: ${commandLine} [${suitName}]`, async () => {
      const res = await parsePullRequestBotCommandLine(commandLine, { logger })
      expect(res).toEqual(expectedResponse)
    })
  }
})
