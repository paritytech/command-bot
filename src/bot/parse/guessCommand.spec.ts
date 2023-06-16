import { jest } from "@jest/globals";

import { guessCommand } from "src/bot/parse/guessCommand";
import { logger } from "src/logger";

jest.mock("src/command-configs/fetchCommandsConfiguration");

logger.options.minLogLevel = "fatal";

type DataProvider = {
  suitName: string;
  command: string;
  repo: string;
  result: string;
};

const dataProvider: DataProvider[] = [
  { suitName: "no args", command: "help", repo: "polkadot", result: "" },
  { suitName: "sample", command: "sample $ args", repo: "polkadot", result: "sample default --input=bla" },
  {
    suitName: "cumulus assets",
    command: "bench $ pallet statemint assets pallet_assets",
    repo: "polkadot-sdk",
    result: "bench cumulus-assets --subcommand=pallet --runtime=statemint --kind=assets --pallet=pallet_name",
  },
  {
    suitName: "polkadot pallet",
    command: "bench $ pallet polkadot pallet_name::some",
    repo: "polkadot-sdk",
    result: "bench polkadot-pallet --runtime=polkadot --pallet=pallet_name --dir=polkadot",
  },
  {
    suitName: "polkadot overhead",
    command: "bench $ overhead kusama-dev",
    repo: "polkadot-sdk",
    result: "bench polkadot-overhead --subcommand=overhead --runtime=kusama-dev",
  },
  {
    suitName: "cumulus bridge-hubs",
    command: "bench $ xcm bridge-hub-kusama bridge-hubs pallet_name",
    repo: "cumulus",
    result:
      "bench cumulus-bridge-hubs --subcommand=xcm --runtime=bridge-hub-kusama --kind=bridge-hubs --pallet=pallet_name",
  },
];

describe("guessCommand", () => {
  for (const { suitName, result, command, repo } of dataProvider) {
    test(`test: [${suitName}]: "bot ${command}"`, async () => {
      expect(await guessCommand({ logger }, command, repo)).toEqual(result);
    });
  }
});
