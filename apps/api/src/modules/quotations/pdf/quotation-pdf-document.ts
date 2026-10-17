// Two-level approval correction — quotation PDF generation. Written in
// plain React.createElement calls, deliberately not JSX: apps/api has no
// JSX compiler configuration anywhere (it is a NestJS backend with no
// other React/frontend code), and enabling one project-wide for a single
// feature would be a far bigger footprint than avoiding JSX syntax here.
// @react-pdf/renderer's components (Document/Page/View/Text) are ordinary
// React components either way — this is only a syntax choice, not a
// different rendering model.
import { createElement as h } from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { paddingTop: 42, paddingBottom: 55, paddingHorizontal: 42, fontSize: 9, fontFamily: "Helvetica", color: "#183047" },
  watermark: {
    position: "absolute",
    top: 260,
    left: 90,
    fontSize: 90,
    color: "#bdc9d4",
    opacity: 0.22,
    transform: "rotate(-35deg)",
  },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24, paddingBottom: 14, borderBottom: "2 solid #117c9c" },
  h1: { fontSize: 16, fontWeight: 700, marginBottom: 4, color: "#123c58" },
  documentTitle: { fontSize: 17, fontWeight: 700, color: "#117c9c", textAlign: "right" },
  muted: { color: "#647587" },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 10, fontWeight: 700, color: "#123c58", marginBottom: 7, borderBottom: "1 solid #dce5eb", paddingBottom: 5, textTransform: "uppercase" },
  customerName: { fontSize: 11, fontWeight: 700, marginBottom: 3 },
  metadata: { textAlign: "right", marginTop: 6, lineHeight: 1.5 },
  row: { flexDirection: "row" },
  table: { display: "flex", width: "100%", marginTop: 4 },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#123c58", color: "#ffffff", paddingVertical: 8, paddingHorizontal: 7, fontWeight: 700 },
  tableRow: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 7, borderBottom: "0.5 solid #dce5eb" },
  colDescription: { width: "42%", paddingRight: 8 },
  colQty: { width: "9%", textAlign: "right" },
  colUnit: { width: "9%", paddingLeft: 5 },
  colPrice: { width: "20%", textAlign: "right" },
  colAmount: { width: "20%", textAlign: "right" },
  itemDetail: { color: "#647587", fontSize: 8, marginTop: 3 },
  totals: { marginTop: 12, alignSelf: "flex-end", width: "53%" },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalsFinal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderTop: "2 solid #117c9c", fontWeight: 700, fontSize: 11, color: "#123c58" },
  approvalBox: { marginTop: 16, padding: 10, border: "1 solid #dce5eb", backgroundColor: "#f5f9fb" },
  approvalTitle: { fontSize: 11, fontWeight: 700, marginBottom: 6 },
  approvalRow: { marginBottom: 4 },
  footer: { position: "absolute", bottom: 26, left: 42, right: 42, borderTop: "1 solid #dce5eb", paddingTop: 6, flexDirection: "row", justifyContent: "space-between", color: "#647587", fontSize: 8 },
});

export interface QuotationPdfLineItem {
  description: string;
  specification: string | null;
  brand: string | null;
  model: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
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
  exclusions: string | null;
  validUntil: string | null;
  isFinal: boolean; // all required approval levels complete for this revision
  approvals: QuotationPdfApprovalEvent[]; // in level order (Manager, then Owner if applicable)
  generatedAt: string;
}

