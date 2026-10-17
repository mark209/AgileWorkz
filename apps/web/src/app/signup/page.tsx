"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { RequestableDesignation } from "@agileworks/shared-types";
import { listRequestableDesignations, submitRegistration } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

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
    listRequestableDesignations().then(setDesignations).catch(() => setError("Designations could not be loaded. Please refresh and try again."));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!requestedRoleId) {
      setError("Select the designation you are requesting.");
      return;
    }
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
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-2">
          <p className="text-sm font-semibold tracking-wide text-primary">AgileWorks HVAC ERP</p>
          <CardTitle className="text-2xl">Request an account</CardTitle>
          <CardDescription>Choose a designation to request. The Super Admin reviews every request and decides your final access.</CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div role="status" className="space-y-4 text-sm">
              <p>Your request was received. You can sign in after the Super Admin approves your account.</p>
              <Link href="/login" className="inline-block font-medium text-primary underline underline-offset-2">Back to sign in</Link>
            </div>
          ) : (
            <>
              <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="signup-name">Full name</Label><Input id="signup-name" autoComplete="name" maxLength={160} required value={fullName} onChange={(event) => setFullName(event.target.value)} /></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="signup-email">Work email</Label><Input id="signup-email" type="email" autoComplete="email" maxLength={255} required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="signup-phone">Phone (optional)</Label><Input id="signup-phone" type="tel" autoComplete="tel" maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} /></div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="signup-designation">Requested designation</Label>
                  <Select id="signup-designation" required disabled={!designations} value={requestedRoleId} onChange={(event) => setRequestedRoleId(event.target.value)}>
                    <option value="">{designations ? "Select a designation" : "Loading designations…"}</option>
                    {designations?.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </Select>
                  <p className="text-xs text-muted-foreground">Your selection does not grant access. The Super Admin makes the final decision.</p>
                </div>
                <div className="space-y-2"><Label htmlFor="signup-password">Password</Label><Input id="signup-password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="signup-confirm">Confirm password</Label><Input id="signup-confirm" type="password" autoComplete="new-password" minLength={12} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
                <p className="text-xs text-muted-foreground sm:col-span-2">Use at least 12 characters.</p>
                {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
                <Button type="submit" disabled={loading || !designations?.length} className="sm:col-span-2">{loading ? "Submitting…" : "Submit request"}</Button>
              </form>
              <p className="mt-6 text-center text-sm text-muted-foreground">Already approved? <Link href="/login" className="font-medium text-primary underline underline-offset-2">Sign in</Link></p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
