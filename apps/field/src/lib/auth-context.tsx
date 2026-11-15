"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { AuthenticatedUser, LoginResponseDto } from "@agileworks/shared-types";
import { apiRequest, setSessionRefresher } from "./api-client";
import { clearCachedAssignedWorkOrders } from "./offline-store";

interface AuthState {
  user: AuthenticatedUser | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (module: string, action: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

// Access tokens remain in memory; the refresh token stays in a same-origin,
// HttpOnly session cookie so a reload does not sign the technician out.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const restoreSession = useCallback(async (): Promise<string | null> => {
    const response = await fetch("/api/session", { cache: "no-store" });
    if (response.status === 401) {
      setAccessToken(null);
      setUser(null);
      return null;
    }
    if (!response.ok) throw new Error("Could not restore your session.");
    const session = await response.json() as { accessToken: string; user: AuthenticatedUser };
    setAccessToken(session.accessToken);
    setUser(session.user);
    return session.accessToken;
  }, []);

  useEffect(() => {
    setSessionRefresher(restoreSession);
    restoreSession().catch(() => undefined).finally(() => setRestoring(false));
    return () => setSessionRefresher(null);
  }, [restoreSession]);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const response = await apiRequest<LoginResponseDto>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      const stored = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: response.refreshToken }),
      });
      if (!stored.ok) throw new Error("Could not establish a secure session. Please try again.");
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
    const cleared = await fetch("/api/session", { method: "DELETE" });
    if (!cleared.ok) throw new Error("Could not sign out. Please try again.");
    setAccessToken(null);
    setUser(null);
    if (user) await clearCachedAssignedWorkOrders(user.id).catch(() => undefined);
  }, [accessToken, user]);

  // Phase 4 Operations Frontend — added now that the field app has its
  // first permission-gated screens (My Jobs, Work Order actions). Mirrors
  // apps/web's own hasPermission exactly (same PermissionRef shape from
  // @agileworks/shared-types), so a technician who lacks e.g.
  // work_orders.start_own simply doesn't see the Start Job control —
  // server-side authorization on the actual endpoint remains authoritative.
  const hasPermission = useCallback(
    (module: string, action: string) => user?.permissions.some((p) => p.module === module && p.action === action) ?? false,
    [user],
  );

  const value = useMemo(
    () => ({ user, accessToken, isLoading: restoring || isLoading, login, logout, hasPermission }),
    [user, accessToken, restoring, isLoading, login, logout, hasPermission],
  );

  return <AuthContext.Provider value={value}>{restoring ? <div role="status">Loading your session…</div> : children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
