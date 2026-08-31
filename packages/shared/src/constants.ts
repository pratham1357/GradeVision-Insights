/** Canonical name of the platform. */
export const PLATFORM_NAME = "GradeVision Insights";

/** Shape of the payload returned by every service's health endpoint. */
export interface HealthStatus {
  service: string;
  status: "ok";
  timestamp: string;
}

/** Build a standard health-check payload for a service. */
export function healthStatus(service: string): HealthStatus {
  return { service, status: "ok", timestamp: new Date().toISOString() };
}
