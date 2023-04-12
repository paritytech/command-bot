import { Logger, LoggerOptions } from "@eng-automation/js";
import { Logger as ProbotLogger } from "pino";
import { getLog } from "probot/lib/helpers/get-log";

import { Context } from "src/types";

export const logFormat = ((): "json" | null => {
  const value = process.env.LOG_FORMAT;
  switch (value) {
    case "json": {
      return value;
    }
    case undefined: {
      return null;
    }
    default: {
      throw new Error(`Invalid $LOG_FORMAT: ${value}`);
    }
  }
})();

export const minLogLevel = ((): "debug" | "info" | "warn" | "error" => {
  const value: string | undefined = process.env.MIN_LOG_LEVEL;
  switch (value) {
    case undefined: {
      return "info";
    }
    case "debug":
    case "info":
    case "warn":
    case "error": {
      return value;
    }
    default: {
      throw new Error(`Invalid $MIN_LOG_LEVEL: ${value}`);
    }
  }
})();

const loggerOptions: LoggerOptions = { name: "command-bot", minLogLevel, logFormat, impl: console };

export type LoggerContext = Pick<Context, "logger">;
export const logger = new Logger(loggerOptions);

export let probotLogger: ProbotLogger | undefined = undefined;
switch (logFormat) {
  case "json": {
    probotLogger = getLog({ level: "error", logFormat: "json", logLevelInString: true, logMessageKey: "msg" });
    break;
  }
  case null: {
    break;
  }
  default: {
    const exhaustivenessCheck: never = logFormat;
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    throw new Error(`Not exhaustive: ${exhaustivenessCheck}`);
  }
}
