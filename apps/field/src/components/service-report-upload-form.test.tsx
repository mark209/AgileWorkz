import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ServiceReportType, WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { ServiceReportUploadForm } from "./service-report-upload-form";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const { listServiceReportTypesMock, uploadServiceReportMock } = vi.hoisted(() => ({
  listServiceReportTypesMock: vi.fn(),
  uploadServiceReportMock: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listServiceReportTypes: listServiceReportTypesMock, uploadServiceReport: uploadServiceReportMock };
});

function job(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: "wo1",
    workOrderNumber: "WO-2026-08-00001",
    customerId: "c1",
    siteId: "s1",
    workOrderType: "STANDALONE",
    standaloneReason: null,
    standaloneReasonType: null,
    status: "IN_PROGRESS",
    scheduledDate: null,
    description: null,
    startedAt: "2026-08-30T00:00:00.000Z",
    completedAt: null,
    customer: { id: "c1", name: "Acme Corp" },
    site: { id: "s1", label: "Main Building" },
    assignments: [],
    ...overrides,
  };
}

function reportType(overrides: Partial<ServiceReportType> = {}): ServiceReportType {
  return { code: "MAINTENANCE_CLEANING", label: "Maintenance / Cleaning", sortOrder: 0, ...overrides };
}

describe("ServiceReportUploadForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    listServiceReportTypesMock.mockResolvedValue([reportType()]);
  });

  it("renders nothing without service_reports.upload, and never fetches report types", () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => false });
    const { container } = render(<ServiceReportUploadForm workOrder={job()} />);
    expect(container).toBeEmptyDOMElement();
    expect(listServiceReportTypesMock).not.toHaveBeenCalled();
  });

  it("loads report types and disables submit until both a type and a file are chosen", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    render(<ServiceReportUploadForm workOrder={job()} />);

    const submit = await screen.findByRole("button", { name: /upload service report/i });
    expect(submit).toBeDisabled();
  });

  it("uploads with the work order's own customerId/siteId/workOrderId and the chosen type/file", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    uploadServiceReportMock.mockResolvedValue({ id: "sr1", serviceReportNumber: "SR-2026-08-00001", status: "PENDING_EXTRACTION" });
    render(<ServiceReportUploadForm workOrder={job()} />);

    const user = userEvent.setup();
    const select = await screen.findByLabelText(/report type/i);
    await user.selectOptions(select, "MAINTENANCE_CLEANING");

    const file = new File(["binary"], "photo.jpg", { type: "image/jpeg" });
    const fileInput = screen.getByLabelText(/photo or document/i);
    await user.upload(fileInput, file);

    const submit = screen.getByRole("button", { name: /upload service report/i });
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() =>
      expect(uploadServiceReportMock).toHaveBeenCalledWith("token-1", "c1", {
        siteId: "s1",
        workOrderId: "wo1",
        reportTypeCode: "MAINTENANCE_CLEANING",
        file,
      }),
    );
    expect(await screen.findByText(/SR-2026-08-00001/)).toBeInTheDocument();
  });

  it("surfaces an upload error without losing the loaded report types", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    uploadServiceReportMock.mockRejectedValue(new ApiError(400, "Unsupported file type"));
    render(<ServiceReportUploadForm workOrder={job()} />);

    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(/report type/i), "MAINTENANCE_CLEANING");
    await user.upload(screen.getByLabelText(/photo or document/i), new File(["x"], "f.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /upload service report/i }));

    expect(await screen.findByText(/unsupported file type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/report type/i)).toBeInTheDocument();
  });

  it("surfaces a report-types load error", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    listServiceReportTypesMock.mockRejectedValue(new ApiError(403, "Forbidden"));
    render(<ServiceReportUploadForm workOrder={job()} />);
    expect(await screen.findByText(/forbidden/i)).toBeInTheDocument();
  });

  // Phase 7 Wave 1 (F6.2, scoped mitigation) — the file itself can never
  // survive a lost session (a File object isn't serializable), but the
  // report-type selection is persisted to sessionStorage per Work Order so
  // a technician re-logging in mid-job doesn't have to re-pick it.

  it("restores a previously-selected report type from sessionStorage on mount", async () => {
    sessionStorage.setItem("sr-upload-draft:wo1", "MAINTENANCE_CLEANING");
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    render(<ServiceReportUploadForm workOrder={job()} />);

    const select = (await screen.findByLabelText(/report type/i)) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("MAINTENANCE_CLEANING"));
  });

  it("persists the report-type selection to sessionStorage, scoped to this Work Order", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    render(<ServiceReportUploadForm workOrder={job({ id: "wo-42" })} />);

    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(/report type/i), "MAINTENANCE_CLEANING");

    expect(sessionStorage.getItem("sr-upload-draft:wo-42")).toBe("MAINTENANCE_CLEANING");
  });

  it("clears the persisted draft once an upload succeeds", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    uploadServiceReportMock.mockResolvedValue({ id: "sr1", serviceReportNumber: "SR-2026-08-00001", status: "PENDING_EXTRACTION" });
    render(<ServiceReportUploadForm workOrder={job()} />);

    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(/report type/i), "MAINTENANCE_CLEANING");
    await user.upload(screen.getByLabelText(/photo or document/i), new File(["x"], "f.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /upload service report/i }));

    await waitFor(() => expect(sessionStorage.getItem("sr-upload-draft:wo1")).toBeNull());
  });
});
