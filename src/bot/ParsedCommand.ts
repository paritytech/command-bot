import { CmdJson } from "src/schema/schema.cmd"

export class ParsedCommand {
  constructor(public subcommand: string) {}
}

export class CancelCommand extends ParsedCommand {
  constructor(public taskId: string) {
    super("cancel")
  }
}
export class GenericCommand extends ParsedCommand {
  constructor(
    public subcommand: string,
    public configuration: Pick<CmdJson["command"]["configuration"], "gitlab" | "commandStart"> & {
      optionalCommandArgs?: boolean
    },
    public variables: {
      [k: string]: unknown
    },
    public command: string,
  ) {
    super(subcommand)
  }
}
