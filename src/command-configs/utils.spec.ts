import { CommandConfigs } from "src/command-configs/types";
import { getSupportedRepoNames } from "src/command-configs/utils";
import { CmdJson } from "src/schema/schema.cmd";

type DataProvider = {
  suitName: string;
  configs: CommandConfigs;
  result: { repos: string[]; includesGenericPresets: boolean };
  presetName?: string;
};

function stubPresets(presets?: CmdJson["command"]["presets"]): CommandConfigs {
  return {
    cmd: {
      command: { configuration: { gitlab: { job: { tags: [""] } } }, presets: presets ? { ...presets } : undefined },
    },
  };
}

const dataProvider: DataProvider[] = [
  {
    suitName: "test common preset without repos",
    configs: stubPresets({ common: { description: "common", args: { arg1: { label: "1" } } } }),
    result: { repos: [], includesGenericPresets: true },
  },
  {
    suitName: "test repo specific preset with polkadot repo, no common presets",
    configs: stubPresets({
      repoSpecific: { repos: ["polkadot"], description: "polkadot", args: { arg1: { label: "1" } } },
    }),
    result: { repos: ["polkadot"], includesGenericPresets: false },
  },
  {
    suitName: "test repo with both specific preset with polkadot repo and common one",
    configs: stubPresets({
      common: { description: "common", args: { arg1: { label: "1" } } },
      repoSpecific: { repos: ["polkadot"], description: "1" },
    }),
    result: { repos: ["polkadot"], includesGenericPresets: true },
  },
  {
    suitName: "test command without presets",
    configs: stubPresets(),
    result: { repos: [], includesGenericPresets: true },
  },
];

describe("getSupportedRepoNames", () => {
  for (const { suitName, configs, result, presetName } of dataProvider) {
    test(`test commandLine: [${suitName}]`, () => {
      expect(getSupportedRepoNames(configs, presetName)).toEqual(result);
    });
  }
});
