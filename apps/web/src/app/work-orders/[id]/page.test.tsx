import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WorkOrder } from "@/lib/api/types";
import { ApiError } from "@/lib/api-client";
import WorkOrderDetailPage from "./page";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const { useParamsMock, replaceMock } = vi.hoisted(() => ({ useParamsMock: vi.fn(), replaceMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: useParamsMock,
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

const { getWorkOrderMock } = vi.hoisted(() => ({ getWorkOrderMock: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, getWorkOrder: getWorkOrderMock };
});

// The three sub-panels each fetch their own data independently (technicians,
// service reports) — stub them out so this page test stays focused on the
// page-level shell (header, details card, permission gate, error handling).
vi.mock("@/components/work-orders/work-order-lifecycle-actions", () => ({
  WorkOrderLifecycleActions: () => <div data-testid="lifecycle-actions" />,
}));
vi.mock("@/components/work-orders/work-order-assignment-panel", () => ({
  WorkOrderAssignmentPanel: () => <div data-testid="assignment-panel" />,
}));
vi.mock("@/components/work-orders/work-order-service-reports-panel", () => ({
  WorkOrderServiceReportsPanel: () => <div data-testid="service-reports-panel" />,
}));

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
    estimatedValue: "450.00",
    status: "SCHEDULED",
    scheduledDate: "2026-09-01T00:00:00.000Z",
    description: "Inspect condenser unit",
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

describe("WorkOrderDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useParamsMock.mockReturnValue({ id: "wo1" });
    useAuthMock.mockReturnValue({ user: { id: "u1", fullName: "Admin" }, accessToken: "token-1", hasPermission: () => true, isLoading: false });
  });

  it("shows an access-denied message without work_orders.read, and never fetches", async () => {
    useAuthMock.mockReturnValue({ user: { id: "u1", fullName: "Admin" }, accessToken: "token-1", hasPermission: () => false, isLoading: false });
    render(<WorkOrderDetailPage />);
    expect(await screen.findByText(/do not have permission to view work orders/i)).toBeInTheDocument();
    expect(getWorkOrderMock).not.toHaveBeenCalled();
  });

  it("loads the work order by the route id and renders its header and details", async () => {
    getWorkOrderMock.mockResolvedValue(workOrder());
    render(<WorkOrderDetailPage />);

    expect(await screen.findByRole("heading", { name: "WO-2026-08-00001" })).toBeInTheDocument();
    expect(getWorkOrderMock).toHaveBeenCalledWith("token-1", "wo1");
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument();
    expect(screen.getByText(/Main Building/)).toBeInTheDocument();
    expect(screen.getByText("Inspect condenser unit")).toBeInTheDocument();
  });

  it("renders the lifecycle actions, assignment, and linked service reports panels once loaded", async () => {
    getWorkOrderMock.mockResolvedValue(workOrder());
    render(<WorkOrderDetailPage />);

    await screen.findByRole("heading", { name: "WO-2026-08-00001" });
    expect(screen.getByTestId("lifecycle-actions")).toBeInTheDocument();
    expect(screen.getByTestId("assignment-panel")).toBeInTheDocument();
    expect(screen.getByTestId("service-reports-panel")).toBeInTheDocument();
  });

  it("surfaces a load error with a retry option", async () => {
    getWorkOrderMock.mockRejectedValue(new ApiError(404, "Work order not found"));
    render(<WorkOrderDetailPage />);
    expect(await screen.findByText(/work order not found/i)).toBeInTheDocument();
  });
});
