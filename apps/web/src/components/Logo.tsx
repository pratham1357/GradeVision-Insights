/**
 * GradeVision mark: a code bracket (the student's program) wrapping an
 * evidence trace - three run results rising to a pass. Pure inline SVG, no
 * network request. Decorative by default; pass `title` when it stands alone.
 */
export function LogoMark({ className = "h-7 w-7", title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect width="32" height="32" rx="8" fill="var(--color-brand-700, #1d4ed8)" />
      <path
        d="M10.5 9.5 6 16l4.5 6.5M21.5 9.5 26 16l-4.5 6.5"
        fill="none"
        stroke="#dbeafe"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12.6" cy="19.4" r="1.6" fill="#fca5a5" />
      <circle cx="16" cy="16.8" r="1.6" fill="#fcd34d" />
      <path
        d="m17.7 15.2 1.7 1.7 3.2-4"
        fill="none"
        stroke="#86efac"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ subtle = false }: { subtle?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className={`font-semibold tracking-tight ${subtle ? "text-neutral-800" : ""}`}>
        Grade<span className="text-brand-700">Vision</span>
        <span className="ml-1 font-normal text-neutral-500">Insights</span>
      </span>
    </span>
  );
}
