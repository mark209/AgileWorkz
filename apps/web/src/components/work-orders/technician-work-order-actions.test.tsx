import { OutcomeProvider } from "@/components/shared/outcome-provider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render as baseRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkOrder } from "@/lib/api/types";
import { ApiError } from "@/lib/api-client";
import { TechnicianWorkOrderActions } from "./technician-work-order-actions";

const { useAuthMock, startMock, uploadMock, typesMock, fieldCompleteMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(), startMock: vi.fn(), uploadMock: vi.fn(), typesMock: vi.fn(), fieldCompleteMock: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("@/lib/api", () => ({
  startWorkOrder: startMock,
  uploadWorkOrderServiceReport: uploadMock,
  listServiceReportTypes: typesMock,
  completeFieldWorkOrder: fieldCompleteMock,
}));

function job(status: WorkOrder["status"]): WorkOrder {
  return { id: "wo-1", workOrderNumber: "WO-TEST-1", customerId: "c-1", siteId: "s-1", status } as WorkOrder;
}

describe("TechnicianWorkOrderActions", () => {
  it("uploads a typed report label and shows success only after receipt", async () => {
    uploadMock.mockResolvedValue({ serviceReportNumber: "SR-CUSTOM" });
    const user = userEvent.setup();
    render(<TechnicianWorkOrderActions workOrder={job("IN_PROGRESS")} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Upload Service Report" }));
    await screen.findByRole("option", { name: "Custom report type…" });
    await user.selectOptions(screen.getByLabelText("Report type"), "__custom__");
    fireEvent.change(screen.getByLabelText("Custom report type"), { target: { value: "Cooling performance assessment" } });
    await user.upload(screen.getByLabelText(/signed report/i), new File(["test"], "report.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Upload report" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith("token-1", "c-1", expect.objectContaining({ reportTypeCode: "OTHER", reportTypeOther: "Cooling performance assessment" })));
    expect(await screen.findByRole("dialog", { name: "Report uploaded" })).toHaveTextContent("SR-CUSTOM");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    typesMock.mockResolvedValue([{ code: "SERVICE", label: "Service" }]);
  });

  it("starts a scheduled job only after confirmation", async () => {
    startMock.mockResolvedValue({});
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<TechnicianWorkOrderActions workOrder={job("SCHEDULED")} onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "Start Job" }));
    expect(startMock).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Start Job" }));
    await waitFor(() => expect(startMock).toHaveBeenCalledWith("token-1", "wo-1"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("offers report upload after completion and links it to the Work Order", async () => {
    uploadMock.mockResolvedValue({ serviceReportNumber: "SR-TEST-1" });
    const user = userEvent.setup();
    render(<TechnicianWorkOrderActions workOrder={job("COMPLETED")} onChanged={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Start Job" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Upload Service Report" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(typesMock).toHaveBeenCalledWith("token-1"));
    await user.selectOptions(within(dialog).getByLabelText("Report type"), "SERVICE");
    const fileInput = within(dialog).getByLabelText(/signed report/i) as HTMLInputElement;
    await user.upload(fileInput, new File(["test"], "report.pdf", { type: "application/pdf" }));
    expect(fileInput.files).toHaveLength(1);
    expect(within(dialog).getByLabelText("Report type")).toHaveValue("SERVICE");
    expect(fileInput.closest("form")?.checkValidity()).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Upload report" }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith("token-1", "c-1", expect.objectContaining({ workOrderId: "wo-1", siteId: "s-1", reportTypeCode: "SERVICE" })));
    expect(await screen.findByRole("dialog", { name: "Report uploaded" })).toHaveTextContent("SR-TEST-1");
  });

  it("does not offer either action for a draft job", () => {
    render(<TechnicianWorkOrderActions workOrder={job("DRAFT")} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Start Job" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload Service Report" })).not.toBeInTheDocument();
    expect(screen.getByText(/still Draft.*move it to Scheduled/i)).toBeInTheDocument();
  });

  it("marks field work done only after confirmation and shows the recorded timestamp", async () => {
    fieldCompleteMock.mockResolvedValue({ fieldCompletedAt: "2026-11-21T08:00:00.000Z" });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<TechnicianWorkOrderActions workOrder={job("IN_PROGRESS")} onChanged={onChanged} />);
    await user.click(screen.getByRole("button", { name: "Mark field work done" }));
    expect(fieldCompleteMock).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark field work done" }));
    expect(fieldCompleteMock).toHaveBeenCalledWith("token-1", "wo-1");
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText(/Field work marked done:/)).toHaveTextContent("2026");
    expect(screen.queryByRole("button", { name: "Mark field work done" })).not.toBeInTheDocument();
    expect(screen.getByText(/Manager.*still completes and closes/)).toBeInTheDocument();
  });

  it("allows retry after field completion fails", async () => {
    fieldCompleteMock.mockRejectedValueOnce(new ApiError(409, "Job changed. Try again.")).mockResolvedValue({ fieldCompletedAt: "2026-11-21T08:00:00.000Z" });
    const user = userEvent.setup();
    render(<TechnicianWorkOrderActions workOrder={job("IN_PROGRESS")} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Mark field work done" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark field work done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Job changed. Try again.");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark field work done" }));
    expect(fieldCompleteMock).toHaveBeenCalledTimes(2);
  });

  it("hides field completion without its exact grant", () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: (_module: string, action: string) => action !== "field_complete_own" });
    render(<TechnicianWorkOrderActions workOrder={job("IN_PROGRESS")} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Mark field work done" })).not.toBeInTheDocument();
  });

  it.each(["DRAFT", "SCHEDULED", "COMPLETED", "CLOSED", "CANCELLED"] as const)("hides field completion in %s", (status) => {
    render(<TechnicianWorkOrderActions workOrder={job(status)} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Mark field work done" })).not.toBeInTheDocument();
  });

  it("shows an existing field completion timestamp without offering a duplicate action", () => {
    render(<TechnicianWorkOrderActions workOrder={{ ...job("IN_PROGRESS"), fieldCompletedAt: "2026-11-21T08:00:00.000Z" } as WorkOrder} onChanged={vi.fn()} />);
    expect(screen.getByText(/Field work marked done:/)).toHaveTextContent("2026");
    expect(screen.queryByRole("button", { name: "Mark field work done" })).not.toBeInTheDocument();
  });
});

function render(ui: React.ReactElement) { return baseRender(<OutcomeProvider>{ui}</OutcomeProvider>); }
