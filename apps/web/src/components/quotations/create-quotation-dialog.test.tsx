import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Site } from "@/lib/api/types";
import { CreateQuotationDialog } from "./create-quotation-dialog";

const { createQuotationMock, listApprovedTypesMock, pushMock } = vi.hoisted(() => ({
  createQuotationMock: vi.fn(), listApprovedTypesMock: vi.fn(), pushMock: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ accessToken: "office-token" }) }));
vi.mock("@/lib/use-reference-data", () => ({
  useReferenceData: () => ({ trades: [{ code: "HVAC", label: "HVAC", status: "ACTIVE" }] }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api")>(),
  createQuotation: createQuotationMock,
  listApprovedQuotationTypes: listApprovedTypesMock,
}));

const sites = [{ id: "site-1", label: "Test Site" }] as Site[];

describe("CreateQuotationDialog editable choices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createQuotationMock.mockResolvedValue({ id: "quotation-1" });
    listApprovedTypesMock.mockResolvedValue([]);
  });

  it("lets Office Staff type a new Type and Trade into their existing controls", async () => {
    const user = userEvent.setup();
    render(<CreateQuotationDialog customerId="customer-1" sites={sites} />);
    await user.click(screen.getByRole("button", { name: "New Quotation" }));

    await user.selectOptions(screen.getByLabelText("Site"), "site-1");
    const type = screen.getByLabelText("Quotation type");
    const trade = screen.getByLabelText("Primary trade");
    expect(type).toHaveAttribute("list");
    expect(trade).toHaveAttribute("list");
    await user.clear(type);
    await user.type(type, "Emergency Visit");
    await user.selectOptions(screen.getByLabelText("Operational type"), "PREVENTIVE_MAINTENANCE");
    await user.type(trade, "Refrigeration");
    expect(screen.queryByLabelText(/other quotation type|other trade/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create quotation" }));

    await waitFor(() => expect(createQuotationMock).toHaveBeenCalledWith("office-token", "customer-1", expect.objectContaining({
      quotationType: "PREVENTIVE_MAINTENANCE",
      quotationTypeOther: "Emergency Visit",
      primaryTradeCode: "OTHER",
      primaryTradeOther: "Refrigeration",
    })));
    expect(pushMock).toHaveBeenCalledWith("/quotations/quotation-1");
  });

  it("maps an existing Trade to its stored code", async () => {
    const user = userEvent.setup();
    render(<CreateQuotationDialog customerId="customer-1" sites={sites} />);
    await user.click(screen.getByRole("button", { name: "New Quotation" }));
    await user.selectOptions(screen.getByLabelText("Site"), "site-1");
    await user.type(screen.getByLabelText("Primary trade"), "HVAC");
    await user.click(screen.getByRole("button", { name: "Create quotation" }));
    await waitFor(() => expect(createQuotationMock).toHaveBeenCalledWith("office-token", "customer-1", expect.objectContaining({
      quotationType: "REPAIR",
      primaryTradeCode: "HVAC",
      primaryTradeOther: undefined,
    })));
  });
});
