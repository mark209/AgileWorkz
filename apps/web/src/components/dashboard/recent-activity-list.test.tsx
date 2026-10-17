import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RecentActivityList } from "./recent-activity-list";

describe("RecentActivityList", () => {
  it("renders each entry with a humanized action and its entity type", () => {
    render(
      <RecentActivityList
        entries={[
          { id: "a1", actorType: "USER", actorUserId: "u1", action: "service_report_locked", entityType: "ServiceReport", entityId: "sr-1", createdAt: "2026-08-30T00:00:00.000Z" },
        ]}
      />,
    );
    expect(screen.getByText(/service report locked/i)).toBeInTheDocument();
    expect(screen.getByText(/Service Report/)).toBeInTheDocument();
  });

  it("keeps older fetched activity available without crowding the initial dashboard", () => {
    const entries = Array.from({ length: 7 }, (_, index) => ({
      id: `a${index}`,
      actorType: "USER" as const,
      actorUserId: "u1",
      action: `action_${index}`,
      entityType: "Quotation",
      entityId: `q${index}`,
      createdAt: "2026-08-30T00:00:00.000Z",
    }));
    render(<RecentActivityList entries={entries} />);
    expect(screen.queryByText(/Action 6/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more activities" }));
    expect(screen.getByText(/Action 6/)).toBeInTheDocument();
  });
});
