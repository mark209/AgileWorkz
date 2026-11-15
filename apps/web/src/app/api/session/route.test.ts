import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(origin: string) {
  return new NextRequest("http://internal-render-host:3000/api/session", {
    method: "POST",
    headers: { host: "agileworkz-web.onrender.com", origin, "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: "test-refresh-token" }),
  });
}

describe("session origin validation behind a proxy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the public HTTPS origin when the internal request URL uses HTTP", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(request("https://agileworkz-web.onrender.com"));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("test-refresh-token");
  });

  it("rejects a different public origin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(request("https://other.example.com"));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
