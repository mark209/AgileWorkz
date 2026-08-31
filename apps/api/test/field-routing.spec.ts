import { ExtractedField } from "../src/common/extraction/extraction-provider.interface";
import { assignRowIndexes, routeFieldsByCategory } from "../src/common/extraction/field-routing";

function field(overrides: Partial<ExtractedField> & Pick<ExtractedField, "category" | "fieldName">): ExtractedField {
  return { value: null, unit: null, confidence: "high", suggestedMeasurementTypeCode: null, ...overrides };
}

describe("routeFieldsByCategory", () => {
  it("splits a mixed batch into the six category buckets", () => {
    const fields: ExtractedField[] = [
      field({ category: "basicInfo", fieldName: "customer_name" }),
      field({ category: "measurement", fieldName: "low_side_pressure" }),
      field({ category: "measurement", fieldName: "high_side_pressure" }),
      field({ category: "problem", fieldName: "leak" }),
      field({ category: "narrativeItem", fieldName: "notes" }),
      field({ category: "signoff", fieldName: "technician_signature" }),
      field({ category: "equipmentUnit", fieldName: "unit_model" }),
    ];
    const routed = routeFieldsByCategory(fields);
    expect(routed.basicInfo).toHaveLength(1);
    expect(routed.measurement).toHaveLength(2);
    expect(routed.problem).toHaveLength(1);
    expect(routed.narrativeItem).toHaveLength(1);
    expect(routed.signoff).toHaveLength(1);
    expect(routed.equipmentUnit).toHaveLength(1);
  });

  it("returns empty arrays for categories with no fields, never undefined", () => {
    const routed = routeFieldsByCategory([]);
    expect(routed.basicInfo).toEqual([]);
    expect(routed.measurement).toEqual([]);
  });
});

describe("assignRowIndexes", () => {
  it("assigns the same row_index to every field sharing a groupKey", () => {
    const fields: ExtractedField[] = [
      field({ category: "measurement", fieldName: "low_side_pressure", groupKey: "unit-1" }),
      field({ category: "measurement", fieldName: "high_side_pressure", groupKey: "unit-1" }),
      field({ category: "measurement", fieldName: "low_side_pressure", groupKey: "unit-2" }),
    ];
    const rows = assignRowIndexes(fields);
    expect(rows[0].rowIndex).toBe(rows[1].rowIndex);
    expect(rows[2].rowIndex).not.toBe(rows[0].rowIndex);
  });

  it("assigns groupKeys row_index in first-seen order, starting at 0 when every field is grouped", () => {
    const fields: ExtractedField[] = [
      field({ category: "measurement", fieldName: "a", groupKey: "unit-1" }),
      field({ category: "measurement", fieldName: "b", groupKey: "unit-2" }),
    ];
    const rows = assignRowIndexes(fields);
    expect(rows[0].rowIndex).toBe(0);
    expect(rows[1].rowIndex).toBe(1);
  });

  it("does not collide an ungrouped field's row_index 0 with the first real group", () => {
    const fields: ExtractedField[] = [
      field({ category: "measurement", fieldName: "ambient_temp" }), // no groupKey -> report-level reading
      field({ category: "measurement", fieldName: "low_side_pressure", groupKey: "unit-1" }),
    ];
    const rows = assignRowIndexes(fields);
    const ungrouped = rows.find((r) => r.fieldName === "ambient_temp")!;
    const grouped = rows.find((r) => r.fieldName === "low_side_pressure")!;
    expect(ungrouped.rowIndex).toBe(0);
    expect(grouped.rowIndex).not.toBe(0);
  });

  it("defaults every ungrouped field to row_index 0 when there is no grouping at all", () => {
    const fields: ExtractedField[] = [
      field({ category: "basicInfo", fieldName: "customer_name" }),
      field({ category: "basicInfo", fieldName: "service_date" }),
    ];
    const rows = assignRowIndexes(fields);
    expect(rows.every((r) => r.rowIndex === 0)).toBe(true);
  });

  it("carries stage through only for measurements, defaulting to null when absent", () => {
    const fields: ExtractedField[] = [
      field({ category: "measurement", fieldName: "low_side_pressure", stage: "before cleaning" }),
      field({ category: "measurement", fieldName: "high_side_pressure" }),
    ];
    const rows = assignRowIndexes(fields);
    expect(rows[0].stage).toBe("before cleaning");
    expect(rows[1].stage).toBeNull();
  });
});
