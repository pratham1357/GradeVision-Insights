import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { useAuth } from "../lib/auth-context";
import { Wordmark } from "./Logo";
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
  const location = useLocation();
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5">
          <nav aria-label="Primary" className="flex items-center gap-3 text-sm">
            <Link to={homeHref} className="rounded-md" aria-label="GradeVision Insights home">
              <Wordmark subtle />
            </Link>
            {areaLabel ? (
              <span className="rounded-full border border-brand-100 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                {areaLabel}
              </span>
            ) : null}
          </nav>
          <div className="flex items-center gap-3 text-sm text-neutral-600">
            {user ? (
              <span className="hidden sm:inline" aria-label="Signed in as">
                {user.name}
              </span>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      {/* Keyed by route: a short fade-in on navigation (disabled by reduced motion). */}
      <main
        id="main"
        tabIndex={-1}
        key={location.pathname}
        className="mx-auto max-w-5xl animate-enter px-4 py-6 outline-none"
      >
        {children}
      </main>
    </div>
  );
}
