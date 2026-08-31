import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CanonicalServiceReportView } from "@/lib/api/service-report-confirmation";
import CanonicalServiceReportPage from "./page";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "report-1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { getCanonicalServiceReportMock, lockServiceReportMock } = vi.hoisted(() => ({
  getCanonicalServiceReportMock: vi.fn(),
  lockServiceReportMock: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, getCanonicalServiceReport: getCanonicalServiceReportMock, lockServiceReport: lockServiceReportMock };
});

function baseView(): CanonicalServiceReportView {
  return {
    report: {
      id: "report-1",
      status: "CONFIRMED",
      serviceReportNumber: "SR-0119",
      serviceDate: "2026-08-27T00:00:00.000Z",
      timeIn: null,
      timeOut: null,
      reportReferenceNumber: "SR-0119",
      contactName: null,
      contactPhone: null,
      generalNotes: null,
      confirmedBy: "u1",
      confirmedAt: "2026-08-30T00:00:00.000Z",
    },
    technicians: [{ id: "t1", technicianName: "Juan Dela Cruz" }],
    equipmentUnits: [{ id: "e1", equipmentTypeCode: "OTHER", unitTag: "AC#1", description: "Split unit", location: null, modelNumber: null, serialNumber: null }],
    problems: [{ id: "p1", problemTypeCode: "NOT_OPERATIONAL", description: "NOT OPERATIONAL", equipmentUnitId: "e1" }],
    measurements: [{ id: "m1", measurementTypeCode: "OTHER_UNMAPPED", stageCode: null, value: "ISA", unit: null, sourceFieldName: "Breaker Capacity", equipmentUnitId: "e1" }],
    narrativeItems: [],
    signoffs: [{ id: "s1", signoffRoleCode: "TECHNICIAN", signatoryName: "John Arnold Candia", signed: true }],
  };
}

describe("CanonicalServiceReportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true, isLoading: false });
    getCanonicalServiceReportMock.mockResolvedValue(baseView());
  });

  it("shows an access-denied message when the caller lacks service_reports.read", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => false, isLoading: false });
    render(<CanonicalServiceReportPage />);
    expect(await screen.findByText(/do not have permission to view/i)).toBeInTheDocument();
    expect(getCanonicalServiceReportMock).not.toHaveBeenCalled();
  });

  it("loads and displays the canonical data across every section", async () => {
    render(<CanonicalServiceReportPage />);
    expect(await screen.findByText("Juan Dela Cruz")).toBeInTheDocument();
    expect(screen.getByText("Split unit")).toBeInTheDocument();
    expect(screen.getByText("NOT OPERATIONAL")).toBeInTheDocument();
    expect(screen.getByText("Breaker Capacity")).toBeInTheDocument();
    expect(screen.getByText("ISA")).toBeInTheDocument();
    expect(screen.getByText("John Arnold Candia")).toBeInTheDocument();
  });

  it("shows the report number and status", async () => {
    render(<CanonicalServiceReportPage />);
    expect(await screen.findByRole("heading", { name: /SR-0119/ })).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  describe("Lock (Step 7)", () => {
    it("shows the Lock Report action for a CONFIRMED report when the caller holds service_reports.lock", async () => {
      render(<CanonicalServiceReportPage />);
      expect(await screen.findByRole("button", { name: /^lock report$/i })).toBeInTheDocument();
    });

    it("hides the Lock Report action when the caller lacks service_reports.lock", async () => {
      useAuthMock.mockReturnValue({
        accessToken: "token-1",
        hasPermission: (_module: string, action: string) => action !== "lock",
        isLoading: false,
      });
      render(<CanonicalServiceReportPage />);
      await screen.findByText("Juan Dela Cruz");
      expect(screen.queryByRole("button", { name: /^lock report$/i })).not.toBeInTheDocument();
    });

    it("hides the Lock Report action once the report is already LOCKED", async () => {
      getCanonicalServiceReportMock.mockResolvedValue({ ...baseView(), report: { ...baseView().report, status: "LOCKED" } });
      render(<CanonicalServiceReportPage />);
      expect(await screen.findByText("Locked")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^lock report$/i })).not.toBeInTheDocument();
    });

    it("locking calls the API only after the confirmation dialog is accepted, then reloads as LOCKED", async () => {
      lockServiceReportMock.mockResolvedValue({ id: "report-1", status: "LOCKED", lockedBy: "u1", lockedAt: "2026-08-30T00:00:00.000Z" });
      getCanonicalServiceReportMock
        .mockResolvedValueOnce(baseView())
        .mockResolvedValueOnce({ ...baseView(), report: { ...baseView().report, status: "LOCKED" } });

      render(<CanonicalServiceReportPage />);
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: /^lock report$/i }));

      const dialog = await screen.findByRole("dialog");
      expect(lockServiceReportMock).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole("button", { name: /^lock report$/i }));

      await waitFor(() => expect(lockServiceReportMock).toHaveBeenCalledWith("token-1", "report-1"));
      expect(await screen.findByText("Locked")).toBeInTheDocument();
    });
  });
});
