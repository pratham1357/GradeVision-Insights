import { PLATFORM_NAME } from "@gradevision/shared";
import type { ReactNode } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../lib/auth-context";
import { Alert, Button, Spinner } from "./ui";

function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/dashboard" className="text-sm font-semibold">
            {PLATFORM_NAME}
            <span className="ml-2 font-normal text-neutral-400">Instructor</span>
          </Link>
          <div className="flex items-center gap-3 text-sm text-neutral-600">
            {user ? <span>{user.name}</span> : null}
            <Button variant="secondary" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}

/**
 * Route guard for the instructor area. The API independently enforces the same
 * rules - this only controls what the UI renders.
 */
export function RequireInstructor() {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "loading") return <Spinner label="Checking your session…" />;

  if (status === "anonymous" || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (user.role !== "INSTRUCTOR") {
    return (
      <Layout>
        <Alert kind="error">
          This area is for instructors. Your account role is <strong>{user.role}</strong>.
        </Alert>
      </Layout>
    );
  }

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
