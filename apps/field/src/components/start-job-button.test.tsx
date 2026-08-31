import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { StartJobButton } from "./start-job-button";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const { startWorkOrderMock } = vi.hoisted(() => ({ startWorkOrderMock: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, startWorkOrder: startWorkOrderMock };
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
    status: "SCHEDULED",
    scheduledDate: null,
    description: null,
    startedAt: null,
    completedAt: null,
    customer: { id: "c1", name: "Acme Corp" },
    site: { id: "s1", label: "Main Building" },
    assignments: [],
    ...overrides,
  };
}

describe("StartJobButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing without work_orders.start_own", () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => false });
    const { container } = render(<StartJobButton workOrder={job({ status: "SCHEDULED" })} onStarted={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing once the job is no longer SCHEDULED, even with the permission", () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    const { container } = render(<StartJobButton workOrder={job({ status: "IN_PROGRESS" })} onStarted={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the Start Job button for a SCHEDULED job with the permission", () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    render(<StartJobButton workOrder={job({ status: "SCHEDULED" })} onStarted={vi.fn()} />);
    expect(screen.getByRole("button", { name: /start job/i })).toBeInTheDocument();
  });

  it("calls startWorkOrder and onStarted on success", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    startWorkOrderMock.mockResolvedValue(undefined);
    const onStarted = vi.fn();
    render(<StartJobButton workOrder={job({ status: "SCHEDULED" })} onStarted={onStarted} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /start job/i }));

    await waitFor(() => expect(startWorkOrderMock).toHaveBeenCalledWith("token-1", "wo1"));
    expect(onStarted).toHaveBeenCalled();
  });

  it("surfaces an error and does not call onStarted when starting fails", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    startWorkOrderMock.mockRejectedValue(new ApiError(409, "This Work Order is no longer SCHEDULED"));
    const onStarted = vi.fn();
    render(<StartJobButton workOrder={job({ status: "SCHEDULED" })} onStarted={onStarted} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /start job/i }));

    expect(await screen.findByText(/no longer SCHEDULED/i)).toBeInTheDocument();
    expect(onStarted).not.toHaveBeenCalled();
  });
});
