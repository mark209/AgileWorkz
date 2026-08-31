/**
 * Offline analysis of production-validation-results.json (produced by
 * run-production-validation-batch.ts). No network calls, no DB. Computes
 * the metrics requested for the Phase 5 production readiness assessment.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const inPath = path.resolve(process.env.TEMP ?? ".", "production-validation-results.json");
const records: any[] = JSON.parse(fs.readFileSync(inPath, "utf-8"));

const CRITICAL = new Set([
  "VOLTAGE", "VOLTAGE_L1_L2", "VOLTAGE_L1_L3", "VOLTAGE_L2_L3",
  "CURRENT", "CURRENT_L1", "CURRENT_L2", "CURRENT_L3",
  "HIGH_SIDE_PRESSURE", "LOW_SIDE_PRESSURE",
  "SUCTION_PIPE_TEMPERATURE", "DISCHARGE_PIPE_TEMPERATURE", "LIQUID_PIPE_TEMPERATURE",
  "INDOOR_RETURN_AIR_TEMPERATURE", "INDOOR_SUPPLY_AIR_TEMPERATURE",
  "OUTDOOR_SUCTION_AIR_TEMPERATURE", "OUTDOOR_DISCHARGE_AIR_TEMPERATURE",
  "ROOM_TEMPERATURE", "AMBIENT_TEMPERATURE",
  "PIPE_SIZE_LIQUID", "PIPE_SIZE_GAS", "BREAKER_CAPACITY", "THERMOSTAT_SETTING",
]);

function isCheckbox(v: string | null) {
  return v !== null && /^(checked|unchecked)$/i.test(v.trim());
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

// ---- 1/2: calls distribution ----
const callDist: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
for (const r of records) callDist[r.result.callsUsed]++;
console.log("=== Calls distribution (all 21) ===");
for (const k of [1, 2, 3]) {
  console.log(`  ${k}-call: ${callDist[k]} (${((callDist[k] / records.length) * 100).toFixed(1)}%)`);
}
console.log(`  avg calls/doc: ${(records.reduce((s, r) => s + r.result.callsUsed, 0) / records.length).toFixed(2)}`);

// ---- by report type ----
const byType: Record<string, any[]> = {};
for (const r of records) (byType[r.reportTypeCode] ??= []).push(r);

console.log("\n=== Calls distribution by report type ===");
for (const [type, recs] of Object.entries(byType)) {
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const r of recs) dist[r.result.callsUsed]++;
  console.log(`  ${type} (n=${recs.length}): 1-call=${dist[1]}, 3-call=${dist[3]}, avg=${(recs.reduce((s, r) => s + r.result.callsUsed, 0) / recs.length).toFixed(2)}`);
}

// ---- 3/4/5: human-verification & unresolved rates ----
function fieldStats(recs: any[]) {
  let totalFields = 0, hvrFields = 0, unresolvedFields = 0;
  let criticalFields = 0, criticalHvr = 0, criticalUnresolved = 0;
  let checkboxFields = 0, checkboxUnanimous = 0, checkboxMajority = 0, checkboxUnresolved = 0;
  let unmappedCritical = 0; // suggestedMeasurementTypeCode null on a measurement field
  let measurementFields = 0;
  for (const r of recs) {
    for (const f of r.result.fields) {
      totalFields++;
      if (f.requiresHumanVerification) hvrFields++;
      if (f.reconciliationStatus === "unresolved") unresolvedFields++;
      const isCrit = f.category === "measurement" && CRITICAL.has(f.suggestedMeasurementTypeCode);
      if (isCrit) {
        criticalFields++;
        if (f.requiresHumanVerification) criticalHvr++;
        if (f.reconciliationStatus === "unresolved") criticalUnresolved++;
      }
      if (f.category === "measurement") {
        measurementFields++;
        if (!f.suggestedMeasurementTypeCode) unmappedCritical++;
      }
      if (isCheckbox(f.value)) {
        checkboxFields++;
        if (f.reconciliationStatus === "unanimous") checkboxUnanimous++;
        if (f.reconciliationStatus === "majority") checkboxMajority++;
        if (f.reconciliationStatus === "unresolved") checkboxUnresolved++;
      }
    }
  }
  return {
    totalFields, hvrFields, unresolvedFields, criticalFields, criticalHvr, criticalUnresolved,
    checkboxFields, checkboxUnanimous, checkboxMajority, checkboxUnresolved,
    measurementFields, unmappedCritical,
  };
}

console.log("\n=== Human-verification / unresolved rates (overall) ===");
const overall = fieldStats(records);
console.log(`  total fields=${overall.totalFields}`);
console.log(`  HVR rate (all fields): ${overall.hvrFields}/${overall.totalFields} = ${(overall.hvrFields / overall.totalFields * 100).toFixed(1)}%`);
console.log(`  unresolved rate (all fields): ${overall.unresolvedFields}/${overall.totalFields} = ${(overall.unresolvedFields / overall.totalFields * 100).toFixed(1)}%`);
console.log(`  critical fields=${overall.criticalFields}`);
console.log(`  critical HVR rate: ${overall.criticalHvr}/${overall.criticalFields} = ${(overall.criticalHvr / overall.criticalFields * 100).toFixed(1)}%`);
console.log(`  critical unresolved rate: ${overall.criticalUnresolved}/${overall.criticalFields} = ${(overall.criticalUnresolved / overall.criticalFields * 100).toFixed(1)}%`);
console.log(`  measurement fields=${overall.measurementFields}, unmapped (code=null)=${overall.unmappedCritical} (${(overall.unmappedCritical / overall.measurementFields * 100).toFixed(1)}%)`);
console.log(`  checkbox fields=${overall.checkboxFields}: unanimous=${overall.checkboxUnanimous} (${(overall.checkboxUnanimous/overall.checkboxFields*100).toFixed(1)}%), majority=${overall.checkboxMajority}, unresolved=${overall.checkboxUnresolved}`);

console.log("\n=== By report type ===");
for (const [type, recs] of Object.entries(byType)) {
  const s = fieldStats(recs);
  console.log(`\n  ${type} (n=${recs.length} docs, ${s.totalFields} fields):`);
  console.log(`    HVR (all): ${s.hvrFields}/${s.totalFields} = ${(s.hvrFields / s.totalFields * 100).toFixed(1)}%`);
  console.log(`    unresolved (all): ${s.unresolvedFields}/${s.totalFields} = ${(s.unresolvedFields / s.totalFields * 100).toFixed(1)}%`);
  console.log(`    critical fields=${s.criticalFields}, critical HVR=${s.criticalHvr} (${s.criticalFields ? (s.criticalHvr / s.criticalFields * 100).toFixed(1) : "n/a"}%), critical unresolved=${s.criticalUnresolved} (${s.criticalFields ? (s.criticalUnresolved / s.criticalFields * 100).toFixed(1) : "n/a"}%)`);
  console.log(`    checkboxes=${s.checkboxFields} (unanimous=${s.checkboxUnanimous}, majority=${s.checkboxMajority}, unresolved=${s.checkboxUnresolved})`);
  console.log(`    measurement fields=${s.measurementFields}, unmapped=${s.unmappedCritical} (${s.measurementFields ? (s.unmappedCritical/s.measurementFields*100).toFixed(1) : "n/a"}%)`);
}

// ---- cost & latency ----
const costs = records.map((r) => r.estimatedCostUsd);
const latencies = records.map((r) => r.result.totalLatencyMs).sort((a, b) => a - b);
console.log("\n=== Cost & latency ===");
console.log(`  total cost: $${costs.reduce((a, b) => a + b, 0).toFixed(5)}`);
console.log(`  avg cost/doc: $${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(5)}`);
console.log(`  avg latency: ${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)}ms`);
console.log(`  median latency: ${percentile(latencies, 50)}ms`);
console.log(`  P95 latency: ${percentile(latencies, 95)}ms`);
console.log(`  max latency: ${latencies[latencies.length - 1]}ms`);

// ---- critical fields requiring manual ground-truth review (unanimous, NOT flagged) ----
console.log("\n=== Critical fields UNANIMOUS and NOT flagged for human verification (highest-stakes set for ground-truth check) ===");
for (const r of records) {
  const flagged = r.result.fields.filter((f: any) =>
    f.category === "measurement" && CRITICAL.has(f.suggestedMeasurementTypeCode) &&
    f.reconciliationStatus === "unanimous" && !f.requiresHumanVerification && f.value !== null,
  );
  if (flagged.length > 0) {
    console.log(`\n  ${r.documentId}: ${flagged.length} unflagged-unanimous critical field(s)`);
    for (const f of flagged) {
      console.log(`    ${f.fieldName} = ${JSON.stringify(f.value)} ${f.unit ?? ""} (code=${f.suggestedMeasurementTypeCode}, group=${f.groupKey ?? "-"})`);
    }
  }
}
