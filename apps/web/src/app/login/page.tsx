"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const { login, isLoading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed. Please try again.");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <p className="text-sm font-semibold tracking-wide text-primary">AgileWorks HVAC ERP</p>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>Enter your approved account details to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="login-email">Email</Label><Input id="login-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="login-password">Password</Label><Input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={isLoading}>{isLoading ? "Signing in…" : "Sign in"}</Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">New to AgileWorks? <Link href="/signup" className="font-medium text-primary underline underline-offset-2">Request an account</Link></p>
        </CardContent>
      </Card>
    </main>
  );
}
