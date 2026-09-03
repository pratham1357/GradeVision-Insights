import type { UserRole } from "@gradevision/shared";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../lib/auth-context";
import { AppLayout } from "./AppLayout";
import { Alert, Spinner } from "./ui";

/**
 * Route guard. The API enforces the same rules independently - this only decides
 * what the UI renders. A wrong-role user gets a notice, never a blank page.
 */
function RequireRole({
  role,
  homeHref,
  areaLabel,
}: {
  role: UserRole;
  homeHref: string;
  areaLabel: string;
}) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "loading") return <Spinner label="Checking your session…" />;

  if (status === "anonymous" || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (user.role !== role) {
    return (
      <AppLayout homeHref="/" areaLabel="">
        <Alert kind="error">
          This area is for {role.toLowerCase()}s. Your account role is <strong>{user.role}</strong>.
        </Alert>
      </AppLayout>
    );
  }

  return (
    <AppLayout homeHref={homeHref} areaLabel={areaLabel}>
      <Outlet />
    </AppLayout>
  );
}

export function RequireInstructor() {
  return <RequireRole role="INSTRUCTOR" homeHref="/dashboard" areaLabel="Instructor" />;
}

export function RequireStudent() {
  return <RequireRole role="STUDENT" homeHref="/student" areaLabel="Student" />;
}
