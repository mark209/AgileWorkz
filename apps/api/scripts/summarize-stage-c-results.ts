/**
 * Offline summarizer for stage-c-results.json (produced by
 * run-stage-c-batch.ts). No network calls, no DB. Prints, per document:
 *  - every measurement-category field with its reconciliation status
 *  - every checkbox-shaped field (count + a sample)
 *  - every field flagged requiresHumanVerification
 *  - the full trigger list with reasons
 * This is the raw material for the Stage C validation report — actual
 * ground-truth comparison is done by re-reading each source PDF, not by
 * this script.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const inPath = path.resolve(process.env.TEMP ?? ".", "stage-c-results.json");
const records = JSON.parse(fs.readFileSync(inPath, "utf-8"));

function isCheckboxLike(value: string | null): boolean {
  return value !== null && /^(checked|unchecked)$/i.test(value.trim());
}

for (const rec of records) {
  const { documentId, classification, result, estimatedCostUsd } = rec;
  console.log(`\n\n================ ${documentId} (${classification}) ================`);
  console.log(`status=${result.status} callsUsed=${result.callsUsed} totalLatencyMs=${result.totalLatencyMs} estimatedCostUsd=${estimatedCostUsd.toFixed(5)}`);
  console.log(`totalUsage=${JSON.stringify(result.totalUsage)}`);

  const triggerCounts: Record<string, number> = {};
  for (const t of result.verificationTriggers) triggerCounts[t.reason] = (triggerCounts[t.reason] ?? 0) + 1;
  console.log(`triggers by reason: ${JSON.stringify(triggerCounts)}`);

  const measurementFields = result.fields.filter((f: any) => f.category === "measurement");
  const checkboxFields = result.fields.filter((f: any) => isCheckboxLike(f.value));
  const unresolvedFields = result.fields.filter((f: any) => f.requiresHumanVerification);

  console.log(`\n-- measurement fields (${measurementFields.length}) --`);
  for (const f of measurementFields) {
    console.log(
      `  [${f.reconciliationStatus}${f.requiresHumanVerification ? " *HUMAN*" : ""}] ${f.fieldName} = ${JSON.stringify(f.value)} ${f.unit ?? ""} ` +
        `(conf=${f.confidence}, code=${f.suggestedMeasurementTypeCode}, stage=${f.stage ?? "-"}, group=${f.groupKey ?? "-"})`,
    );
  }

  console.log(`\n-- checkbox-shaped fields: ${checkboxFields.length} total --`);
  for (const f of checkboxFields.slice(0, 40)) {
    console.log(`  [${f.reconciliationStatus}] ${f.fieldName} = ${f.value} (group=${f.groupKey ?? "-"})`);
  }
  if (checkboxFields.length > 40) console.log(`  ... and ${checkboxFields.length - 40} more`);

  console.log(`\n-- fields requiring human verification: ${unresolvedFields.length} --`);
  for (const f of unresolvedFields) {
    console.log(`  [${f.category}] ${f.fieldName} (code=${f.suggestedMeasurementTypeCode}, group=${f.groupKey ?? "-"})`);
  }

  const otherCategories = result.fields.filter((f: any) => f.category !== "measurement" && !isCheckboxLike(f.value));
  console.log(`\n-- other non-checkbox fields (${otherCategories.length}) by category --`);
  const byCat: Record<string, number> = {};
  for (const f of otherCategories) byCat[f.category] = (byCat[f.category] ?? 0) + 1;
  console.log(`  ${JSON.stringify(byCat)}`);
}
