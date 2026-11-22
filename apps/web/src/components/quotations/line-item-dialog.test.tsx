import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LineItemDialog } from "./line-item-dialog";
import { RevisionEditor } from "./revision-editor";
import type { QuotationLineItem } from "@/lib/api";

const { createMock, updateMock, catalogMock } = vi.hoisted(() => ({ createMock: vi.fn(), updateMock: vi.fn(), catalogMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ accessToken: "token" }) }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), createLineItem: createMock, updateLineItem: updateMock, listQuotationLineCatalog: catalogMock }));
const props = { open: true, onOpenChange: vi.fn(), quotationId: "q", revisionId: "r", sections: [], assets: [], defaultTaxTreatment: "VAT_EXEMPT" as const, editingItem: null, onSaved: vi.fn() };

describe("line items follow overall quotation tax", () => {
  beforeEach(() => { vi.clearAllMocks(); createMock.mockResolvedValue({}); updateMock.mockResolvedValue({}); catalogMock.mockResolvedValue([]); });
  it("saves cleared optional item text rather than leaving the old saved text", async () => {
    const editingItem = { id: "item", description: "Service", quantity: "1", unit: "lot", unitPriceBeforeVat: "1000", specification: "Old specification", brand: "Old brand", model: "Old model" } as QuotationLineItem;
    render(<LineItemDialog {...props} editingItem={editingItem} />);
    for (const label of ["Specification (optional)", "Brand (optional)", "Model (optional)"]) fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][4]).toMatchObject({ specification: "", brand: "", model: "" });
  });
  it("opens a fresh form after adding an item", async () => {
    render(<RevisionEditor quotationId="q" revisionId="r" canEdit sections={[]} lineItems={[]} assets={[]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Line Item" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "First service" } });
    fireEvent.change(screen.getByLabelText(/Unit selling price/), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add line item" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add Line Item" }));
    expect(screen.getByLabelText("Description")).toHaveValue("");
    expect(screen.getByLabelText(/Unit selling price/)).toHaveValue(null);
  });
  it("has no per-item tax selector and lets the backend inherit quotation tax", async () => {
    render(<LineItemDialog {...props} />);
    expect(screen.queryByLabelText("Tax treatment")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Service" } });
    fireEvent.change(screen.getByLabelText(/Unit selling price/), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add line item" }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][3]).not.toHaveProperty("taxTreatment");
  });
  it("does not copy a saved catalog item's tax override into the quotation", async () => {
    catalogMock.mockResolvedValue([{ id: "saved", description: "Catalog service", specification: null, brand: null, model: null, unit: "lot", unitPriceBeforeVat: "1000", taxTreatment: "VAT_INCLUSIVE" }]);
    render(<LineItemDialog {...props} />);
    await screen.findByRole("option", { name: /Catalog service/ });
    fireEvent.change(screen.getByLabelText("Saved line item (optional)"), { target: { value: "saved" } });
    fireEvent.click(screen.getByRole("button", { name: "Add line item" }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][3]).not.toHaveProperty("taxTreatment");
  });
});
