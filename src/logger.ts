import { Logger, LoggerOptions } from "opstooling-js";

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
export const minLogLevel = ((): "info" | "warn" | "error" => {
  const value: string | undefined = process.env.MIN_LOG_LEVEL;
  switch (value) {
    case undefined: {
      return "info";
    }
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

export const logger = new Logger(loggerOptions);
