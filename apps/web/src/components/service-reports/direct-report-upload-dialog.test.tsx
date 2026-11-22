import { OutcomeProvider } from "@/components/shared/outcome-provider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render as baseRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectReportUploadDialog } from "./direct-report-upload-dialog";
import type { Site } from "@/lib/api";

const { useAuthMock, listTypesMock, searchTargetsMock, uploadMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(), listTypesMock: vi.fn(), searchTargetsMock: vi.fn(), uploadMock: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listServiceReportTypes: listTypesMock, searchDirectReportTargets: searchTargetsMock, uploadCustomerServiceReport: uploadMock };
});

describe("DirectReportUploadDialog", () => {
  it.each([false, true])("keeps a typed direct report label and announces only successful receipt (error=%s)", async (fails) => {
    if (fails) uploadMock.mockRejectedValue(new Error("offline"));
    else uploadMock.mockResolvedValue({ serviceReportNumber: "SR-DIRECT" });
    const user = userEvent.setup();
    render(<DirectReportUploadDialog customerId="c1" sites={[{ id: "s1", label: "Main", status: "ACTIVE" } as Site]} onUploaded={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Upload direct report" }));
    await user.selectOptions(screen.getByLabelText("Site"), "s1");
    await user.selectOptions(screen.getByLabelText("Report type"), "__custom__");
    fireEvent.change(screen.getByLabelText("Custom report type"), { target: { value: "Equipment condition survey" } });
    await user.selectOptions(screen.getByLabelText("Reason for direct report"), "EMERGENCY_CALL");
    await user.upload(screen.getByLabelText(/Signed report/i), new File(["report"], "report.pdf", { type: "application/pdf" }));
    const form = screen.getByLabelText(/Signed report/i).closest("form")!;
    expect((screen.getByLabelText(/Signed report/i) as HTMLInputElement).files?.[0]?.name).toBe("report.pdf");
    expect(screen.getByRole("button", { name: "Upload report" })).toBeEnabled();
    // jsdom does not update native required-file validity for userEvent's
    // synthetic FileList. Submit the populated form; browsers enforce required.
    fireEvent.submit(form);
    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith("token", "c1", expect.objectContaining({ reportTypeCode: "OTHER", reportTypeOther: "Equipment condition survey" })));
    if (fails) {
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not upload");
      expect(screen.queryByRole("dialog", { name: "Report uploaded" })).not.toBeInTheDocument();
    } else expect(await screen.findByRole("dialog", { name: "Report uploaded" })).toHaveTextContent("SR-DIRECT");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ accessToken: "token", hasPermission: () => true });
    listTypesMock.mockResolvedValue([]);
  });

  it("clears a customer search error when the next search succeeds", async () => {
    searchTargetsMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([{ id: "c1", name: "Acme", sites: [] }]);
    render(<DirectReportUploadDialog onUploaded={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Upload direct report" }));
    fireEvent.change(screen.getByLabelText("Find customer"), { target: { value: "bad" } });
    expect(await screen.findByText("Could not search customers.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Find customer"), { target: { value: "Acme" } });
    expect(await screen.findByRole("option", { name: "Acme" })).toBeInTheDocument();
    expect(screen.queryByText("Could not search customers.")).not.toBeInTheDocument();
  });

  it("clears a failed type load when the dialog is reopened", async () => {
    listTypesMock.mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([{ code: "MAINTENANCE_CLEANING", label: "Maintenance / Cleaning" }]);
    render(<DirectReportUploadDialog onUploaded={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Upload direct report" }));
    expect(await screen.findByText("Could not load report types.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Upload direct report" }));
    expect(await screen.findByRole("option", { name: "Maintenance / Cleaning" })).toBeInTheDocument();
    expect(screen.queryByText("Could not load report types.")).not.toBeInTheDocument();
  });
});

function render(ui: React.ReactElement) { return baseRender(<OutcomeProvider>{ui}</OutcomeProvider>); }
