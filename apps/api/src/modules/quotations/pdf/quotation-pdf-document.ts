import { createElement as h } from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const logo = readFileSync(join(__dirname, "assets", "agileworks-logo.jpg"));

// Geometry follows the client-supplied US Letter quotation samples. All
// commercial values and customer/author names come from the chosen revision.
const styles = StyleSheet.create({
  page: { paddingTop: 54, paddingBottom: 42, paddingHorizontal: 36, fontSize: 11, fontFamily: "Helvetica", color: "#000000", lineHeight: 1.45 },
  frame: { position: "absolute", top: 24, height: 744, width: 564, left: 24, borderWidth: 1.2, borderColor: "#000000" },
  header: { flexDirection: "row", alignItems: "center", marginLeft: 25, height: 116, marginBottom: 8 },
  logo: { width: 119, height: 116, objectFit: "contain", marginRight: 9 },
  company: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 5 },
  companyDetail: { fontSize: 10.5, fontFamily: "Helvetica-Bold", lineHeight: 1.55 },
  quotationNumber: { textAlign: "right", color: "#ed7d31", fontFamily: "Helvetica-Bold", fontSize: 12, marginBottom: 2 },
  date: { fontFamily: "Helvetica-Bold", marginBottom: 20 },
  recipient: { flexDirection: "row", fontFamily: "Helvetica-Bold", marginBottom: 20 },
  label: { width: 36 },
  sender: { fontFamily: "Helvetica-Bold", marginBottom: 26 },
  greeting: { marginBottom: 16 },
  introduction: { marginBottom: 34 },
  table: { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: "#000000", marginBottom: 12 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#000000" },
  cell: { borderRightWidth: 0.5, borderColor: "#000000", paddingHorizontal: 4, paddingVertical: 1.5, justifyContent: "center" },
  tableHeading: { fontFamily: "Helvetica-Bold", textAlign: "center", fontSize: 10.5, lineHeight: 1.4, minHeight: 54, paddingVertical: 4 },
  numeric: { textAlign: "right" },
  centered: { textAlign: "center" },
  highlight: { backgroundColor: "#ffff00" },
  detail: { fontSize: 9.5 },
  summary: { width: "62%", alignSelf: "flex-end", marginTop: 5, marginBottom: 10, fontSize: 10 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1 },
  grandTotal: { alignSelf: "center", width: "86%", flexDirection: "row", borderWidth: 0.5, backgroundColor: "#ffff00", fontFamily: "Helvetica-Bold", marginTop: 4, marginBottom: 22 },
  totalLabel: { width: "66%", borderRightWidth: 0.5, paddingHorizontal: 5, paddingVertical: 2, textAlign: "center" },
  totalValue: { width: "34%", paddingHorizontal: 7, paddingVertical: 2, textAlign: "right" },
  section: { marginTop: 20 },
  heading: { fontFamily: "Helvetica-Bold", marginBottom: 4 },
  indent: { marginLeft: 18 },
  terms: { marginTop: 16, marginLeft: 36 },
  signatureBlock: { flexDirection: "row", justifyContent: "space-between", marginTop: 26, marginBottom: 12 },
  signatureColumn: { width: "42%" },
  signatureLine: { borderBottomWidth: 0.5, marginTop: 40, marginBottom: 16, width: "92%" },
  signatureName: { fontFamily: "Helvetica-Bold", fontSize: 10.5 },
  approval: { marginTop: 14, fontSize: 8, lineHeight: 1.4 },
  appendix: { paddingTop: 78, paddingBottom: 35, paddingHorizontal: 30, fontSize: 11, fontFamily: "Helvetica", color: "#000000", lineHeight: 1.35 },
  appendixTitle: { fontSize: 12, textAlign: "center", fontFamily: "Helvetica-Bold", textDecoration: "underline", marginBottom: 10 },
  appendixCell: { paddingVertical: 6, fontSize: 11.5 },
  watermark: { position: "absolute", top: 300, left: 90, fontSize: 85, color: "#cccccc", opacity: 0.3, transform: "rotate(-35deg)" },
});

export interface QuotationPdfLineItem {
  description: string;
  specification: string | null;
  brand: string | null;
  model: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineAmount: string;
  lineFinalAmount: string;
  lineVatAmount: string;
  taxTreatment: "VAT_EXCLUSIVE" | "VAT_INCLUSIVE" | "VAT_EXEMPT";
}

