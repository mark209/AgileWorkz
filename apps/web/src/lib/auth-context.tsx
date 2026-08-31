"use client";

import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from "react";
import { AuthenticatedUser, LoginResponseDto } from "@agileworks/shared-types";
import { apiRequest } from "./api-client";

interface AuthState {
  user: AuthenticatedUser | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (module: string, action: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

// Tokens are held in memory only, never in localStorage/sessionStorage — a
// deliberate Phase 1 trade-off to keep XSS from being able to exfiltrate a
// long-lived credential. It means a full page reload requires signing in
// again; a persistent session (e.g. an httpOnly refresh cookie) is a
// reasonable Phase 2 enhancement, not a Phase 1 requirement.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const response = await apiRequest<LoginResponseDto>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setAccessToken(response.accessToken);
      setUser(response.user);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    if (accessToken) {
      await apiRequest("/auth/logout", { method: "POST", accessToken }).catch(() => undefined);
    }
    setAccessToken(null);
    setUser(null);
  }, [accessToken]);

  const hasPermission = useCallback(
    (module: string, action: string) =>
      user?.permissions.some((p) => p.module === module && p.action === action) ?? false,
    [user],
  );

  const value = useMemo(
    () => ({ user, accessToken, isLoading, login, logout, hasPermission }),
    [user, accessToken, isLoading, login, logout, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
