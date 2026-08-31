import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * A separate Prisma client connected via OCR_WORKER_DATABASE_URL, not
 * DATABASE_URL — the ocr_worker Postgres role, which is granted SELECT/
 * INSERT/UPDATE on exactly the six extraction_* staging tables and nothing
 * else in the schema (docs/architecture/ocr-worker-db-isolation.md). Only
 * StagingWriterService should ever use this client; every other read in the
 * extraction pipeline (reference tables, service_reports status) goes
 * through the regular app_runtime-credentialed PrismaService instead,
 * since ocr_worker has zero grant on either.
 *
 * Scoped to ExtractionModule only, not @Global() like PrismaModule — this
 * credential should never be reachable from an unrelated module by
 * accident.
 */
@Injectable()
export class OcrWorkerPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OcrWorkerPrismaService.name);

  constructor() {
    super({
      datasources: {
        db: { url: process.env.OCR_WORKER_DATABASE_URL },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Connected to PostgreSQL as ocr_worker");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
