import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const focus = "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300",
    secondary: "bg-white text-neutral-800 border border-neutral-300 hover:bg-neutral-50",
    danger: "bg-white text-red-700 border border-red-300 hover:bg-red-50",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    />
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:bg-neutral-100 ${focus} ${className}`}
      {...props}
    />
  );
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:bg-neutral-100 ${focus} ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm disabled:bg-neutral-100 ${focus} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-700">{label}</span>
      {children}
      {hint && !error ? <span className="mt-1 block text-xs text-neutral-500">{hint}</span> : null}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
    </label>
  );
}

export function Card({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-800">{title}</h2>
          <div className="flex gap-2">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Alert({
  kind,
  children,
}: {
  kind: "error" | "success" | "info";
  children: ReactNode;
}) {
  const styles = {
    error: "bg-red-50 text-red-800 border-red-200",
    success: "bg-green-50 text-green-800 border-green-200",
    info: "bg-blue-50 text-blue-800 border-blue-200",
  }[kind];
  return <div className={`rounded-md border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  const styles = {
    neutral: "bg-neutral-100 text-neutral-600",
    info: "bg-blue-100 text-blue-700",
    success: "bg-green-100 text-green-700",
    warning: "bg-amber-100 text-amber-800",
    danger: "bg-red-100 text-red-700",
  }[tone];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <p className="py-8 text-center text-sm text-neutral-500">{label}</p>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-neutral-300 px-3 py-6 text-center text-sm text-neutral-500">
      {children}
    </p>
  );
}
