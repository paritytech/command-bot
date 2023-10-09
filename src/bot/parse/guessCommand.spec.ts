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
    suitName: "cumulus assets westend",
    command: "bench $ pallet asset-hub-westend assets pallet_xz",
    repo: "polkadot-sdk",
    result: "bot bench cumulus-assets --pallet=pallet_xz",
  },
  {
    suitName: "cumulus assets will end up with default as kusama no longer in repo",
    command: "bench $ pallet asset-hub-kusama assets pallet_xz",
    repo: "polkadot-sdk",
    result: "bot bench cumulus-assets --pallet=pallet_name",
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
  { suitName: "polkadot all", command: "bench-all $ rococo", repo: "polkadot", result: "bot bench-all polkadot" },
  {
    suitName: "cumulus bridge-hubs default",
    command: "bench $ xcm bridge-hub-rococo bridge-hubs pallet_name",
    repo: "cumulus",
    result: "bot bench cumulus-bridge-hubs --subcommand=xcm --pallet=pallet_name",
  },
  { suitName: "try-runtime default", command: "try-runtime $ westend", repo: "polkadot", result: "bot try-runtime" },
];

describe("guessCommand", () => {
  for (const { suitName, result, command, repo } of dataProvider) {
    test(`test: [${suitName}]: "bot ${command}"`, async () => {
      expect(await guessCommand({ logger }, command, repo)).toEqual(result);
    });
  }
});
