import { env } from "./env.js";

type Level = "error" | "warn" | "info" | "debug";
const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = env.NODE_ENV === "production" ? ORDER.info : ORDER.debug;

function emit(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (env.isTest && !process.env.TEST_LOG) return;
  if (ORDER[level] > threshold) return;
  const line = { ts: new Date().toISOString(), svc: "hint-engine", level, message, ...meta };
  const write = level === "error" || level === "warn" ? console.error : console.log;
  write(
    env.NODE_ENV === "production"
      ? JSON.stringify(line)
      : `${line.ts} ${level.toUpperCase()} ${message}`,
  );
}

export const logger = {
  error: (m: string, meta?: Record<string, unknown>) => emit("error", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit("warn", m, meta),
  info: (m: string, meta?: Record<string, unknown>) => emit("info", m, meta),
  debug: (m: string, meta?: Record<string, unknown>) => emit("debug", m, meta),
};
