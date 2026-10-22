import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "./page";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { listCustomersMock, listServiceReportsMock, listQuotationsMock, listWorkOrdersMock, listAuditLogsMock } = vi.hoisted(() => ({
  listCustomersMock: vi.fn(),
  listServiceReportsMock: vi.fn(),
  listQuotationsMock: vi.fn(),
  listWorkOrdersMock: vi.fn(),
  listAuditLogsMock: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listCustomers: listCustomersMock,
    listServiceReports: listServiceReportsMock,
    listQuotations: listQuotationsMock,
    listWorkOrders: listWorkOrdersMock,
    listAuditLogs: listAuditLogsMock,
  };
});

const ADMIN_PERMISSIONS = ["customers.read", "service_reports.read", "service_reports.verify", "quotations.read", "quotations.approve", "quotations.approve_final", "work_orders.read", "work_orders.cancel", "audit_logs.read"];
const OFFICE_STAFF_PERMISSIONS = ["customers.read", "service_reports.read", "quotations.read", "work_orders.read"];
const TECHNICIAN_PERMISSIONS = ["work_orders.read_own"];

function authAs(permissions: string[], roles = ["Admin/Owner"]) {
  useAuthMock.mockReturnValue({
    user: { fullName: "Test User", roles },
    accessToken: "token-1",
    isLoading: false,
    logout: vi.fn(),
    hasPermission: (module: string, action: string) => permissions.includes(`${module}.${action}`),
  });
}

function mockAllResolved() {
  listCustomersMock.mockResolvedValue([
    { id: "c1", name: "Active Co", status: "ACTIVE" },
    { id: "c2", name: "Inactive Co", status: "INACTIVE" },
  ]);
  listServiceReportsMock.mockResolvedValue([
    { id: "sr1", serviceReportNumber: "SR-001", status: "PENDING_VERIFICATION" },
    { id: "sr2", status: "VERIFIED" },
    { id: "sr3", status: "CONFIRMED" },
    { id: "sr4", status: "CONFIRMED" },
  ]);
  listQuotationsMock.mockResolvedValue([
    { id: "q1", quotationNumber: "Q-001", status: "PENDING_APPROVAL" },
    { id: "q2", status: "SENT" },
    { id: "q3", status: "SENT" },
    { id: "q4", quotationNumber: "Q-004", status: "PENDING_OWNER_APPROVAL" },
  ]);
  listWorkOrdersMock.mockResolvedValue([
    { id: "w1", workOrderNumber: "WO-001", customer: { name: "Active Co" }, site: { label: "Main Site" }, status: "SCHEDULED", cancellationRequestedAt: null, cancelledAt: null },
    { id: "w2", workOrderNumber: "WO-002", customer: { name: "Active Co" }, site: { label: "Main Site" }, status: "IN_PROGRESS", cancellationRequestedAt: "2026-08-30T00:00:00.000Z", cancelledAt: null },
  ]);
  listAuditLogsMock.mockResolvedValue([
    { id: "a1", actorType: "USER", actorUserId: "u1", action: "service_report_locked", entityType: "ServiceReport", entityId: "sr-1", createdAt: "2026-08-30T00:00:00.000Z" },
  ]);
}

