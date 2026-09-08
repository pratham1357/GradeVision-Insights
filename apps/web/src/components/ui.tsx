import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const focus = "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500";

/** Small animated spinner glyph (inherits `currentColor`). */
export function InlineSpinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`h-4 w-4 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  loading?: boolean;
}) {
  const styles = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300 shadow-sm",
    secondary: "bg-white text-neutral-800 border border-neutral-300 hover:bg-neutral-50",
    danger: "bg-white text-red-700 border border-red-300 hover:bg-red-50",
    ghost: "bg-transparent text-neutral-600 hover:bg-neutral-100",
  }[variant];
  const sizing = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed ${sizing} ${styles} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <InlineSpinner /> : null}
      {children}
    </button>
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
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-neutral-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-800">{title}</h2>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="space-y-1">
      {back ?? null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Alert({
  kind,
  title,
  children,
  onRetry,
}: {
  kind: "error" | "success" | "info" | "warning";
  title?: ReactNode;
  children: ReactNode;
  onRetry?: () => void;
}) {
  const styles = {
    error: "bg-red-50 text-red-800 border-red-200",
    success: "bg-green-50 text-green-800 border-green-200",
    info: "bg-blue-50 text-blue-800 border-blue-200",
    warning: "bg-amber-50 text-amber-900 border-amber-200",
  }[kind];
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${styles}`}>
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={title ? "mt-0.5" : ""}>{children}</div>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-1.5 rounded border border-black/15 bg-white/60 px-2 py-0.5 text-xs font-medium hover:bg-white"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
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
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-500">
      <InlineSpinner className="text-neutral-400" />
      {label}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-neutral-300 px-3 py-8 text-center text-sm text-neutral-500">
      {children}
    </p>
  );
}
