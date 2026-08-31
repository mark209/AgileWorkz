import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FieldStatusBadge } from "./field-status-badge";

describe("FieldStatusBadge", () => {
  it("renders the correct label for each of the 8 field states", () => {
    const cases: Array<[Parameters<typeof FieldStatusBadge>[0]["status"], string]> = [
      ["needs-follow-up", "Needs Follow-Up"],
      ["unresolved", "Unreadable / Unresolved"],
      ["requires-verification", "Requires Human Verification"],
      ["low-confidence", "Low Confidence"],
      ["blank", "Blank"],
      ["high-confidence", "High Confidence"],
      ["confirmed", "Confirmed"],
      ["corrected", "Corrected"],
      ["confirmed-blank", "Confirmed Blank"],
    ];
    for (const [status, label] of cases) {
      const { unmount } = render(<FieldStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});
