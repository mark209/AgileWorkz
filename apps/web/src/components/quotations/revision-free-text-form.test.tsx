import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
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
  it("can reapply an unchanged overall tax to inconsistent legacy draft items", async () => {
    render(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={{ ...draft, defaultTaxTreatment: "VAT_EXEMPT" }} hasTaxMismatch onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply quotation tax to all items" }));
    await waitFor(() => expect(updateRevisionContentMock).toHaveBeenCalled(), { timeout: 3000 });
    expect(updateRevisionContentMock.mock.calls[0][3].defaultTaxTreatment).toBe("VAT_EXEMPT");
  });
  it("does not clear a concurrently returned scope title in the next queued save", async () => {
    let finish!: (value: QuotationRevision) => void;
    updateRevisionContentMock.mockImplementationOnce(() => new Promise<QuotationRevision>((resolve) => { finish = resolve; }));
    renderForm();
    fireEvent.change(screen.getByLabelText("Scope of work"), { target: { value: "Changed scope" } });
    await waitFor(() => expect(updateRevisionContentMock).toHaveBeenCalledTimes(1), { timeout: 3000 });
    fireEvent.change(screen.getByLabelText("Warranty"), { target: { value: "2 weeks" } });
    await act(async () => finish({ ...draft, scopeOfWork: "Changed scope", scopeChecklistTitle: "GENERAL CLEANING SCOPE OF WORK" }));
    await waitFor(() => expect(updateRevisionContentMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(updateRevisionContentMock.mock.calls[1][3].scopeChecklistTitle).toBeUndefined();
  });

  it("loads remote validity and tax changes without resending old values", async () => {
    const onChanged = vi.fn();
    const initial = { ...draft, validUntil: "2026-12-01", updatedAt: "2026-11-20T00:00:00Z" };
    const view = render(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={initial} onChanged={onChanged} />);
    view.rerender(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={{ ...initial, validUntil: "2026-12-20", defaultTaxTreatment: "VAT_EXEMPT", updatedAt: "2026-11-20T00:00:01Z" }} onChanged={onChanged} />);
    expect(screen.getByLabelText("Valid until")).toHaveValue("2026-12-20");
    expect(screen.getByLabelText("Quotation tax treatment")).toHaveValue("VAT_EXEMPT");
    fireEvent.change(screen.getByLabelText("Warranty"), { target: { value: "2 weeks" } });
    await waitFor(() => expect(updateRevisionContentMock).toHaveBeenCalled(), { timeout: 3000 });
    expect(updateRevisionContentMock.mock.calls[0][3].validUntil).toBeUndefined();
    expect(updateRevisionContentMock.mock.calls[0][3].defaultTaxTreatment).toBeUndefined();
  });
  it("ignores a parent read that predates a successful save", async () => {
    const initial = { ...draft, scopeOfWork: "A", updatedAt: "2026-11-20T00:00:00Z" };
    updateRevisionContentMock.mockResolvedValueOnce({ ...initial, scopeOfWork: "B", updatedAt: "2026-11-20T00:00:02Z" });
    const onChanged = vi.fn();
    const view = render(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={initial} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText("Scope of work"), { target: { value: "B" } });
    await waitFor(() => expect(onChanged).toHaveBeenCalled(), { timeout: 3000 });
    view.rerender(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={{ ...initial }} onChanged={onChanged} />);
    expect(screen.getByLabelText("Scope of work")).toHaveValue("B");
  });
  it("persists a revert made while an earlier save is still in flight", async () => {
    let finishFirst!: (value: QuotationRevision) => void;
    updateRevisionContentMock.mockImplementationOnce(() => new Promise<QuotationRevision>((resolve) => { finishFirst = resolve; }));
    renderForm({ ...draft, scopeOfWork: "A" });
    fireEvent.change(screen.getByLabelText("Scope of work"), { target: { value: "B" } });
    await waitFor(() => expect(updateRevisionContentMock).toHaveBeenCalledTimes(1), { timeout: 3000 });
    fireEvent.change(screen.getByLabelText("Scope of work"), { target: { value: "A" } });
    await act(async () => finishFirst({ ...draft, scopeOfWork: "B" }));
    await waitFor(() => expect(updateRevisionContentMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(updateRevisionContentMock.mock.calls[1][3].scopeOfWork).toBe("A");
  });
  it("accepts the sample's warranty wording and quotation-specific payment instructions", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Warranty"), { target: { value: "2 weeks from completion of cleaning" } });
    fireEvent.change(screen.getByLabelText("Mode of payment"), { target: { value: "Bank transfer to the saved quotation account" } });
    await waitFor(() => expect(updateRevisionContentMock).toHaveBeenCalledWith("token-1", "q1", "r1", expect.objectContaining({ warranty: "2 weeks from completion of cleaning", paymentInstructions: "Bank transfer to the saved quotation account" })), { timeout: 3000 });
  });

  it("keeps a newly loaded scope title and does not overwrite it when another field is saved", async () => {
    const onChanged = vi.fn();
    const view = render(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={draft} onChanged={onChanged} />);
    view.rerender(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={{ ...draft, scopeChecklistTitle: "GENERAL CLEANING SCOPE OF WORK" }} onChanged={onChanged} />);
    expect(screen.getByLabelText("Scope appendix title")).toHaveValue("GENERAL CLEANING SCOPE OF WORK");
    fireEvent.change(screen.getByLabelText("Warranty"), { target: { value: "2 weeks" } });
    await waitFor(() => expect(updateRevisionContentMock).toHaveBeenCalled(), { timeout: 3000 });
    expect(updateRevisionContentMock.mock.calls[0][3].scopeChecklistTitle).toBeUndefined();
  });
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

  it("preserves the stored discount instead of reconstructing it from a rounded percentage", async () => {
    renderForm({ ...draft, subtotal: "3000", discountAmount: "100", discountPercent: "3.33" });
    expect(screen.getByLabelText("Discount")).toHaveValue("amount");
    fireEvent.change(screen.getByLabelText("Warranty"), { target: { value: "2026-12-31" } });
    await waitFor(() => expect(updateRevisionContentMock).toHaveBeenCalled(), { timeout: 3000 });
    const body = updateRevisionContentMock.mock.calls[0][3];
    expect(body.discountAmount).toBeUndefined();
    expect(body.discountPercent).toBeUndefined();
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
