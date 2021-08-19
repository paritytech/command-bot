import { GetCommandOptions } from "./types"

export const botMentionPrefix = "/try-runtime"

export const defaultTryRuntimeGetCommandOptions: GetCommandOptions = {
  baseEnv: { RUST_LOG: "remote-ext=info" },
}
