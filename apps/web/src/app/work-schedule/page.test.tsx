import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkOrder } from "@/lib/api/types";
import WorkSchedulePage from "./page";

const { authMock, listMock } = vi.hoisted(() => ({ authMock: vi.fn(), listMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: authMock }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), listWorkOrders: listMock }));

function order(id: string, date: string | null, overrides: Partial<WorkOrder> = {}): WorkOrder {
  return { id, workOrderNumber: `WO-${id}`, status: "SCHEDULED", scheduledDate: date, description: "Preventive cleaning", customerId: "c1", siteId: "s1",
    customer: { id: "c1", name: "Demo Company" }, site: { id: "s1", label: "Main Office" }, assignments: [], ...overrides } as WorkOrder;
}

describe("WorkSchedulePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockReturnValue({ accessToken: "token", hasPermission: (module: string, action: string) => module === "work_orders" && action === "read", isLoading: false });
    listMock.mockResolvedValue([order("one", "2026-11-20"), order("unscheduled", null)]);
  });
  afterEach(() => { vi.useRealTimers(); });

  it("loads the authorized Work Order source, renders details and links directly to the order", async () => {
    render(<WorkSchedulePage />);
    const link = await screen.findByRole("link", { name: "WO-one" });
    expect(link).toHaveAttribute("href", "/work-orders/one");
    expect(listMock).toHaveBeenCalledWith("token");
    expect(screen.getAllByText("Demo Company", { selector: "p" })).toHaveLength(2);
    expect(screen.getAllByText("Preventive cleaning")).toHaveLength(2);
    expect(screen.getAllByText("No technician assigned")).toHaveLength(2);
    expect(screen.getByText(/scheduled date is used/i)).toBeInTheDocument();
  });

  it.each(["read_assigned", "read_own"])("allows the existing %s scope without requesting broader lists", async (grant) => {
    authMock.mockReturnValue({ accessToken: "scoped", hasPermission: (module: string, action: string) => module === "work_orders" && action === grant, isLoading: false });
    render(<WorkSchedulePage />);
    await screen.findByRole("link", { name: "WO-one" });
    expect(listMock).toHaveBeenCalledWith("scoped");
  });

  it("does not fetch when the user has no Work Order read scope", () => {
    authMock.mockReturnValue({ accessToken: "token", hasPermission: () => false, isLoading: false });
    render(<WorkSchedulePage />);
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("filters technicians using only the active assignments in authorized records", async () => {
    listMock.mockResolvedValue([order("one", "2026-11-20", { assignments: [{ id: "a1", technicianId: "t1", assignedAt: "2026-11-01", technician: { id: "t1", fullName: "Jamie Test" } }] }), order("two", null)]);
    render(<WorkSchedulePage />);
    await screen.findByRole("link", { name: "WO-two" });
    fireEvent.change(screen.getByLabelText("Technician"), { target: { value: "t1" } });
    expect(screen.getByRole("link", { name: "WO-one" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "WO-two" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search work schedule"), { target: { value: "missing" } });
    expect(screen.getByText("No matching work scheduled")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("link", { name: "WO-two" })).toBeInTheDocument();
  });

  it("shows loading, retry and empty states", async () => {
    listMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
    render(<WorkSchedulePage />);
    expect(screen.getByText("Loading work schedule…")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No work orders yet")).toBeInTheDocument();
  });

  it("keeps an active technician filter understandable after that technician has no remaining visible assignments", async () => {
    listMock.mockResolvedValueOnce([order("one", null, { assignments: [{ id: "a1", technicianId: "t1", assignedAt: "2026-11-01", technician: { id: "t1", fullName: "Jamie Test" } }] })]).mockResolvedValue([order("one", null)]);
    render(<WorkSchedulePage />);
    await screen.findByRole("option", { name: "Jamie Test" });
    fireEvent.change(screen.getByLabelText("Technician"), { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("option", { name: "Selected technician (no current jobs)" })).toHaveValue("t1");
    expect(screen.getByLabelText("Technician")).toHaveValue("t1");
    expect(screen.getByText("No matching work scheduled")).toBeInTheDocument();
  });

  it("refreshes automatically and removes a completed job from active work", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-20T04:00:00Z"));
    listMock.mockResolvedValueOnce([order("one", "2026-11-19")]).mockResolvedValue([order("one", "2026-11-19", { status: "COMPLETED" })]);
    const view = render(<WorkSchedulePage />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Overdue: 1" })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("button", { name: "Overdue: 0" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "WO-one" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Work Order status"), { target: { value: "COMPLETED" } });
    expect(screen.getByRole("link", { name: "WO-one" })).toBeInTheDocument();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes on focus and ignores a stale response after the user changes", async () => {
    let resolveOld!: (rows: WorkOrder[]) => void;
    listMock.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue([]);
    const view = render(<WorkSchedulePage />);
    authMock.mockReturnValue({ accessToken: "new-token", hasPermission: () => true, isLoading: false });
    view.rerender(<WorkSchedulePage />);
    await screen.findByText("No work orders yet");
    await act(async () => { resolveOld([order("old-private", null)]); });
    expect(screen.queryByRole("link", { name: "WO-old-private" })).not.toBeInTheDocument();
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(3));
  });
});
