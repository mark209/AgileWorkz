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

// Same in-memory-only token policy as apps/web — see that app's auth-context
// for the rationale. Sharing this module via a package is a reasonable
// Phase 2 cleanup once there's a second real screen to justify it.
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
