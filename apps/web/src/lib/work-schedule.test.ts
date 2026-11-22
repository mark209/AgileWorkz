import { describe, expect, it } from "vitest";
import type { WorkOrder } from "./api/types";
import { classifySchedule, filterSchedule, scheduleCounts, scheduleDateKey, scheduleToday } from "./work-schedule";

const today = "2026-11-20";
function order(id: string, scheduledDate: string | null, status: WorkOrder["status"] = "SCHEDULED", overrides: Partial<WorkOrder> = {}): WorkOrder {
  return { id, workOrderNumber: `WO-${id}`, status, scheduledDate, description: "AC cleaning", customerId: "customer-1", siteId: "site-1",
    customer: { id: "customer-1", name: "Demo Company" }, site: { id: "site-1", label: "Main Office" }, assignments: [], ...overrides } as WorkOrder;
}

describe("Work Schedule", () => {
  it("uses the Manila business day across UTC midnight boundaries", () => {
    expect(scheduleToday(new Date("2026-11-19T15:59:59Z"))).toBe("2026-11-19");
    expect(scheduleToday(new Date("2026-11-19T16:00:00Z"))).toBe(today);
    expect(scheduleToday(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
  });

  it("preserves database date-only values without browser timezone shifts and handles invalid dates", () => {
    expect(scheduleDateKey("2026-11-20T00:00:00.000Z")).toBe(today);
    expect(scheduleDateKey("2026-11-20")).toBe(today);
    expect(scheduleDateKey("2026-02-30")).toBeNull();
    expect(scheduleDateKey("invalid")).toBeNull();
    expect(scheduleDateKey(null)).toBeNull();
  });

  it("classifies active orders and excludes completed/closed/cancelled orders from active counts", () => {
    const rows = [order("past", "2026-11-19"), order("now", today), order("next", "2026-11-21"), order("none", null),
      order("bad", "invalid"), order("done", "2026-11-01", "COMPLETED"), order("closed", null, "CLOSED"), order("cancelled", "2026-11-02", "CANCELLED")];
    expect(rows.map(row => classifySchedule(row, today))).toEqual(["overdue", "today", "upcoming", "unscheduled", "unscheduled", "finished", "finished", "finished"]);
    expect(scheduleCounts(rows, today)).toEqual({ overdue: 1, today: 1, upcoming: 1, unscheduled: 2 });
  });

  it("filters active technician assignments, customer, text and status, and sorts chronologically with unscheduled last", () => {
    const assignment = { id: "a1", technicianId: "tech-1", assignedAt: "2026-11-01", technician: { id: "tech-1", fullName: "Jamie" } };
    const rows = [order("next", "2026-11-22"), order("none", null), order("past", "2026-11-19", "IN_PROGRESS", { assignments: [assignment] }), order("done", today, "COMPLETED")];
    expect(filterSchedule(rows, {}, today).map(row => row.id)).toEqual(["past", "next", "none"]);
    expect(filterSchedule(rows, { technicianId: "tech-1", customerId: "customer-1", search: "jamie" }, today).map(row => row.id)).toEqual(["past"]);
    expect(filterSchedule(rows, { customerId: "other" }, today)).toEqual([]);
    expect(filterSchedule(rows, { status: "COMPLETED" }, today).map(row => row.id)).toEqual(["done"]);
    expect(filterSchedule(rows, { category: "overdue" }, today).map(row => row.id)).toEqual(["past"]);
  });

  it("uses inclusive date bounds and excludes undated records only while a date range is selected", () => {
    const rows = [order("before", "2026-11-19"), order("today", today), order("after", "2026-11-21"), order("none", null)];
    expect(filterSchedule(rows, { from: today, to: today }, today).map(row => row.id)).toEqual(["today"]);
    expect(filterSchedule(rows, { status: "all" }, today)).toHaveLength(4);
  });

  it("reflects rescheduling, new records and completion directly from refreshed Work Orders", () => {
    const initial = [order("job", "2026-11-19")];
    expect(scheduleCounts(initial, today).overdue).toBe(1);
    const rescheduled = [{ ...initial[0], scheduledDate: "2026-11-21" }, order("new", today)];
    expect(scheduleCounts(rescheduled, today)).toEqual({ overdue: 0, today: 1, upcoming: 1, unscheduled: 0 });
    expect(scheduleCounts([{ ...rescheduled[0], status: "COMPLETED" }], today).upcoming).toBe(0);
  });
});