export interface QuotationPdfApprovalEvent {
  levelLabel: string; // "Manager" or "Owner"
  approverName: string;
  approverRole: string; // "Manager (Service)" or "Owner"
  approvedAt: string; // ISO timestamp, formatted by the caller
}

export interface QuotationPdfData {
  quotationNumber: string;
  revisionNumber: number;
  customerName: string;
  siteLabel: string;
  siteAddress: string;
  scopeOfWork: string | null;
  quotationType?: string;
  pdfLayout?: string;
  quotationDate?: string;
  recipientName?: string | null;
  preparedByName?: string | null;
  paymentInstructions?: string | null;
  scopeItems?: Array<{ description: string; method: string | null; indications: string | null }>;
  scopeTitle?: string | null;
  maintenanceFrequency?: string | null;
  lineItems: QuotationPdfLineItem[];
  subtotal: string;
  discountAmount: string;
  netAmount: string;
  vatAmount: string;
  totalAmount: string;
  termsAndConditions: string | null;
  paymentTerms: string | null;
  warranty: string | null;
  leadTime: string | null;
  notes?: string | null;
  exclusions: string | null;
  validUntil: string | null;
  isFinal: boolean; // all required approval levels complete for this revision
  approvals: QuotationPdfApprovalEvent[]; // in level order (Manager, then Owner if applicable)
  generatedAt: string;
}

function money(value: string) {
  return Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function date(value: string) {
  return new Date(value).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "long", day: "2-digit", year: "numeric" });
}

function approvalDate(value: string) {
  return new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Keep ordinary sample-sized blocks together, but let lengthy or explicitly
// multiline content continue onto another page instead of clipping it.
function needsPageWrapping(...values: Array<string | null | undefined>) {
  return values.some((value) => (value ?? "").split(/\r?\n/).reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / 35)), 0) > 18);
}

