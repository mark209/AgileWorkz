import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkOrder } from "@/lib/api/types";
import { TechnicianWorkOrderActions } from "./technician-work-order-actions";

const { useAuthMock, startMock, uploadMock, typesMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(), startMock: vi.fn(), uploadMock: vi.fn(), typesMock: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("@/lib/api", () => ({
  startWorkOrder: startMock,
  uploadWorkOrderServiceReport: uploadMock,
  listServiceReportTypes: typesMock,
}));

function job(status: WorkOrder["status"]): WorkOrder {
  return { id: "wo-1", workOrderNumber: "WO-TEST-1", customerId: "c-1", siteId: "s-1", status } as WorkOrder;
}

describe("TechnicianWorkOrderActions", () => {
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
    expect(await screen.findByText(/SR-TEST-1 uploaded/i)).toBeInTheDocument();
  });

  it("does not offer either action for a draft job", () => {
    render(<TechnicianWorkOrderActions workOrder={job("DRAFT")} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Start Job" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload Service Report" })).not.toBeInTheDocument();
    expect(screen.getByText(/still Draft.*move it to Scheduled/i)).toBeInTheDocument();
  });
});
