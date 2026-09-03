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
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to={homeHref} className="text-sm font-semibold">
            {PLATFORM_NAME}
            <span className="ml-2 font-normal text-neutral-400">{areaLabel}</span>
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
