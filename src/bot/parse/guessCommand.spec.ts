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
    suitName: "cumulus assets polkadot",
    command: "bench $ pallet asset-hub-polkadot assets pallet_xz",
    repo: "polkadot-sdk",
    result: "bot bench cumulus-assets --pallet=pallet_xz",
  },
  {
    suitName: "cumulus assets kusama",
    command: "bench $ pallet asset-hub-kusama assets pallet_xz",
    repo: "polkadot-sdk",
    result: "bot bench cumulus-assets --runtime=asset-hub-kusama --pallet=pallet_xz",
  },
  {
    suitName: "cumulus assets old kusama: will endup with default, as can't find `statemine`",
    command: "bench $ pallet statemine assets pallet_xz",
    repo: "polkadot-sdk",
    result: "bot bench cumulus-assets --pallet=pallet_name",
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
  { suitName: "polkadot all", command: "bench-all $ kusama", repo: "polkadot", result: "bot bench-all polkadot" },
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
    result: "bot try-runtime --chain=westend",
  },
  { suitName: "try-runtime default", command: "try-runtime $ polkadot", repo: "polkadot", result: "bot try-runtime" },
];

describe("guessCommand", () => {
  for (const { suitName, result, command, repo } of dataProvider) {
    test(`test: [${suitName}]: "bot ${command}"`, async () => {
      expect(await guessCommand({ logger }, command, repo)).toEqual(result);
    });
  }
});
