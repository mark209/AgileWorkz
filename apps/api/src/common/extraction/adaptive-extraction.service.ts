/**
 * Adaptive verification orchestration — Phase 5 Stage C correction plan.
 * The normal production path: one extraction call; if deterministic
 * validation finds nothing to question, that single result is used as-is
 * (the common case, no added cost). Only when validation flags a concern
 * does this escalate to two more calls (in parallel, to keep latency flat)
 * for a full 3-way majority vote — never more than 3 calls total.
 *
 * Wraps the existing, unmodified ExtractionProvider/ExtractionBatchResult
 * contract — this is a new orchestration layer, not a change to the
 * approved provider interface.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  EXTRACTION_PROVIDER,
  ExtractionContext,
  ExtractionDocumentInput,
  ExtractionProvider,
  ExtractionTokenUsage,
} from "./extraction-provider.interface";
import { evaluateExtraction, VerificationTrigger } from "./extraction-validation";
import { reconcile, reconcileSingleCall } from "./extraction-consensus";
import { assessRisk } from "./extraction-risk-assessment";
import { AdaptiveExtractionResult, PerCallMetadata } from "./adaptive-extraction.types";

function sumUsage(perCall: PerCallMetadata[]): ExtractionTokenUsage {
  const total: ExtractionTokenUsage = {};
  for (const call of perCall) {
    const u = call.usage;
    if (!u) continue;
    total.promptTokenCount = (total.promptTokenCount ?? 0) + (u.promptTokenCount ?? 0);
    total.candidatesTokenCount = (total.candidatesTokenCount ?? 0) + (u.candidatesTokenCount ?? 0);
    total.thoughtsTokenCount = (total.thoughtsTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    total.cachedContentTokenCount = (total.cachedContentTokenCount ?? 0) + (u.cachedContentTokenCount ?? 0);
    total.toolUsePromptTokenCount = (total.toolUsePromptTokenCount ?? 0) + (u.toolUsePromptTokenCount ?? 0);
    total.totalTokenCount = (total.totalTokenCount ?? 0) + (u.totalTokenCount ?? 0);
  }
  return total;
}

@Injectable()
export class AdaptiveExtractionService {
  private readonly logger = new Logger(AdaptiveExtractionService.name);

  constructor(@Inject(EXTRACTION_PROVIDER) private readonly provider: ExtractionProvider) {}

  async extract(document: ExtractionDocumentInput, context: ExtractionContext): Promise<AdaptiveExtractionResult> {
    const startedAt = Date.now();

    const first = await this.provider.extractDocument(document, context);
    const perCallMetadata: PerCallMetadata[] = [
      { model: first.providerMetadata?.model ?? "unknown", latencyMs: first.providerMetadata?.latencyMs, usage: first.providerMetadata?.usage },
    ];

    if (first.status === "failed") {
      return {
        status: "failed",
        fields: [],
        error: first.error,
        callsUsed: 1,
        verificationTriggers: [],
        perCallMetadata,
        totalLatencyMs: Date.now() - startedAt,
        totalUsage: sumUsage(perCallMetadata),
      };
    }

    const validation = evaluateExtraction(first.fields, context);
    const triggers: VerificationTrigger[] = [...validation.triggers];
    if (first.status === "partial") {
      triggers.push({ reason: "partial-extraction-status", fieldName: "(document-level)", category: "coverage" });
    }

    if (triggers.length === 0) {
      // Stage C.1: even the fast (1-call) path gets the post-reconciliation
      // risk pass — the cross-field contradiction checks (e.g. high-side
      // pressure vs. low-side pressure) aren't part of evaluateExtraction's
      // per-field checks above, so a single clean-looking call can still
      // surface a genuine physical contradiction between two of its own
      // fields.
      const risk = assessRisk(reconcileSingleCall(first.fields));
      if (risk.triggers.length > 0) {
        this.logger.warn(
          `Post-consensus risk assessment flagged ${risk.triggers.length} field(s) on an otherwise-clean single call (${[...new Set(risk.triggers.map((t) => t.reason))].join(", ")}).`,
        );
      } else {
        this.logger.log("Extraction passed deterministic validation on the first call — no verification needed.");
      }
      return {
        status: first.status,
        fields: risk.fields,
        callsUsed: 1,
        verificationTriggers: risk.triggers,
        perCallMetadata,
        totalLatencyMs: Date.now() - startedAt,
        totalUsage: sumUsage(perCallMetadata),
      };
    }

    this.logger.warn(
      `Extraction flagged ${triggers.length} verification trigger(s) (${[...new Set(triggers.map((t) => t.reason))].join(", ")}) — running 2 additional calls for consensus.`,
    );

    const [second, third] = await Promise.all([
      this.provider.extractDocument(document, context),
      this.provider.extractDocument(document, context),
    ]);
    perCallMetadata.push(
      { model: second.providerMetadata?.model ?? "unknown", latencyMs: second.providerMetadata?.latencyMs, usage: second.providerMetadata?.usage },
      { model: third.providerMetadata?.model ?? "unknown", latencyMs: third.providerMetadata?.latencyMs, usage: third.providerMetadata?.usage },
    );

    const perCallFields = [first, second, third]
      .filter((r) => r.status !== "failed")
      .map((r) => r.fields);

    const reconciledFields = perCallFields.length >= 2 ? reconcile(perCallFields) : reconcileSingleCall(first.fields);

    // Stage C.1: consensus (unanimous or majority) among the up-to-3 raw
    // calls proves agreement, not correctness — multiple independent calls
    // can share the same misreading. This deterministic pass re-checks the
    // WINNING value (format/range), requires more than "majority" alone for
    // critical fields, and cross-checks physically-related readings —
    // never increases the call count, never replaces a value.
    const risk = assessRisk(reconciledFields);
    if (risk.triggers.length > 0) {
      this.logger.warn(
        `Post-consensus risk assessment flagged ${risk.triggers.length} field(s) despite reconciliation (${[...new Set(risk.triggers.map((t) => t.reason))].join(", ")}).`,
      );
    }

    const overallStatus = risk.fields.length > 0 ? "extracted" : "failed";

    return {
      status: overallStatus,
      fields: risk.fields,
      callsUsed: 3,
      verificationTriggers: [...triggers, ...risk.triggers],
      perCallMetadata,
      totalLatencyMs: Date.now() - startedAt,
      totalUsage: sumUsage(perCallMetadata),
    };
  }
}
