import { MaintenanceFrequency } from "@prisma/client";
import { computeMaintenanceVisitDate, generateMaintenanceVisitDates } from "../src/modules/work-orders/maintenance-visit-schedule.util";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("computeMaintenanceVisitDate", () => {
  it("visit index 0 is always the start date itself, regardless of frequency", () => {
    const start = new Date("2027-01-15T00:00:00.000Z");
    for (const frequency of [
      MaintenanceFrequency.WEEKLY,
      MaintenanceFrequency.MONTHLY,
      MaintenanceFrequency.QUARTERLY,
      MaintenanceFrequency.SEMI_ANNUAL,
      MaintenanceFrequency.ANNUAL,
    ]) {
      expect(iso(computeMaintenanceVisitDate(start, frequency, 0))).toBe("2027-01-15");
    }
  });

  it("WEEKLY walks forward 7 days per visit", () => {
    const start = new Date("2027-01-01T00:00:00.000Z");
    expect(iso(computeMaintenanceVisitDate(start, MaintenanceFrequency.WEEKLY, 1))).toBe("2027-01-08");
    expect(iso(computeMaintenanceVisitDate(start, MaintenanceFrequency.WEEKLY, 4))).toBe("2027-01-29");
  });

  it("MONTHLY/QUARTERLY/SEMI_ANNUAL/ANNUAL walk forward by their respective month counts", () => {
    const start = new Date("2027-01-15T00:00:00.000Z");
    expect(iso(computeMaintenanceVisitDate(start, MaintenanceFrequency.MONTHLY, 1))).toBe("2027-02-15");
    expect(iso(computeMaintenanceVisitDate(start, MaintenanceFrequency.QUARTERLY, 1))).toBe("2027-04-15");
    expect(iso(computeMaintenanceVisitDate(start, MaintenanceFrequency.SEMI_ANNUAL, 1))).toBe("2027-07-15");
    expect(iso(computeMaintenanceVisitDate(start, MaintenanceFrequency.ANNUAL, 1))).toBe("2028-01-15");
  });

  it("CUSTOM has no defined interval and throws rather than guessing one", () => {
    const start = new Date("2027-01-15T00:00:00.000Z");
    expect(() => computeMaintenanceVisitDate(start, MaintenanceFrequency.CUSTOM, 1)).toThrow(/no defined interval/i);
  });
});

describe("generateMaintenanceVisitDates", () => {
  it("generates exactly `count` dates, evenly spaced by the frequency, starting at the given date", () => {
    const start = new Date("2027-01-01T00:00:00.000Z");
    const dates = generateMaintenanceVisitDates(start, MaintenanceFrequency.QUARTERLY, 4);
    expect(dates).toHaveLength(4);
    expect(dates.map(iso)).toEqual(["2027-01-01", "2027-04-01", "2027-07-01", "2027-10-01"]);
  });

  it("generates zero dates for zero visits", () => {
    const start = new Date("2027-01-01T00:00:00.000Z");
    expect(generateMaintenanceVisitDates(start, MaintenanceFrequency.MONTHLY, 0)).toHaveLength(0);
  });
});
