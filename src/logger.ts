export class Logger {
  constructor(public options: { name: string }) {}

  private logToConsole(level: "fatal" | "info", item: any, context?: string) {
    switch (process.env.LOG_FORMAT) {
      case "json": {
        const base = { level, name: this.options.name, context }

        // This structure is aligned with Probot's pino output format for JSON
        const logEntry: {
          level: string
          name: string
          msg: string
          stack?: string
          context?: string
        } = (function () {
          if (item instanceof Error) {
            return { ...base, stack: item.stack, msg: item.toString() }
          } else {
            return { ...base, msg: item }
          }
        })()

        console.log(JSON.stringify(logEntry))
        break
      }
      default: {
        const tag = `${level.toUpperCase()} (${this.options.name}):`
        const fn = item instanceof Error ? console.error : console.log
        if (context) {
          fn(tag, `${context}\n`, item)
        } else {
          fn(tag, item)
        }
        break
      }
    }
  }

  info(msg: any, context?: string) {
    return this.logToConsole("info", msg, context)
  }

  fatal(err: any, context?: string) {
    return this.logToConsole("fatal", err, context)
  }
}
