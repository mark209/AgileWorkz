import { isValidElement, ReactNode } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { buildQuotationPdfDocument, QuotationPdfData } from "../src/modules/quotations/pdf/quotation-pdf-document";

function textContent(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(textContent);
  if (typeof node === "string") return [node];
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  return [];
}

function pageSizes(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(pageSizes);
  if (isValidElement<{ size?: string; children?: ReactNode }>(node)) return [...(node.props.size ? [node.props.size] : []), ...pageSizes(node.props.children)];
  return [];
}

const data: QuotationPdfData = {
  quotationNumber: "Q-AUDIT", revisionNumber: 0, customerName: "Test Customer", siteLabel: "Office", siteAddress: "Test Address",
  scopeOfWork: "Maintenance services", lineItems: [{ description: "Service", specification: null, brand: null, model: null,
    quantity: "1", unit: "lot", unitPrice: "1120", lineAmount: "1120", lineFinalAmount: "1008", lineVatAmount: "108", taxTreatment: "VAT_INCLUSIVE" }],
  subtotal: "1120", discountAmount: "112", netAmount: "900", vatAmount: "108", totalAmount: "1008",
  termsAndConditions: null, paymentTerms: "Net 30", warranty: null, leadTime: null, exclusions: null, validUntil: null,
  isFinal: true, approvals: [], generatedAt: "2026-11-19T00:00:00Z",
};

describe("quotation PDF totals", () => {
  it("labels an exempt quotation correctly even when the maintenance table layout is selected", () => {
    const text = textContent(buildQuotationPdfDocument({ ...data, pdfLayout: "MAINTENANCE", vatAmount: "0", netAmount: "1000", subtotal: "1000", discountAmount: "0", totalAmount: "1000",
      lineItems: [{ ...data.lineItems[0], taxTreatment: "VAT_EXEMPT", unitPrice: "1000", lineAmount: "1000", lineFinalAmount: "1000", lineVatAmount: "0" }],
    })).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("VAT EXEMPT");
    expect(text).not.toContain("VAT INCL");
  });
  it("uses the supplied Letter-size letterhead and the quotation's own recipient and sender", () => {
    const document = buildQuotationPdfDocument({ ...data, recipientName: "Current Contact", preparedByName: "Current Engineer", quotationDate: "2026-10-09", paymentInstructions: "Current bank instructions", quotationType: "PREVENTIVE_MAINTENANCE" } as QuotationPdfData);
    const text = textContent(document);
    expect(pageSizes(document)).toContain("LETTER");
    expect(text).toContain("AGILEWORKS SOLUTIONS OPC");
    expect(text).toContain("San Juan, Taytay, Rizal");
    expect(text).toContain("Current Contact");
    expect(text).toContain("Current Engineer");
    expect(text).toContain("TERMS OF PAYMENT:");
    expect(text).toContain("MODE OF PAYMENT:");
    expect(text).toContain("Current bank instructions");
    expect(text).toContain("Prepared by:");
    expect(text).toContain("Conformed by:");
    expect(text.join(" ")).not.toContain("Neil Christopher");
    expect(text.join(" ")).not.toContain("Ford Marikina");
  });

  it("prints only the quotation's included scope rows in the three-column appendix", () => {
    const document = buildQuotationPdfDocument({ ...data, scopeItems: [
      { description: "Check current unit", method: "Use calibrated meter", indications: "Current reading" },
    ] } as QuotationPdfData);
    const text = textContent(document);
    expect(text).toContain("SCOPE OF WORK DETAILS");
    expect(text).toContain("Description");
    expect(text).toContain("Indications");
    expect(text.join(" ")).toContain("Check current unit");
    expect(text).toContain("Use calibrated meter");
    expect(text).toContain("Current reading");
  });
  it("shows the undiscounted line amount and deducts the discount once in the summary", () => {
    const text = textContent(buildQuotationPdfDocument(data));
    const amountHeader = text.findIndex((value) => value.startsWith("Amount ("));
    const subtotalLabel = text.indexOf("Subtotal (includes VAT)");
    const lineText = text.slice(amountHeader + 1, subtotalLabel);
    expect(lineText).toContain("1,120.00");
    expect(lineText).not.toContain("1,008.00");
    expect(text).toContain("Less: Discount");
    expect(text).toContain("- 112.00");
    expect(text).toContain("900.00");
    expect(text).toContain("108.00");
    expect(text).toContain("1,008.00");
  });

  it("renders a valid PDF using the same totals", async () => {
    const pdf = await renderToBuffer(buildQuotationPdfDocument(data));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("paginates short multiline instructions rather than keeping an oversized block on one page", async () => {
    const lines = Array.from({ length: 70 }, (_, i) => `Line ${i + 1}`).join("\n");
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const pdf = await renderToBuffer(buildQuotationPdfDocument({ ...data,
        paymentInstructions: lines, scopeOfWork: lines,
        lineItems: [{ ...data.lineItems[0], specification: lines }],
        scopeItems: [{ description: "Current scope", method: lines, indications: "Current condition" }],
      }));
      const pageCount = pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
      expect(pageCount).toBeGreaterThanOrEqual(5);
      expect(warn.mock.calls.flat().join(" ")).not.toMatch(/can't wrap|exceed|larger than/i);
    } finally { warn.mockRestore(); }
  });
  it("paginates the combined commercial terms when several individually short fields exceed a page", async () => {
    const lines = Array.from({ length: 15 }, (_, i) => `Condition ${i + 1}`).join("\n");
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const pdf = await renderToBuffer(buildQuotationPdfDocument({ ...data,
        termsAndConditions: lines, warranty: lines, exclusions: lines, leadTime: lines, notes: lines,
      }));
      const pageCount = pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
      expect(pageCount).toBeGreaterThanOrEqual(3);
      expect(warn.mock.calls.flat().join(" ")).not.toMatch(/can't wrap|exceed|larger than/i);
    } finally { warn.mockRestore(); }
  });
});
