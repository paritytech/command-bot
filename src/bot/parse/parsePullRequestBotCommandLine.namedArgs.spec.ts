import { jest } from "@jest/globals";

import { CancelCommand, CleanCommand, GenericCommand, HelpCommand, ParsedCommand } from "src/bot/parse/ParsedCommand";
import { parsePullRequestBotCommandLine } from "src/bot/parse/parsePullRequestBotCommandLine";
import { SkipEvent } from "src/bot/types";
import { logger } from "src/logger";

jest.mock("src/command-configs/fetchCommandsConfiguration");
jest.mock("src/db");

logger.options.minLogLevel = "fatal";

type DataProvider = {
  suitName: string;
  commandLine: string;
  expectedResponse: SkipEvent | ParsedCommand | Error;
  repo?: string;
};

const dataProvider: DataProvider[] = [
  {
    suitName: "bench-bot",
    commandLine: "bot bench polkadot-pallet --pallet=pallet_referenda",
    expectedResponse: new GenericCommand(
      "bench",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/bench/bench.sh"'],
        gitlab: { job: { tags: ["weights-vm"], variables: {} } },
      },
      {},
      '"$PIPELINE_SCRIPTS_DIR/commands/bench/bench.sh" --subcommand=runtime --runtime=westend --target_dir=polkadot --pallet=pallet_referenda',
    ),
  },
  {
    suitName: "bench-bot cumulus",
    commandLine:
      "bot bench cumulus-bridge-hubs -v PIPELINE_SCRIPTS_REF=branch --subcommand=xcm --runtime=bridge-hub-rococo --pallet=pallet_name",
    expectedResponse: new GenericCommand(
      "bench",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/bench/bench.sh"'],
        gitlab: { job: { tags: ["weights-vm"], variables: {} } },
      },
      { PIPELINE_SCRIPTS_REF: "branch" },
      '"$PIPELINE_SCRIPTS_DIR/commands/bench/bench.sh" --subcommand=xcm --runtime=bridge-hub-rococo --runtime_dir=bridge-hubs --target_dir=cumulus --pallet=pallet_name',
    ),
    repo: "cumulus",
  },
  {
    suitName: "unrelated to bot comment returns nothing (ignores)",
    commandLine: "something from comments",
    expectedResponse: new SkipEvent("Not a command"),
  },
  {
    suitName: "try-runtime-bot testing default without mentioning preset name",
    commandLine: "bot try-runtime -v RUST_LOG=remote-ext=debug,runtime=trace -v SECOND=val --chain=rococo",
    expectedResponse: new GenericCommand(
      "try-runtime",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/try-runtime/try-runtime.sh"'],
        gitlab: { job: { tags: ["linux-docker-vm-c2"], variables: {} } },
      },
      { RUST_LOG: "remote-ext=debug,runtime=trace", SECOND: "val" },
      '"$PIPELINE_SCRIPTS_DIR/commands/try-runtime/try-runtime.sh" --chain=rococo --target_path=. --chain_node=polkadot',
    ),
  },
  {
    suitName: "try-runtime-bot testing default without any args",
    commandLine: "bot try-runtime",
    expectedResponse: new GenericCommand(
      "try-runtime",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/try-runtime/try-runtime.sh"'],
        gitlab: { job: { tags: ["linux-docker-vm-c2"], variables: {} } },
      },
      {},
      '"$PIPELINE_SCRIPTS_DIR/commands/try-runtime/try-runtime.sh" --chain=westend --target_path=. --chain_node=polkadot',
    ),
  },
  {
    suitName: "try-runtime-bot testing wrong presets",
    commandLine: "bot try-runtime unbelievable",
    expectedResponse: new Error(
      `Unknown subcommand of "try-runtime". Refer to [help docs](http://cmd-bot.docs.com/static/docs/latest.html) and/or [source code](https://github.com/paritytech/command-bot-scripts).`,
    ),
  },
  {
    suitName: "try-runtime-bot testing trappist",
    commandLine: "bot try-runtime trappist",
    expectedResponse: new GenericCommand(
      "try-runtime",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/try-runtime/try-runtime.sh"'],
        gitlab: { job: { tags: ["linux-docker-vm-c2"], variables: {} } },
      },
      {},
      '"$PIPELINE_SCRIPTS_DIR/commands/try-runtime/try-runtime.sh" --chain=trappist --chain_node=trappist-node --target_path=. --live_uri=rococo-trappist',
    ),
    repo: "trappist",
  },
  {
    suitName: "try-runtime-bot testing trappist with existing but unsupported preset [default]",
    commandLine: "bot try-runtime",
    expectedResponse: new Error(
      `Missing arguments for command "try-runtime". Refer to [help docs](http://cmd-bot.docs.com/static/docs/latest.html) and/or [source code](https://github.com/paritytech/command-bot-scripts).`,
    ),
    repo: "trappist",
  },
  {
    suitName: "try-runtime-bot testing trappist with existing but unsupported preset [polkadot]",
    commandLine: "bot try-runtime polkadot",
    expectedResponse: new Error(
      `Unknown subcommand of "try-runtime". Refer to [help docs](http://cmd-bot.docs.com/static/docs/latest.html) and/or [source code](https://github.com/paritytech/command-bot-scripts).`,
    ),
    repo: "trappist",
  },
  {
    suitName: "fmt, no args should be allowed and return config",
    commandLine: "bot fmt",
    expectedResponse: new GenericCommand(
      "fmt",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/fmt/fmt.sh"'],
        gitlab: { job: { tags: ["linux-docker-vm-c2"], variables: {} } },
      },
      {},
      '"$PIPELINE_SCRIPTS_DIR/commands/fmt/fmt.sh"',
    ),
  },
  {
    suitName: "fmt, no args should be allowed and return config",
    commandLine: "bot fmt -v RUST_LOG=remote-ext=debug,runtime=trace -v SECOND=val",
    expectedResponse: new GenericCommand(
      "fmt",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/fmt/fmt.sh"'],
        gitlab: { job: { tags: ["linux-docker-vm-c2"], variables: {} } },
      },
      { RUST_LOG: "remote-ext=debug,runtime=trace", SECOND: "val" },
      '"$PIPELINE_SCRIPTS_DIR/commands/fmt/fmt.sh"',
    ),
  },
  {
    suitName: "command, with dev branch and one variable should add properly",
    commandLine: "bot sample -v PIPELINE_SCRIPTS_REF=dev-branch -v SECOND=val --input=bla",
    expectedResponse: new GenericCommand(
      "sample",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/sample/sample.sh"'],
        gitlab: { job: { tags: ["kubernetes-parity-build"], variables: {} } },
      },
      { SECOND: "val", PIPELINE_SCRIPTS_REF: "dev-branch" },
      '"$PIPELINE_SCRIPTS_DIR/commands/sample/sample.sh" --input=bla',
    ),
  },
  {
    suitName: "command, with one variable should add properly",
    commandLine: "bot sample -v SECOND=val --input=bla",
    expectedResponse: new GenericCommand(
      "sample",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/sample/sample.sh"'],
        gitlab: { job: { tags: ["kubernetes-parity-build"], variables: {} } },
      },
      { SECOND: "val" },
      '"$PIPELINE_SCRIPTS_DIR/commands/sample/sample.sh" --input=bla',
    ),
  },
  {
    suitName: "command, with 'default' preset should add properly",
    commandLine: "bot sample --input=bla",
    expectedResponse: new GenericCommand(
      "sample",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/sample/sample.sh"'],
        gitlab: { job: { tags: ["kubernetes-parity-build"], variables: {} } },
      },
      {},
      '"$PIPELINE_SCRIPTS_DIR/commands/sample/sample.sh" --input=bla',
    ),
  },
  {
    suitName: "command, without 'default' preset should add properly",
    commandLine: "bot sample --input=bla",
    expectedResponse: new GenericCommand(
      "sample",
      {
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/sample/sample.sh"'],
        gitlab: { job: { tags: ["kubernetes-parity-build"], variables: {} } },
      },
      {},
      '"$PIPELINE_SCRIPTS_DIR/commands/sample/sample.sh" --input=bla',
    ),
  },

  /*
      Help cases
     */
  {
    suitName: "help",
    commandLine: "bot help",
    expectedResponse: new HelpCommand("http://cmd-bot.docs.com/static/docs/latest.html"),
  },
  {
    suitName: "help",
    commandLine: "bot help -v PIPELINE_SCRIPTS_REF=help-branch",
    expectedResponse: new HelpCommand("http://cmd-bot.docs.com/static/docs/latest.html"),
  },
  { suitName: "clean", commandLine: "bot clean", expectedResponse: new CleanCommand() },
  { suitName: "clear", commandLine: "bot clear", expectedResponse: new CleanCommand() },

  /*
      Cancel cases
     */
  { suitName: "cancel no-taskId", commandLine: "bot cancel", expectedResponse: new CancelCommand("") },
  { suitName: "cancel with taskId", commandLine: "bot cancel 123123", expectedResponse: new CancelCommand("123123") },

  /*
       Ignore cases
  */
  {
    suitName: "empty command line returns nothing (ignores)",
    commandLine: "",
    expectedResponse: new SkipEvent("Not a command"),
  },
  { suitName: "no subcommand - ignore", commandLine: "bot ", expectedResponse: new SkipEvent("Not a command") },
  {
    suitName: "ignored command merge",
    commandLine: "bot merge",
    expectedResponse: new Error(
      `\`bot merge\` and \`bot rebase\` are not supported anymore. Please use native Github "Auto-Merge" and "Update Branch" buttons instead. \n![image](https://github.com/paritytech/polkadot-sdk/assets/1177472/e0883113-9440-4517-9d42-d4255573a2be)`,
    ),
  },
  {
    suitName: "ignored command merge force",
    commandLine: "bot merge force",
    expectedResponse: new Error(
      `\`bot merge\` and \`bot rebase\` are not supported anymore. Please use native Github "Auto-Merge" and "Update Branch" buttons instead. \n![image](https://github.com/paritytech/polkadot-sdk/assets/1177472/e0883113-9440-4517-9d42-d4255573a2be)`,
    ),
  },
  {
    suitName: "ignored command rebase",
    commandLine: "bot rebase",
    expectedResponse: new Error(
      `\`bot merge\` and \`bot rebase\` are not supported anymore. Please use native Github "Auto-Merge" and "Update Branch" buttons instead. \n![image](https://github.com/paritytech/polkadot-sdk/assets/1177472/e0883113-9440-4517-9d42-d4255573a2be)`,
    ),
  },

  /*
      Expected Error cases
     */
  {
    suitName: "bench-bot --pallet should validate the matching rule",
    commandLine: "bot bench polkadot-pallet --pallet=00034",
    expectedResponse: new Error(
      "option '--pallet <value>' argument '00034' is invalid. argument pallet is not matching rule ^([a-z_]+)([:]{2}[a-z_]+)?$",
    ),
  },
  {
    suitName: "bench-bot, no args when not allowed, should return error",
    commandLine: "bot bench",
    expectedResponse: new Error(
      `Missing arguments for command "bench". Refer to [help docs](http://cmd-bot.docs.com/static/docs/latest.html) and/or [source code](https://github.com/paritytech/command-bot-scripts).`,
    ),
  },
  {
    suitName: "bench-bot, no required args, should return error",
    commandLine: "bot bench cumulus-bridge-hubs",
    expectedResponse: new Error(`required option '--pallet <value>' not specified`),
    repo: "cumulus",
  },
  {
    suitName: "sample without required arg should return error",
    commandLine: "bot sample",
    expectedResponse: new Error("required option '--input <value>' not specified"),
  },
  {
    suitName: "check wrong set -v, validation should trigger error",
    commandLine: "bot bench -v SOME_VAR runtime ",
    expectedResponse: new Error(
      `option '-v, --variable [value]' argument 'SOME_VAR' is invalid. SOME_VAR is not in KEY=value format`,
    ),
  },
  {
    suitName: "nonexistent command, should return proper error",
    commandLine: "bot nope 123123",
    expectedResponse: new Error(
      'Unknown command "nope". Refer to [help docs](http://cmd-bot.docs.com/static/docs/latest.html) and/or [source code](https://github.com/paritytech/command-bot-scripts).',
    ),
  },
  {
    suitName: "not provided command, returns proper error",
    commandLine: "bot $",
    expectedResponse: new Error(
      'Unknown command "$". Refer to [help docs](http://cmd-bot.docs.com/static/docs/latest.html) and/or [source code](https://github.com/paritytech/command-bot-scripts).',
    ),
  },
  {
    suitName: "non existed config must return error with explanation",
    commandLine: "bot xz",
    expectedResponse: new Error(
      `Unknown command "xz". Refer to [help docs](http://cmd-bot.docs.com/static/docs/latest.html) and/or [source code](https://github.com/paritytech/command-bot-scripts).`,
    ),
  },
  {
    suitName: "non existed config must return error with explanation",
    commandLine: "bot bench $ pallet dev some_pallet",
    expectedResponse: new Error(
      `Positional arguments are not supported anymore. I guess you meant \`bot bench polkadot-pallet --pallet=pallet_name\`, but I could be wrong.\n[Read docs](http://cmd-bot.docs.com/static/docs/latest.html) to find out how to run your command.`,
    ),
  },
  {
    suitName: "non existed config must return error with explanation",
    commandLine: "bot bench-overhead $ rococo",
    expectedResponse: new Error(
      `Positional arguments are not supported anymore. I guess you meant \`bot bench-overhead --runtime=rococo\`, but I could be wrong.\n[Read docs](http://cmd-bot.docs.com/static/docs/latest.html) to find out how to run your command.`,
    ),
  },
];

describe("parsePullRequestBotCommandLine", () => {
  for (const { suitName, commandLine, expectedResponse, repo } of dataProvider) {
    test(`test commandLine: "${commandLine}" [${suitName}] ${repo ? "repo: [" + repo + "]" : ""}`, async () => {
      const res = await parsePullRequestBotCommandLine(commandLine, { logger }, repo || "polkadot");
      expect(res).toEqual(expectedResponse);
    });
  }
});
