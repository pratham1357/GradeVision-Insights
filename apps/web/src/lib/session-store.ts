/**
 * Browser-side session state. The session itself is an HttpOnly cookie that
 * page scripts cannot read; the only thing kept here is the session's CSRF
 * token - in memory, never in localStorage/sessionStorage - which is re-read
 * from `GET /auth/session` after a page reload.
 */
let csrfToken: string | null = null;

export const sessionStore = {
  getCsrfToken: (): string | null => csrfToken,
  setCsrfToken(token: string): void {
    csrfToken = token;
  },
  clear(): void {
    csrfToken = null;
  },
};

/** Earlier builds kept a bearer token in localStorage; remove any leftover copy. */
export function purgeLegacyTokenStorage(): void {
  try {
    window.localStorage.removeItem("gv.accessToken");
  } catch {
    /* storage unavailable */
  }
}
