import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";
import { ConvertToWorkOrdersPanel } from "./convert-to-work-orders-panel";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const { convertQuotationToWorkOrdersMock, generateMaintenanceVisitsMock } = vi.hoisted(() => ({
  convertQuotationToWorkOrdersMock: vi.fn(),
  generateMaintenanceVisitsMock: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, convertQuotationToWorkOrders: convertQuotationToWorkOrdersMock, generateMaintenanceVisits: generateMaintenanceVisitsMock };
});

describe("ConvertToWorkOrdersPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("converts to a work order and navigates to it when exactly one is created", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    convertQuotationToWorkOrdersMock.mockResolvedValue([{ id: "wo-new" }]);
    const onConverted = vi.fn();
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="REPAIR" onConverted={onConverted} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /convert to work order/i }));

    await waitFor(() => expect(convertQuotationToWorkOrdersMock).toHaveBeenCalledWith("token-1", "q1", "r1", { scheduledDate: undefined }));
    expect(onConverted).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/work-orders/wo-new");
  });

  it("does not navigate when conversion produces more than one work order", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    convertQuotationToWorkOrdersMock.mockResolvedValue([{ id: "wo-1" }, { id: "wo-2" }]);
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PREVENTIVE_MAINTENANCE" onConverted={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^convert to work order$/i }));

    await waitFor(() => expect(convertQuotationToWorkOrdersMock).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("requires a start date before Generate Maintenance Visits can be clicked", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PREVENTIVE_MAINTENANCE" onConverted={vi.fn()} />);
    expect(screen.getByRole("button", { name: /generate maintenance visits/i })).toBeDisabled();
  });

  it("generates maintenance visits with the chosen start date", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    generateMaintenanceVisitsMock.mockResolvedValue(undefined);
    const onConverted = vi.fn();
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="PREVENTIVE_MAINTENANCE" onConverted={onConverted} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/first visit date/i), "2026-09-01");
    await user.click(screen.getByRole("button", { name: /generate maintenance visits/i }));

    await waitFor(() => expect(generateMaintenanceVisitsMock).toHaveBeenCalledWith("token-1", "q1", "r1", "2026-09-01"));
    expect(onConverted).toHaveBeenCalled();
  });

  it("surfaces an error when conversion fails", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    convertQuotationToWorkOrdersMock.mockRejectedValue(new ApiError(409, "Revision is not the current ACCEPTED revision"));
    render(<ConvertToWorkOrdersPanel quotationId="q1" revisionId="r1" quotationType="REPAIR" onConverted={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /convert to work order/i }));

    expect(await screen.findByText(/not the current ACCEPTED revision/i)).toBeInTheDocument();
  });
});
