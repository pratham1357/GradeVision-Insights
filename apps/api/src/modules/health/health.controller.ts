import type { Request, Response } from "express";

import { getHealthReport } from "./health.service.js";

/**
 * `GET /api/v1/health` (and the legacy `/health`).
 *
 * Returns a flat body (no `data` envelope) so uptime probes and orchestrators
 * can consume it directly. 200 when healthy, 503 when a hard dependency is down.
 */
export async function getHealth(_req: Request, res: Response): Promise<void> {
  const report = await getHealthReport();
  res.status(report.status === "ok" ? 200 : 503).json(report);
}
