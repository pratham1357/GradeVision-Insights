import { pingDatabase } from "../../services/database.js";

export interface HealthReport {
  service: "api";
  status: "ok" | "degraded";
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    database: { status: "up" | "down"; latencyMs?: number };
  };
}

/**
 * Builds the health report, including a lightweight DB connectivity check.
 * Redis / evaluator / hint-engine checks are added when those integrations exist.
 */
export async function getHealthReport(): Promise<HealthReport> {
  const db = await pingDatabase();

  return {
    service: "api",
    status: db.ok ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      database: db.ok ? { status: "up", latencyMs: db.latencyMs } : { status: "down" },
    },
  };
}
