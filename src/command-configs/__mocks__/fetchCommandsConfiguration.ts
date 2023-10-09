import { jest } from "@jest/globals";

import { CommandConfigs, FetchCommandConfigsResult } from "src/command-configs/types";

export const cmd: CommandConfigs = {
  "bench-all": {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description: "This is a wrapper to run `bench` for all pallets within BM4,5,6 runners",
      configuration: {
        gitlab: { job: { tags: ["weights-vm"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/bench-all/bench-all.sh"'],
      },
      presets: {
        substrate: {
          description: "Pallet + Overhead + Machine Benchmark for Substrate for all pallets",
          repos: ["substrate", "polkadot-sdk"],
          args: { target_dir: { label: "Target Directory", type_string: "substrate" } },
        },
        polkadot: {
          description: "Pallet + Overhead Benchmark for Polkadot",
          repos: ["polkadot", "polkadot-sdk"],
          args: {
            runtime: { label: "Runtime", type_one_of: ["rococo", "westend"] },
            target_dir: { label: "Target Directory", type_string: "polkadot" },
          },
        },
        cumulus: {
          description: "Pallet Benchmark for Cumulus",
          repos: ["cumulus", "polkadot-sdk"],
          args: { target_dir: { label: "Target Directory", type_string: "cumulus" } },
        },
        trappist: {
          description: "Pallet Benchmark for Trappist",
          repos: ["trappist"],
          args: {
            runtime: { label: "Runtime", type_one_of: ["trappist", "stout"] },
            target_dir: { label: "Target Directory", type_string: "trappist" },
          },
        },
      },
    },
  },
  "bench-bm": {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description: "This is a testing for `bench` command running on legacy BM machines",
      configuration: {
        gitlab: { job: { tags: ["weights-vm"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/bench-bm/bench-bm.sh"'],
      },
    },
  },
  "bench-overhead": {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description: "Run benchmarks overhead and commit back results to PR",
      configuration: {
        gitlab: { job: { tags: ["weights-vm"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/bench-overhead/bench-overhead.sh"'],
      },
      presets: {
        default: {
          description: "Runs `benchmark overhead` and commits back to PR the updated `extrinsic_weights.rs` files",
          repos: ["polkadot", "polkadot-sdk"],
          args: {
            runtime: { label: "Runtime", type_one_of: ["westend", "rococo"] },
            target_dir: { label: "Target Directory", type_string: "polkadot" },
          },
        },
        substrate: {
          description: "Runs `benchmark overhead` and commits back to PR the updated `extrinsic_weights.rs` files",
          repos: ["substrate", "polkadot-sdk"],
          args: { target_dir: { label: "Target Directory", type_string: "substrate" } },
        },
        cumulus: {
          description: "Runs `benchmark overhead` and commits back to PR the updated `extrinsic_weights.rs` files",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            runtime: { label: "Runtime", type_one_of: ["asset-hub-westend"] },
            target_dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        trappist: {
          description: "Runs `benchmark overhead` and commits back to PR",
          repos: ["trappist"],
          args: { runtime: { label: "Runtime", type_one_of: ["trappist", "stout"] } },
        },
      },
    },
  },
  bench: {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description: "Runs `benchmark pallet` or `benchmark overhead` against your PR and commits back updated weights",
      configuration: {
        gitlab: { job: { tags: ["weights-vm"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/bench/bench.sh"'],
      },
      presets: {
        "substrate-pallet": {
          description: "Pallet Benchmark for Substrate for specific pallet",
          repos: ["substrate", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet"] },
            runtime: { label: "Runtime", type_one_of: ["dev"] },
            pallet: { label: "pallet", type_rule: "^([a-z_]+)([:]{2}[a-z_]+)?$", example: "pallet_name" },
            target_dir: { label: "Target Directory", type_string: "substrate" },
          },
        },
        "polkadot-pallet": {
          description: "Pallet Benchmark for Polkadot for specific pallet",
          repos: ["polkadot", "command-bot-test", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["runtime", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["westend", "rococo"] },
            pallet: { label: "Pallet", type_rule: "^([a-z_]+)([:]{2}[a-z_]+)?$", example: "pallet_name" },
            target_dir: { label: "Target Directory", type_string: "polkadot" },
          },
        },
        "cumulus-assets": {
          description: "Pallet Benchmark for Cumulus [assets]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["asset-hub-westend"] },
            pallet: { label: "Pallet", type_rule: "^([a-z_]+)([:]{2}[a-z_]+)?$", example: "pallet_name" },
            runtime_dir: { label: "Runtime Dir", type_string: "assets" },
            target_dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "cumulus-collectives": {
          description: "Pallet Benchmark for Cumulus [collectives]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["collectives-westend"] },
            pallet: { label: "Pallet", type_rule: "^([a-z_]+)([:]{2}[a-z_]+)?$", example: "pallet_name" },
            runtime_dir: { label: "Runtime Dir", type_string: "collectives" },
            target_dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "cumulus-bridge-hubs": {
          description: "Pallet Benchmark for Cumulus [bridge-hubs]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["bridge-hub-rococo"] },
            pallet: { label: "Pallet", type_rule: "^([a-z_]+)([:]{2}[a-z_]+)?$", example: "pallet_name" },
            runtime_dir: { label: "Runtime Dir", type_string: "bridge-hubs" },
            target_dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "cumulus-contracts": {
          description: "Pallet Benchmark for Cumulus [contracts]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["contracts-rococo"] },
            runtime_dir: { label: "Runtime Dir", type_string: "contracts" },
            pallet: { label: "Pallet", type_rule: "^([a-z_]+)([:]{2}[a-z_]+)?$", example: "pallet_name" },
            target_dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "cumulus-glutton": {
          description: "Pallet Benchmark for Cumulus [glutton]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet"] },
            runtime: { label: "Runtime", type_one_of: ["glutton-westend", "glutton-westend-dev-1300"] },
            pallet: { label: "Pallet", type_rule: "^([a-z_]+)([:]{2}[a-z_]+)?$", example: "pallet_name" },
            runtime_dir: { label: "Runtime Dir", type_string: "glutton" },
            target_dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "cumulus-starters": {
          description: "Pallet Benchmark for Cumulus [starters]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["seedling", "shell"] },
            pallet: { label: "Pallet", type_rule: "^([a-z_]+)([:]{2}[a-z_]+)?$", example: "pallet_name" },
            runtime_dir: { label: "Runtime Dir", type_string: "starters" },
            target_dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "cumulus-testing": {
          description: "Pallet Benchmark for Cumulus [testing]",
          repos: ["cumulus", "polkadot-sdk"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["pallet", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["penpal", "rococo-parachain"] },
            pallet: { label: "Pallet", type_rule: "^([a-z_]+)([:]{2}[a-z_]+)?$", example: "pallet_name" },
            runtime_dir: { label: "Runtime Dir", type_string: "testing" },
            target_dir: { label: "Target Directory", type_string: "cumulus" },
          },
        },
        "trappist-pallet": {
          description: "Pallet Benchmark for Trappist for specific pallet",
          repos: ["trappist"],
          args: {
            subcommand: { label: "Subcommand", type_one_of: ["runtime", "xcm"] },
            runtime: { label: "Runtime", type_one_of: ["trappist", "stout"] },
            pallet: { label: "Pallet", type_rule: "^([a-z_]+)([:]{2}[a-z_]+)?$", example: "pallet_name" },
            target_dir: { label: "Target Directory", type_string: "trappist" },
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
      presets: { default: { description: "merge PR", repos: ["substrate", "polkadot", "cumulus"] } },
    },
  },
  rebase: {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description:
        "create a merge commit from the target branch into the PR. Read more: https://github.com/paritytech/parity-processbot/",
      configuration: {
        gitlab: { job: { tags: [""], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/rebase/rebase.sh"'],
      },
      presets: { default: { description: "pull latest from the base", repos: ["substrate", "polkadot", "cumulus"] } },
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
          description: "Run try-runtime with specified runtime for Polkadot repo",
          repos: ["polkadot", "command-bot-test"],
          args: {
            chain: { label: "Chain", type_one_of: ["westend", "rococo"] },
            target_path: { label: "Target Path", type_string: "." },
            chain_node: { label: "Chain Node", type_string: "polkadot" },
          },
        },
        polkadot: {
          description: "Run try-runtime with specified runtime for monorepo Polkadot SDK",
          repos: ["polkadot-sdk"],
          args: {
            chain: { label: "Chain", type_one_of: ["westend", "rococo"] },
            target_path: { label: "Target Path", type_string: "./polkadot" },
            chain_node: { label: "Chain Node", type_string: "polkadot" },
          },
        },
        trappist: {
          description: "Run try-runtime for Trappist",
          repos: ["trappist"],
          args: {
            chain: { label: "Chain", type_one_of: ["trappist"] },
            chain_node: { label: "Chain Node", type_string: "trappist-node" },
            target_path: { label: "Target Path", type_string: "." },
            live_uri: { label: "Live Node URI ID", type_string: "rococo-trappist" },
          },
        },
      },
    },
  },
  "update-ui": {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description: "Update UI tests, e.g. after a rust toolchain upgrade, and commit them to your PR.",
      configuration: {
        gitlab: { job: { tags: ["linux-docker-vm-c2"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/update-ui/update-ui.sh"'],
      },
      presets: {
        default: {
          description: "Update substrate UI tests in Substrate Repo",
          repos: ["substrate"],
          args: {
            rust_version: { label: "Rust version", type_rule: "^[0-9.]+$", example: "1.70" },
            target_path: { label: "Target path", type_string: "." },
          },
        },
        substrate: {
          description: "Update substrate UI tests in Monorepo/substrate",
          repos: ["polkadot-sdk"],
          args: {
            rust_version: { label: "Rust version", type_rule: "^[0-9.]+$", example: "1.70" },
            target_path: { label: "Target path", type_string: "./substrate" },
          },
        },
      },
    },
  },
};

// eslint-disable-next-line @typescript-eslint/require-await
export const fetchCommandsConfiguration = jest.fn<() => Promise<FetchCommandConfigsResult>>(async () => {
  return { commandConfigs: cmd, docsPath: "http://cmd-bot.docs.com/static/docs/latest.html" };
});
