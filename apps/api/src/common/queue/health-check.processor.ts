import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";

/**
 * Proves the Redis-backed queue is wired end-to-end. Real jobs (extraction,
 * PDF generation, notifications) are added by the modules that own them as
 * those phases land — nothing business-specific here yet.
 */
@Processor("health-check")
export class HealthCheckProcessor extends WorkerHost {
  async process(_job: Job<{ pingedAt: string }>): Promise<{ pongedAt: string }> {
    return { pongedAt: new Date().toISOString() };
  }
}
