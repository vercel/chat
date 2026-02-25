/**
 * Logger types and implementations for chat-sdk
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
  /** Create a sub-logger with a prefix */
  child(prefix: string): Logger;
  debug(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
}

/**
 * Default console logger implementation.
 */
export class ConsoleLogger implements Logger {
  private readonly prefix: string;

  private readonly level: LogLevel;

  constructor(level: LogLevel = "info", prefix = "chat-sdk") {
    this.level = level;
    this.prefix = prefix;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error", "silent"];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  child(prefix: string): Logger {
    return new ConsoleLogger(this.level, `${this.prefix}:${prefix}`);
  }

  // eslint-disable-next-line no-console
  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog("debug")) {
      console.debug(`[${this.prefix}] ${message}`, ...args);
    }
  }

  // eslint-disable-next-line no-console
  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog("info")) {
      console.info(`[${this.prefix}] ${message}`, ...args);
    }
  }

  // eslint-disable-next-line no-console
  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog("warn")) {
      console.warn(`[${this.prefix}] ${message}`, ...args);
    }
  }

  // eslint-disable-next-line no-console
  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog("error")) {
      console.error(`[${this.prefix}] ${message}`, ...args);
    }
  }
}
