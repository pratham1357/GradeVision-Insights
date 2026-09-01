import type { AuthUser, AuthenticatedAccount, LoginResult } from "@gradevision/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { apiRequest } from "./api-client";
import { tokenStorage } from "./auth-storage";

interface AuthContextValue {
  user: AuthUser | null;
  status: "loading" | "authenticated" | "anonymous";
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Minimal auth state container. This is plumbing for later work - there is no
 * login screen or route guarding yet. On mount it hydrates the current user
 * only if a token is already stored.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>(
    tokenStorage.get() ? "loading" : "anonymous",
  );

  useEffect(() => {
    if (!tokenStorage.get()) return;
    let active = true;
    apiRequest<AuthenticatedAccount>("/auth/me")
      .then((account) => {
        if (!active) return;
        setUser(account);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!active) return;
        tokenStorage.clear();
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
    tokenStorage.set(result.accessToken);
    setUser(result.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(() => {
    tokenStorage.clear();
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, logout }),
    [user, status, login, logout],
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
