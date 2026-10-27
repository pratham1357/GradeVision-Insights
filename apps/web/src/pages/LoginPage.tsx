import { type FormEvent, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../lib/auth-context";
import { afterLoginPath } from "../lib/auth-redirect";
import { messageFromError } from "../lib/use-api";
import { LogoMark } from "../components/Logo";
import { Alert, Button, Field, Input } from "../components/ui";

export function LoginPage() {
  const { status, user, sessionEnded, login } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Signing in re-renders with an authenticated user; route by their role.
  if (status === "authenticated" && user) {
    return <Navigate to={afterLoginPath(from, user.role)} replace />;
  }

  async function submit(nextEmail: string, nextPassword: string) {
    setError(null);
    setSubmitting(true);
    try {
      await login(nextEmail.trim(), nextPassword);
    } catch (err) {
      setError(messageFromError(err));
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(email, password);
  }

  return (
    <div className="grid min-h-screen bg-neutral-50 lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ink-950 p-10 text-neutral-200 lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <LogoMark className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight text-white">
            Grade<span className="text-blue-300">Vision</span>{" "}
            <span className="font-normal text-neutral-400">Insights</span>
          </span>
        </div>
        <div className="max-w-md space-y-6">
          <p className="text-2xl font-semibold leading-snug text-white">
            Programming assessment that shows its evidence.
          </p>
          <ul className="space-y-3 text-sm">
            {[
              [
                "Graded by execution",
                "Every attempt is compiled and run against visible and hidden tests.",
              ],
              [
                "Assistance on evidence",
                "Hints unlock after evaluated attempts, never on a timer.",
              ],
              [
                "Records, not verdicts",
                "Instructors see attempts, hints and a hints-off transfer task.",
              ],
            ].map(([title, body]) => (
              <li key={title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
                />
                <span>
                  <span className="font-medium text-white">{title}.</span> {body}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <pre
          aria-hidden="true"
          className="pointer-events-none select-none rounded-lg border border-white/10 bg-white/5 p-4 font-mono text-xs leading-relaxed text-neutral-400"
        >
          {[
            "attempt 1  ✗ 0/4 tests",
            "hint 1     written",
            "attempt 2  ✗ 2/4 tests",
            "hint 2     written",
            "attempt 3  ✓ 4/4 tests",
            "transfer   ✓ no hints",
          ].join("\n")}
        </pre>
      </aside>

      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm animate-enter space-y-4">
          <div className="flex items-center gap-2 lg:hidden">
            <LogoMark />
            <span className="font-semibold tracking-tight">GradeVision Insights</span>
          </div>
          <form
            onSubmit={onSubmit}
            aria-labelledby="login-title"
            className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
          >
            <div>
              <h1 id="login-title" className="text-lg font-semibold tracking-tight">
                Sign in
              </h1>
              <p className="text-sm text-neutral-500">Use your instructor or student account.</p>
            </div>

            <div aria-live="polite" className="space-y-2">
              {sessionEnded && !error ? (
                <Alert kind="info">
                  Your session ended. Sign in again to continue - autosaved drafts are kept.
                </Alert>
              ) : null}
              {error ? <Alert kind="error">{error}</Alert> : null}
            </div>

            <Field label="Email">
              <Input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            <Button type="submit" loading={submitting} className="w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p className="text-center text-xs text-neutral-500">
            Runs entirely on this machine. AI hints use a local model.
          </p>
        </div>
      </main>
    </div>
  );
}
