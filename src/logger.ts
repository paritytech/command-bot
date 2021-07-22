export class Logger {
  constructor(public options: { name: string }) {}

  private logToConsole(
    level: "error" | "info",
    item: string | Error,
    context?: string,
  ) {
    const base = { level, name: this.options.name, context }

    // This structure is aligned with Probot's pino format for JSON logging
    let logEntry: {
      level: string
      name: string
      msg: string
      stack?: string
      context?: string
    }
    if (item instanceof Error) {
      logEntry = { ...base, stack: item.stack, msg: item.toString() }
    } else {
      logEntry = { ...base, msg: item }
    }

    console.log(JSON.stringify(logEntry))
  }

  info(msg: string) {
    return this.logToConsole("info", msg)
  }

  error(err: Error, context?: string) {
    return this.logToConsole("error", err, context)
  }
}
