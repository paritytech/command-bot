import { CmdJson } from "src/schema/schema.cmd";

interface IParseCommand {
  subcommand: string;
}

export abstract class ParsedCommand implements IParseCommand {
  protected constructor(public subcommand: string) {}
}

export class CancelCommand extends ParsedCommand {
  constructor(public taskId: string) {
    super("cancel");
  }
}

export class CleanCommand extends ParsedCommand {
  constructor(public all: boolean = false) {
    super("clean");
  }
}

export class HelpCommand extends ParsedCommand {
  constructor(public docsPath: string) {
    super("help");
  }
}

export class GenericCommand extends ParsedCommand {
  constructor(
    subcommand: string,
    public configuration: Pick<CmdJson["command"]["configuration"], "gitlab" | "commandStart"> & {
      optionalCommandArgs?: boolean;
    },
    public variables: {
      [k: string]: unknown;
    },
    public command: string,
  ) {
    super(subcommand);
  }
}
