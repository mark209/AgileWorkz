import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { EXTRACTION_PROVIDER } from "./extraction-provider.interface";
import { StubExtractionProvider } from "./stub-extraction.provider";
import { VertexGeminiExtractionProvider } from "./providers/vertex-gemini.provider";
import { loadVertexGeminiConfig } from "./extraction-config";
import { OcrWorkerPrismaService } from "./ocr-worker-prisma.service";
import { ExtractionContextBuilder } from "./extraction-context.builder";
import { StagingWriterService } from "./staging-writer.service";
import {
  ExtractionQueueService,
  SERVICE_REPORT_EXTRACTION_QUEUE,
  ServiceReportExtractionProcessor,
} from "./service-report-extraction.processor";
import { StorageModule } from "../storage/storage.module";
import { AuditModule } from "../../modules/audit/audit.module";
import { AdaptiveExtractionService } from "./adaptive-extraction.service";

// EXTRACTION_PROVIDER env var selects the adapter: "stub" (default) or
// "vertex-gemini" — mirrors StorageModule's STORAGE_PROVIDER pattern.
// Constructing VertexGeminiExtractionProvider only validates config shape
// (via loadVertexGeminiConfig, which throws on a missing model/project or a
// non-locational region — see extraction-config.ts) and does not make any
// network call or require real credentials until extractDocument() is
// actually invoked by a real job.
@Module({
  imports: [
    StorageModule,
    AuditModule,
    BullModule.registerQueue({
      name: SERVICE_REPORT_EXTRACTION_QUEUE,
      defaultJobOptions: {
        // Transient failures (network/timeout/5xx) get 3 attempts total
        // with exponential backoff — see §04a-6/7 and
        // ServiceReportExtractionProcessor's retry classification.
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    }),
  ],
  providers: [
    {
      provide: EXTRACTION_PROVIDER,
      useFactory: () =>
        process.env.EXTRACTION_PROVIDER === "vertex-gemini"
          ? new VertexGeminiExtractionProvider(loadVertexGeminiConfig())
          : new StubExtractionProvider(),
    },
    OcrWorkerPrismaService,
    ExtractionContextBuilder,
    StagingWriterService,
    ExtractionQueueService,
    AdaptiveExtractionService,
    ServiceReportExtractionProcessor,
  ],
  exports: [EXTRACTION_PROVIDER, ExtractionQueueService],
})
export class ExtractionModule {}
