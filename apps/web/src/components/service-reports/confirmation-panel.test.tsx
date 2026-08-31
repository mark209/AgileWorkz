import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmationPanel } from "./confirmation-panel";
import type { ConfirmationPlan } from "@/lib/api/service-report-confirmation";

function plan(overrides: Partial<ConfirmationPlan> = {}): ConfirmationPlan {
  return {
    reportId: "sr-1",
    reportStatus: "VERIFIED",
    isConfirmable: true,
    validationIssues: [],
    header: { serviceDate: null, timeIn: null, timeOut: null, reportReferenceNumber: null, contactName: null, contactPhone: null, generalNotes: null },
    technicians: [],
    equipmentUnits: [],
    problems: [],
    measurements: [],
    narrativeItems: [],
    signoffs: [],
    skipped: [],
    warnings: [],
    ...overrides,
  };
}

describe("ConfirmationPanel", () => {
  it("hides the preview/confirm actions when the caller lacks service_reports.confirm", () => {
    render(<ConfirmationPanel canConfirm={false} onLoadPreview={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText(/do not have permission to confirm/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /preview confirm/i })).not.toBeInTheDocument();
  });

  it("loads and displays the preview without confirming", async () => {
    const onLoadPreview = vi.fn().mockResolvedValue(plan({ equipmentUnits: [{ rowIndex: 0, equipmentTypeCode: "OTHER", equipmentTypeResolution: "fallback_other", unitTag: "AC#1", description: "x", location: null, modelNumber: null, serialNumber: null }] }));
    const onConfirm = vi.fn();
    render(<ConfirmationPanel canConfirm onLoadPreview={onLoadPreview} onConfirm={onConfirm} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /preview confirm/i }));

    expect(await screen.findByText("1 equipment unit(s)")).toBeInTheDocument();
    expect(screen.getByText(/1 equipment unit\(s\) → Other/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables Confirm Report and shows validation issues when the plan is not confirmable", async () => {
    const onLoadPreview = vi.fn().mockResolvedValue(
      plan({ isConfirmable: false, validationIssues: [{ code: "NEEDS_FOLLOW_UP", message: "1 staging field(s) are flagged NEEDS_FOLLOW_UP" }] }),
    );
    render(<ConfirmationPanel canConfirm onLoadPreview={onLoadPreview} onConfirm={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /preview confirm/i }));

    expect(await screen.findByText(/flagged NEEDS_FOLLOW_UP/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^confirm report$/i })).toBeDisabled();
  });

  it("shows warnings and skipped (all-blank) groups from the preview", async () => {
    const onLoadPreview = vi.fn().mockResolvedValue(
      plan({
        skipped: [{ category: "equipmentUnit", rowIndex: 2, reason: "every field in this equipment unit group is blank" }],
        warnings: ["Equipment unit (row 2) could not be matched to a known equipment type — using OTHER"],
      }),
    );
    render(<ConfirmationPanel canConfirm onLoadPreview={onLoadPreview} onConfirm={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /preview confirm/i }));

    expect(await screen.findByText(/entirely blank — no record will be created/i)).toBeInTheDocument();
    expect(screen.getByText(/could not be matched to a known equipment type/i)).toBeInTheDocument();
  });

  it("calls onConfirm when Confirm Report is clicked", async () => {
    const onLoadPreview = vi.fn().mockResolvedValue(plan());
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmationPanel canConfirm onLoadPreview={onLoadPreview} onConfirm={onConfirm} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /preview confirm/i }));
    await user.click(await screen.findByRole("button", { name: /^confirm report$/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("surfaces an error message when loading the preview fails", async () => {
    const onLoadPreview = vi.fn().mockRejectedValue(new Error("Network error"));
    render(<ConfirmationPanel canConfirm onLoadPreview={onLoadPreview} onConfirm={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /preview confirm/i }));

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });
});
