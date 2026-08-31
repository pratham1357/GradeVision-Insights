import { env } from "../env.js";

type Level = "error" | "warn" | "info" | "http" | "debug";

const LEVEL_ORDER: Record<Level, number> = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const threshold = env.isProduction ? LEVEL_ORDER.info : LEVEL_ORDER.debug;

function emit(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] > threshold) return;

  const timestamp = new Date().toISOString();
  const write = level === "error" || level === "warn" ? console.error : console.log;

  if (env.isProduction) {
    write(JSON.stringify({ timestamp, level, message, ...meta }));
  } else {
    const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    write(`${timestamp} ${level.toUpperCase().padEnd(5)} ${message}${suffix}`);
  }
}

/** Minimal leveled logger. Structured JSON in production, readable lines in dev. */
export const logger = {
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  http: (message: string, meta?: Record<string, unknown>) => emit("http", message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => emit("debug", message, meta),
};
