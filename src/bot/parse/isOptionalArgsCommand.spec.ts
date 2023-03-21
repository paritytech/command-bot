import { isOptionalArgsCommand } from "src/bot/parse/isOptionalArgsCommand";
import { CmdJson } from "src/schema/schema.cmd";

type DataProvider = {
  suitName: string;
  presets: CmdJson;
  isOptional: boolean;
};

function stubPresets(presets: CmdJson["command"]["presets"]): CmdJson {
  return { command: { configuration: { gitlab: { job: { tags: [""] } } }, presets: { ...presets } } };
}

const dataProvider: DataProvider[] = [
  { suitName: "test that command args are optional without presets", presets: stubPresets({}), isOptional: true },
  {
    suitName: "test that command args are required with presets and args",
    presets: stubPresets({ common: { description: "common", args: { arg1: { label: "1" } } } }),
    isOptional: false,
  },
  {
    suitName: "test that command args are optional with presets but no args",
    presets: stubPresets({ common: { description: "common" } }),
    isOptional: true,
  },
  {
    suitName: "test that command args are optional with polkadot repo presets but no args",
    presets: stubPresets({
      polkadot: { description: "polkadot", repos: ["polkadot"] },
      substrate: { description: "substrate", repos: ["substrate"], args: { arg1: { label: "1" } } },
    }),
    isOptional: true,
  },
  {
    suitName: "test that command args are required with polkadot repo presets and args",
    presets: stubPresets({
      polkadot: { description: "polkadot", repos: ["polkadot"], args: { arg1: { label: "1" } } },
      substrate: { description: "substrate", repos: ["substrate"], args: { arg1: { label: "1" } } },
    }),
    isOptional: false,
  },
  {
    suitName: "test that command args are required with different polkadot presets where all have args defined",
    presets: stubPresets({
      polkadot1: { description: "polkadot-1", repos: ["polkadot"], args: { arg1: { label: "1" } } },
      polkadot2: { description: "polkadot-2", repos: ["polkadot"], args: { arg1: { label: "1" } } },
      substrate: { description: "substrate", repos: ["substrate"], args: { arg1: { label: "1" } } },
    }),
    isOptional: false,
  },
  {
    suitName:
      "test that command args are optional with different polkadot presets where at least one has no args defined",
    presets: stubPresets({
      polkadot1: { description: "polkadot-1", repos: ["polkadot"] },
      polkadot2: { description: "polkadot-2", repos: ["polkadot"], args: { arg1: { label: "1" } } },
      substrate: { description: "substrate", repos: ["substrate"], args: { arg1: { label: "1" } } },
    }),
    isOptional: true,
  },
];

describe("isOptionalArgsPreset", () => {
  for (const { suitName, presets, isOptional } of dataProvider) {
    test(`test commandLine: [${suitName}]`, () => {
      expect(isOptionalArgsCommand(presets, "cmd", "polkadot")).toEqual(isOptional);
    });
  }

  test("test throws error if no presets found for repo", () => {
    expect(() =>
      isOptionalArgsCommand(
        stubPresets({ substrate: { description: "substrate", repos: ["substrate"], args: { arg1: { label: "1" } } } }),
        "cmd",
        "polkadot",
      ),
    ).toThrow('The command: "cmd" is not supported in **polkadot** repository');
  });
});
