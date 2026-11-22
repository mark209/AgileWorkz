import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";
import { ConvertToWorkOrdersPanel } from "./convert-to-work-orders-panel";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
const { showOutcomeMock } = vi.hoisted(() => ({ showOutcomeMock: vi.fn() }));
vi.mock("@/components/shared/outcome-provider", () => ({ useOutcome: () => ({ showOutcome: showOutcomeMock }) }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const { convertQuotationToWorkOrdersMock, generateMaintenanceVisitsMock, getGenerationMock } = vi.hoisted(() => ({
  convertQuotationToWorkOrdersMock: vi.fn(),
  generateMaintenanceVisitsMock: vi.fn(),
  getGenerationMock: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, getRevisionWorkOrders: getGenerationMock, listManagers: vi.fn().mockResolvedValue([{ id: "manager-1", fullName: "Service Manager" }]), convertQuotationToWorkOrders: convertQuotationToWorkOrdersMock, generateMaintenanceVisits: generateMaintenanceVisitsMock };
});

describe("ConvertToWorkOrdersPanel", () => {
  it("passes the explicitly selected Manager when generating maintenance visits", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    generateMaintenanceVisitsMock.mockResolvedValue([]);
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PREVENTIVE_MAINTENANCE" onConverted={vi.fn()} />);
    const user = userEvent.setup();
    await screen.findByRole("option", { name: "Service Manager" });
    await user.selectOptions(screen.getByLabelText("Responsible Manager (optional)"), "manager-1");
    await user.type(screen.getByLabelText("First visit date"), "2026-12-01");
    await user.click(screen.getByRole("button", { name: "Generate Maintenance Visits" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Generate visits" }));
    await waitFor(() => expect(generateMaintenanceVisitsMock).toHaveBeenCalledWith("token-1", "q1", "r1", "2026-12-01", "manager-1"));
  });
  beforeEach(() => {
    vi.clearAllMocks();
    getGenerationMock.mockResolvedValue({ generated: false, totalCount: 0, workOrders: [] });
  });

  it.each(["REPAIR", "SUPPLY_INSTALLATION", "PROJECT"] as const)("shows persisted %s Work Orders instead of offering conversion again", async (quotationType) => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    getGenerationMock.mockResolvedValue({ generated: true, totalCount: 2, workOrders: [{ id: "wo-existing", workOrderNumber: "WO-EXISTING", status: "CLOSED", scheduledDate: "2026-12-01" }] });
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType={quotationType} onConverted={vi.fn()} />);
    expect(await screen.findByText("Work Orders already created")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Convert to Work Order" })).not.toBeInTheDocument();
    expect(showOutcomeMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "WO-EXISTING" })).toHaveAttribute("href", "/work-orders/wo-existing");
    expect(screen.getByText(/Some Work Orders are outside your Work Order access/i)).toBeInTheDocument();
  });

  it("checks regular conversion status before enabling creation and blocks when checking fails", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    getGenerationMock.mockRejectedValue(new Error("offline"));
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="REPAIR" onConverted={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Convert to Work Order" })).toBeDisabled();
    expect(await screen.findByRole("button", { name: "Retry Work Order status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Convert to Work Order" })).toBeDisabled();
  });

  it("reconciles a regular conversion conflict into existing Work Order links", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    getGenerationMock.mockResolvedValueOnce({ generated: false, totalCount: 0, workOrders: [] }).mockResolvedValue({ generated: true, totalCount: 1, workOrders: [{ id: "wo-other-tab", workOrderNumber: "WO-OTHER-TAB", status: "DRAFT", scheduledDate: null }] });
    convertQuotationToWorkOrdersMock.mockRejectedValue(new ApiError(409, "Work Orders already exist for this revision"));
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="REPAIR" onConverted={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Convert to Work Order" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Convert to Work Order" }));
    expect(await screen.findByRole("link", { name: "WO-OTHER-TAB" })).toHaveAttribute("href", "/work-orders/wo-other-tab");
    expect(showOutcomeMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Convert to Work Order" })).not.toBeInTheDocument();
  });

  it("hides regular conversion immediately after successful creation even if status refresh is stale", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    convertQuotationToWorkOrdersMock.mockResolvedValue([{ id: "wo-1" }, { id: "wo-2" }]);
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PROJECT" onConverted={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Convert to Work Order" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Convert to Work Order" }));
    expect(await screen.findByText("Work Orders already created")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Convert to Work Order" })).not.toBeInTheDocument();
  });

  it("shows regular creation status to quotation readers without exposing inaccessible Work Order links", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: (module: string, action: string) => module === "quotations" && action === "read" });
    getGenerationMock.mockResolvedValue({ generated: true, totalCount: 1, workOrders: [] });
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="REPAIR" onConverted={vi.fn()} />);
    expect(await screen.findByText("Work Orders already created")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Convert to Work Order" })).not.toBeInTheDocument();
  });

  it("shows persisted generated visits instead of offering generation again", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    getGenerationMock.mockResolvedValue({ generated: true, totalCount: 2, workOrders: [{ id: "visit-1", workOrderNumber: "WO-TEST-1", status: "DRAFT", scheduledDate: "2026-12-01" }] });
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PREVENTIVE_MAINTENANCE" onConverted={vi.fn()} />);
    expect(await screen.findByText("Maintenance visits already generated")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate Maintenance Visits" })).not.toBeInTheDocument();
    expect(showOutcomeMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "WO-TEST-1" })).toHaveAttribute("href", "/work-orders/visit-1");
    expect(screen.getByText(/outside your Work Order access/i)).toBeInTheDocument();
  });

  it("does not allow generation when saved status cannot be checked", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    getGenerationMock.mockRejectedValue(new Error("offline"));
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PREVENTIVE_MAINTENANCE" onConverted={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Retry visit status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Maintenance Visits" })).toBeDisabled();
  });

  it("reconciles a duplicate-generation conflict into the saved generated state", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    getGenerationMock.mockResolvedValueOnce({ generated: false, totalCount: 0, workOrders: [] }).mockResolvedValue({ generated: true, totalCount: 4, workOrders: [] });
    generateMaintenanceVisitsMock.mockRejectedValue(new ApiError(409, "Maintenance visits have already been generated"));
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PREVENTIVE_MAINTENANCE" onConverted={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("First visit date"), "2026-12-01");
    await user.click(screen.getByRole("button", { name: "Generate Maintenance Visits" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Generate visits" }));
    expect(await screen.findByText("Maintenance visits already generated")).toBeInTheDocument();
    expect(showOutcomeMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate Maintenance Visits" })).not.toBeInTheDocument();
  });

  it("replaces generation controls with saved Work Order links immediately after success", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    const visit = { id: "visit-new", workOrderNumber: "WO-NEW", status: "DRAFT", scheduledDate: "2026-12-01" };
    getGenerationMock.mockResolvedValueOnce({ generated: false, totalCount: 0, workOrders: [] }).mockResolvedValue({ generated: true, totalCount: 1, workOrders: [visit] });
    generateMaintenanceVisitsMock.mockResolvedValue([visit]);
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PREVENTIVE_MAINTENANCE" onConverted={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("First visit date"), "2026-12-01");
    await user.click(screen.getByRole("button", { name: "Generate Maintenance Visits" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Generate visits" }));
    expect(await screen.findByRole("link", { name: "WO-NEW" })).toHaveAttribute("href", "/work-orders/visit-new");
    expect(screen.queryByRole("button", { name: "Generate Maintenance Visits" })).not.toBeInTheDocument();
  });

  it("renders nothing when the caller holds neither work_orders.create nor .generate_maintenance_visits", () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => false });
    const { container } = render(
      <ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="REPAIR" onConverted={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only 'Convert to Work Order' for a REPAIR quotation, never Generate Maintenance Visits", () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="REPAIR" onConverted={vi.fn()} />);
    expect(screen.getByRole("button", { name: /convert to work order/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate maintenance visits/i })).not.toBeInTheDocument();
  });

  it("shows Generate Maintenance Visits for a PREVENTIVE_MAINTENANCE quotation when permitted", () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PREVENTIVE_MAINTENANCE" onConverted={vi.fn()} />);
    expect(screen.getByRole("button", { name: /generate maintenance visits/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /convert to work order/i })).not.toBeInTheDocument();
  });

  it("shows no unavailable action for a PREVENTIVE_MAINTENANCE quotation without visit-generation permission", () => {
    useAuthMock.mockReturnValue({
      accessToken: "token-1",
      hasPermission: (_module: string, action: string) => action === "create",
    });
    const { container } = render(
      <ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PREVENTIVE_MAINTENANCE" onConverted={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("converts to a work order and navigates to it when exactly one is created", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    convertQuotationToWorkOrdersMock.mockResolvedValue([{ id: "wo-new" }]);
    const onConverted = vi.fn();
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="REPAIR" onConverted={onConverted} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /convert to work order/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Convert to Work Order" }));

    await waitFor(() => expect(convertQuotationToWorkOrdersMock).toHaveBeenCalledWith("token-1", "q1", "r1", { scheduledDate: undefined, responsibleManagerId: undefined }));
    expect(onConverted).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/work-orders/wo-new");
    expect(showOutcomeMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Work Orders created", description: expect.stringMatching(/1 Draft Work Order.*assign.*schedule/i) }));
    expect(showOutcomeMock.mock.invocationCallOrder[0]).toBeLessThan(onConverted.mock.invocationCallOrder[0]);
    expect(showOutcomeMock.mock.invocationCallOrder[0]).toBeLessThan(pushMock.mock.invocationCallOrder[0]);
  });

  it("does not navigate when conversion produces more than one work order", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    convertQuotationToWorkOrdersMock.mockResolvedValue([{ id: "wo-1" }, { id: "wo-2" }]);
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PROJECT" onConverted={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^convert to work order$/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Convert to Work Order" }));

    await waitFor(() => expect(convertQuotationToWorkOrdersMock).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
    expect(showOutcomeMock).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("2 Draft Work Orders") }));
  });

  it("requires a start date before Generate Maintenance Visits can be clicked", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PREVENTIVE_MAINTENANCE" onConverted={vi.fn()} />);
    expect(screen.getByRole("button", { name: /generate maintenance visits/i })).toBeDisabled();
  });

  it("generates maintenance visits with the chosen start date", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    generateMaintenanceVisitsMock.mockResolvedValue([{ id: "visit-created" }]);
    const onConverted = vi.fn();
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PREVENTIVE_MAINTENANCE" onConverted={onConverted} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/first visit date/i), "2026-09-01");
    await user.click(screen.getByRole("button", { name: /generate maintenance visits/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Generate visits" }));

    await waitFor(() => expect(generateMaintenanceVisitsMock).toHaveBeenCalledWith("token-1", "q1", "r1", "2026-09-01", undefined));
    expect(onConverted).toHaveBeenCalled();
    expect(showOutcomeMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Maintenance visits generated", description: expect.stringContaining("1 Draft Work Order") }));
  });

  it("surfaces an error when conversion fails", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    convertQuotationToWorkOrdersMock.mockRejectedValue(new ApiError(409, "Revision is not the current ACCEPTED revision"));
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="REPAIR" onConverted={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /convert to work order/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Convert to Work Order" }));

    expect(await screen.findByText(/not the current ACCEPTED revision/i)).toBeInTheDocument();
    expect(showOutcomeMock).not.toHaveBeenCalled();
  });
});
