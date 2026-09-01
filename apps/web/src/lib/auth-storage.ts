/**
 * Access-token storage abstraction.
 *
 * SECURITY TRADEOFF: this first implementation keeps the JWT in `localStorage`,
 * which is readable by any script on the page and therefore exposed to XSS. It is
 * used now for simplicity while there is no login UI. The interface below is the
 * only place the frontend touches token storage, so migrating to a secure
 * `httpOnly` cookie later means reimplementing this file (and dropping the
 * `Authorization` header in the API client) - not rewriting callers.
 */
export interface TokenStorage {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

const STORAGE_KEY = "gv.accessToken";

export const tokenStorage: TokenStorage = {
  get() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      window.localStorage.setItem(STORAGE_KEY, token);
    } catch {
      /* storage unavailable (private mode, etc.) - token stays in memory only */
    }
  },
  clear() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
};
