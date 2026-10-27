import type { UserRole } from "@gradevision/shared";

/** Landing page for each role. */
export function homeFor(role: UserRole): string {
  if (role === "INSTRUCTOR") return "/dashboard";
  if (role === "STUDENT") return "/student";
  return "/admin";
}

function areaOf(pathname: string): UserRole {
  if (pathname.startsWith("/student")) return "STUDENT";
  if (pathname.startsWith("/admin")) return "ADMIN";
  return "INSTRUCTOR";
}

/**
 * Where to go after signing in. A remembered page is only reused when it
 * belongs to the signed-in role's area - after one person signs out and
 * another signs in on the same browser, the second never lands on the first
 * person's page (which would only show a "wrong area" error).
 */
export function afterLoginPath(from: string | undefined, role: UserRole): string {
  if (!from || from === "/" || from.startsWith("/login")) return homeFor(role);
  return areaOf(from) === role ? from : homeFor(role);
}
