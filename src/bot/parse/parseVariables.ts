import yargs from "yargs";

import { LoggerContext } from "src/logger";
import { arrayify } from "src/utils";

export async function parseVariables(ctx: LoggerContext, str: string): Promise<Record<string, string> | Error> {
  const { logger } = ctx;
  const botArgs = await yargs(str.split(" ").filter((value) => !!value)).argv;
  logger.debug({ botArgs, botOptionsLinePart: str }, "Parsed bot arguments");

  const variables: Record<string, string> = {};
  const variableValueSeparator = "=";
  for (const tok of arrayify(botArgs.var).concat(arrayify(botArgs.v))) {
    switch (typeof tok) {
      case "string": {
        const valueSeparatorIndex = tok.indexOf(variableValueSeparator);
        if (valueSeparatorIndex === -1) {
          return new Error(`Variable token "${tok}" doesn't have a value separator ('${variableValueSeparator}')`);
        }
        variables[tok.slice(0, valueSeparatorIndex)] = tok.slice(valueSeparatorIndex + 1);
        break;
      }
      default: {
        return new Error(`Variable token "${String(tok)}" should be a string of the form NAME=VALUE`);
      }
    }
  }

  return variables;
}
