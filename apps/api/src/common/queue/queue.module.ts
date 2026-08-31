import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { HealthCheckProcessor } from "./health-check.processor";

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        // Parsed from REDIS_URL rather than passed as a single string so we
        // can set maxRetriesPerRequest: null, which BullMQ requires and which
        // also means a Redis outage doesn't crash app bootstrap — jobs just
        // queue up client-side until Redis is reachable.
        ...parseRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6379"),
        maxRetriesPerRequest: null,
      },
    }),
    BullModule.registerQueue({ name: "health-check" }),
  ],
  providers: [HealthCheckProcessor],
  exports: [BullModule],
})
export class QueueModule {}

// Phase 7 P0 — this previously extracted only host/port, silently
// dropping any username/password/TLS scheme even if REDIS_URL actually
// contained them: an operator who correctly set a credentialed URL would
// have gotten an unauthenticated connection anyway, with no error and no
// indication anything was wrong. Never hardcodes a credential — every
// value here comes from REDIS_URL itself; the plain `redis://localhost:
// 6379` default used in local dev has no username/password/tls, so
// nothing changes for that case. `rediss:` (TLS) is the scheme used by
// most managed Redis providers' connection strings.
export function parseRedisUrl(url: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
  };
}
