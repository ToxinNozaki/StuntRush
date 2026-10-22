export type LogLevel = "error" | "warn" | "info";

export interface LogEntry {
  time: number; // ms since epoch
  level: LogLevel;
  message: string;
  stack?: string;
  source?: string; // "window.onerror" | "unhandledrejection" | "console.error" | "console.warn" | "manual"
}

const STORAGE_KEY = "stuntrush_error_log_v1";
const MAX_ENTRIES = 300;

/**
 * Catches everything: uncaught exceptions, unhandled promise rejections, and
 * console.error/warn calls (ours and Babylon's own internal warnings), in one
 * capped, timestamped, localStorage-backed log. Point of this: when something
 * glitches three minutes ago and you only notice now, the log still has it.
 */
class ErrorLogger {
  private entries: LogEntry[] = [];
  private listeners: Array<(entry: LogEntry) => void> = [];

  constructor() {
    this.entries = this.loadFromStorage();

    window.addEventListener("error", (e) => {
      this.record({
        level: "error",
        message: e.message,
        stack: e.error?.stack,
        source: "window.onerror",
      });
    });

    window.addEventListener("unhandledrejection", (e) => {
      const reason = e.reason;
      this.record({
        level: "error",
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        source: "unhandledrejection",
      });
    });

    const originalError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      this.record({ level: "error", message: args.map(stringifyArg).join(" "), source: "console.error" });
      originalError(...args);
    };

    const originalWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      this.record({ level: "warn", message: args.map(stringifyArg).join(" "), source: "console.warn" });
      originalWarn(...args);
    };
  }

  record(partial: Omit<LogEntry, "time">) {
    const entry: LogEntry = { time: Date.now(), ...partial };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.saveToStorage();
    for (const listener of this.listeners) listener(entry);
  }

  onEntry(listener: (entry: LogEntry) => void) {
    this.listeners.push(listener);
  }

  getAll(): readonly LogEntry[] {
    return this.entries;
  }

  clear() {
    this.entries = [];
    this.saveToStorage();
  }

  exportAsText(): string {
    return this.entries
      .map((e) => {
        const t = new Date(e.time).toISOString();
        const head = `[${t}] ${e.level.toUpperCase()} (${e.source ?? "manual"}) ${e.message}`;
        return e.stack ? `${head}\n${e.stack}` : head;
      })
      .join("\n\n");
  }

  private loadFromStorage(): LogEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Storage full/unavailable: logging continues in-memory for this session only.
    }
  }
}

function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? arg.message;
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

export const errorLogger = new ErrorLogger();
