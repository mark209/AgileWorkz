/**
 * Dumps every "measurement" category field across the 3 runs of each Stage
 * B document, grouped by a normalized field-name signature (lowercased,
 * word-sorted, so "Pressure High" and "High Pressure" group together) so
 * they can be read and compared by hand against ground truth — exact
 * string matching proved too fragile (field labels vary in case, wording,
 * and word order between runs, a real finding reported separately).
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
  runIndex: number;
  result: { fields: ExtractedField[] };
}

const resultsPath = path.resolve(process.env.TEMP ?? process.env.TMPDIR ?? ".", "stage-b-results.json");
const records: RunRecord[] = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[().,°%]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

const targetDoc = process.argv[2];
const docRecords = records.filter((r) => r.documentId === targetDoc).sort((a, b) => a.runIndex - b.runIndex);

// group[normalizedName][posKey::runIndex] = field
const groups = new Map<string, Map<string, ExtractedField>>();

docRecords.forEach((r) => {
  const perNameCounters = new Map<string, number>();
  r.result.fields
    .filter((f) => f.category === "measurement")
    .forEach((f) => {
      const norm = normalize(f.fieldName) + (f.stage ? `__${f.stage.toLowerCase()}` : "");
      const occurrence = (perNameCounters.get(norm) ?? 0) + 1;
      perNameCounters.set(norm, occurrence);
      const posKey = `#${occurrence}`;
      if (!groups.has(norm)) groups.set(norm, new Map());
      groups.get(norm)!.set(`${posKey}::${r.runIndex}`, f);
    });
});

// Re-key by (normalizedName, occurrence) -> {1: field, 2: field, 3: field}
const byNameAndOccurrence = new Map<string, Record<number, ExtractedField | undefined>>();
for (const [norm, m] of groups) {
  for (const [k, f] of m) {
    const [posKey, runIndexStr] = k.split("::");
    const outerKey = `${norm}::${posKey}`;
    if (!byNameAndOccurrence.has(outerKey)) byNameAndOccurrence.set(outerKey, {});
    byNameAndOccurrence.get(outerKey)![Number(runIndexStr)] = f;
  }
}

console.log(`\n=== ${targetDoc}: measurement fields across 3 runs (word-normalized name matching) ===`);
for (const [key, byRun] of [...byNameAndOccurrence.entries()].sort()) {
  const r1 = byRun[1];
  const r2 = byRun[2];
  const r3 = byRun[3];
  const vals = [r1, r2, r3].map((f) => (f ? `${f.value ?? "NULL"}${f.unit ? " " + f.unit : ""} [${f.suggestedMeasurementTypeCode ?? "-"}]` : "—absent—"));
  const label = r1?.fieldName ?? r2?.fieldName ?? r3?.fieldName ?? key;
  console.log(`${key.padEnd(45)} label="${label}"`);
  console.log(`    run1: ${vals[0]}`);
  console.log(`    run2: ${vals[1]}`);
  console.log(`    run3: ${vals[2]}`);
}
