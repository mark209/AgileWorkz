import type { WorkOrder, WorkOrderStatus } from "./api/types";

export const SCHEDULE_TIME_ZONE = "Asia/Manila";
export const SCHEDULE_CATEGORIES = ["overdue", "today", "upcoming", "unscheduled"] as const;
export type ScheduleCategory = typeof SCHEDULE_CATEGORIES[number];
export const SCHEDULE_LABELS: Record<ScheduleCategory | "finished", string> = {
  overdue: "Overdue", today: "Due Today", upcoming: "Upcoming", unscheduled: "Unscheduled", finished: "Finished",
};
const FINISHED = new Set<WorkOrderStatus>(["COMPLETED", "CLOSED", "CANCELLED"]);
const businessDay = new Intl.DateTimeFormat("en-US", { timeZone: SCHEDULE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const dayLabel = new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });

export function scheduleToday(now = new Date()): string {
  const parts = businessDay.formatToParts(now);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}

// scheduled_date is a PostgreSQL DATE, serialized by Prisma at UTC midnight.
// Preserve its calendar date instead of converting it to the browser timezone.
export function scheduleDateKey(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const key = value.slice(0, 10);
  const date = new Date(`${key}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : null;
}

export function formatScheduleDay(key: string): string {
  return dayLabel.format(new Date(`${key}T00:00:00Z`));
}

export function classifySchedule(order: Pick<WorkOrder, "status" | "scheduledDate">, today: string): ScheduleCategory | "finished" {
  if (FINISHED.has(order.status)) return "finished";
  const day = scheduleDateKey(order.scheduledDate);
  return !day ? "unscheduled" : day < today ? "overdue" : day === today ? "today" : "upcoming";
}

export function scheduleCounts(orders: WorkOrder[], today: string): Record<ScheduleCategory, number> {
  const counts = { overdue: 0, today: 0, upcoming: 0, unscheduled: 0 };
  for (const order of orders) {
    const category = classifySchedule(order, today);
    if (category !== "finished") counts[category]++;
  }
  return counts;
}

export interface ScheduleFilters {
  search?: string;
  technicianId?: string;
  customerId?: string;
  status?: WorkOrderStatus | "active" | "all";
  category?: ScheduleCategory | "all";
  from?: string;
  to?: string;
}

export function filterSchedule(orders: WorkOrder[], filters: ScheduleFilters, today: string): WorkOrder[] {
  const search = filters.search?.trim().toLowerCase();
  const status = filters.status ?? "active";
  return orders.filter(order => {
    const day = scheduleDateKey(order.scheduledDate);
    const category = classifySchedule(order, today);
    if (status === "active" ? FINISHED.has(order.status) : status !== "all" && order.status !== status) return false;
    if (filters.category && filters.category !== "all" && category !== filters.category) return false;
    if (filters.technicianId && !order.assignments.some(assignment => assignment.technicianId === filters.technicianId)) return false;
    if (filters.customerId && order.customerId !== filters.customerId) return false;
    if (filters.from && (!day || day < filters.from)) return false;
    if (filters.to && (!day || day > filters.to)) return false;
    return !search || [order.workOrderNumber, order.description, order.standaloneReason, order.customer?.name, order.site?.label,
      ...order.assignments.map(assignment => assignment.technician.fullName)].some(value => value?.toLowerCase().includes(search));
  }).sort((a, b) => (scheduleDateKey(a.scheduledDate) ?? "9999").localeCompare(scheduleDateKey(b.scheduledDate) ?? "9999") || a.workOrderNumber.localeCompare(b.workOrderNumber));
}
