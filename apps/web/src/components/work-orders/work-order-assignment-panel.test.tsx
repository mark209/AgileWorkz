import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TechnicianOption, WorkOrder } from "@/lib/api/types";
import { ApiError } from "@/lib/api-client";
import { WorkOrderAssignmentPanel } from "./work-order-assignment-panel";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const { listTechniciansMock, assignTechnicianMock, unassignTechnicianMock } = vi.hoisted(() => ({
  listTechniciansMock: vi.fn(),
  assignTechnicianMock: vi.fn(),
  unassignTechnicianMock: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listTechnicians: listTechniciansMock,
    assignTechnician: assignTechnicianMock,
    unassignTechnician: unassignTechnicianMock,
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
    status: "SCHEDULED",
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

function technician(overrides: Partial<TechnicianOption> = {}): TechnicianOption {
  return { id: "t1", fullName: "Jordan Lee", status: "ACTIVE", ...overrides };
}

describe("WorkOrderAssignmentPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTechniciansMock.mockResolvedValue([]);
  });

  it("does not fetch technicians or show the assign controls without work_orders.assign", () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => false });
    render(<WorkOrderAssignmentPanel workOrder={workOrder()} onChanged={vi.fn()} />);
    expect(listTechniciansMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /assign technician/i })).not.toBeInTheDocument();
  });

  it("shows 'No technician assigned yet' when there are no active assignments", () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => false });
    render(<WorkOrderAssignmentPanel workOrder={workOrder({ assignments: [] })} onChanged={vi.fn()} />);
    expect(screen.getByText(/no technician assigned yet/i)).toBeInTheDocument();
  });

  it("lists currently assigned technicians with an Unassign button when the caller holds work_orders.assign", () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    render(
      <WorkOrderAssignmentPanel
        workOrder={workOrder({
          assignments: [{ id: "a1", technicianId: "t1", assignedAt: "2026-08-30T00:00:00.000Z", technician: { id: "t1", fullName: "Jordan Lee" } }],
        })}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unassign/i })).toBeInTheDocument();
  });

  it("hides the Unassign button when the caller lacks work_orders.assign", () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => false });
    render(
      <WorkOrderAssignmentPanel
        workOrder={workOrder({
          assignments: [{ id: "a1", technicianId: "t1", assignedAt: "2026-08-30T00:00:00.000Z", technician: { id: "t1", fullName: "Jordan Lee" } }],
        })}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /unassign/i })).not.toBeInTheDocument();
  });

  it("excludes already-assigned technicians from the assign dropdown", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    listTechniciansMock.mockResolvedValue([technician({ id: "t1", fullName: "Jordan Lee" }), technician({ id: "t2", fullName: "Sam Rivera" })]);
    render(
      <WorkOrderAssignmentPanel
        workOrder={workOrder({
          assignments: [{ id: "a1", technicianId: "t1", assignedAt: "2026-08-30T00:00:00.000Z", technician: { id: "t1", fullName: "Jordan Lee" } }],
        })}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(listTechniciansMock).toHaveBeenCalled());
    expect(screen.queryByRole("option", { name: "Jordan Lee" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sam Rivera" })).toBeInTheDocument();
  });

  it("disables (but still shows) a non-ACTIVE technician option", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    listTechniciansMock.mockResolvedValue([technician({ id: "t2", fullName: "Sam Rivera", status: "INACTIVE" })]);
    render(<WorkOrderAssignmentPanel workOrder={workOrder({ assignments: [] })} onChanged={vi.fn()} />);

    const option = await screen.findByRole("option", { name: /Sam Rivera \(INACTIVE\)/i });
    expect(option).toBeDisabled();
  });

  it("assigns the selected technician and refreshes on success", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    listTechniciansMock.mockResolvedValue([technician({ id: "t2", fullName: "Sam Rivera" })]);
    assignTechnicianMock.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<WorkOrderAssignmentPanel workOrder={workOrder({ assignments: [] })} onChanged={onChanged} />);

    const user = userEvent.setup();
    const select = await screen.findByRole("combobox");
    await user.selectOptions(select, "t2");
    await user.click(screen.getByRole("button", { name: /assign technician/i }));

    await waitFor(() => expect(assignTechnicianMock).toHaveBeenCalledWith("token-1", "wo1", "t2"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("unassigns a technician and refreshes on success", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    unassignTechnicianMock.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(
      <WorkOrderAssignmentPanel
        workOrder={workOrder({
          assignments: [{ id: "a1", technicianId: "t1", assignedAt: "2026-08-30T00:00:00.000Z", technician: { id: "t1", fullName: "Jordan Lee" } }],
        })}
        onChanged={onChanged}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /unassign/i }));

    await waitFor(() => expect(unassignTechnicianMock).toHaveBeenCalledWith("token-1", "wo1", "a1"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("surfaces a technician-load error without crashing the assignment list", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    listTechniciansMock.mockRejectedValue(new ApiError(403, "Forbidden"));
    render(<WorkOrderAssignmentPanel workOrder={workOrder({ assignments: [] })} onChanged={vi.fn()} />);

    expect(await screen.findByText(/forbidden/i)).toBeInTheDocument();
  });

  it("explains when every eligible Technician is already assigned", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    listTechniciansMock.mockResolvedValue([technician()]);
    render(<WorkOrderAssignmentPanel workOrder={workOrder({
      assignments: [{ id: "a1", technicianId: "t1", assignedAt: "2026-08-30T00:00:00.000Z", technician: { id: "t1", fullName: "Jordan Lee" } }],
    })} onChanged={vi.fn()} />);

    expect(await screen.findByText(/no additional active technicians are available/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Add a Technician" })).toBeInTheDocument();
  });
});
