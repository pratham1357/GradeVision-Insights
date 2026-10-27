import type { AuthUser, LoginResult, SessionInfo } from "@gradevision/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { apiRequest, onUnauthorized } from "./api-client";
import { purgeLegacyTokenStorage, sessionStore } from "./session-store";

interface AuthContextValue {
  user: AuthUser | null;
  status: "loading" | "authenticated" | "anonymous";
  /** Set when the server ended the session (expired/revoked/deactivated); cleared on login. */
  sessionEnded: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Auth state container over the server-side session. The session lives in an
 * HttpOnly cookie the page cannot read; on load the app asks the API who is
 * signed in (`GET /auth/session`), which also returns the CSRF token for
 * state-changing requests. Any later 401 means the session ended server-side;
 * route guards then send the user to sign in again and back to their page.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [sessionEnded, setSessionEnded] = useState(false);

  useEffect(
    () =>
      onUnauthorized(() => {
        setUser(null);
        setStatus("anonymous");
        setSessionEnded(true);
      }),
    [],
  );

  useEffect(() => {
    purgeLegacyTokenStorage();
    let active = true;
    apiRequest<SessionInfo>("/auth/session")
      .then((session) => {
        if (!active) return;
        sessionStore.setCsrfToken(session.csrfToken);
        setUser(session.user);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!active) return;
        sessionStore.clear();
        setUser(null);
        setStatus("anonymous");
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiRequest<LoginResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    sessionStore.setCsrfToken(result.csrfToken);
    setUser(result.user);
    setStatus("authenticated");
    setSessionEnded(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest<void>("/auth/logout", { method: "POST" });
    } catch {
      /* already signed out / offline: the local state is cleared regardless */
    }
    sessionStore.clear();
    setUser(null);
    setStatus("anonymous");
    setSessionEnded(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, sessionEnded, login, logout }),
    [user, status, sessionEnded, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return context;
}
