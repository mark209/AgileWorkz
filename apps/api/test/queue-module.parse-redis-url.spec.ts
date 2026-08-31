import { parseRedisUrl } from "../src/common/queue/queue.module";

/**
 * Phase 7 P0 (Redis security) — parseRedisUrl() previously discarded any
 * username/password/TLS scheme in REDIS_URL, silently connecting without
 * authentication even if an operator had correctly set a credentialed
 * URL. These tests prove the fix: local-dev usability (a plain,
 * credential-less URL) is unaffected, and a production-shaped
 * credentialed/TLS URL is now fully honored — never a hardcoded
 * credential, always derived from the URL string itself.
 */
describe("parseRedisUrl", () => {
  it("local-dev default: no username/password/tls fields at all", () => {
    const result = parseRedisUrl("redis://localhost:6379");
    expect(result).toEqual({ host: "localhost", port: 6379 });
    expect(result.username).toBeUndefined();
    expect(result.password).toBeUndefined();
    expect(result.tls).toBeUndefined();
  });

  it("extracts a password-only credential (the common 'requirepass'-style Redis auth shape)", () => {
    const result = parseRedisUrl("redis://:my-secret-password@redis.example.com:6379");
    expect(result.host).toBe("redis.example.com");
    expect(result.password).toBe("my-secret-password");
    expect(result.username).toBeUndefined();
  });

  it("extracts both username and password (Redis 6+ ACL-style auth)", () => {
    const result = parseRedisUrl("redis://default:hunter2@redis.example.com:6380");
    expect(result.username).toBe("default");
    expect(result.password).toBe("hunter2");
    expect(result.port).toBe(6380);
  });

  it("URL-decodes a percent-encoded special character in the password", () => {
    const result = parseRedisUrl("redis://default:p%40ss%23word@redis.example.com:6379");
    expect(result.password).toBe("p@ss#word");
  });

  it("enables TLS for the rediss: scheme (common for managed Redis providers), not for plain redis:", () => {
    expect(parseRedisUrl("rediss://default:pw@redis.example.com:6380").tls).toEqual({});
    expect(parseRedisUrl("redis://default:pw@redis.example.com:6379").tls).toBeUndefined();
  });

  it("defaults to port 6379 when the URL omits an explicit port", () => {
    expect(parseRedisUrl("redis://default:pw@redis.example.com").port).toBe(6379);
  });
});
