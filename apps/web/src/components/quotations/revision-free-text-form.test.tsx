import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuotationRevision } from "@/lib/api/types";
import { RevisionFreeTextForm } from "./revision-free-text-form";

const { useAuthMock, updateRevisionContentMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  updateRevisionContentMock: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, updateRevisionContent: updateRevisionContentMock };
});

const draft = {
  id: "r1",
  quotationId: "q1",
  status: "DRAFT",
  defaultTaxTreatment: "VAT_INCLUSIVE",
  discountPercent: "0",
  discountAmount: "0",
  paymentTerms: "Net 30",
  termsAndConditions: "[PLACEHOLDER] Replace before sending",
  validUntil: null,
} as QuotationRevision;

describe("RevisionFreeTextForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useAuthMock.mockReturnValue({ accessToken: "token-1", user: { id: "user-1" } });
    updateRevisionContentMock.mockResolvedValue({ ...draft, termsAndConditions: "" });
  });

  it("sends an empty Terms & Conditions value when the draft field is cleared", async () => {
    render(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={draft} onChanged={vi.fn()} />);

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Terms & conditions"));
    await user.click(screen.getByRole("button", { name: "Save details and commercial terms" }));

    await waitFor(() => {
      expect(updateRevisionContentMock).toHaveBeenCalledWith(
        "token-1",
        "q1",
        "r1",
        expect.objectContaining({ termsAndConditions: "" }),
      );
    });
  });

  it("sends an empty optional text value when that draft field is cleared", async () => {
    render(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={draft} onChanged={vi.fn()} />);

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Payment terms"));
    await user.click(screen.getByRole("button", { name: "Save details and commercial terms" }));

    await waitFor(() => {
      expect(updateRevisionContentMock).toHaveBeenCalledWith(
        "token-1",
        "q1",
        "r1",
        expect.objectContaining({ paymentTerms: "" }),
      );
    });
  });

  it("does not fill untouched optional fields that are null", async () => {
    render(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={draft} onChanged={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Save details and commercial terms" }));

    await waitFor(() => {
      expect(updateRevisionContentMock).toHaveBeenCalled();
      expect(updateRevisionContentMock.mock.calls[0][3].scopeOfWork).toBeUndefined();
    });
  });

  it("keeps a fixed discount in fixed-amount mode when saving", async () => {
    const fixedDiscountDraft = { ...draft, discountPercent: "0", discountAmount: "500" };
    render(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={fixedDiscountDraft} onChanged={vi.fn()} />);

    expect(screen.getByLabelText("Discount")).toHaveValue("amount");
    await userEvent.setup().click(screen.getByRole("button", { name: "Save details and commercial terms" }));

    await waitFor(() => {
      expect(updateRevisionContentMock).toHaveBeenCalledWith(
        "token-1",
        "q1",
        "r1",
        expect.objectContaining({ discountAmount: 500, discountPercent: undefined }),
      );
    });
  });

  it("reports unsaved edits until the details API succeeds", async () => {
    const onDirtyChange = vi.fn();
    render(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={draft} onChanged={vi.fn()} onDirtyChange={onDirtyChange} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Lead time"), "Two weeks");
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Save details and commercial terms" }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it("offers the last saved lead time as a suggestion without changing the current field", async () => {
    const user = userEvent.setup();
    const view = render(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={draft} onChanged={vi.fn()} />);
    await user.type(screen.getByLabelText("Lead time"), "Two weeks");
    await user.click(screen.getByRole("button", { name: "Save details and commercial terms" }));
    await waitFor(() => expect(window.localStorage.getItem("agileworks-quotation-suggestions:user-1")).toContain("Two weeks"));

    view.unmount();
    render(<RevisionFreeTextForm quotationId="q2" revisionId="r2" canEdit revision={draft} onChanged={vi.fn()} />);
    const leadTime = screen.getByLabelText("Lead time");
    expect(leadTime).toHaveValue("");
    expect(document.getElementById(leadTime.getAttribute("list")!)?.querySelector("option")?.value).toBe("Two weeks");
  });

  it("does not remember a value when saving fails", async () => {
    updateRevisionContentMock.mockRejectedValueOnce(new Error("Save failed"));
    const user = userEvent.setup();
    render(<RevisionFreeTextForm quotationId="q1" revisionId="r1" canEdit revision={draft} onChanged={vi.fn()} />);
    await user.type(screen.getByLabelText("Lead time"), "Three weeks");
    await user.click(screen.getByRole("button", { name: "Save details and commercial terms" }));
    await screen.findByText("Failed to save.");
    expect(window.localStorage.getItem("agileworks-quotation-suggestions:user-1")).toBeNull();
  });
});
