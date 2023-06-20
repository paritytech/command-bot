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
  { suitName: "sample", command: "sample $ args", repo: "polkadot", result: "bot sample --input=args" },
  {
    suitName: "sample in wrong repo",
    command: "sample $ args",
    repo: "polkadot-sdk",
    result: "bot sample --input=args",
  },
  {
    suitName: "cumulus assets",
    command: "bench $ pallet statemint assets pallet_assets",
    repo: "polkadot-sdk",
    result: "bot bench cumulus-assets --runtime=statemint --pallet=pallet_assets",
  },
  {
    suitName: "polkadot runtime",
    command: "bench $ pallet dev pallet_contracts",
    repo: "polkadot-sdk",
    result: "bot bench substrate-pallet --pallet=pallet_contracts",
  },
  {
    suitName: "substrate pallet",
    command: "bench $ runtime polkadot pallet_contracts",
    repo: "polkadot-sdk",
    result: "bot bench polkadot-pallet --pallet=pallet_contracts",
  },
  {
    suitName: "polkadot overhead",
    command: "bench $ overhead kusama-dev",
    repo: "polkadot-sdk",
    result: "bot bench polkadot-overhead",
  },
  { suitName: "polkadot all", command: "bench-all $ kusama", repo: "polkadot", result: "bot bench-all polkadot-all" },
  {
    suitName: "cumulus bridge-hubs",
    command: "bench $ xcm bridge-hub-kusama bridge-hubs pallet_name",
    repo: "cumulus",
    result: "bot bench cumulus-bridge-hubs --subcommand=xcm --runtime=bridge-hub-kusama --pallet=pallet_name",
  },
  {
    suitName: "try-runtime default",
    command: "try-runtime $ westend",
    repo: "polkadot",
    result: "bot try-runtime --network=westend",
  },
];

describe("guessCommand", () => {
  for (const { suitName, result, command, repo } of dataProvider) {
    test(`test: [${suitName}]: "bot ${command}"`, async () => {
      expect(await guessCommand({ logger }, command, repo)).toEqual(result);
    });
  }
});
