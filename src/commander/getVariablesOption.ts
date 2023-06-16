import { ensureDefined } from "@eng-automation/js";
import { CommanderError, InvalidArgumentError, Option } from "commander";

export function getVariablesOption(): Option {
  return new Option("-v, --variable [value]", "set variable in KEY=value format").argParser(
    (value: string, collected: Record<string, string>) => {
      if (!value) throw new InvalidArgumentError("");

      const splitValue = value.split("=");

      if (!splitValue[1]) {
        throw new InvalidArgumentError(`${value} is not in KEY=value format`);
      }

      const varName = ensureDefined(splitValue.shift());
      const varValue = splitValue.join("=");

      if (typeof collected !== "undefined") {
        collected[varName] = varValue;
      } else {
        collected = { [varName]: varValue };
      }

      return collected;
    },
  );
}

export function variablesExitOverride(e: CommanderError): void {
  throw new Error(e.message.replace("error: ", ""));
}
