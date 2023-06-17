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
  { suitName: "sample", command: "sample $ args", repo: "polkadot", result: "sample default --input=args" },
  {
    suitName: "cumulus assets",
    command: "bench $ pallet statemint assets pallet_assets",
    repo: "polkadot-sdk",
    result:
      "bench cumulus-assets --subcommand=pallet --runtime=statemint --kind=assets --dir=cumulus --pallet=pallet_assets",
  },
  {
    suitName: "polkadot runtime",
    command: "bench $ pallet dev pallet_contracts",
    repo: "polkadot-sdk",
    result: "bench substrate-pallet --subcommand=pallet --runtime=dev --dir=substrate --pallet=pallet_contracts",
  },
  {
    suitName: "substrate pallet",
    command: "bench $ runtime polkadot pallet_contracts",
    repo: "polkadot-sdk",
    result: "bench polkadot-pallet --subcommand=runtime --runtime=polkadot --dir=polkadot --pallet=pallet_contracts",
  },
  {
    suitName: "polkadot overhead",
    command: "bench $ overhead kusama-dev",
    repo: "polkadot-sdk",
    result: "bench polkadot-overhead --subcommand=overhead --runtime=kusama-dev --dir=polkadot",
  },
  {
    suitName: "polkadot all",
    command: "bench-all $ kusama",
    repo: "polkadot",
    result: "bench-all polkadot-all --runtime=kusama --dir=polkadot",
  },
  {
    suitName: "cumulus bridge-hubs",
    command: "bench $ xcm bridge-hub-kusama bridge-hubs pallet_name",
    repo: "cumulus",
    result:
      "bench cumulus-bridge-hubs --subcommand=xcm --runtime=bridge-hub-kusama --kind=bridge-hubs --dir=cumulus --pallet=pallet_name",
  },
  {
    suitName: "try-runtime default",
    command: "try-runtime $ westend",
    repo: "polkadot",
    result: "try-runtime default --network=westend",
  },
];

describe("guessCommand", () => {
  for (const { suitName, result, command, repo } of dataProvider) {
    test(`test: [${suitName}]: "bot ${command}"`, async () => {
      expect(await guessCommand({ logger }, command, repo)).toEqual(result);
    });
  }
});
