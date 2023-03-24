import { CmdJson } from "src/schema/schema.cmd";

export type CommandConfigs = { [key: string]: CmdJson };

export type FetchCommandConfigsResult = { commandConfigs: CommandConfigs; docsPath: string };
