import { Controller, Get, Req } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { Request } from "express";

/**
 * Phase 7 P0 — proves Express's "trust proxy" setting (main.ts, driven by
 * TRUST_PROXY_HOPS) behaves as a narrowly-scoped hop count, not a blanket
 * "trust every X-Forwarded-For header" — this is what keeps the login
 * rate limiter and every audit log's IP correct once actually deployed
 * behind a reverse proxy, without letting a direct, unproxied caller spoof
 * their own IP just by sending the header. A minimal standalone app (no
 * DB/Redis) is enough — this is purely about Express's own IP resolution.
 */
@Controller()
class IpEchoController {
  @Get("ip")
  echo(@Req() req: Request) {
    return { ip: req.ip };
  }
}

async function buildApp(trustProxyHops: number): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ controllers: [IpEchoController] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.set("trust proxy", trustProxyHops);
  await app.init();
  return app;
}

describe("trust proxy configuration", () => {
  it("TRUST_PROXY_HOPS=0 (the default, no reverse proxy): ignores X-Forwarded-For entirely", async () => {
    const app = await buildApp(0);
    try {
      const res = await request(app.getHttpServer()).get("/ip").set("X-Forwarded-For", "1.2.3.4");
      // Never the attacker-supplied value — the direct connection's own address.
      expect(res.body.ip).not.toBe("1.2.3.4");
    } finally {
      await app.close();
    }
  });

  it("TRUST_PROXY_HOPS=1 (the expected single-reverse-proxy topology): trusts the one hop the proxy itself appended", async () => {
    const app = await buildApp(1);
    try {
      const res = await request(app.getHttpServer()).get("/ip").set("X-Forwarded-For", "203.0.113.7");
      // With exactly one trusted hop, Express takes the single entry as
      // the real client IP — this is the address the pilot's reverse
      // proxy would have appended for a real request.
      expect(res.body.ip).toBe("203.0.113.7");
    } finally {
      await app.close();
    }
  });

  it("TRUST_PROXY_HOPS=1: a client prepending a SECOND, spoofed entry ahead of the proxy's real one is ignored", async () => {
    const app = await buildApp(1);
    try {
      // A malicious client sends its own fake header value BEFORE the
      // request reaches the (simulated) proxy; the proxy would append the
      // connection's real address as the LAST entry. With trust=1, only
      // that last entry is honored — the attacker's prepended value never is.
      const res = await request(app.getHttpServer()).get("/ip").set("X-Forwarded-For", "9.9.9.9, 203.0.113.7");
      expect(res.body.ip).toBe("203.0.113.7");
      expect(res.body.ip).not.toBe("9.9.9.9");
    } finally {
      await app.close();
    }
  });
});
