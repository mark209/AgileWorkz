import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import JobDetailPage from "./page";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const { useParamsMock, replaceMock, pushMock } = vi.hoisted(() => ({
  useParamsMock: vi.fn(),
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useParams: useParamsMock,
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

const { getWorkOrderMock } = vi.hoisted(() => ({ getWorkOrderMock: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, getWorkOrder: getWorkOrderMock };
});

// StartJobButton and ServiceReportUploadForm each have their own dedicated
// test files (and their own API calls) — stub them here so this page test
// stays focused on the shell: loading/error states and which section shows
// at which status.
vi.mock("@/components/start-job-button", () => ({ StartJobButton: () => <div data-testid="start-job-button" /> }));
vi.mock("@/components/service-report-upload-form", () => ({
  ServiceReportUploadForm: () => <div data-testid="upload-form" />,
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
    description: "Inspect condenser unit",
    startedAt: null,
    completedAt: null,
    customer: { id: "c1", name: "Acme Corp" },
    site: { id: "s1", label: "Main Building" },
    assignments: [],
    ...overrides,
  };
}

describe("JobDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useParamsMock.mockReturnValue({ id: "wo1" });
    useAuthMock.mockReturnValue({ user: { id: "u1", fullName: "Jordan Lee" }, accessToken: "token-1", hasPermission: () => true });
  });

  it("redirects to /login when there is no user", () => {
    useAuthMock.mockReturnValue({ user: null, accessToken: null });
    render(<JobDetailPage />);
    expect(replaceMock).toHaveBeenCalledWith("/login");
  });

  it("loads the job by the route id and renders its header", async () => {
    getWorkOrderMock.mockResolvedValue(job());
    render(<JobDetailPage />);

    expect(await screen.findByRole("heading", { name: "WO-2026-08-00001" })).toBeInTheDocument();
    expect(getWorkOrderMock).toHaveBeenCalledWith("token-1", "wo1");
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument();
    expect(screen.getByText("Inspect condenser unit")).toBeInTheDocument();
  });

  it("shows the Start Job control for a SCHEDULED job", async () => {
    getWorkOrderMock.mockResolvedValue(job({ status: "SCHEDULED" }));
    render(<JobDetailPage />);
    await screen.findByRole("heading", { name: "WO-2026-08-00001" });
    expect(screen.getByTestId("start-job-button")).toBeInTheDocument();
  });

  it("shows the upload form once IN_PROGRESS, not a placeholder", async () => {
    getWorkOrderMock.mockResolvedValue(job({ status: "IN_PROGRESS" }));
    render(<JobDetailPage />);
    await screen.findByRole("heading", { name: "WO-2026-08-00001" });
    expect(screen.getByTestId("upload-form")).toBeInTheDocument();
    expect(screen.queryByText(/available once the job is started/i)).not.toBeInTheDocument();
  });

  it("shows a placeholder instead of the upload form while still SCHEDULED", async () => {
    getWorkOrderMock.mockResolvedValue(job({ status: "SCHEDULED" }));
    render(<JobDetailPage />);
    await screen.findByRole("heading", { name: "WO-2026-08-00001" });
    expect(screen.queryByTestId("upload-form")).not.toBeInTheDocument();
    expect(screen.getByText(/available once the job is started/i)).toBeInTheDocument();
  });

  it("surfaces a load error with a retry option (e.g. no longer assigned)", async () => {
    getWorkOrderMock.mockRejectedValue(new ApiError(403, "You are not currently assigned to this Work Order"));
    render(<JobDetailPage />);
    expect(await screen.findByText(/no longer assigned/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("navigates back to My Jobs", async () => {
    getWorkOrderMock.mockResolvedValue(job());
    render(<JobDetailPage />);
    await screen.findByRole("heading", { name: "WO-2026-08-00001" });
    screen.getByRole("button", { name: /my jobs/i }).click();
    expect(pushMock).toHaveBeenCalledWith("/home");
  });
});
