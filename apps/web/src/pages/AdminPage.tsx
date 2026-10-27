import type { AdminUser, UserRole } from "@gradevision/shared";
import { type FormEvent, useEffect, useId, useState } from "react";

import { SystemMetricsCard } from "../components/InstructorMonitor";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "../components/ui";
import { adminApi } from "../lib/admin-api";
import { useAuth } from "../lib/auth-context";
import { messageFromError, useApi } from "../lib/use-api";

const ROLES: UserRole[] = ["STUDENT", "INSTRUCTOR", "ADMIN"];
const ROLE_LABEL: Record<UserRole, string> = {
  STUDENT: "Student",
  INSTRUCTOR: "Instructor",
  ADMIN: "Admin",
};
type Banner = { kind: "success" | "error"; text: string } | null;

/**
 * ADMIN area: account management (create, role, status, password) with an
 * audit trail, plus API-process health. Every rule - ADMIN-only access, the
 * last active admin, no self-demotion, session revocation - is enforced by the
 * API; this page only presents it.
 */
export function AdminPage() {
  const [refresh, setRefresh] = useState(0);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Administration"
        subtitle="Accounts, their access, and the health of this GradeVision instance."
      />
      <UsersCard onChanged={() => setRefresh((n) => n + 1)} />
      <div className="grid gap-4 lg:grid-cols-2">
        <AuditCard refreshKey={refresh} />
        <SystemMetricsCard />
      </div>
    </div>
  );
}

function UsersCard({ onChanged }: { onChanged: () => void }) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<UserRole | "">("");
  const [query, setQuery] = useState({ search: "", role: "" as UserRole | "" });
  const { data, loading, error, reload } = useApi(() => adminApi.listUsers(query), [query]);
  const [banner, setBanner] = useState<Banner>(null);

  function applyFilter(event: FormEvent) {
    event.preventDefault();
    setQuery({ search, role });
  }

  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBanner(null);
    try {
      await action();
      setBanner({ kind: "success", text: success });
      reload();
      onChanged();
      return true;
    } catch (err) {
      setBanner({ kind: "error", text: messageFromError(err) });
      return false;
    }
  }

  return (
    <Card title="Accounts">
      <form onSubmit={applyFilter} className="mb-3 flex flex-wrap items-end gap-2" role="search">
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-600">
            Search name or email
          </span>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. student1"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-600">Role</span>
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole | "")}>
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      <div aria-live="polite">
        {banner ? <Alert kind={banner.kind}>{banner.text}</Alert> : null}
      </div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      {loading && !data ? <Spinner label="Loading accounts…" /> : null}
      {data && data.length === 0 ? <EmptyState>No accounts match this filter.</EmptyState> : null}

      {data && data.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Accounts</caption>
            <thead className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Account
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Role
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Status
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Sections
                </th>
                <th scope="col" className="py-2 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.map((user) => (
                <UserRow key={user.id} user={user} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <CreateUserForm run={run} />
    </Card>
  );
}

