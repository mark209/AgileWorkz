import { NextRequest, NextResponse } from "next/server";
import type { AuthenticatedUser } from "@agileworks/shared-types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const COOKIE_NAME = "agileworks_field_refresh";
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/session",
};

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, "", { ...cookieOptions, maxAge: 0 });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return noStore(new NextResponse(null, { status: 403 }));
  const body = await request.json().catch(() => null);
  if (typeof body?.refreshToken !== "string" || !body.refreshToken || body.refreshToken.length > 4096) {
    return noStore(new NextResponse(null, { status: 400 }));
  }
  const response = noStore(new NextResponse(null, { status: 204 }));
  response.cookies.set(COOKIE_NAME, body.refreshToken, cookieOptions);
  return response;
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return noStore(new NextResponse(null, { status: 401 }));

  try {
    const refreshed = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: token }),
      cache: "no-store",
    });
    if (!refreshed.ok) {
      const response = noStore(new NextResponse(null, { status: refreshed.status === 401 ? 401 : 503 }));
      if (refreshed.status === 401) clearSessionCookie(response);
      return response;
    }

    const tokens = await refreshed.json() as { accessToken: string; refreshToken: string };
    const me = await fetch(`${API_BASE_URL}/users/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      cache: "no-store",
    });
    if (!me.ok) return noStore(new NextResponse(null, { status: me.status === 401 ? 401 : 503 }));

    const user = await me.json() as AuthenticatedUser;
    const response = noStore(NextResponse.json({ accessToken: tokens.accessToken, user }));
    response.cookies.set(COOKIE_NAME, tokens.refreshToken, cookieOptions);
    return response;
  } catch {
    return noStore(new NextResponse(null, { status: 503 }));
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return noStore(new NextResponse(null, { status: 403 }));
  const response = noStore(new NextResponse(null, { status: 204 }));
  clearSessionCookie(response);
  return response;
}
