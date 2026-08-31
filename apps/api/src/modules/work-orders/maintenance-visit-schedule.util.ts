import { MaintenanceFrequency } from "@prisma/client";

const MONTHS_PER_INTERVAL: Partial<Record<MaintenanceFrequency, number>> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

/**
 * §08 — "each dated by walking frequency forward from a chosen start date."
 * visitIndex 0 is the start date itself; visitIndex N is N intervals later.
 * All arithmetic is UTC-based (scheduled_date is a DATE column, no time
 * component) so it never drifts with the server's local timezone.
 *
 * CUSTOM has no defined interval anywhere in the frozen schema — callers
 * MUST reject it before calling this function (WorkOrdersService does, with
 * a clear message); this throw is a defensive second layer, not the primary
 * guard.
 */
export function computeMaintenanceVisitDate(startDate: Date, frequency: MaintenanceFrequency, visitIndex: number): Date {
  if (frequency === MaintenanceFrequency.WEEKLY) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + 7 * visitIndex);
    return d;
  }

  const months = MONTHS_PER_INTERVAL[frequency];
  if (months === undefined) {
    throw new Error(`No defined interval for maintenance frequency ${frequency} — cannot compute a visit schedule`);
  }
  const d = new Date(startDate);
  d.setUTCMonth(d.getUTCMonth() + months * visitIndex);
  return d;
}

/** Generates `count` visit dates, index 0..count-1, per computeMaintenanceVisitDate. */
export function generateMaintenanceVisitDates(startDate: Date, frequency: MaintenanceFrequency, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => computeMaintenanceVisitDate(startDate, frequency, i));
}
