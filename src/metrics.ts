import client from "prom-client";

// There are duplicated string literals here, but they aren't related to each other and aren't magic strings
/* eslint-disable sonarjs/no-duplicate-string */

export const counters: {
  commandsHandledTotal: client.Counter;
  commandsFinished: client.Counter;
  commandsWarn: client.Counter;
  commandsError: client.Counter;
  commandsFatal: client.Counter;
  commandsSkip: client.Counter;
} = {
  commandsHandledTotal: new client.Counter({
    name: "command_bot_commands_handled_total",
    help: "Amount of all commands run.",
    labelNames: ["eventName", "owner", "repo", "pr"] as const,
  }),
  commandsFinished: new client.Counter({
    name: "command_bot_commands_recognized_finished_total",
    help: "Amount of recognized commands run. ",
    labelNames: ["owner", "repo", "pr", "command"] as const,
  }),
  commandsWarn: new client.Counter({
    name: "command_bot_commands_warn_total",
    help: "Amount of commands warn responses.",
    labelNames: ["owner", "repo", "pr", "command"] as const,
  }),
  commandsError: new client.Counter({
    name: "command_bot_commands_error_total",
    help: "Amount of commands error responses.",
    labelNames: ["message", "owner", "repo", "pr"] as const,
  }),
  commandsFatal: new client.Counter({
    name: "command_bot_commands_fatal_total",
    help: "Amount of commands fatal responses.",
    labelNames: ["message", "owner", "repo", "pr"] as const,
  }),
  commandsSkip: new client.Counter({
    name: "command_bot_commands_skip_total",
    help: "Amount of commands skip responses.",
    labelNames: ["reason", "owner", "repo", "pr"] as const,
  }),
};

export const summaries: { commandHandlingDuration: client.Summary } = {
  commandHandlingDuration: new client.Summary({
    name: "command_bot_command_handling_seconds",
    help: "Timings of handling commands",
    percentiles: [0.25, 0.5, 0.75, 0.85, 0.9],
    labelNames: ["eventName", "owner", "repo", "pr"] as const,
  }),
};

client.collectDefaultMetrics({ prefix: "command_bot_" });
