/**
 * Stage B consistency analysis (Phase 5 Approved Baseline §04a-13). Reads
 * the raw stage-b-results.json produced by run-stage-b-batch.ts and
 * computes, per document, per-field agreement across the 3 runs — purely
 * by comparing the runs to each other, no ground truth needed for this
 * part. Ground-truth accuracy itself is assessed separately, by hand,
 * against the real source documents.
 */
import * as path from "node:path";
import * as fs from "node:fs";

interface ExtractedField {
  category: string;
  fieldName: string;
  value: string | null;
  unit: string | null;
  confidence: string;
  suggestedMeasurementTypeCode: string | null;
  stage?: string;
  groupKey?: string;
}

interface RunRecord {
  documentId: string;
  classification: string;
  runIndex: number;
  result: {
    status: string;
    fields: ExtractedField[];
    providerMetadata?: { model: string; latencyMs?: number; usage?: Record<string, number> };
  };
}

const resultsPath = path.resolve(process.env.TEMP ?? process.env.TMPDIR ?? ".", "stage-b-results.json");
const records: RunRecord[] = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

const byDocument = new Map<string, RunRecord[]>();
for (const r of records) {
  if (!byDocument.has(r.documentId)) byDocument.set(r.documentId, []);
  byDocument.get(r.documentId)!.push(r);
}

/**
 * groupKey is free text the model invents per run (e.g. "MASTER" in one
 * run, "master_outdoor_unit" in another) — it's meant to group fields
 * WITHIN one run, never to be compared literally ACROSS runs. What's
 * actually stable across runs is document order: for a repeating field
 * name (e.g. "SUCTION AIR TEMP."), the Nth occurrence in reading order
 * should correspond to the same physical equipment unit each run, since
 * the document itself doesn't change. So fields are matched positionally
 * within (category, fieldName, stage), not by groupKey text.
 */
function buildPositionalKeys(fields: ExtractedField[]): Map<ExtractedField, string> {
  const seenCount = new Map<string, number>();
  const keys = new Map<ExtractedField, string>();
  for (const f of fields) {
    const base = `${f.category}::${f.fieldName}::${f.stage ?? ""}`;
    const occurrence = (seenCount.get(base) ?? 0) + 1;
    seenCount.set(base, occurrence);
    keys.set(f, `${base}::#${occurrence}`);
  }
  return keys;
}

console.log("========== TOKEN USAGE / COST / LATENCY ==========");
let totalPromptTokens = 0;
let totalCandidateTokens = 0;
let totalThoughtsTokens = 0;
let totalTokens = 0;
let totalLatency = 0;
const INPUT_RATE_PER_M = 0.3;
const OUTPUT_RATE_PER_M = 2.5; // candidates + thoughts billed as output tokens

for (const [docId, runs] of byDocument) {
  for (const r of runs.sort((a, b) => a.runIndex - b.runIndex)) {
    const u = r.result.providerMetadata?.usage;
    const lat = r.result.providerMetadata?.latencyMs ?? 0;
    const inputCost = ((u?.promptTokenCount ?? 0) / 1_000_000) * INPUT_RATE_PER_M;
    const outputCost = (((u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0)) / 1_000_000) * OUTPUT_RATE_PER_M;
    console.log(
      `${docId} run${r.runIndex}: status=${r.result.status} fields=${r.result.fields.length} ` +
        `prompt=${u?.promptTokenCount} candidates=${u?.candidatesTokenCount} thoughts=${u?.thoughtsTokenCount} ` +
        `total=${u?.totalTokenCount} latencyMs=${lat} estCost=$${(inputCost + outputCost).toFixed(5)}`,
    );
    totalPromptTokens += u?.promptTokenCount ?? 0;
    totalCandidateTokens += u?.candidatesTokenCount ?? 0;
    totalThoughtsTokens += u?.thoughtsTokenCount ?? 0;
    totalTokens += u?.totalTokenCount ?? 0;
    totalLatency += lat;
  }
}
const totalInputCost = (totalPromptTokens / 1_000_000) * INPUT_RATE_PER_M;
const totalOutputCost = ((totalCandidateTokens + totalThoughtsTokens) / 1_000_000) * OUTPUT_RATE_PER_M;
console.log(
  `\nTOTALS: prompt=${totalPromptTokens} candidates=${totalCandidateTokens} thoughts=${totalThoughtsTokens} ` +
    `total=${totalTokens} avgLatencyMs=${(totalLatency / records.length).toFixed(0)} ` +
    `estTotalCost=$${(totalInputCost + totalOutputCost).toFixed(4)}`,
);

console.log("\n========== PER-DOCUMENT RUN-TO-RUN CONSISTENCY (positional matching) ==========");
for (const [docId, runs] of byDocument) {
  const sorted = runs.sort((a, b) => a.runIndex - b.runIndex);
  const allKeys = new Set<string>();
  const byRunMap = sorted.map((r) => {
    const positional = buildPositionalKeys(r.result.fields);
    const m = new Map<string, ExtractedField>();
    for (const f of r.result.fields) {
      const key = positional.get(f)!;
      m.set(key, f);
      allKeys.add(key);
    }
    return m;
  });

  console.log(`\n--- ${docId} (${sorted[0].classification}) — ${allKeys.size} distinct field keys across ${sorted.length} runs ---`);

  let numericTotal = 0;
  let numericConsistent = 0;
  let presentInAll = 0;
  let valueConsistentOfPresent = 0;
  const inconsistentRows: string[] = [];

  for (const key of allKeys) {
    const vals = byRunMap.map((m) => m.get(key));
    const presentCount = vals.filter((v) => v !== undefined).length;
    if (presentCount === sorted.length) {
      presentInAll++;
      const values = vals.map((v) => `${v!.value ?? "null"}|${v!.unit ?? ""}|${v!.suggestedMeasurementTypeCode ?? ""}`);
      const allSame = values.every((v) => v === values[0]);
      if (allSame) valueConsistentOfPresent++;
      const first = vals[0]!;
      if (first.category === "measurement") {
        numericTotal++;
        if (allSame) numericConsistent++;
        else inconsistentRows.push(`  ${key} => [${values.join("]  [")}]`);
      }
    } else {
      inconsistentRows.push(`  ${key} => present in only ${presentCount}/${sorted.length} runs`);
    }
  }

  console.log(`  Fields present in all ${sorted.length} runs: ${presentInAll}/${allKeys.size}`);
  console.log(`  Of those, value+unit+code identical across all runs: ${valueConsistentOfPresent}/${presentInAll}`);
  console.log(`  Measurement-category fields present in all runs: ${numericTotal}; identical across all runs: ${numericConsistent} (${numericTotal ? ((numericConsistent / numericTotal) * 100).toFixed(1) : "n/a"}%)`);
  if (inconsistentRows.length > 0) {
    console.log(`  Inconsistent/missing rows (${inconsistentRows.length}):`);
    inconsistentRows.forEach((row) => console.log(row));
  }
}
