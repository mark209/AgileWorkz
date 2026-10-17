"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { ApiError } from "../../lib/api-client";
import { page, primaryButton, heading, subheading, colors } from "../../lib/styles";

export default function LoginPage() {
  const { login, isLoading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      router.push("/home");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    }
  }

  return (
    <main style={{ ...page, paddingTop: 48 }}>
      <p style={{ color: colors.green, fontSize: 14, fontWeight: 700 }}>AgileWorks Field</p>
      <h1 style={{ ...heading, fontSize: 28, marginTop: 8 }}>Sign in</h1>
      <p style={subheading}>Use your approved account to view your assigned work.</p>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 28 }}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            style={{ display: "block", width: "100%", minHeight: 48, padding: 10, marginTop: 6, border: `1px solid ${colors.border}`, borderRadius: 8, boxSizing: "border-box" }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{ display: "block", width: "100%", minHeight: 48, padding: 10, marginTop: 6, border: `1px solid ${colors.border}`, borderRadius: 8, boxSizing: "border-box" }}
          />
        </label>
        {error && (
          <p role="alert" style={{ color: "#a52f2f" }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={isLoading} style={primaryButton}>
          {isLoading ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p style={{ ...subheading, marginTop: 24 }}>New to AgileWorks? <Link href="/signup" style={{ color: colors.green, fontWeight: 600 }}>Request an account</Link></p>
    </main>
  );
}
