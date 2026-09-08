import { PLATFORM_NAME } from "@gradevision/shared";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../lib/auth-context";
import { Button } from "./ui";

/** Shared chrome for the authenticated areas (instructor + student). */
export function AppLayout({
  homeHref,
  areaLabel,
  children,
}: {
  homeHref: string;
  areaLabel: string;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5">
          <Link to={homeHref} className="flex items-baseline gap-2 text-sm font-semibold">
            {PLATFORM_NAME}
            {areaLabel ? (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-500">
                {areaLabel}
              </span>
            ) : null}
          </Link>
          <div className="flex items-center gap-3 text-sm text-neutral-600">
            {user ? <span className="hidden sm:inline">{user.name}</span> : null}
            <Button size="sm" variant="secondary" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
