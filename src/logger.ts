type LoggingLevel = "debug" | "info" | "error" | "fatal"
export class Logger {
  constructor(
    public options: { name: string; context?: Record<string, any> },
  ) {}

  child(context: Record<string, any>) {
    return new Logger({
      ...this.options,
      context: { ...this.options.context, ...context },
    })
  }

  private log(level: LoggingLevel, item: any, context?: string) {
    switch (process.env.LOG_FORMAT) {
      case "json": {
        const base = {
          level,
          name: this.options.name,
          context:
            this.options.context === undefined
              ? context
              : { ...this.options.context, context },
        }

        // This structure is aligned with Probot's pino output format for JSON
        const logEntry: {
          level: string
          name: string
          msg: string
          stack?: string
          context?: any
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

  private loggerCallback(level: LoggingLevel) {
    return (msg: any, context?: string) => {
      return this.log(level, msg, context)
    }
  }
  info = this.loggerCallback("info")
  error = this.loggerCallback("error")
  fatal = this.loggerCallback("fatal")
  debug = this.loggerCallback("debug")
}
