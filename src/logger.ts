export class Logger {
  constructor(public options: { name: string }) {}

  private logToConsole(
    level: "error" | "info",
    item: string | Error,
    context?: string,
  ) {
    switch (process.env.NODE_ENV) {
      case "prod": {
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
        if (item instanceof Error) {
          const tag = `ERROR (${this.options.name}):`
          if (context) {
            console.error(tag, context, item)
          } else {
            console.error(tag, item)
          }
        } else {
          console.log(`INFO (${this.options.name}):`, item)
        }
        break
      }
    }
  }

  info(msg: string) {
    return this.logToConsole("info", msg)
  }

  error(err: Error, context?: string) {
    return this.logToConsole("error", err, context)
  }
}
