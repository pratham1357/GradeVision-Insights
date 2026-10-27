import type { AdminSection, AdminUser, AuditEntry, UserRole } from "@gradevision/shared";

import { apiRequest } from "./api-client";

export interface CreateUserInput {
  email: string;
  name: string;
  role: UserRole;
  password: string;
  sectionId?: string;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

/** ADMIN-only account management (`/api/v1/admin/*`). The server enforces every rule. */
export const adminApi = {
  listUsers: (filter: { search?: string; role?: UserRole | "" }) => {
    const params = new URLSearchParams();
    if (filter.search?.trim()) params.set("search", filter.search.trim());
    if (filter.role) params.set("role", filter.role);
    const query = params.toString();
    return apiRequest<AdminUser[]>(`/admin/users${query ? `?${query}` : ""}`);
  },
  createUser: (body: CreateUserInput) =>
    apiRequest<AdminUser>("/admin/users", { method: "POST", ...json(body) }),
  updateUser: (userId: string, body: { name?: string; role?: UserRole; isActive?: boolean }) =>
    apiRequest<AdminUser>(`/admin/users/${userId}`, { method: "PATCH", ...json(body) }),
  setPassword: (userId: string, password: string) =>
    apiRequest<AdminUser>(`/admin/users/${userId}/password`, {
      method: "POST",
      ...json({ password }),
    }),
  listSections: () => apiRequest<AdminSection[]>("/admin/sections"),
  listAudit: () => apiRequest<AuditEntry[]>("/admin/audit"),
};
