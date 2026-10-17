"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { RequestableDesignation } from "@agileworks/shared-types";
import { listRequestableDesignations, submitRegistration } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { colors, dangerText, heading, page, primaryButton, subheading } from "@/lib/styles";

const inputStyle = {
  display: "block" as const, width: "100%", minHeight: 48, padding: 10,
  marginTop: 6, border: `1px solid ${colors.border}`, borderRadius: 8, boxSizing: "border-box" as const,
};

export default function SignupPage() {
  const [designations, setDesignations] = useState<RequestableDesignation[] | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [requestedRoleId, setRequestedRoleId] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    listRequestableDesignations().then(setDesignations).catch(() => setError("Designations could not be loaded. Please try again later."));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) return setError("Passwords do not match.");
    if (!requestedRoleId) return setError("Select a designation.");
    setLoading(true);
    try {
      await submitRegistration({ fullName, email, phone: phone || undefined, password, requestedRoleId });
      setPassword("");
      setConfirmPassword("");
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Your request could not be submitted. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ ...page, paddingTop: 32 }}>
      <p style={{ color: colors.green, fontSize: 14, fontWeight: 700 }}>AgileWorks Field</p>
      <h1 style={{ ...heading, fontSize: 26, marginTop: 8 }}>Request an account</h1>
      <p style={subheading}>Choose a designation to request. The Super Admin decides your final access.</p>
      {submitted ? (
        <div role="status" style={{ marginTop: 28 }}>
          <p>Your request was received. You can sign in after the Super Admin approves your account.</p>
          <Link href="/login" style={{ color: colors.green, fontWeight: 600 }}>Back to sign in</Link>
        </div>
      ) : (
        <>
          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
            <label>Full name<input style={inputStyle} autoComplete="name" maxLength={160} required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <label>Work email<input style={inputStyle} type="email" autoComplete="email" maxLength={255} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Phone (optional)<input style={inputStyle} type="tel" autoComplete="tel" maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            <div>
              <label htmlFor="field-signup-designation">Requested designation</label>
              <select id="field-signup-designation" style={inputStyle} required disabled={!designations} value={requestedRoleId} onChange={(event) => setRequestedRoleId(event.target.value)}>
                <option value="">{designations ? "Select a designation" : "Loading designations…"}</option>
                {designations?.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
              <span style={{ ...subheading, display: "block", marginTop: 6 }}>Your choice does not grant access.</span>
            </div>
            <label>Password (at least 12 characters)<input style={inputStyle} type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label>Confirm password<input style={inputStyle} type="password" autoComplete="new-password" minLength={12} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            {error && <p role="alert" style={dangerText}>{error}</p>}
            <button type="submit" style={primaryButton} disabled={loading || !designations?.length}>{loading ? "Submitting…" : "Submit request"}</button>
          </form>
          <p style={{ ...subheading, marginTop: 24 }}>Already approved? <Link href="/login" style={{ color: colors.green, fontWeight: 600 }}>Sign in</Link></p>
        </>
      )}
    </main>
  );
}
