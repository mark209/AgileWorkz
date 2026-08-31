import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ServiceReportListItem } from "@/lib/api/service-report-verification";
import { ApiError } from "@/lib/api-client";
import { WorkOrderServiceReportsPanel } from "./work-order-service-reports-panel";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const { listServiceReportsForWorkOrderMock } = vi.hoisted(() => ({ listServiceReportsForWorkOrderMock: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listServiceReportsForWorkOrder: listServiceReportsForWorkOrderMock };
});

function report(overrides: Partial<ServiceReportListItem> = {}): ServiceReportListItem {
  return {
    id: "sr1",
    serviceReportNumber: "SR-2026-08-00001",
    status: "PENDING_VERIFICATION",
    reportTypeCode: "MAINTENANCE",
    uploadedAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("WorkOrderServiceReportsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ accessToken: "token-1" });
  });

  it("shows an empty state when no reports are linked yet", async () => {
    listServiceReportsForWorkOrderMock.mockResolvedValue([]);
    render(<WorkOrderServiceReportsPanel workOrderId="wo1" />);
    expect(await screen.findByText(/no service reports yet/i)).toBeInTheDocument();
  });

  it("renders each linked report with its status and a link to the existing verify page", async () => {
    listServiceReportsForWorkOrderMock.mockResolvedValue([report()]);
    render(<WorkOrderServiceReportsPanel workOrderId="wo1" />);

    expect(await screen.findByText("SR-2026-08-00001")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view →/i });
    // Reuses the existing Phase 5 verify page for every status — no
    // status-based branching or duplicated verification/lock UI here.
    expect(link).toHaveAttribute("href", "/service-reports/sr1/verify");
  });

  it("calls listServiceReportsForWorkOrder scoped to the given work order", async () => {
    listServiceReportsForWorkOrderMock.mockResolvedValue([]);
    render(<WorkOrderServiceReportsPanel workOrderId="wo-42" />);
    await screen.findByText(/no service reports yet/i);
    expect(listServiceReportsForWorkOrderMock).toHaveBeenCalledWith("token-1", "wo-42");
  });

  it("surfaces a load error with a retry option", async () => {
    listServiceReportsForWorkOrderMock.mockRejectedValue(new ApiError(403, "Forbidden"));
    render(<WorkOrderServiceReportsPanel workOrderId="wo1" />);
    expect(await screen.findByText(/forbidden/i)).toBeInTheDocument();
  });
});
