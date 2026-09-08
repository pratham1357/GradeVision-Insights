import { PLATFORM_NAME } from "@gradevision/shared";
import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../lib/auth-context";
import { messageFromError } from "../lib/use-api";
import { Alert, Button, Field, Input } from "../components/ui";

/** Seeded local-dev accounts, shown only in the Vite dev build. */
const DEV_ACCOUNTS = [
  { label: "Instructor", email: "instructor@example.edu", password: "instructor-dev-password" },
  { label: "Student 1", email: "student1@example.edu", password: "student-dev-password" },
  { label: "Student 2", email: "student2@example.edu", password: "student-dev-password" },
];

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === "authenticated") return <Navigate to={from} replace />;

  async function submit(nextEmail: string, nextPassword: string) {
    setError(null);
    setSubmitting(true);
    try {
      await login(nextEmail.trim(), nextPassword);
      navigate(from, { replace: true });
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
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-10">
      <div className="w-full max-w-sm space-y-4">
        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
        >
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{PLATFORM_NAME}</h1>
            <p className="text-sm text-neutral-500">Sign in to continue.</p>
          </div>

          {error ? <Alert kind="error">{error}</Alert> : null}

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

        {import.meta.env.DEV ? (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-3 text-xs text-neutral-500">
            <p className="mb-1 font-medium text-neutral-600">Local dev accounts</p>
            <ul className="space-y-1">
              {DEV_ACCOUNTS.map((a) => (
                <li key={a.email} className="flex items-center justify-between gap-2">
                  <span>
                    {a.label}: <code>{a.email}</code>
                  </span>
                  <button
                    type="button"
                    className="rounded border border-neutral-300 px-1.5 py-0.5 font-medium text-neutral-600 hover:bg-neutral-50"
                    disabled={submitting}
                    onClick={() => {
                      setEmail(a.email);
                      setPassword(a.password);
                      void submit(a.email, a.password);
                    }}
                  >
                    Use
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
