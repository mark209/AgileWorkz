import { statusBadgeStyle } from "@/lib/styles";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export function StatusBadge({ status }: { status: string }) {
  return <span style={statusBadgeStyle(status)}>{STATUS_LABEL[status] ?? status}</span>;
}
