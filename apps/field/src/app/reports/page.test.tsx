import { OutcomeProvider } from "@/components/outcome-provider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render as baseRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportsPage from "./page";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
});

const { useAuthMock, listMineMock, listTypesMock, searchTargetsMock, uploadMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(), listMineMock: vi.fn(), listTypesMock: vi.fn(), searchTargetsMock: vi.fn(), uploadMock: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listMyServiceReports: listMineMock, listServiceReportTypes: listTypesMock, searchDirectReportTargets: searchTargetsMock, uploadDirectServiceReport: uploadMock };
});

describe("ReportsPage", () => {
  it("uploads a custom direct report and shows its received reference in the dialog", async () => {
    searchTargetsMock.mockResolvedValue([{ id: "c1", name: "Acme", sites: [{ id: "s1", label: "Main" }] }]);
    uploadMock.mockResolvedValue({ serviceReportNumber: "SR-FIELD-DIRECT" });
    const user = userEvent.setup();
    render(<ReportsPage />);
    fireEvent.change(screen.getByLabelText("Find customer"), { target: { value: "Acme" } });
    await screen.findByRole("option", { name: "Acme" });
    await user.selectOptions(screen.getByLabelText("Customer"), "c1");
    await user.selectOptions(screen.getByLabelText("Site"), "s1");
    await user.selectOptions(screen.getByLabelText("Report type"), "__custom__");
    fireEvent.change(screen.getByLabelText("Custom report type"), { target: { value: "Drain inspection" } });
    await user.selectOptions(screen.getByLabelText("Reason for direct report"), "CALLBACK_VISIT");
    await user.upload(screen.getByLabelText(/Signed report/i), new File(["report"], "report.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Upload report" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith("token", "c1", expect.objectContaining({ reportTypeCode: "OTHER", reportTypeOther: "Drain inspection" })));
    expect(await screen.findByRole("dialog", { name: "Report uploaded" })).toHaveTextContent("SR-FIELD-DIRECT");
  });
  it("displays a report-specific custom label in My Reports", async () => {
    listMineMock.mockResolvedValue([{ id: "r1", serviceReportNumber: "SR-CUSTOM", reportTypeCode: "OTHER", reportTypeOther: "Cooling assessment", status: "PENDING_VERIFICATION", uploadedAt: "2026-11-21T00:00:00Z", workOrderId: null }]);
    render(<ReportsPage />);
    expect(await screen.findByText(/Cooling assessment/)).toBeInTheDocument();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ user: { id: "u1" }, accessToken: "token", hasPermission: () => true });
    listMineMock.mockResolvedValue([{ id: "r1", serviceReportNumber: "SR-001", reportTypeCode: "MAINTENANCE_CLEANING", status: "PENDING_VERIFICATION", uploadedAt: "2026-01-01T00:00:00Z", workOrderId: null, documentFileName: "signed-report.pdf" }]);
    listTypesMock.mockResolvedValue([]);
    searchTargetsMock.mockResolvedValue([]);
  });

  it("shows submitted report details and explains an empty customer search", async () => {
    const user = userEvent.setup();
    render(<ReportsPage />);
    expect(await screen.findByText("SR-001")).toBeInTheDocument();
    await user.click(screen.getByText("File details"));
    expect(screen.getByText("File: signed-report.pdf")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Find customer"), { target: { value: "zzzzzzzz" } });
    expect(await screen.findByText("No customers found. Try a different name.")).toBeInTheDocument();
  });

  it("clears a failed customer search message after a successful search", async () => {
    searchTargetsMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([{ id: "c1", name: "Acme", sites: [] }]);
    render(<ReportsPage />);
    fireEvent.change(screen.getByLabelText("Find customer"), { target: { value: "bad" } });
    expect(await screen.findByText("Could not find customers.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Find customer"), { target: { value: "Acme" } });
    expect(await screen.findByRole("option", { name: "Acme" })).toBeInTheDocument();
    expect(screen.queryByText("Could not find customers.")).not.toBeInTheDocument();
  });

  it("keeps a report-type failure visible after the report list succeeds and retries", async () => {
    let resolveReports!: (rows: unknown[]) => void;
    listMineMock.mockReturnValueOnce(new Promise((resolve) => { resolveReports = resolve; }));
    listTypesMock.mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([{ code: "MAINTENANCE_CLEANING", label: "Maintenance / Cleaning" }]);
    render(<ReportsPage />);
    expect(await screen.findByText("Could not load report types.")).toBeInTheDocument();
    await act(async () => { resolveReports([]); });
    expect(screen.getByText("Could not load report types.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry report types" }));
    expect(await screen.findByRole("option", { name: "Maintenance / Cleaning" })).toBeInTheDocument();
    expect(screen.queryByText("Could not load report types.")).not.toBeInTheDocument();
  });

  it("offers rear-camera capture for a direct report", async () => {
    const user = userEvent.setup();
    render(<ReportsPage />);
    const cameraInput = screen.getByLabelText("Camera photo") as HTMLInputElement;
    expect(cameraInput).toHaveAttribute("capture", "environment");
    expect(cameraInput).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(screen.getByLabelText(/signed report/i)).not.toBeRequired();
    const openCamera = vi.spyOn(cameraInput, "click");
    await user.click(screen.getByRole("button", { name: "Take Photo" }));
    expect(openCamera).toHaveBeenCalledOnce();
    await user.upload(cameraInput, new File(["image"], "direct-photo.jpg", { type: "image/jpeg" }));
    expect(screen.getByText("Selected report: direct-photo.jpg")).toBeInTheDocument();
  });
});

function render(ui: React.ReactElement) { return baseRender(<OutcomeProvider>{ui}</OutcomeProvider>); }
