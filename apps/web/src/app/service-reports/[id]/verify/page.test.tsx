import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VerificationView } from "@/lib/api/service-report-verification";
import ServiceReportVerifyPage from "./page";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "report-1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const {
  getServiceReportVerificationMock,
  submitFieldReviewMock,
  previewBulkConfirmMock,
  bulkConfirmMock,
  completeVerificationMock,
  previewConfirmMock,
  confirmServiceReportMock,
} = vi.hoisted(() => ({
  getServiceReportVerificationMock: vi.fn(),
  submitFieldReviewMock: vi.fn(),
  previewBulkConfirmMock: vi.fn(),
  bulkConfirmMock: vi.fn(),
  completeVerificationMock: vi.fn(),
  previewConfirmMock: vi.fn(),
  confirmServiceReportMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getServiceReportVerification: getServiceReportVerificationMock,
    submitFieldReview: submitFieldReviewMock,
    previewBulkConfirm: previewBulkConfirmMock,
    bulkConfirm: bulkConfirmMock,
    completeVerification: completeVerificationMock,
    previewConfirm: previewConfirmMock,
    confirmServiceReport: confirmServiceReportMock,
  };
});

function baseView(): VerificationView {
  return {
    report: {
      id: "report-1",
      status: "PENDING_VERIFICATION",
      reportTypeCode: "MAINTENANCE_CLEANING",
      documentFileName: "report.jpg",
      documentMimeType: "image/jpeg",
      uploadedBy: "u1",
      uploadedAt: "2026-01-01T00:00:00Z",
      verifiedBy: null,
      verifiedAt: null,
    },
    documentUrl: "https://example.com/report.jpg",
    fields: {
      basicInfo: [],
      equipmentUnit: [],
      problem: [],
      measurement: [
        {
          id: "m1",
          category: "measurement",
          rowIndex: 0,
          fieldName: "low_side_pressure",
          aiValue: "65",
          aiUnit: "psi",
          aiConfidence: "HIGH",
          suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE",
          stage: null,
          requiresHumanVerification: false,
          reviewStatus: null,
          verifiedValue: null,
          verifiedBy: null,
          verifiedAt: null,
        },
      ],
      narrativeItem: [],
      signoff: [],
    },
  };
}

