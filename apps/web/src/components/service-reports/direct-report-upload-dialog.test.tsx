import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectReportUploadDialog } from "./direct-report-upload-dialog";

const { useAuthMock, listTypesMock, searchTargetsMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(), listTypesMock: vi.fn(), searchTargetsMock: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listServiceReportTypes: listTypesMock, searchDirectReportTargets: searchTargetsMock };
});

describe("DirectReportUploadDialog", () => {
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
