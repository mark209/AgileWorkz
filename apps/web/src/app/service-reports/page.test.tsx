import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ServiceReportListItem } from "@/lib/api/service-report-verification";
import ServiceReportsQueuePage from "./page";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
const { useSearchParamsMock } = vi.hoisted(() => ({ useSearchParamsMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: useSearchParamsMock }));

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
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true, isLoading: false });
  });

  it("also requests failed extraction reports for Super Admin document review", async () => {
    listServiceReportsMock.mockResolvedValue([]);
    render(<ServiceReportsQueuePage />);
    await screen.findByText(/no reports to review/i);
    expect(listServiceReportsMock).toHaveBeenCalledWith("token-1", "EXTRACTION_FAILED,PENDING_VERIFICATION,VERIFIED,CONFIRMED");
  });

  it("labels review and lock destinations by status", async () => {
    listServiceReportsMock.mockResolvedValue([
      report({ id: "r1", status: "PENDING_VERIFICATION" }),
      report({ id: "r2", serviceReportNumber: "SR-0002", status: "VERIFIED" }),
      report({ id: "r3", serviceReportNumber: "SR-0003", status: "CONFIRMED" }),
    ]);
    render(<ServiceReportsQueuePage />);

    const reviewLinks = await screen.findAllByRole("link", { name: /review →/i });
    const verifyLink = reviewLinks[0];
    expect(verifyLink).toHaveAttribute("href", "/service-reports/r1/verify");

    const confirmLink = reviewLinks[1];
    expect(confirmLink).toHaveAttribute("href", "/service-reports/r2/verify");

    const lockLink = screen.getByRole("link", { name: /lock →/i });
    expect(lockLink).toHaveAttribute("href", "/service-reports/r3/canonical");
  });

  it("loads the status selected from a dashboard card", async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("status=VERIFIED"));
    listServiceReportsMock.mockResolvedValue([report({ status: "VERIFIED" })]);
    render(<ServiceReportsQueuePage />);
    await screen.findByText("SR-0001");
    expect(listServiceReportsMock).toHaveBeenCalledWith("token-1", "VERIFIED");
    expect(screen.getByRole("link", { name: "Clear status filter" })).toHaveAttribute("href", "/service-reports");
  });

  it("names the selected status when its queue is empty", async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("status=CONFIRMED"));
    listServiceReportsMock.mockResolvedValue([]);
    render(<ServiceReportsQueuePage />);
    expect(await screen.findByText("No reports with this status")).toBeInTheDocument();
    expect(screen.getByText("No Service Reports currently have status confirmed.")).toBeInTheDocument();
  });
});
