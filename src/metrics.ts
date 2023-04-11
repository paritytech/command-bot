import client from "prom-client";

// There are duplicated string literals here, but they aren't related to each other and aren't magic strings
/* eslint-disable sonarjs/no-duplicate-string */
export type CommandRunLabels = {
  eventName: string;
  repo: string;
  pr: string;
  type: CommandRunType;
  body?: string;
};
export type CommandRunType = "ok" | "warn" | "skip" | "error" | "fatal";

export const counters: {
  commandsRun: client.Counter;
} = {
  commandsRun: new client.Counter({
    name: "command_bot_commands_handled_total",
    help: "Amount of all commands run.",
    labelNames: ["eventName", "repo", "pr", "type", "body"] as const,
  }),
};

export const summaries: { commandHandlingDuration: client.Summary } = {
  commandHandlingDuration: new client.Summary({
    name: "command_bot_command_handling_seconds",
    help: "Timings of handling commands",
    percentiles: [0.25, 0.5, 0.75, 0.85, 0.9],
    labelNames: ["eventName", "repo", "pr"] as const,
  }),
};

client.collectDefaultMetrics({ prefix: "command_bot_" });
