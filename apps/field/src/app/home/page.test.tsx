import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import HomePage from "./page";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: replaceMock, push: vi.fn() }) }));

const { listMyWorkOrdersMock } = vi.hoisted(() => ({ listMyWorkOrdersMock: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listMyWorkOrders: listMyWorkOrdersMock };
});

const { getCachedAssignedWorkOrdersMock, saveAssignedWorkOrdersMock, getQueuedServiceReportsMock } = vi.hoisted(() => ({
  getCachedAssignedWorkOrdersMock: vi.fn(),
  saveAssignedWorkOrdersMock: vi.fn(),
  getQueuedServiceReportsMock: vi.fn(),
}));
vi.mock("@/lib/offline-store", () => ({
  getCachedAssignedWorkOrders: getCachedAssignedWorkOrdersMock,
  saveAssignedWorkOrders: saveAssignedWorkOrdersMock,
  getQueuedServiceReports: getQueuedServiceReportsMock,
}));

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
    scheduledDate: "2026-09-01T00:00:00.000Z",
    description: null,
    startedAt: null,
    completedAt: null,
    customer: { id: "c1", name: "Acme Corp" },
    site: { id: "s1", label: "Main Building" },
    assignments: [],
    ...overrides,
  };
}

describe("HomePage (My Jobs)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCachedAssignedWorkOrdersMock.mockResolvedValue(null);
    saveAssignedWorkOrdersMock.mockResolvedValue(undefined);
    getQueuedServiceReportsMock.mockResolvedValue([]);
    useAuthMock.mockReturnValue({
      user: { id: "u1", fullName: "Jordan Lee" },
      accessToken: "token-1",
      hasPermission: () => true,
      logout: vi.fn(),
    });
  });

  it("redirects to /login when there is no user", () => {
    useAuthMock.mockReturnValue({ user: null, accessToken: null, hasPermission: () => false, logout: vi.fn() });
    render(<HomePage />);
    expect(replaceMock).toHaveBeenCalledWith("/login");
  });

  it("shows a permission message and never fetches without work_orders.read_own", () => {
    useAuthMock.mockReturnValue({
      user: { id: "u1", fullName: "Jordan Lee" },
      accessToken: "token-1",
      hasPermission: () => false,
      logout: vi.fn(),
    });
    render(<HomePage />);
    expect(screen.getByText(/isn.t set up to view assigned jobs/i)).toBeInTheDocument();
    expect(listMyWorkOrdersMock).not.toHaveBeenCalled();
  });

  it("shows an empty state when there are no assigned jobs", async () => {
    listMyWorkOrdersMock.mockResolvedValue([]);
    render(<HomePage />);
    expect(await screen.findByText(/no assigned jobs right now/i)).toBeInTheDocument();
  });

  it("lists assigned jobs with customer, site, status, and a link to the job detail page", async () => {
    listMyWorkOrdersMock.mockResolvedValue([job()]);
    render(<HomePage />);

    expect(await screen.findByText("WO-2026-08-00001")).toBeInTheDocument();
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/jobs/wo1");
  });

  it("surfaces a load error with a retry option", async () => {
    listMyWorkOrdersMock.mockRejectedValue(new Error("Network error"));
    render(<HomePage />);
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("shows this technician's recent cached assignments after a network failure", async () => {
    const savedAt = Date.now() - 60_000;
    listMyWorkOrdersMock.mockRejectedValue(new TypeError("Failed to fetch"));
    getCachedAssignedWorkOrdersMock.mockResolvedValue({ workOrders: [job()], savedAt });
    render(<HomePage />);

    expect(await screen.findByText("WO-2026-08-00001")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/offline copy/i);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/jobs/wo1");
  });

  it("does not show cached assignments after the server denies access", async () => {
    listMyWorkOrdersMock.mockRejectedValue(new ApiError(403, "Forbidden"));
    render(<HomePage />);

    expect(await screen.findByText(/cannot view assigned jobs/i)).toBeInTheDocument();
    expect(getCachedAssignedWorkOrdersMock).not.toHaveBeenCalled();
  });

  it("greets the technician by first name", async () => {
    listMyWorkOrdersMock.mockResolvedValue([]);
    render(<HomePage />);
    expect(await screen.findByText("Hi, Jordan")).toBeInTheDocument();
  });
});
