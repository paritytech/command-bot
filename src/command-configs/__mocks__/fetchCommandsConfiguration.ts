import { jest } from "@jest/globals";

import { CommandConfigs, FetchCommandConfigsResult } from "src/command-configs/types";

export const cmd: CommandConfigs = {
  "bench-all": {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description: "This is a wrapper to run `bench` for all pallets within BM4,5,6 runners",
      configuration: {
        gitlab: { job: { tags: ["weights"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/bench-all/bench-all.sh"'],
      },
      presets: {
        "substrate-all": {
          description: "Pallet + Overhead + Machine Benchmark for Substrate for all pallets",
          repos: ["substrate", "polkadot-sdk"],
          args: { dir: { label: "repo", type_string: "cumulus" } },
        },
        "polkadot-all": {
          description: "Pallet + Overhead Benchmark for Polkadot",
          repos: ["polkadot", "polkadot-sdk"],
          args: {
            runtime: { label: "Runtime", type_one_of: ["kusama", "polkadot", "rococo", "westend"] },
            dir: { label: "repo", type_string: "polkadot" },
          },
        },
        "cumulus-all": {
          description: "Pallet Benchmark for Cumulus",
          repos: ["cumulus", "polkadot-sdk"],
          args: { dir: { label: "repo", type_string: "cumulus" } },
        },
        "trappist-all": {
          description: "Pallet Benchmark for Trappist",
          repos: ["trappist"],
          args: { runtime: { label: "Runtime", type_one_of: ["trappist"] } },
        },
      },
    },
  },
  "bench-vm": {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description: "This is a testing for `bench` command running on VM machine",
      configuration: {
        gitlab: { job: { tags: ["weights-vm"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/bench-vm/bench-vm.sh"'],
      },
    },
  },
  bench: {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description: "Runs `benchmark pallet` or `benchmark overhead` against your PR and commits back updated weights",
      configuration: {
        gitlab: { job: { tags: ["bench-bot"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/bench/bench.sh"'],
      },
      presets: {
        "substrate-pallet": {
          description: "Pallet Benchmark for Substrate for specific pallet",
          repos: ["substrate", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet"] },
            runtime: { label: "Runtime", type_one_of: ["dev"] },
            pallet: { label: "pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/", example: "pallet_name" },
            dir: { label: "Target Directory", type_string: "substrate" },
          },
        },
        "polkadot-pallet": {
          description: "Pallet Benchmark for Polkadot for specific pallet",
          repos: ["polkadot", "command-bot-test", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["runtime", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["polkadot", "kusama", "rococo", "westend"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/", example: "pallet_name" },
            dir: { label: "Target Directory", type_string: "polkadot" },
          },
        },
        "cumulus-assets": {
          description: "Pallet Benchmark for Cumulus [assets]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["statemine", "statemint", "test-utils", "westmint"] },
            kind: { label: "Kind", type_one_of: ["assets"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/", example: "pallet_name" },
            dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "cumulus-collectives": {
          description: "Pallet Benchmark for Cumulus [collectives]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["collectives-polkadot"] },
            kind: { label: "Kind", type_one_of: ["collectives"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/", example: "pallet_name" },
            dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "cumulus-bridge-hubs": {
          description: "Pallet Benchmark for Cumulus [bridge-hubs]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet", "xcm"] },
            runtime: {
              label: "Runtime",
              type_one_of: ["bridge-hub-polkadot", "bridge-hub-kusama", "bridge-hub-rococo"],
            },
            kind: { label: "Kind", type_one_of: ["bridge-hubs"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/", example: "pallet_name" },
            dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "cumulus-contracts": {
          description: "Pallet Benchmark for Cumulus [contracts]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["contracts-rococo"] },
            kind: { label: "Kind", type_one_of: ["contracts"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/", example: "pallet_name" },
            dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "cumulus-glutton": {
          description: "Pallet Benchmark for Cumulus [glutton]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet"] },
            runtime: { label: "Runtime", type_one_of: ["glutton-kusama", "glutton-kusama-dev-1300"] },
            kind: { label: "Kind", type_one_of: ["glutton"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/", example: "pallet_name" },
            dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "cumulus-starters": {
          description: "Pallet Benchmark for Cumulus [starters]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["seedling", "shell"] },
            kind: { label: "Kind", type_one_of: ["starters"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/", example: "pallet_name" },
            dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "cumulus-testing": {
          description: "Pallet Benchmark for Cumulus [testing]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["penpal", "rococo-parachain"] },
            kind: { label: "Kind", type_one_of: ["testing"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/", example: "pallet_name" },
            dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "substrate-overhead": {
          description: "Runs `benchmark overhead` and commits back to PR the updated `extrinsic_weights.rs` files",
          repos: ["substrate", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["overhead"] },
            dir: { label: "Target Directory", type_string: "substrate" },
          },
        },
        "polkadot-overhead": {
          description: "Runs `benchmark overhead` and commits back to PR the updated `extrinsic_weights.rs` files",
          repos: ["polkadot", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["overhead"] },
            runtime: { label: "Runtime", type_one_of: ["kusama-dev", "polkadot-dev", "rococo-dev", "westend-dev"] },
            dir: { label: "Target Directory", type_string: "polkadot" },
          },
        },
        "cumulus-overhead": {
          description: "Runs `benchmark overhead` and commits back to PR the updated `extrinsic_weights.rs` files",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["overhead"] },
            kind: { label: "Kind", type_one_of: ["assets"] },
            runtime: { label: "Runtime", type_one_of: ["statemine", "statemint", "test-utils", "westmint"] },
            dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "trappist-pallet": {
          description: "Pallet Benchmark for Trappist for specific pallet",
          repos: ["trappist"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["runtime"] },
            runtime: { label: "Runtime", type_one_of: ["trappist"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/", example: "pallet_name" },
          },
        },
      },
    },
  },
  fmt: {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description: "RustFMT. Formatting Rust code according to style guidelines and commits to your PR.",
      configuration: {
        gitlab: { job: { tags: ["linux-docker-vm-c2"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/fmt/fmt.sh"'],
      },
    },
  },
  merge: {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description:
        "Merges current PR if this is merge-able. May include companion checks. Read more: https://github.com/paritytech/parity-processbot/",
      configuration: {
        gitlab: { job: { tags: [""] } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/merge/merge.sh"'],
      },
    },
  },
  rebase: {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description:
        "create a merge commit from the target branch into the PR. Read more: https://github.com/paritytech/parity-processbot/",
      configuration: {
        gitlab: { job: { tags: [""] } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/rebase/rebase.sh"'],
      },
    },
  },
  sample: {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      excluded: true,
      configuration: {
        gitlab: { job: { tags: ["kubernetes-parity-build"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/sample/sample.sh"'],
      },
      presets: {
        default: {
          description: "Outputs your echo string",
          repos: ["polkadot", "command-bot-test"],
          args: { input: { label: "Pass your echo string", type_rule: ".*", example: "bla" } },
        },
      },
    },
  },
  "try-runtime": {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description:
        "Runs `node-try-runtime try-runtime --runtime runtime-try-runtime.wasm -lruntime=debug on-runtime-upgrade live --uri wss://${NETWORK}-try-runtime-node.parity-chains.parity.io:443`",
      configuration: {
        gitlab: { job: { tags: ["linux-docker-vm-c2"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/try-runtime/try-runtime.sh"'],
      },
      presets: {
        default: {
          description: "Run try-runtime with specified network",
          repos: ["polkadot", "command-bot-test"],
          args: { network: { label: "Network", type_one_of: ["polkadot", "kusama", "westend", "rococo"] } },
        },
      },
    },
  },
};

// eslint-disable-next-line @typescript-eslint/require-await
export const fetchCommandsConfiguration = jest.fn<() => Promise<FetchCommandConfigsResult>>(async () => {
  return { commandConfigs: cmd, docsPath: "http://cmd-bot.docs.com/static/docs/latest.html" };
});