describe("DashboardPage — role-based section visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAllResolved();
  });

  it("Admin/Owner shows authorized company-wide sections, including Recent Activity", async () => {
    authAs(ADMIN_PERMISSIONS);
    render(<DashboardPage />);

    expect(await screen.findByText("Active Customers")).toBeInTheDocument();
    // 1 ACTIVE customer out of 2 seeded.
    expect(screen.getByText("Active Customers").closest("div")?.textContent).toContain("1");

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Overview of your business operations")).toBeInTheDocument();
    expect(screen.getByText("Pending Approvals").closest("a")).toHaveTextContent("2");
    expect(screen.getByText("Active Work Orders").closest("a")).toHaveTextContent("2");
    expect(screen.getByText("Reports to Verify").closest("div")).toHaveTextContent("1");
    expect(screen.getByText("Workflow Overview")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Service Reports", { selector: "summary span" }));
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(await screen.findByText("Recent Activity")).toBeInTheDocument();
    expect(screen.getByText(/service report locked/i)).toBeInTheDocument();
  });

  it("Office Staff: shows Customers/Service Reports/Quotations/Work Orders but never Recent Activity", async () => {
    authAs(OFFICE_STAFF_PERMISSIONS, ["Office Staff"]);
    render(<DashboardPage />);

    expect(await screen.findByText("Active Customers")).toBeInTheDocument();
    expect(screen.getByText("Service Reports — Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Quotations — Pending Approval")).toBeInTheDocument();
    expect(screen.getByText("Work Orders — Scheduled")).toBeInTheDocument();

    expect(listAuditLogsMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Recent Activity")).not.toBeInTheDocument();
  });

  it("Manager: requests the assigned Work Order view and shows the existing creation path", async () => {
    authAs(["work_orders.read_assigned", "work_orders.create", "quotations.read", "audit_logs.read"], ["Manager"]);
    render(<DashboardPage />);

    expect(await screen.findByText("Manager Dashboard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose customer to create Service" })).toHaveAttribute("href", "/customers");
    await waitFor(() => expect(listWorkOrdersMock).toHaveBeenCalledWith("token-1", undefined, true));
    expect(listCustomersMock).not.toHaveBeenCalled();
    expect(listServiceReportsMock).not.toHaveBeenCalled();
    expect(listAuditLogsMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Recent Activity")).not.toBeInTheDocument();
  });

  it("Admin/Owner with a Manager role keeps the administrative dashboard and full Work Order view", async () => {
    authAs(ADMIN_PERMISSIONS, ["Admin/Owner", "Manager"]);
    render(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    await waitFor(() => expect(listWorkOrdersMock).toHaveBeenCalledWith("token-1", "SCHEDULED,IN_PROGRESS", false));
    expect(await screen.findByText("Recent Activity")).toBeInTheDocument();
  });

  it("Technician: sees assigned Work Orders without fetching unrelated data", async () => {
    authAs(TECHNICIAN_PERMISSIONS, ["Technician"]);
    render(<DashboardPage />);

    expect(await screen.findByText("Technician Dashboard")).toBeInTheDocument();
    expect(await screen.findByText("My Assigned Services")).toBeInTheDocument();
    expect(screen.getByText(/this list includes all your currently assigned work orders/i)).toBeInTheDocument();
    expect(screen.queryByText("Work Orders — Scheduled")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Customers")).not.toBeInTheDocument();
    expect(screen.queryByText(/service reports/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/quotations/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Recent Activity")).not.toBeInTheDocument();

    // Not just hidden in the UI — never even requested.
    expect(listCustomersMock).not.toHaveBeenCalled();
    expect(listServiceReportsMock).not.toHaveBeenCalled();
    expect(listQuotationsMock).not.toHaveBeenCalled();
    expect(listWorkOrdersMock).toHaveBeenCalledWith("token-1", undefined, false);
    expect(listAuditLogsMock).not.toHaveBeenCalled();
  });

  it("Work Order workflow rows link only to supported filtered lists", async () => {
    authAs(ADMIN_PERMISSIONS);
    render(<DashboardPage />);
    await screen.findByText("Work Orders", { selector: "summary span" });
    fireEvent.click(screen.getByText("Work Orders", { selector: "summary span" }));

    expect(screen.getByText("Scheduled").closest("a")).toHaveAttribute("href", "/work-orders?status=SCHEDULED");
    expect(screen.getByText("In Progress").closest("a")).toHaveAttribute("href", "/work-orders?status=IN_PROGRESS");
    expect(screen.getByText("Cancellation Requested").closest("a")).toBeNull();
  });

  it("summary and Quotation workflow links use existing routes and filters", async () => {
    authAs(ADMIN_PERMISSIONS);
    render(<DashboardPage />);
    await screen.findByText("Active Customers");

    expect(screen.getByText("Active Customers").closest("a")).toHaveAttribute("href", "/customers");
    expect(screen.getByText("Pending Approvals").closest("a")).toHaveAttribute("href", "/quotations?status=PENDING_APPROVAL,PENDING_OWNER_APPROVAL");
    fireEvent.click(screen.getByText("Quotations", { selector: "summary span" }));
    expect(screen.getByText("Pending Approval").closest("a")).toHaveAttribute("href", "/quotations?status=PENDING_APPROVAL");
    expect(screen.getByText("Pending Owner Approval").closest("a")).toHaveAttribute("href", "/quotations?status=PENDING_OWNER_APPROVAL");
    expect(listQuotationsMock).toHaveBeenCalledWith("token-1", "PENDING_APPROVAL,PENDING_OWNER_APPROVAL,SENT");
    expect(screen.getByText("Pending Owner Approval").closest("li")?.textContent).toContain("1");
  });

  it("computes the Cancellation Requested count only for work orders with an open (unresolved) cancellation request", async () => {
    authAs(ADMIN_PERMISSIONS);
    render(<DashboardPage />);
    await screen.findByText("Work Orders", { selector: "summary span" });
    fireEvent.click(screen.getByText("Work Orders", { selector: "summary span" }));
    // 1 of the 2 seeded work orders has cancellationRequestedAt set and cancelledAt null.
    const cancelCardText = screen.getByText("Cancellation Requested").closest("li")?.textContent;
    expect(cancelCardText).toContain("1");
  });

  it("shows a compact attention empty state when no permitted actions are pending", async () => {
    authAs(ADMIN_PERMISSIONS);
    listQuotationsMock.mockResolvedValue([]);
    listServiceReportsMock.mockResolvedValue([]);
    listWorkOrdersMock.mockResolvedValue([]);
    render(<DashboardPage />);

    expect(await screen.findByText("No items currently require your attention.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open →/ })).not.toBeInTheDocument();
  });

  it("a failed section shows its own error without blocking other sections", async () => {
    authAs(ADMIN_PERMISSIONS);
    listQuotationsMock.mockRejectedValue(new Error("Network error"));
    render(<DashboardPage />);

    expect(await screen.findByText("Active Customers")).toBeInTheDocument(); // unaffected
    expect((await screen.findAllByText("Failed to load quotations.")).length).toBeGreaterThan(0);
  });

  it("shows an empty state for Recent Activity when nothing has been logged", async () => {
    authAs(ADMIN_PERMISSIONS);
    listAuditLogsMock.mockResolvedValue([]);
    render(<DashboardPage />);
    expect(await screen.findByText(/no recent activity/i)).toBeInTheDocument();
  });

  it("no longer shows the stale 'Sales and Operations screens land in later phases' placeholder", async () => {
    authAs(ADMIN_PERMISSIONS);
    render(<DashboardPage />);
    await screen.findByText("Active Customers");
    expect(screen.queryByText(/land in later phases/i)).not.toBeInTheDocument();
  });

  it("re-fetches every permitted section on load and settles without leaving anything stuck loading", async () => {
    authAs(ADMIN_PERMISSIONS);
    render(<DashboardPage />);
    await waitFor(() => expect(listCustomersMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listAuditLogsMock).toHaveBeenCalledWith("token-1", 8));
  });
});
