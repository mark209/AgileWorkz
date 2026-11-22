import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApprovalStages } from "./approval-stages";

describe("Report approval stage presentation", () => {
  it.each([
    ["PENDING_VERIFICATION", "Supervisor review"],
    ["EXTRACTION_FAILED", "Supervisor review"],
    ["VERIFIED", "Final approval"],
    ["CONFIRMED", "Administrative lock"],
  ])("shows the existing next stage for %s", (status, label) => {
    render(<ApprovalStages status={status} />);
    const stages = screen.getByRole("list", { name: "Report approval stages" });
    expect(within(stages).getAllByRole("listitem")).toHaveLength(3);
    expect(stages.querySelector('[aria-current="step"]')).toHaveTextContent(label);
  });
  it("does not imply extraction-pending reports are ready for approval", () => {
    render(<ApprovalStages status="PENDING_EXTRACTION" />);
    expect(screen.queryByText("Current stage")).not.toBeInTheDocument();
    expect(screen.getAllByText("Upcoming")).toHaveLength(3);
  });
  it("marks all stages complete only after administrative lock", () => {
    render(<ApprovalStages status="LOCKED" />);
    expect(screen.getAllByText("Complete")).toHaveLength(3);
    expect(screen.queryByText("Current stage")).not.toBeInTheDocument();
  });
});
