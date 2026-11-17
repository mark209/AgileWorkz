import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { WorkOrder } from "@/lib/api/types";
import WorkOrdersListPage from "./page";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const { useSearchParamsMock } = vi.hoisted(() => ({ useSearchParamsMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: useSearchParamsMock,
}));

const { listWorkOrdersMock } = vi.hoisted(() => ({ listWorkOrdersMock: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listWorkOrders: listWorkOrdersMock };
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
    standaloneReason: "No-cooling complaint",
    standaloneReasonType: "EMERGENCY",
    estimatedValue: null,
    status: "SCHEDULED",
    scheduledDate: "2026-09-01T00:00:00.000Z",
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

describe("WorkOrdersListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true, isLoading: false });
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
  });

  it("shows an access-denied message when the caller lacks work_orders.read", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => false, isLoading: false });
    render(<WorkOrdersListPage />);
    expect(await screen.findByText(/do not have permission to view work orders/i)).toBeInTheDocument();
    expect(listWorkOrdersMock).not.toHaveBeenCalled();
  });

  it("loads with no status filter by default", async () => {
    listWorkOrdersMock.mockResolvedValue([workOrder()]);
    render(<WorkOrdersListPage />);
    expect((await screen.findAllByText("WO-2026-08-00001")).length).toBe(2);
    expect(listWorkOrdersMock).toHaveBeenCalledWith("token-1", undefined);
  });

  it("passes the ?status= query param straight through to the API call", async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("status=SCHEDULED,IN_PROGRESS"));
    listWorkOrdersMock.mockResolvedValue([workOrder()]);
    render(<WorkOrdersListPage />);
    await screen.findAllByText("WO-2026-08-00001");
    expect(listWorkOrdersMock).toHaveBeenCalledWith("token-1", "SCHEDULED,IN_PROGRESS");
  });

  it("confirms creation when the new Work Order is outside the Manager's assigned view", async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("created=outside-scope"));
    useAuthMock.mockReturnValue({
      accessToken: "token-1",
      hasPermission: (module: string, action: string) => module === "work_orders" && action === "read_assigned",
      isLoading: false,
    });
    listWorkOrdersMock.mockResolvedValue([]);
    render(<WorkOrdersListPage />);

    expect(await screen.findByRole("status")).toHaveTextContent("Work Order created");
    expect(await screen.findByText("No assigned Work Orders")).toBeInTheDocument();
  });

  it("shows an empty state when no work orders match", async () => {
    listWorkOrdersMock.mockResolvedValue([]);
    render(<WorkOrdersListPage />);
    expect(await screen.findByText(/no work orders found/i)).toBeInTheDocument();
  });

  it("renders customer, site, type, status, and assigned technicians from the single enriched response (no per-row fetch)", async () => {
    listWorkOrdersMock.mockResolvedValue([
      workOrder({
        assignments: [
          { id: "a1", technicianId: "t1", assignedAt: "2026-08-30T00:00:00.000Z", technician: { id: "t1", fullName: "Jordan Lee" } },
        ],
      }),
    ]);
    render(<WorkOrdersListPage />);
    await screen.findAllByText("WO-2026-08-00001");

    expect(screen.getAllByText("Acme Corp")).toHaveLength(2);
    expect(screen.getAllByText("Main Building")).toHaveLength(2);
    expect(screen.getAllByText("Jordan Lee")).toHaveLength(2);
    // Exactly one call for the whole list — no N+1 follow-up fetches.
    expect(listWorkOrdersMock).toHaveBeenCalledTimes(1);
  });

  it("shows an em dash when no technician is assigned", async () => {
    listWorkOrdersMock.mockResolvedValue([workOrder({ assignments: [] })]);
    render(<WorkOrdersListPage />);
    await screen.findAllByText("WO-2026-08-00001");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("links each row to its detail page", async () => {
    listWorkOrdersMock.mockResolvedValue([workOrder()]);
    render(<WorkOrdersListPage />);
    const link = await screen.findByRole("link", { name: /view →/i });
    expect(link).toHaveAttribute("href", "/work-orders/wo1");
  });

  it("ignores an older response after status and scope change", async () => {
    let resolveOld!: (rows: WorkOrder[]) => void;
    let resolveNew!: (rows: WorkOrder[]) => void;
    listWorkOrdersMock
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveNew = resolve; }));
    useSearchParamsMock.mockReturnValue(new URLSearchParams("status=SCHEDULED"));
    const view = render(<WorkOrdersListPage />);
    await waitFor(() => expect(listWorkOrdersMock).toHaveBeenCalledWith("token-1", "SCHEDULED"));

    useSearchParamsMock.mockReturnValue(new URLSearchParams("status=IN_PROGRESS&scope=assigned"));
    view.rerender(<WorkOrdersListPage />);
    await waitFor(() => expect(listWorkOrdersMock).toHaveBeenCalledWith("token-1", "IN_PROGRESS", true));
    expect(screen.getByText("Work Orders assigned to you · Status: IN_PROGRESS.")).toBeInTheDocument();

    await act(async () => { resolveNew([workOrder({ id: "new", workOrderNumber: "WO-NEW", status: "IN_PROGRESS" })]); });
    expect(screen.getAllByText("WO-NEW").length).toBeGreaterThan(0);
    await act(async () => { resolveOld([workOrder({ id: "old", workOrderNumber: "WO-OLD" })]); });
    expect(screen.queryByText("WO-OLD")).not.toBeInTheDocument();
  });

  it("keeps assigned scope when clearing an empty status filter", async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("status=IN_PROGRESS&scope=assigned"));
    listWorkOrdersMock.mockResolvedValue([]);
    render(<WorkOrdersListPage />);
    expect(await screen.findByText("No assigned Work Orders with this status")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear status filter" })).toHaveAttribute("href", "/work-orders?scope=assigned");
  });
});
