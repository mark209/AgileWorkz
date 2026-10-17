import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ServiceReportListItem } from "@/lib/api/service-report-verification";
import ServiceReportsQueuePage from "./page";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const { listServiceReportsMock } = vi.hoisted(() => ({ listServiceReportsMock: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listServiceReports: listServiceReportsMock };
});

function report(overrides: Partial<ServiceReportListItem> = {}): ServiceReportListItem {
  return { id: "r1", serviceReportNumber: "SR-0001", status: "PENDING_VERIFICATION", reportTypeCode: "MAINTENANCE_CLEANING", uploadedAt: "2026-01-01T00:00:00Z", ...overrides };
}

describe("ServiceReportsQueuePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true, isLoading: false });
  });

  it("requests PENDING_VERIFICATION, VERIFIED, and CONFIRMED reports, so Confirm- and Lock-eligible reports are reachable too", async () => {
    listServiceReportsMock.mockResolvedValue([]);
    render(<ServiceReportsQueuePage />);
    await screen.findByText(/no reports to review/i);
    expect(listServiceReportsMock).toHaveBeenCalledWith("token-1", "PENDING_VERIFICATION,VERIFIED,CONFIRMED");
  });

  it("labels each row's action link and target by status: Verify/PENDING_VERIFICATION, Confirm/VERIFIED, Lock/CONFIRMED", async () => {
    listServiceReportsMock.mockResolvedValue([
      report({ id: "r1", status: "PENDING_VERIFICATION" }),
      report({ id: "r2", serviceReportNumber: "SR-0002", status: "VERIFIED" }),
      report({ id: "r3", serviceReportNumber: "SR-0003", status: "CONFIRMED" }),
    ]);
    render(<ServiceReportsQueuePage />);

    const verifyLink = await screen.findByRole("link", { name: /verify →/i });
    expect(verifyLink).toHaveAttribute("href", "/service-reports/r1/verify");

    const confirmLink = screen.getByRole("link", { name: /confirm →/i });
    expect(confirmLink).toHaveAttribute("href", "/service-reports/r2/verify");

    const lockLink = screen.getByRole("link", { name: /lock →/i });
    expect(lockLink).toHaveAttribute("href", "/service-reports/r3/canonical");
  });
});
