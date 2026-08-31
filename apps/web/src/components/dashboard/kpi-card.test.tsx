import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCard } from "./kpi-card";

describe("KpiCard", () => {
  it("renders as a real link when href is provided", () => {
    render(<KpiCard label="Active Customers" value={12} href="/customers" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/customers");
    expect(screen.getByText("Active Customers")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("renders as plain, non-interactive content when href is omitted (informational-only)", () => {
    render(<KpiCard label="Work Orders — Scheduled" value={3} note="Work Order detail pages are not yet available." />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Work Order detail pages are not yet available.")).toBeInTheDocument();
  });
});
