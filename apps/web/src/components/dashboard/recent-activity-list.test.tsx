import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText(/ServiceReport/)).toBeInTheDocument();
  });
});
