import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuotationRevision } from "@/lib/api/types";
import { RevisionFreeTextForm } from "./revision-free-text-form";

const { useAuthMock, updateRevisionContentMock, listPaymentTermsMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(), updateRevisionContentMock: vi.fn(), listPaymentTermsMock: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual, updateRevisionContent: updateRevisionContentMock,
    listPaymentTerms: listPaymentTermsMock,
    listQuotationTemplates: vi.fn().mockResolvedValue([]),
  };
});

const draft = {
  id: "r1", quotationId: "q1", status: "DRAFT", defaultTaxTreatment: "VAT_INCLUSIVE",
  discountPercent: "0", discountAmount: "0", paymentTerms: "Net 30",
  termsAndConditions: "[PLACEHOLDER] Replace before sending", validUntil: null,
} as QuotationRevision;

function renderForm(revision: QuotationRevision = draft, onDirtyChange?: (dirty: boolean) => void) {
  return render(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={revision} onChanged={vi.fn()} onDirtyChange={onDirtyChange} />);
}

describe("RevisionFreeTextForm auto-save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ accessToken: "token-1", user: { id: "user-1" } });
    updateRevisionContentMock.mockImplementation(async (_token, _qid, _rid, body) => ({ ...draft, ...body }));
    listPaymentTermsMock.mockResolvedValue(["Net 30"]);
  });

  it("shows saved payment terms while the choice list is unavailable", () => {
    listPaymentTermsMock.mockReturnValue(new Promise(() => {}));
    renderForm({ ...draft, paymentTerms: "30 days" } as QuotationRevision);
    expect(screen.getByLabelText("Payment terms")).toHaveValue("30 days");
    expect(screen.getByRole("option", { name: "30 days" })).toBeInTheDocument();
  });

  it("saves cleared Terms & Conditions as an empty value", async () => {
    renderForm();
    await userEvent.setup().clear(screen.getByLabelText("Terms & conditions"));
    await waitFor(() => expect(updateRevisionContentMock).toHaveBeenCalledWith("token-1", "q1", "r1", expect.objectContaining({ termsAndConditions: "" })), { timeout: 3000 });
  });

  it("saves a cleared payment selection and leaves untouched optional fields unset", async () => {
    renderForm();
    await userEvent.setup().selectOptions(screen.getByLabelText("Payment terms"), "");
    await waitFor(() => expect(updateRevisionContentMock).toHaveBeenCalled(), { timeout: 3000 });
    const body = updateRevisionContentMock.mock.calls[0][3];
    expect(body.paymentTerms).toBe("");
    expect(body.scopeOfWork).toBeUndefined();
  });

  it("retains fixed-amount discount mode while saving a changed amount", async () => {
    renderForm({ ...draft, discountAmount: "500" } as QuotationRevision);
    expect(screen.getByLabelText("Discount")).toHaveValue("amount");
    fireEvent.change(screen.getByLabelText("Discount (₱)"), { target: { value: "400" } });
    await waitFor(() => expect(updateRevisionContentMock).toHaveBeenCalledWith("token-1", "q1", "r1", expect.objectContaining({ discountAmount: 400, discountPercent: undefined })), { timeout: 3000 });
  });

  it("reports unsaved edits until the API succeeds", async () => {
    const onDirtyChange = vi.fn();
    renderForm(draft, onDirtyChange);
    fireEvent.change(screen.getByLabelText("Lead time"), { target: { value: "2026-12-01" } });
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false), { timeout: 3000 });
  });

  it("shows a retry action when auto-save fails", async () => {
    updateRevisionContentMock.mockRejectedValueOnce(new Error("Save failed"));
    renderForm();
    fireEvent.change(screen.getByLabelText("Warranty"), { target: { value: "2026-12-31" } });
    expect(await screen.findByText("Failed to save.", {}, { timeout: 3000 })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(updateRevisionContentMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });
});
