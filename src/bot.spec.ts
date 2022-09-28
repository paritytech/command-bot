import { jest } from "@jest/globals"

import { ParsedBotCommand, parsePullRequestBotCommandLine } from "./bot"
import { logger } from "./logger"

logger.options.minLogLevel = "fatal"

type DataProvider = {
  suitName: string
  commandLine: string
  expectedResponse?: undefined | ParsedBotCommand | Error
}

const dataProvider: DataProvider[] = [
  { suitName: "empty command line returns nothing (ignores)", commandLine: "", expectedResponse: undefined },
  {
    suitName: "unrelated to /cmd comment returns nothing (ignores)",
    commandLine: "something from comments",
    expectedResponse: undefined,
  },
  {
    suitName: "check wrong set -v, validation should trigger error",
    commandLine: "/cmd queue -v PIPELINE_SCRIPTS_REF -c bench-bot $ runtime ",
    expectedResponse: new Error(`Variable token "PIPELINE_SCRIPTS_REF" doesn't have a value separator ('=')`),
  },
  {
    suitName: "bench-bot",
    commandLine:
      "/cmd queue -v PIPELINE_SCRIPTS_REF=hello-is-this-even-used -c bench-bot $ runtime kusama-dev pallet_referenda",
    expectedResponse: {
      subcommand: "queue",
      configuration: {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/bench-bot.sh"'],
        gitlab: { job: { tags: ["bench-bot"], variables: {} } },
      },
      variables: { PIPELINE_SCRIPTS_REF: "hello-is-this-even-used" },
      command: '"$PIPELINE_SCRIPTS_DIR/bench-bot.sh" runtime kusama-dev pallet_referenda',
    },
  },
  {
    suitName: "try-runtime-bot",
    commandLine:
      "/cmd queue -v RUST_LOG=remote-ext=debug,runtime=trace -c try-runtime $ --chain=kusama-dev --execution=Wasm --no-spec-name-check on-runtime-upgrade live --uri wss://kusama-try-runtime-node.parity-chains.parity.io:443",
    expectedResponse: {
      subcommand: "queue",
      configuration: {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/try-runtime-bot.sh"'],
        gitlab: { job: { tags: ["linux-docker"], variables: {} } },
      },
      variables: { RUST_LOG: "remote-ext=debug,runtime=trace" },
      command:
        '"$PIPELINE_SCRIPTS_DIR/try-runtime-bot.sh" --chain=kusama-dev --execution=Wasm --no-spec-name-check on-runtime-upgrade live --uri wss://kusama-try-runtime-node.parity-chains.parity.io:443',
    },
  },
  {
    suitName: "fmt with args should generate config with args",
    commandLine: "/cmd queue -c fmt $ 1",
    expectedResponse: {
      subcommand: "queue",
      configuration: {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/fmt.sh"'],
        gitlab: { job: { tags: ["linux-docker"], variables: {} } },
        optionalCommandArgs: true,
      },
      variables: {},
      command: '"$PIPELINE_SCRIPTS_DIR/fmt.sh" 1',
    },
  },
  {
    suitName: "fmt, no args should be allowed and return config",
    commandLine: "/cmd queue -c fmt",
    // expectedResponse: new Error(`Could not find start of command (" $ ")`),
    expectedResponse: {
      subcommand: "queue",
      configuration: {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/fmt.sh"'],
        gitlab: { job: { tags: ["linux-docker"], variables: {} } },
        optionalCommandArgs: true,
      },
      variables: {},
      command: '"$PIPELINE_SCRIPTS_DIR/fmt.sh"',
    },
  },
  {
    suitName: "bench-bot, no args when not allowed, should return error",
    commandLine: "/cmd queue -c bench-bot",
    expectedResponse: new Error(`Could not find start of command (" $ ")`),
  },
  {
    suitName: "no subcommand",
    commandLine: "/cmd queue",
    expectedResponse: new Error(`Configuration ("-c" or "--configuration") should be specified exactly once`),
  },
  { suitName: "cancel no-taskId", commandLine: "/cmd cancel", expectedResponse: { subcommand: "cancel", taskId: "" } },
  {
    suitName: "cancel with taskId",
    commandLine: "/cmd cancel 123123",
    expectedResponse: { subcommand: "cancel", taskId: "123123" },
  },
  {
    suitName: "nonexistent command, should return proper error",
    commandLine: "/cmd nope 123123",
    expectedResponse: new Error('Invalid subcommand "nope" in line /cmd nope 123123.'),
  },
  {
    suitName: "not provided command, returns proper error",
    commandLine: "/cmd $",
    expectedResponse: new Error("Must provide a subcommand in line /cmd $."),
  },
  {
    suitName: "non existed config must return error with explanation",
    commandLine: "/cmd queue -c xz",
    expectedResponse: new Error(
      `Could not find matching configuration xz; available ones are try-runtime, fmt, bench-bot, test-bench-bot, sample.`,
    ),
  },
]

afterEach(() => {
  jest.useRealTimers()
})

describe("parsePullRequestBotCommandLine", () => {
  jest.useFakeTimers({ legacyFakeTimers: true })
  for (const { suitName, commandLine, expectedResponse } of dataProvider) {
    test(`test commandLine: ${commandLine} [${suitName}]`, async () => {
      const res = await parsePullRequestBotCommandLine(commandLine)
      expect(res).toEqual(expectedResponse)
    })
  }
})
