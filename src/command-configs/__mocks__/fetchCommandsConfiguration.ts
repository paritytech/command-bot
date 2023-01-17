import { jest } from "@jest/globals"

import { CommandConfigs } from "src/types"

export const cmd: CommandConfigs = {
  bench: {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description: "Runs `benchmark pallet` or `benchmark overhead` against your PR and commits back updated weights",
      configuration: {
        gitlab: { job: { tags: ["bench-bot"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/bench/bench.sh"'],
      },
      presets: {
        substrate: {
          description: "Pallet Benchmark for Substrate",
          repos: ["substrate"],
          args: {
            type: { label: "Type of bench", type_one_of: ["pallet"] },
            runtime: { label: "Runtime", type_one_of: ["dev"] },
            pallet: { label: "pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/" },
          },
        },
        polkadot: {
          description: "Pallet Benchmark for Polkadot",
          repos: ["polkadot"],
          args: {
            type: { label: "Type of bench", type_one_of: ["runtime", "xcm"] },
            runtime: {
              label: "Runtime",
              type_one_of: ["dev", "kusama-dev", "polkadot-dev", "rococo-dev", "westend-dev"],
            },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/" },
          },
        },
        "cumulus-assets": {
          description: "Pallet Benchmark for Cumulus [assets]",
          repos: ["cumulus"],
          args: {
            type: { label: "Type of bench", type_one_of: ["xcm", "pallet"] },
            runtime: { label: "Runtime", type_one_of: ["statemine", "statemint", "test-utils", "westmint"] },
            kind: { label: "Kind", type_one_of: ["asset"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/" },
          },
        },
        "cumulus-collectives": {
          description: "Pallet Benchmark for Cumulus [collectives]",
          repos: ["cumulus"],
          args: {
            type: { label: "Type of bench", type_one_of: ["xcm", "pallet"] },
            runtime: { label: "Runtime", type_one_of: ["collectives-polkadot"] },
            kind: { label: "Kind", type_one_of: ["collectives"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/" },
          },
        },
        "cumulus-contracts": {
          description: "Pallet Benchmark for Cumulus [contracts]",
          repos: ["cumulus"],
          args: {
            type: { label: "Type of bench", type_one_of: ["xcm", "pallet"] },
            runtime: { label: "Runtime", type_one_of: ["contracts-rococo"] },
            kind: { label: "Kind", type_one_of: ["contracts"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/" },
          },
        },
        "cumulus-starters": {
          description: "Pallet Benchmark for Cumulus [starters]",
          repos: ["cumulus"],
          args: {
            type: { label: "Type of bench", type_one_of: ["xcm", "pallet"] },
            runtime: { label: "Runtime", type_one_of: ["seedling", "shell"] },
            kind: { label: "Kind", type_one_of: ["starters"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/" },
          },
        },
        "cumulus-testing": {
          description: "Pallet Benchmark for Cumulus [testing]",
          repos: ["cumulus"],
          args: {
            type: { label: "Type of bench", type_one_of: ["xcm", "pallet"] },
            runtime: { label: "Runtime", type_one_of: ["penpal", "rococo-parachain"] },
            kind: { label: "Kind", type_one_of: ["testing"] },
            pallet: { label: "Pallet", type_rule: "/^([a-z_]+)([:]{2}[a-z_]+)?$/" },
          },
        },
        "substrate-overhead": {
          description: "Runs `benchmark overhead` and commits back to PR the updated `extrinsic_weights.rs` files",
          repos: ["substrate"],
          args: { type: { label: "Type of bench", type_one_of: ["overhead"] } },
        },
        "polkadot-overhead": {
          description: "Runs `benchmark overhead` and commits back to PR the updated `extrinsic_weights.rs` files",
          repos: ["polkadot"],
          args: {
            type: { label: "Type of bench", type_one_of: ["overhead"] },
            runtime: { label: "Runtime", type_one_of: ["kusama-dev", "polkadot-dev", "rococo-dev", "westend-dev"] },
          },
        },
        "cumulus-overhead": {
          description: "Runs `benchmark overhead` and commits back to PR the updated `extrinsic_weights.rs` files",
          repos: ["cumulus"],
          args: {
            type: { label: "Type of bench", type_one_of: ["overhead"] },
            kind: { label: "Kind", type_one_of: ["asset"] },
            runtime: { label: "Runtime", type_one_of: ["statemine", "statemint", "test-utils", "westmint"] },
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
        gitlab: { job: { tags: ["linux-docker"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/fmt/fmt.sh"'],
      },
    },
  },
  sample: {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      configuration: {
        gitlab: { job: { tags: ["kubernetes-parity-build"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/sample/sample.sh"'],
      },
      presets: {
        default: {
          description: "Outputs your echo string",
          repos: ["polkadot"],
          args: { input: { label: "Pass your echo string", type_rule: ".*" } },
        },
      },
    },
  },
  "try-runtime": {
    $schema: "../../node_modules/command-bot/src/schema/schema.cmd.json",
    command: {
      description:
        "Runs `cargo run --release --quiet --features=try-runtime try-runtime --chain=<CHAIN> --execution=Wasm --no-spec-check-panic on-runtime-upgrade live --uri=<URI>`",
      configuration: {
        gitlab: { job: { tags: ["linux-docker"], variables: {} } },
        commandStart: ['"$PIPELINE_SCRIPTS_DIR/commands/try-runtime/try-runtime.sh"'],
      },
      presets: {
        default: {
          description: "1",
          args: { chain: { label: "Chain", rule: "/^[a-z_-]+$/" }, uri: { label: "URI", rule: [".*"] } },
        },
      },
    },
  },
}

// eslint-disable-next-line @typescript-eslint/require-await
export const fetchCommandsConfiguration = jest.fn(async () => cmd)
