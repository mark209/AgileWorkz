import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Site, WorkOrder } from "@/lib/api/types";
import { ApiError } from "@/lib/api-client";
import { WorkOrdersTab } from "./work-orders-tab";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { listWorkOrdersForCustomerMock } = vi.hoisted(() => ({ listWorkOrdersForCustomerMock: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listWorkOrdersForCustomer: listWorkOrdersForCustomerMock };
});

const sites: Site[] = [
  {
    id: "s1",
    customerId: "c1",
    label: "Main Building",
    addressLine: "1 Main St",
    city: null,
    region: null,
    postalCode: null,
    geoLat: null,
    geoLng: null,
    primaryContactId: null,
    accessNotes: null,
    status: "ACTIVE",
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  },
];

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

describe("WorkOrdersTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides the New Work Order button without work_orders.create", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => false });
    listWorkOrdersForCustomerMock.mockResolvedValue([]);
    render(<WorkOrdersTab customerId="c1" sites={sites} />);
    await screen.findByText(/no work orders yet/i);
    expect(screen.queryByRole("button", { name: /new work order/i })).not.toBeInTheDocument();
  });

  it("shows the New Work Order button with work_orders.create", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    listWorkOrdersForCustomerMock.mockResolvedValue([]);
    render(<WorkOrdersTab customerId="c1" sites={sites} />);
    expect(await screen.findByRole("button", { name: /new work order/i })).toBeInTheDocument();
  });

  it("shows an empty state when the customer has no work orders", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    listWorkOrdersForCustomerMock.mockResolvedValue([]);
    render(<WorkOrdersTab customerId="c1" sites={sites} />);
    expect(await screen.findByText(/no work orders yet/i)).toBeInTheDocument();
  });

  it("lists this customer's work orders with a keyboard-accessible detail link", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    listWorkOrdersForCustomerMock.mockResolvedValue([workOrder()]);
    render(<WorkOrdersTab customerId="c1" sites={sites} />);

    const link = await screen.findByRole("link", { name: "WO-2026-08-00001" });
    expect(listWorkOrdersForCustomerMock).toHaveBeenCalledWith("token-1", "c1");
    expect(link).toHaveAttribute("href", "/work-orders/wo1");
  });

  it("surfaces a load error with retry", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    listWorkOrdersForCustomerMock.mockRejectedValue(new ApiError(500, "Network error"));
    render(<WorkOrdersTab customerId="c1" sites={sites} />);
    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
  });
});
