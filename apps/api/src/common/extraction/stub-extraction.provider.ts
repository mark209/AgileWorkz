import { Injectable } from "@nestjs/common";
import {
  ExtractionBatchResult,
  ExtractionContext,
  ExtractionDocumentInput,
  ExtractionProvider,
} from "./extraction-provider.interface";

/**
 * Default adapter when EXTRACTION_PROVIDER=stub (or unset). Does no real
 * extraction; exists only to prove the interface compiles and is wired
 * end-to-end without requiring any AI-vendor credentials in dev/CI.
 */
@Injectable()
export class StubExtractionProvider implements ExtractionProvider {
  async extractDocument(
    _document: ExtractionDocumentInput,
    _context: ExtractionContext,
  ): Promise<ExtractionBatchResult> {
    return {
      status: "failed",
      fields: [],
      error: "No OCR/AI provider is integrated — this is a structural stub only.",
    };
  }
}