function UserRow({
  user,
  run,
}: {
  user: AdminUser;
  run: (action: () => Promise<unknown>, success: string) => Promise<boolean>;
}) {
  const { user: me } = useAuth();
  const isMe = me?.id === user.id;
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const passwordId = useId();

  return (
    <tr className={user.isActive ? "" : "text-neutral-400"}>
      <td className="py-2 pr-3">
        <div className="font-medium text-neutral-800">
          {user.name}
          {isMe ? <span className="ml-1 text-xs text-neutral-500">(you)</span> : null}
        </div>
        <div className="text-xs text-neutral-500">{user.email}</div>
      </td>
      <td className="py-2 pr-3">
        <Select
          aria-label={`Role for ${user.email}`}
          value={user.role}
          disabled={isMe}
          className="w-32"
          onChange={(e) => {
            const next = e.target.value as UserRole;
            if (
              window.confirm(
                `Change ${user.email} to ${ROLE_LABEL[next]}? Their sessions will end.`,
              )
            ) {
              void run(
                () => adminApi.updateUser(user.id, { role: next }),
                `${user.email} is now ${ROLE_LABEL[next]}`,
              );
            }
          }}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </td>
      <td className="py-2 pr-3">
        {user.isActive ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="neutral">Deactivated</Badge>
        )}
        {user.activeSessions > 0 ? (
          <div className="mt-1 text-xs text-neutral-500">
            {user.activeSessions} signed-in session{user.activeSessions === 1 ? "" : "s"}
          </div>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-xs">
        {user.sections.length
          ? user.sections.map((s) => `${s.courseCode} ${s.name}`).join(", ")
          : "—"}
      </td>
      <td className="py-2">
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={user.isActive ? "danger" : "secondary"}
            disabled={isMe}
            title={isMe ? "You cannot deactivate yourself" : undefined}
            onClick={() =>
              void run(
                () => adminApi.updateUser(user.id, { isActive: !user.isActive }),
                user.isActive
                  ? `${user.email} deactivated - signed out everywhere`
                  : `${user.email} reactivated`,
              )
            }
          >
            {user.isActive ? "Deactivate" : "Reactivate"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showPassword}
            onClick={() => setShowPassword((v) => !v)}
          >
            Set password
          </Button>
        </div>
        {showPassword ? (
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => adminApi.setPassword(user.id, password),
                `New password set for ${user.email}`,
              ).then((ok) => {
                if (!ok) return;
                setPassword("");
                setShowPassword(false);
              });
            }}
          >
            <label htmlFor={passwordId} className="sr-only">
              New password for {user.email}
            </label>
            <Input
              id={passwordId}
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              placeholder="12+ characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button size="sm" type="submit">
              Save
            </Button>
          </form>
        ) : null}
      </td>
    </tr>
  );
}

function CreateUserForm({
  run,
}: {
  run: (action: () => Promise<unknown>, success: string) => Promise<boolean>;
}) {
  const sections = useApi(() => adminApi.listSections(), []);
  const empty = { email: "", name: "", role: "STUDENT" as UserRole, password: "", sectionId: "" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (form.role !== "STUDENT" && form.sectionId) setForm((f) => ({ ...f, sectionId: "" }));
  }, [form.role, form.sectionId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const created = await run(
      () =>
        adminApi.createUser({
          email: form.email,
          name: form.name,
          role: form.role,
          password: form.password,
          ...(form.sectionId ? { sectionId: form.sectionId } : {}),
        }),
      `Account ${form.email.trim().toLowerCase()} created`,
    );
    if (created) setForm(empty);
    setBusy(false);
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mt-4 space-y-3 rounded-md border border-dashed border-neutral-300 p-3"
    >
      <p className="text-sm font-medium text-neutral-700">Create an account</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Full name">
          <Input
            required
            maxLength={120}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Email">
          <Input
            required
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="Role">
          <Select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Initial password"
          hint="At least 12 characters. Share it with the person privately."
        >
          <Input
            required
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        {form.role === "STUDENT" ? (
          <Field
            label="Enrol in section (optional)"
            hint="Students see the assessments of their sections."
          >
            <Select
              value={form.sectionId}
              onChange={(e) => setForm({ ...form, sectionId: e.target.value })}
            >
              <option value="">No section</option>
              {(sections.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.courseCode} - {s.name}
                  {s.instructorName ? ` (${s.instructorName})` : ""}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <Button type="submit" loading={busy}>
        Create account
      </Button>
    </form>
  );
}

function AuditCard({ refreshKey }: { refreshKey: number }) {
  const { data, loading, error } = useApi(() => adminApi.listAudit(), [refreshKey]);
  return (
    <Card title="Recent audit events">
      {error ? <Alert kind="error">{error}</Alert> : null}
      {loading && !data ? <Spinner label="Loading audit log…" /> : null}
      {data && data.length === 0 ? <EmptyState>No events yet.</EmptyState> : null}
      <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
        {(data ?? []).map((event) => (
          <li key={event.id} className="border-b border-neutral-100 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">{event.action}</code>
              <time className="text-xs text-neutral-500" dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString()}
              </time>
            </div>
            <p className="mt-1 text-neutral-700">
              {event.summary ?? "—"}
              {event.actorName ? (
                <span className="text-neutral-500"> · by {event.actorName}</span>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
