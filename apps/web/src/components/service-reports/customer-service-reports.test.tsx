import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CustomerServiceReports } from "./customer-service-reports";

const { useAuthMock, listReportsMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  listReportsMock: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listServiceReportsForCustomer: listReportsMock };
});
vi.mock("./direct-report-upload-dialog", () => ({ DirectReportUploadDialog: () => null }));

describe("CustomerServiceReports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      accessToken: "token-1",
      hasPermission: () => true,
    });
  });

  it("opens confirmed and locked reports in the canonical viewer", async () => {
    listReportsMock.mockResolvedValue([
      { id: "pending", serviceReportNumber: "SR-001", status: "PENDING_VERIFICATION", uploadedAt: "2026-01-01T00:00:00Z" },
      { id: "verified", serviceReportNumber: "SR-002", status: "VERIFIED", uploadedAt: "2026-01-01T00:00:00Z" },
      { id: "confirmed", serviceReportNumber: "SR-003", status: "CONFIRMED", uploadedAt: "2026-01-01T00:00:00Z" },
      { id: "locked", serviceReportNumber: "SR-004", status: "LOCKED", uploadedAt: "2026-01-01T00:00:00Z" },
    ]);

    render(<CustomerServiceReports customerId="customer-1" sites={[]} />);

    expect(await screen.findByRole("link", { name: "SR-001" })).toHaveAttribute("href", "/service-reports/pending/verify");
    expect(screen.getByRole("link", { name: "SR-002" })).toHaveAttribute("href", "/service-reports/verified/verify");
    expect(screen.getByRole("link", { name: "SR-003" })).toHaveAttribute("href", "/service-reports/confirmed/canonical");
    expect(screen.getByRole("link", { name: "SR-004" })).toHaveAttribute("href", "/service-reports/locked/canonical");
  });
});
