import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkOrder } from "@/lib/api/types";
import { ApiError } from "@/lib/api-client";
import { WorkOrderLifecycleActions } from "./work-order-lifecycle-actions";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const {
  scheduleWorkOrderMock,
  completeWorkOrderMock,
  closeWorkOrderMock,
  requestCancelWorkOrderMock,
  cancelWorkOrderMock,
  dismissCancellationRequestMock,
} = vi.hoisted(() => ({
  scheduleWorkOrderMock: vi.fn(),
  completeWorkOrderMock: vi.fn(),
  closeWorkOrderMock: vi.fn(),
  requestCancelWorkOrderMock: vi.fn(),
  cancelWorkOrderMock: vi.fn(),
  dismissCancellationRequestMock: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    scheduleWorkOrder: scheduleWorkOrderMock,
    completeWorkOrder: completeWorkOrderMock,
    closeWorkOrder: closeWorkOrderMock,
    requestCancelWorkOrder: requestCancelWorkOrderMock,
    cancelWorkOrder: cancelWorkOrderMock,
    dismissCancellationRequest: dismissCancellationRequestMock,
  };
});

function workOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: "wo1",
    workOrderNumber: "WO-2026-08-00001",
    customerId: "c1",
    siteId: "s1",
    quotationId: null,
    quotationRevisionId: null,
    workOrderType: "STANDALONE",
    standaloneReason: null,
    standaloneReasonType: null,
    estimatedValue: null,
    status: "DRAFT",
    scheduledDate: null,
    description: null,
    startedAt: null,
    completedAt: null,
    closedAt: null,
    cancellationRequestedAt: null,
    cancellationRequestedReason: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    customer: { id: "c1", name: "Acme Corp" },
    site: { id: "s1", label: "Main Building" },
    assignments: [],
    ...overrides,
  };
}

// Every permission granted by default; individual tests narrow via
// hasPermission overrides to exercise gating.
function authWithPermissions(allowed: Set<string> | "all" = "all") {
  useAuthMock.mockReturnValue({
    accessToken: "token-1",
    hasPermission: (module: string, action: string) => allowed === "all" || allowed.has(`${module}.${action}`),
  });
}

describe("WorkOrderLifecycleActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authWithPermissions("all");
  });

  it("shows Schedule only for a DRAFT work order when the caller holds work_orders.update", () => {
    render(<WorkOrderLifecycleActions workOrder={workOrder({ status: "DRAFT" })} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^schedule$/i })).toBeInTheDocument();
  });

  it("hides Schedule when the caller lacks work_orders.update", () => {
    authWithPermissions(new Set());
    render(<WorkOrderLifecycleActions workOrder={workOrder({ status: "DRAFT" })} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^schedule$/i })).not.toBeInTheDocument();
  });

  it("hides Schedule once the work order is no longer DRAFT", () => {
    render(<WorkOrderLifecycleActions workOrder={workOrder({ status: "SCHEDULED" })} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^schedule$/i })).not.toBeInTheDocument();
  });

  it("calls scheduleWorkOrder with the chosen date and refreshes on success", async () => {
    scheduleWorkOrderMock.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<WorkOrderLifecycleActions workOrder={workOrder({ status: "DRAFT" })} onChanged={onChanged} />);

    const user = userEvent.setup();
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    await user.type(dateInput, "2026-09-15");
    await user.click(screen.getByRole("button", { name: /^schedule$/i }));

    await waitFor(() => expect(scheduleWorkOrderMock).toHaveBeenCalledWith("token-1", "wo1", "2026-09-15"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows Mark Completed only for IN_PROGRESS with work_orders.complete", () => {
    render(<WorkOrderLifecycleActions workOrder={workOrder({ status: "IN_PROGRESS" })} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: /mark completed/i })).toBeInTheDocument();
  });

  it("Close Work Order opens a confirm dialog and only fires closeWorkOrder after confirming", async () => {
    closeWorkOrderMock.mockResolvedValue(undefined);
    render(<WorkOrderLifecycleActions workOrder={workOrder({ status: "COMPLETED" })} onChanged={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /close work order/i }));
    const dialog = await screen.findByRole("dialog");
    expect(closeWorkOrderMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /close work order/i }));
    await waitFor(() => expect(closeWorkOrderMock).toHaveBeenCalledWith("token-1", "wo1"));
  });

  it("Request Cancellation requires a reason before the confirm button is enabled", async () => {
    render(<WorkOrderLifecycleActions workOrder={workOrder({ status: "SCHEDULED" })} onChanged={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /request cancellation/i }));
    const dialog = await screen.findByRole("dialog");

    const confirmButton = within(dialog).getByRole("button", { name: /request cancellation/i });
    expect(confirmButton).toBeDisabled();

    await user.type(within(dialog).getByRole("textbox"), "Customer rescheduled");
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    await waitFor(() => expect(requestCancelWorkOrderMock).toHaveBeenCalledWith("token-1", "wo1", "Customer rescheduled"));
  });

  it("shows Confirm Cancellation and Dismiss Request once an open cancellation request exists, not Request Cancellation", () => {
    render(
      <WorkOrderLifecycleActions
        workOrder={workOrder({ status: "SCHEDULED", cancellationRequestedAt: "2026-08-30T00:00:00.000Z", cancellationRequestedReason: "x" })}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /confirm cancellation/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss request/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^request cancellation$/i })).not.toBeInTheDocument();
  });

  it("dismissing a cancellation request calls dismissCancellationRequest with no reason required", async () => {
    dismissCancellationRequestMock.mockResolvedValue(undefined);
    render(
      <WorkOrderLifecycleActions
        workOrder={workOrder({ status: "SCHEDULED", cancellationRequestedAt: "2026-08-30T00:00:00.000Z" })}
        onChanged={vi.fn()}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /dismiss request/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /dismiss request/i }));

    await waitFor(() => expect(dismissCancellationRequestMock).toHaveBeenCalledWith("token-1", "wo1"));
  });

  it("hides all cancellation actions once the work order is CLOSED (not cancellable)", () => {
    render(<WorkOrderLifecycleActions workOrder={workOrder({ status: "CLOSED" })} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /cancellation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel work order$/i })).not.toBeInTheDocument();
  });

  it("surfaces an error message when an action fails, without calling onChanged", async () => {
    completeWorkOrderMock.mockRejectedValue(new ApiError(409, "Work order is not IN_PROGRESS"));
    const onChanged = vi.fn();
    render(<WorkOrderLifecycleActions workOrder={workOrder({ status: "IN_PROGRESS" })} onChanged={onChanged} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /mark completed/i }));

    expect(await screen.findByText(/not IN_PROGRESS/i)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
