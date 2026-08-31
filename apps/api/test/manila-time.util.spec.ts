import { currentManilaYearMonth } from "../src/common/numbering/manila-time.util";

// Deterministic, no live DB / no clock mocking needed — proves the numbering
// engine uses Asia/Manila (UTC+8) rather than naive UTC month math, which
// gets the last ~8 hours of every month wrong. See approved plan §05a.
describe("currentManilaYearMonth", () => {
  it("still reports August for 11:59 PM Manila time, one minute before month-end", () => {
    // 2026-08-31T15:59:00Z = 2026-08-31T23:59:00+08:00 (Manila)
    const { year, month } = currentManilaYearMonth(new Date("2026-08-31T15:59:00Z"));
    expect(year).toBe(2026);
    expect(month).toBe(8);
  });

  it("rolls over to September at the Manila midnight boundary, even though UTC is still August", () => {
    // 2026-08-31T16:01:00Z = 2026-09-01T00:01:00+08:00 (Manila) — naive UTC
    // month math would incorrectly still say August here.
    const { year, month } = currentManilaYearMonth(new Date("2026-08-31T16:01:00Z"));
    expect(year).toBe(2026);
    expect(month).toBe(9);
  });

  it("rolls over the year at the Dec 31 / Jan 1 Manila boundary", () => {
    // 2026-12-31T16:01:00Z = 2027-01-01T00:01:00+08:00 (Manila)
    const { year, month } = currentManilaYearMonth(new Date("2026-12-31T16:01:00Z"));
    expect(year).toBe(2027);
    expect(month).toBe(1);
  });
});