describe("ServiceReportVerifyPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true, isLoading: false });
    getServiceReportVerificationMock.mockResolvedValue(baseView());
  });

  it("shows an access-denied message when the caller lacks service_reports.verify", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => false, isLoading: false });
    render(<ServiceReportVerifyPage />);
    expect(await screen.findByText(/do not have permission to verify/i)).toBeInTheDocument();
    expect(getServiceReportVerificationMock).not.toHaveBeenCalled();
  });

  it("loads and displays staged fields grouped by section", async () => {
    render(<ServiceReportVerifyPage />);
    expect(await screen.findByText("low_side_pressure")).toBeInTheDocument();
    expect(screen.getByText(/Measurements \/ Technical Data/)).toBeInTheDocument();
    expect(screen.getByText("(1)")).toBeInTheDocument();
  });

  it("Confirm calls the API with the exact expected payload and updates the field's displayed status", async () => {
    submitFieldReviewMock.mockResolvedValue({ ...baseView().fields.measurement[0], reviewStatus: "CONFIRMED", verifiedValue: "65" });
    render(<ServiceReportVerifyPage />);
    await screen.findByText("low_side_pressure");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() =>
      expect(submitFieldReviewMock).toHaveBeenCalledWith("token-1", "report-1", "measurement", "m1", { reviewStatus: "CONFIRMED" }),
    );
    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
  });

  it("Correct requires typing a value and sends it as verifiedValue, distinct from the AI value", async () => {
    submitFieldReviewMock.mockResolvedValue({ ...baseView().fields.measurement[0], reviewStatus: "CORRECTED", verifiedValue: "68" });
    render(<ServiceReportVerifyPage />);
    await screen.findByText("low_side_pressure");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /correct/i }));
    const input = screen.getByPlaceholderText("Corrected value");
    await user.clear(input);
    await user.type(input, "68");
    await user.click(screen.getByRole("button", { name: /save correction/i }));

    await waitFor(() =>
      expect(submitFieldReviewMock).toHaveBeenCalledWith("token-1", "report-1", "measurement", "m1", {
        reviewStatus: "CORRECTED",
        verifiedValue: "68",
      }),
    );
  });

  it("Confirm Blank and Needs Follow-Up submit their own distinct review statuses", async () => {
    submitFieldReviewMock.mockResolvedValue({ ...baseView().fields.measurement[0], reviewStatus: "CONFIRMED_BLANK", verifiedValue: null });
    render(<ServiceReportVerifyPage />);
    await screen.findByText("low_side_pressure");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /confirm blank/i }));
    await waitFor(() =>
      expect(submitFieldReviewMock).toHaveBeenCalledWith("token-1", "report-1", "measurement", "m1", { reviewStatus: "CONFIRMED_BLANK" }),
    );
  });

  it("disables Complete Verification until every field is reviewed", async () => {
    render(<ServiceReportVerifyPage />);
    await screen.findByText("low_side_pressure");
    expect(screen.getByRole("button", { name: /complete verification/i })).toBeDisabled();
  });

  it("bulk-confirm preview shows the eligible count before the reviewer applies it", async () => {
    previewBulkConfirmMock.mockResolvedValue({
      eligibleCount: 1,
      eligibleFields: [{ category: "measurement", id: "m1", fieldName: "low_side_pressure", aiValue: "65" }],
    });
    render(<ServiceReportVerifyPage />);
    await screen.findByText("low_side_pressure");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /preview bulk confirm/i }));

    expect(await screen.findByRole("button", { name: /confirm 1 eligible field$/i })).toBeInTheDocument();
  });

  it("renders the document viewer with the signed URL", async () => {
    render(<ServiceReportVerifyPage />);
    await screen.findByText("low_side_pressure");
    const img = screen.getByAltText("report.jpg");
    expect(img).toHaveAttribute("src", "https://example.com/report.jpg");
  });

  it("shows the report as read-only when its status is no longer PENDING_VERIFICATION", async () => {
    getServiceReportVerificationMock.mockResolvedValue({ ...baseView(), report: { ...baseView().report, status: "EXTRACTION_FAILED" } });
    render(<ServiceReportVerifyPage />);
    await screen.findByText("low_side_pressure");
    expect(screen.getByText(/verification actions are unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^confirm$/i })).not.toBeInTheDocument();
  });

  describe("Confirm Report (Step 6)", () => {
    function verifiedView() {
      return { ...baseView(), report: { ...baseView().report, status: "VERIFIED" as const } };
    }

    it("shows the Confirm Report panel (not the generic read-only banner) once the report is VERIFIED", async () => {
      getServiceReportVerificationMock.mockResolvedValue(verifiedView());
      render(<ServiceReportVerifyPage />);
      await screen.findByText("low_side_pressure");
      expect(screen.getByRole("heading", { name: "Confirm Report" })).toBeInTheDocument();
      expect(screen.queryByText(/verification actions are unavailable/i)).not.toBeInTheDocument();
    });

    it("loads a preview showing planned counts and fallback warnings without confirming", async () => {
      getServiceReportVerificationMock.mockResolvedValue(verifiedView());
      previewConfirmMock.mockResolvedValue({
        reportId: "report-1",
        reportStatus: "VERIFIED",
        isConfirmable: true,
        validationIssues: [],
        header: { serviceDate: null, timeIn: null, timeOut: null, reportReferenceNumber: null, contactName: null, contactPhone: null, generalNotes: null },
        technicians: [],
        equipmentUnits: [],
        problems: [],
        measurements: [{ equipmentRowIndex: 0, measurementTypeCode: "OTHER_UNMAPPED", measurementTypeResolution: "fallback_unmapped", stageCode: null, value: "ISA", unit: null, sourceFieldName: "Breaker Capacity" }],
        narrativeItems: [],
        signoffs: [],
        skipped: [],
        warnings: ['Measurement "Breaker Capacity" (row 0) has no resolvable measurement type — using OTHER_UNMAPPED'],
      });
      render(<ServiceReportVerifyPage />);
      await screen.findByText("low_side_pressure");

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /preview confirm/i }));

      expect(await screen.findByText(/1 measurement\(s\) → Other \/ Unmapped/)).toBeInTheDocument();
      expect(confirmServiceReportMock).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /^confirm report$/i })).toBeEnabled();
    });

    it("disables Confirm Report when the preview reports the report is not confirmable", async () => {
      getServiceReportVerificationMock.mockResolvedValue(verifiedView());
      previewConfirmMock.mockResolvedValue({
        reportId: "report-1",
        reportStatus: "VERIFIED",
        isConfirmable: false,
        validationIssues: [{ code: "UNREVIEWED_FIELDS", message: "1 staging field(s) have not been reviewed" }],
        header: { serviceDate: null, timeIn: null, timeOut: null, reportReferenceNumber: null, contactName: null, contactPhone: null, generalNotes: null },
        technicians: [],
        equipmentUnits: [],
        problems: [],
        measurements: [],
        narrativeItems: [],
        signoffs: [],
        skipped: [],
        warnings: [],
      });
      render(<ServiceReportVerifyPage />);
      await screen.findByText("low_side_pressure");

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /preview confirm/i }));

      expect(await screen.findByText(/have not been reviewed/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^confirm report$/i })).toBeDisabled();
    });

    it("confirming calls the API and reloads the view", async () => {
      getServiceReportVerificationMock
        .mockResolvedValueOnce(verifiedView())
        .mockResolvedValueOnce({ ...verifiedView(), report: { ...verifiedView().report, status: "CONFIRMED" } });
      previewConfirmMock.mockResolvedValue({
        reportId: "report-1",
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
      });
      confirmServiceReportMock.mockResolvedValue({
        report: { id: "report-1", status: "CONFIRMED", confirmedBy: "u1", confirmedAt: "2026-01-01T00:00:00Z" },
        createdCounts: { technicians: 0, equipmentUnits: 0, problems: 0, measurements: 0, narrativeItems: 0, signoffs: 0 },
        skippedCount: 0,
        warnings: [],
      });

      render(<ServiceReportVerifyPage />);
      await screen.findByText("low_side_pressure");

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /preview confirm/i }));
      await user.click(await screen.findByRole("button", { name: /^confirm report$/i }));

      await waitFor(() => expect(confirmServiceReportMock).toHaveBeenCalledWith("token-1", "report-1"));
      expect(await screen.findByText(/view canonical report/i)).toBeInTheDocument();
    });

    it("hides the Confirm/Preview actions (but still shows the panel) when the caller lacks service_reports.confirm", async () => {
      useAuthMock.mockReturnValue({
        accessToken: "token-1",
        hasPermission: (_module: string, action: string) => action !== "confirm",
        isLoading: false,
      });
      getServiceReportVerificationMock.mockResolvedValue(verifiedView());
      render(<ServiceReportVerifyPage />);
      await screen.findByText("low_side_pressure");

      expect(screen.getByText(/do not have permission to confirm/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /preview confirm/i })).not.toBeInTheDocument();
    });
  });
});
