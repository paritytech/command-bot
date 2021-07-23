export class Logger {
  constructor(public options: { name: string }) {}

  private logToConsole(
    level: "fatal" | "info",
    item: string | Error,
    context?: string,
  ) {
    switch (process.env.LOG_FORMAT) {
      case "json": {
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
        break
      }
      default: {
        const tag = `${level.toUpperCase()} (${this.options.name}):`
        const fn = item instanceof Error ? console.error : console.log
        if (context) {
          fn(tag, context, item)
        } else {
          fn(tag, item)
        }
        break
      }
    }
  }

  info(msg: string, context?: string) {
    return this.logToConsole("info", msg, context)
  }

  fatal(err: Error, context?: string) {
    return this.logToConsole("fatal", err, context)
  }
}
