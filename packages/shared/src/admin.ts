import type { UserRole } from "./auth.js";

/**
 * Admin account management (`/api/v1/admin/*`, ADMIN only). Separate from
 * system-health monitoring. Never carries password hashes.
 */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  /** Sections the user is enrolled in (students). */
  sections: { id: string; name: string; courseCode: string }[];
  /** Live (unexpired, unrevoked) sign-in sessions. */
  activeSessions: number;
}

export interface AdminSection {
  id: string;
  name: string;
  courseCode: string;
  courseName: string;
  instructorName: string | null;
}

/** One administrative or security-relevant event (`/admin/audit`). */
export interface AuditEntry {
  id: string;
  action: string;
  actorName: string | null;
  entityType: string | null;
  entityId: string | null;
  summary: string | null;
  createdAt: string;
}