export function buildQuotationPdfDocument(data: QuotationPdfData) {
  const allTaxable = data.lineItems.length > 0 && data.lineItems.every((item) => item.taxTreatment === "VAT_INCLUSIVE");
  const allExempt = data.lineItems.length > 0 && data.lineItems.every((item) => item.taxTreatment === "VAT_EXEMPT");
  const maintenanceLayout = data.pdfLayout === "MAINTENANCE" || (data.pdfLayout !== "STANDARD" && data.quotationType === "PREVENTIVE_MAINTENANCE" && allTaxable);
  const taxLabel = allTaxable ? "VAT INCL" : allExempt ? "VAT EXEMPT" : "MIXED TAX";
  const discount = Number(data.discountAmount) > 0;
  const hasVat = Number(data.vatAmount) > 0;
  const showTotal = discount || hasVat || data.lineItems.length > 1;
  const showExemptHighlight = allExempt && data.lineItems.length === 1 && !discount;
  const widths = maintenanceLayout ? ["7%", "46%", "9%", "13%", "12%", "13%"] : ["9%", "49%", "10%", "16%", "16%"];
  const frequency = data.maintenanceFrequency?.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  const tableCell = (content: string, index: number, heading = false, highlight = false, topAlign = false) => h(View, {
    key: index, style: [styles.cell, { width: widths[index] }, ...(heading ? [styles.tableHeading] : []), ...(highlight ? [styles.highlight] : []), ...(topAlign ? [{ justifyContent: "flex-start" as const }] : [])],
  }, h(Text, { style: heading ? styles.centered : index === 1 ? (maintenanceLayout ? styles.centered : undefined) : index < 3 || (maintenanceLayout && index === 4) ? styles.centered : styles.numeric }, content));
  const rowSummary = (label: string, value: string) => h(View, { style: styles.summaryRow, key: label }, h(Text, null, label), h(Text, null, value));
  const headers = maintenanceLayout
    ? ["Item\nNo.", "Brand and Unit Model", "QTY", allExempt ? "Pricing\n(VAT\nEXEMPT)" : `Pricing\n(${taxLabel})`, `Frequency${frequency ? `\n(${frequency})` : ""}`, "Total"]
    : ["Item\nNo.", "Description", "QTY", allExempt ? "Price\n(VAT EXEMPT)" : `Price (${allTaxable ? "VAT INCL" : "mixed tax"})`, allExempt ? "Amount\n(VAT EXEMPT)" : `Amount (${allTaxable ? "VAT INCL" : "mixed tax"})`];

  const firstPage = h(Page, { size: "LETTER", style: styles.page },
    h(View, { style: styles.frame, fixed: true }),
    !data.isFinal && h(Text, { style: styles.watermark, fixed: true }, "DRAFT"),
    h(View, { style: styles.header, wrap: false },
      h(Image, { src: logo, style: styles.logo }),
      h(View, null,
        h(Text, { style: styles.company }, "AGILEWORKS SOLUTIONS OPC"),
        h(Text, { style: styles.companyDetail }, "San Juan, Taytay, Rizal"),
        h(Text, { style: styles.companyDetail }, "SEC NO. 2024090170896-05"),
        h(Text, { style: styles.companyDetail }, "VAT Reg. TIN: 010-852-108-00000"))),
    h(Text, { style: styles.quotationNumber }, `${data.quotationNumber}${data.revisionNumber > 0 ? ` Rev. ${data.revisionNumber}` : ""}`),
    h(Text, { style: styles.date }, `Date:    ${date(data.quotationDate ?? data.generatedAt)}`),
    h(View, { style: styles.recipient }, h(Text, { style: styles.label }, "To:"), h(View, null,
      data.recipientName ? h(Text, null, data.recipientName) : null,
      h(Text, null, data.customerName),
      data.siteLabel && data.siteLabel !== data.customerName ? h(Text, { style: { fontFamily: "Helvetica", fontSize: 10 } }, data.siteLabel) : null)),
    h(Text, { style: styles.sender }, `From:  ${data.preparedByName || "AGILEWORKS SOLUTIONS OPC"}`),
    h(Text, { style: styles.greeting }, "Dear Sir/Madam;"),
    h(View, { style: styles.introduction }, h(Text, null, "Good day!"), h(Text, null, "We are pleased to submit our quotation based on your requirements. Below are the following details:")),
    h(View, { style: styles.table },
      h(View, { style: styles.tableRow, minPresenceAhead: 35 }, ...headers.map((label, index) => tableCell(label, index, true))),
      ...data.lineItems.map((item, index) => {
        const description = [item.description, item.specification, [item.brand, item.model].filter(Boolean).join(" ")].filter(Boolean).join("\n");
        const quantity = `${maintenanceLayout ? String(Number(item.quantity)) : money(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`;
        const values = maintenanceLayout
          ? [String(index + 1), description, quantity, money(item.unitPrice), "1", money(item.lineAmount)]
          : [String(index + 1), description, quantity, money(item.unitPrice), money(item.lineAmount)];
        const longRow = needsPageWrapping(description);
        return h(View, { key: index, style: styles.tableRow, wrap: longRow }, ...values.map((value, col) => tableCell(value, col, false, showExemptHighlight && col >= 3, longRow)));
      })),
    (discount || hasVat) && h(View, { style: styles.summary, wrap: false },
      discount && rowSummary(allExempt ? "Subtotal (VAT exempt)" : "Subtotal (includes VAT)", money(data.subtotal)),
      discount && rowSummary("Less: Discount", `- ${money(data.discountAmount)}`),
      hasVat && rowSummary(discount ? "Net of VAT after discount" : "Net of VAT", money(data.netAmount)),
      hasVat && rowSummary("VAT", money(data.vatAmount))),
    showTotal && h(View, { style: styles.grandTotal, wrap: false },
      h(Text, { style: styles.totalLabel }, `TOTAL (${taxLabel})`), h(Text, { style: styles.totalValue }, money(data.totalAmount))),
    h(View, { style: styles.section, wrap: needsPageWrapping(data.paymentTerms) }, h(Text, { style: styles.heading, minPresenceAhead: 35 }, "TERMS OF PAYMENT:"), h(Text, { style: styles.indent }, data.paymentTerms ? `(1)  ${data.paymentTerms}` : "Not specified")),
    data.paymentInstructions && h(View, { style: styles.section, wrap: needsPageWrapping(data.paymentInstructions) }, h(Text, { style: styles.heading, minPresenceAhead: 35 }, "MODE OF PAYMENT:"), h(Text, { style: styles.indent }, data.paymentInstructions)),
    h(View, { style: styles.section, wrap: needsPageWrapping(data.scopeOfWork) }, h(Text, { style: styles.heading, minPresenceAhead: 35 }, "SCOPE OF WORK:"), h(Text, { style: styles.indent }, data.scopeOfWork ? `(1)  ${data.scopeOfWork}` : "As itemized above.")),
    h(View, { style: styles.terms, wrap: needsPageWrapping([data.termsAndConditions, data.warranty, data.exclusions, data.leadTime, data.notes].filter(Boolean).join("\n")) },
      h(Text, { style: styles.heading, minPresenceAhead: 45 }, "TERMS AND CONDITIONS:"),
      data.termsAndConditions && h(Text, null, data.termsAndConditions),
      data.warranty && h(Text, { style: { marginTop: 8 } }, `WARRANTY: ${data.warranty}`),
      data.exclusions && h(View, { style: { marginTop: 16 } }, h(Text, { style: styles.heading, minPresenceAhead: 35 }, "EXCLUSION:"), h(Text, null, data.exclusions)),
      data.leadTime && h(Text, { style: { marginTop: 8 } }, `LEAD TIME: ${data.leadTime}`),
      data.notes && h(Text, { style: { marginTop: 8 } }, data.notes)),
    data.validUntil && h(View, { style: styles.section, wrap: false }, h(Text, { style: styles.heading }, "VALIDITY:"), h(Text, { style: styles.indent }, `(1)  This quotation is valid until ${date(data.validUntil)}.`)),
    h(View, { style: styles.signatureBlock, wrap: false },
      h(View, { style: styles.signatureColumn }, h(Text, null, "Prepared by:"), h(View, { style: styles.signatureLine }), h(Text, { style: styles.signatureName }, data.preparedByName || "AGILEWORKS SOLUTIONS OPC")),
      h(View, { style: styles.signatureColumn }, h(Text, { style: styles.heading }, "Conformed by:"), h(View, { style: styles.signatureLine }), h(Text, { style: styles.signatureName }, "Signature over printed name / Date"))),
    data.isFinal && data.approvals.length > 0 && h(View, { style: styles.approval, wrap: false }, h(Text, { style: styles.heading }, "Electronically Approved"),
      ...data.approvals.map((approval, index) => h(Text, { key: index }, `${approval.levelLabel}: ${approval.approverName} (${approval.approverRole}) - ${approvalDate(approval.approvedAt)} PHT`))),
  );

  const appendix = data.scopeItems?.length ? h(Page, { size: "LETTER", style: styles.appendix },
    h(View, { style: styles.frame, fixed: true }),
    h(Text, { style: styles.appendixTitle }, data.scopeTitle?.trim() || "SCOPE OF WORK DETAILS"),
    h(View, { style: styles.table },
      h(View, { style: styles.tableRow, fixed: true }, ...["Scope of Work", "Description", "Indications"].map((label, index) => h(View, { key: index, style: [styles.cell, { width: index === 1 ? "37%" : index === 0 ? "34%" : "29%" }] }, h(Text, { style: { fontFamily: "Helvetica-Bold", fontSize: 11.5, lineHeight: 1.2, textAlign: "center", textDecoration: "underline" } }, label)))),
      ...data.scopeItems.map((item, index) => h(View, { key: index, style: styles.tableRow, wrap: needsPageWrapping(item.description, item.method, item.indications) },
        !item.method && !item.indications ? h(View, { style: [styles.cell, styles.appendixCell, { width: "100%" }] }, h(Text, null, `${index + 1})  ${item.description}`)) : [
          h(View, { key: "scope", style: [styles.cell, styles.appendixCell, { width: "34%" }] }, h(Text, null, `${index + 1})  ${item.description}`)),
          h(View, { key: "method", style: [styles.cell, styles.appendixCell, { width: "37%" }] }, h(Text, null, item.method || "")),
          h(View, { key: "indications", style: [styles.cell, styles.appendixCell, { width: "29%" }] }, h(Text, null, item.indications || "")),
        ])))) : null;
  return h(Document, { title: `${data.quotationNumber} Rev.${data.revisionNumber}` }, firstPage, appendix);
}
