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

function parseRedisUrl(url: string): { host: string; port: number } {
  const parsed = new URL(url);
  return { host: parsed.hostname, port: Number(parsed.port || 6379) };
}
