import { Inject, Injectable, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { InjectQueue } from "@nestjs/bullmq";
import { Job, Queue } from "bullmq";
import { ActorType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../../modules/audit/audit.service";
import { STORAGE_PROVIDER, StorageProvider } from "../storage/storage-provider.interface";
import { ExtractionContextBuilder } from "./extraction-context.builder";
import { StagingWriterService } from "./staging-writer.service";
import { routeFieldsByCategory } from "./field-routing";
import { AdaptiveExtractionService } from "./adaptive-extraction.service";
import { estimateCostUsd } from "./adaptive-extraction.types";

export const SERVICE_REPORT_EXTRACTION_QUEUE = "service-report-extraction";

export interface ServiceReportExtractionJobData {
  serviceReportId: string;
  documentFileKey: string;
  documentMimeType: string;
}

/**
 * Enqueues extraction jobs. Exported from ExtractionModule so a future
 * caller (Step 4's Upload API — not built yet) can add a job without
 * needing to know any BullMQ internals directly.
 */
@Injectable()
export class ExtractionQueueService {
  constructor(@InjectQueue(SERVICE_REPORT_EXTRACTION_QUEUE) private readonly queue: Queue<ServiceReportExtractionJobData>) {}

  async enqueueExtraction(data: ServiceReportExtractionJobData): Promise<void> {
    await this.queue.add("extract", data, { jobId: data.serviceReportId });
  }
}

/**
 * The queue processor (Phase 5 Approved Baseline §04a-5/6/7). Orchestrates,
 * but never itself decides taxonomy, verifies, or writes canonical data:
 *
 *  storage.getObject() -> ExtractionContextBuilder -> AdaptiveExtractionService.extract()
 *  -> routeFieldsByCategory() -> StagingWriterService (ocr_worker) -> status transition (app_runtime)
 *
 * Phase 5 Stage C: this used to call the raw ExtractionProvider directly.
 * It now goes through AdaptiveExtractionService instead, which decides
 * internally whether one call is enough or a verification/consensus round
 * is needed (never more than 3 calls) — the ExtractionProvider interface
 * itself is untouched; AdaptiveExtractionService just wraps it. A field
 * left "unresolved" by reconciliation already comes back with
 * confidence: "unreadable" (extraction-consensus.ts), so no schema change
 * or extra processor-side field mapping is needed for that — it flows
 * through routeFieldsByCategory()/StagingWriterService exactly like any
 * other low-confidence field always has.
 *
 * Idempotency: re-checks service_reports.status before doing any work — a
 * report no longer PENDING_EXTRACTION (already processed, or mid-flight
 * from a concurrent delivery) is a no-op, not a re-processing.
 *
 * Retry classification: a thrown error from this method is left to BullMQ's
 * configured retry/backoff (transient — network, storage, timeout). A
 * `status: "failed"` result from the provider itself (schema-invalid
 * output, explicit decline) is non-transient and is written directly as
 * EXTRACTION_FAILED without retrying — except on the LAST configured
 * attempt, where even a transient failure is written as EXTRACTION_FAILED
 * rather than leaving the report stuck in PENDING_EXTRACTION forever.
 */
@Injectable()
@Processor(SERVICE_REPORT_EXTRACTION_QUEUE)
export class ServiceReportExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(ServiceReportExtractionProcessor.name);

  constructor(
    private readonly adaptiveExtraction: AdaptiveExtractionService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly prisma: PrismaService,
    private readonly contextBuilder: ExtractionContextBuilder,
    private readonly stagingWriter: StagingWriterService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job<ServiceReportExtractionJobData>): Promise<void> {
    const { serviceReportId, documentFileKey, documentMimeType } = job.data;
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

    const report = await this.prisma.serviceReport.findUnique({
      where: { id: serviceReportId },
      select: { status: true, reportTypeCode: true },
    });
    if (!report) {
      // Nothing to retry into — the report row itself is missing.
      this.logger.warn(`ServiceReport ${serviceReportId} not found; dropping extraction job.`);
      return;
    }
    if (report.status !== "PENDING_EXTRACTION") {
      // Idempotency guard: already processed (or moved on) since this job
      // was enqueued/re-delivered — a no-op, not a re-processing.
      this.logger.log(`ServiceReport ${serviceReportId} is no longer PENDING_EXTRACTION (${report.status}); skipping.`);
      return;
    }

    try {
      const documentBytes = await this.storage.getObject(documentFileKey);
      const context = await this.contextBuilder.build(report.reportTypeCode);
      const result = await this.adaptiveExtraction.extract({ content: documentBytes, mimeType: documentMimeType }, context);

      const estimatedCostUsd = estimateCostUsd(result.totalUsage);
      const unresolvedFieldNames = result.fields.filter((f) => f.requiresHumanVerification).map((f) => f.fieldName);

      // Phase 5 Stage C, step 7 (observability): record calls used, why any
      // extra verification calls were made, token usage, estimated cost,
      // and latency for every extraction — regardless of outcome — so
      // production can later measure what fraction of real reports resolve
      // on 1 call vs. need 2-3, and tune the deterministic validator
      // (extraction-validation.ts) against real trigger-reason frequency
      // instead of guessing.
      await this.audit.write({
        actorType: ActorType.WORKER,
        action: "service_report_extraction_attempted",
        entityType: "ServiceReport",
        entityId: serviceReportId,
        afterData: {
          status: result.status,
          fieldCount: result.fields.length,
          callsUsed: result.callsUsed,
          verificationTriggers: result.verificationTriggers,
          unresolvedFieldNames,
          usage: result.totalUsage,
          estimatedCostUsd,
          totalLatencyMs: result.totalLatencyMs,
          perCallMetadata: result.perCallMetadata,
        },
        reason: result.error ?? null,
      });

      // Distinct audit action for the escalated (2-3 call) path — kept
      // separate from the attempted-extraction record above so the
      // escalation rate can be queried on its own without filtering every
      // attempt record by callsUsed.
      if (result.callsUsed > 1) {
        await this.audit.write({
          actorType: ActorType.WORKER,
          action: "service_report_extraction_verification_triggered",
          entityType: "ServiceReport",
          entityId: serviceReportId,
          afterData: {
            callsUsed: result.callsUsed,
            verificationTriggers: result.verificationTriggers,
            unresolvedFieldNames,
          },
          reason: null,
        });
      }

      if (result.status === "failed") {
        await this.markFailed(serviceReportId, result.error ?? "Extraction failed with no further detail.");
        return;
      }

      const routed = routeFieldsByCategory(result.fields);
      await this.stagingWriter.write(serviceReportId, routed);
      await this.markPendingVerification(serviceReportId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isLastAttempt) {
        this.logger.error(`Extraction for ${serviceReportId} failed on final attempt: ${message}`);
        await this.markFailed(serviceReportId, message);
        return;
      }
      // Not the last attempt — rethrow so BullMQ's configured retry/backoff
      // handles it as transient (storage/network/timeout class error).
      this.logger.warn(`Extraction attempt for ${serviceReportId} failed, will retry: ${message}`);
      throw err;
    }
  }

  private async markFailed(serviceReportId: string, reason: string): Promise<void> {
    await this.prisma.serviceReport.update({
      where: { id: serviceReportId },
      data: { status: "EXTRACTION_FAILED" },
    });
    this.logger.error(`ServiceReport ${serviceReportId} marked EXTRACTION_FAILED: ${reason}`);
  }

  private async markPendingVerification(serviceReportId: string): Promise<void> {
    await this.prisma.serviceReport.update({
      where: { id: serviceReportId },
      data: { status: "PENDING_VERIFICATION" },
    });
  }
}
