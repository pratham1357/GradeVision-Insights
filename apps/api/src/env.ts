import { config } from "dotenv";

// Load repository-root .env (if present). Real values are never committed.
config();

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  host: process.env.API_HOST ?? "0.0.0.0",
  port: toNumber(process.env.API_PORT, 4000),
  corsOrigin: (process.env.API_CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
} as const;