// "PHP " rather than the "₱" glyph — the built-in Helvetica font this
// document uses has no ₱ glyph, which silently rendered as a missing-glyph
// substitute character when tested. "PHP" is the same convention already
// used in this codebase's own system_settings descriptions, and renders
// correctly with no custom font to embed.
function money(v: string) {
  return `PHP ${Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function approvalDateTime(value: string) {
  return `${new Date(value).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })} PHT`;
}

export function buildQuotationPdfDocument(data: QuotationPdfData) {
  return h(
    Document,
    { title: `${data.quotationNumber} Rev.${data.revisionNumber}` },
    h(
      Page,
      { size: "A4", style: styles.page },
      !data.isFinal && h(Text, { style: styles.watermark, fixed: true }, "DRAFT"),
      h(
        View,
        { style: styles.header },
        h(
          View,
          null,
          h(Text, { style: styles.h1 }, "AgileWorks Solutions OPC"),
          h(Text, { style: styles.muted }, "HVAC services and engineering"),
        ),
        h(
          View,
          null,
          h(Text, { style: styles.documentTitle }, "QUOTATION"),
          h(View, { style: styles.metadata },
            h(Text, null, `No. ${data.quotationNumber}  |  Revision ${data.revisionNumber}`),
            h(Text, null, `PDF generated ${new Date(data.generatedAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}`),
            h(Text, { style: styles.muted }, data.isFinal ? "Approved revision" : "Draft — not for issue"),
          ),
        ),
      ),
      h(
        View,
        { style: styles.section },
        h(Text, { style: styles.sectionTitle }, "Prepared for"),
        h(Text, { style: styles.customerName }, data.customerName),
        h(Text, null, `Service site: ${data.siteLabel}`),
        h(Text, { style: styles.muted }, data.siteAddress),
        data.validUntil ? h(Text, { style: [styles.muted, { marginTop: 4 }] }, `Valid until: ${new Date(data.validUntil).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}`) : null,
      ),
      data.scopeOfWork
        ? h(
            View,
            { style: styles.section },
            h(Text, { style: styles.sectionTitle }, "Scope of Work"),
            h(Text, null, data.scopeOfWork),
          )
        : null,
      h(
        View,
        { style: styles.section },
        h(Text, { style: styles.sectionTitle }, "Line Items"),
        h(
          View,
          { style: styles.table },
          h(
            View,
            { style: styles.tableHeaderRow },
            h(Text, { style: styles.colDescription }, "Description"),
            h(Text, { style: styles.colQty }, "Qty"),
            h(Text, { style: styles.colUnit }, "Unit"),
            h(Text, { style: styles.colPrice }, "Unit Price"),
            h(Text, { style: styles.colAmount }, "Amount"),
          ),
          ...data.lineItems.map((item, i) =>
            h(
              View,
              { key: i, style: styles.tableRow, minPresenceAhead: 48 },
              h(
                View,
                { style: styles.colDescription },
                h(Text, null, item.description),
                item.specification ? h(Text, { style: styles.itemDetail }, item.specification) : null,
                item.brand || item.model ? h(Text, { style: styles.itemDetail }, [item.brand, item.model].filter(Boolean).join(" ")) : null,
                h(Text, { style: styles.itemDetail }, `${item.taxTreatment.replaceAll("_", " ")} · VAT ${money(item.lineVatAmount)}`),
              ),
              h(Text, { style: styles.colQty }, item.quantity),
              h(Text, { style: styles.colUnit }, item.unit),
              h(Text, { style: styles.colPrice }, money(item.unitPrice)),
              h(Text, { style: styles.colAmount }, money(item.lineFinalAmount)),
            ),
          ),
        ),
        h(
          View,
          { style: styles.totals, wrap: false },
          h(View, { style: styles.totalsRow }, h(Text, null, "Subtotal"), h(Text, null, money(data.subtotal))),
          h(View, { style: styles.totalsRow }, h(Text, null, "Discount"), h(Text, null, money(data.discountAmount))),
          h(View, { style: styles.totalsRow }, h(Text, null, "Net Amount"), h(Text, null, money(data.netAmount))),
          h(View, { style: styles.totalsRow }, h(Text, null, "VAT"), h(Text, null, money(data.vatAmount))),
          h(View, { style: styles.totalsFinal }, h(Text, null, "Total"), h(Text, null, money(data.totalAmount))),
        ),
      ),
      (data.paymentTerms || data.leadTime || data.warranty || data.exclusions)
        ? h(View, { style: styles.section },
            h(Text, { style: styles.sectionTitle }, "Commercial terms"),
            data.paymentTerms ? h(Text, { style: { marginBottom: 4 } }, `Payment: ${data.paymentTerms}`) : null,
            data.leadTime ? h(Text, { style: { marginBottom: 4 } }, `Lead time: ${data.leadTime}`) : null,
            data.warranty ? h(Text, { style: { marginBottom: 4 } }, `Warranty: ${data.warranty}`) : null,
            data.exclusions ? h(Text, { style: { marginBottom: 4 } }, `Exclusions: ${data.exclusions}`) : null,
          )
        : null,
      data.termsAndConditions
        ? h(
            View,
            { style: styles.section },
            h(Text, { style: styles.sectionTitle }, "Terms & Conditions"),
            h(Text, null, data.termsAndConditions),
          )
        : null,
      data.isFinal && data.approvals.length > 0
        ? h(
            View,
            { style: styles.approvalBox },
            h(Text, { style: styles.approvalTitle }, "Electronically Approved"),
            ...data.approvals.map((a, i) =>
              h(
                View,
                { key: i, style: styles.approvalRow },
                h(Text, null, `Level ${i + 1} — ${a.levelLabel}`),
                h(Text, null, `Approver: ${a.approverName} (${a.approverRole})`),
                h(Text, null, `Approved: ${approvalDateTime(a.approvedAt)}`),
                h(Text, null, `Quotation ${data.quotationNumber}, Revision ${data.revisionNumber}`),
              ),
            ),
          )
        : null,
      h(View, { style: styles.footer, fixed: true },
        h(Text, null, `${data.quotationNumber} · Rev. ${data.revisionNumber}`),
        h(Text, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` }),
      ),
    ),
  );
}
