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
    commandLine: "bot bench -v PIPELINE_SCRIPTS_REF $ runtime ",
    expectedResponse: new Error(`Variable token "PIPELINE_SCRIPTS_REF" doesn't have a value separator ('=')`),
  },
  {
    suitName: "bench-bot",
    commandLine: "bot bench -v PIPELINE_SCRIPTS_REF=hello-is-this-even-used $ runtime kusama-dev pallet_referenda",
    expectedResponse: new GenericCommand(
      "bench",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/bench/bench.sh"'],
        gitlab: { job: { tags: ["bench-bot"], variables: {} } },
      },
      { PIPELINE_SCRIPTS_REF: "hello-is-this-even-used" },
      '"$PIPELINE_SCRIPTS_DIR/commands/bench/bench.sh" runtime kusama-dev pallet_referenda',
    ),
  },
  {
    suitName: "try-runtime-bot",
    commandLine:
      "bot try-runtime -v RUST_LOG=remote-ext=debug,runtime=trace -v SECOND=val $ --chain=kusama-dev --execution=Wasm --no-spec-name-check on-runtime-upgrade live --uri wss://kusama-try-runtime-node.parity-chains.parity.io:443",
    expectedResponse: new GenericCommand(
      "try-runtime",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/try-runtime/try-runtime.sh"'],
        gitlab: { job: { tags: ["linux-docker"], variables: {} } },
      },
      { RUST_LOG: "remote-ext=debug,runtime=trace", SECOND: "val" },
      '"$PIPELINE_SCRIPTS_DIR/commands/try-runtime/try-runtime.sh" --chain=kusama-dev --execution=Wasm --no-spec-name-check on-runtime-upgrade live --uri wss://kusama-try-runtime-node.parity-chains.parity.io:443',
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
        optionalCommandArgs: true,
      },
      {},
      '"$PIPELINE_SCRIPTS_DIR/commands/fmt/fmt.sh" 1',
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
        optionalCommandArgs: true,
      },
      {},
      '"$PIPELINE_SCRIPTS_DIR/commands/fmt/fmt.sh"',
    ),
  },
  {
    suitName: "bench-bot, no args when not allowed, should return error",
    commandLine: "bot bench",
    expectedResponse: new Error(`Could not find start of command ("$ ")`),
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
      "Could not find matching configuration nope; available ones are bench, fmt, sample, try-runtime.",
    ),
  },
  {
    suitName: "not provided command, returns proper error",
    commandLine: "bot $",
    expectedResponse: new Error(
      "Could not find matching configuration $; available ones are bench, fmt, sample, try-runtime.",
    ),
  },
  {
    suitName: "non existed config must return error with explanation",
    commandLine: "bot xz",
    expectedResponse: new Error(
      `Could not find matching configuration xz; available ones are bench, fmt, sample, try-runtime.`,
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
