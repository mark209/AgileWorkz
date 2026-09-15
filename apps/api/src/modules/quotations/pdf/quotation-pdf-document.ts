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
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  watermark: {
    position: "absolute",
    top: 260,
    left: 90,
    fontSize: 90,
    color: "#e5484d",
    opacity: 0.25,
    transform: "rotate(-35deg)",
  },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  h1: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  muted: { color: "#666666" },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 4, borderBottom: "1 solid #cccccc", paddingBottom: 2 },
  row: { flexDirection: "row" },
  table: { display: "flex", width: "100%", marginTop: 4 },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#f0f0f0", paddingVertical: 4, fontWeight: 700 },
  tableRow: { flexDirection: "row", paddingVertical: 3, borderBottom: "0.5 solid #eeeeee" },
  colDescription: { width: "40%" },
  colQty: { width: "10%", textAlign: "right" },
  colUnit: { width: "10%" },
  colPrice: { width: "20%", textAlign: "right" },
  colAmount: { width: "20%", textAlign: "right" },
  totals: { marginTop: 8, alignSelf: "flex-end", width: "40%" },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalsFinal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTop: "1 solid #333333", fontWeight: 700 },
  approvalBox: { marginTop: 20, padding: 10, border: "1 solid #333333" },
  approvalTitle: { fontSize: 11, fontWeight: 700, marginBottom: 6 },
  approvalRow: { marginBottom: 4 },
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

export function buildQuotationPdfDocument(data: QuotationPdfData) {
  return h(
    Document,
    { title: `${data.quotationNumber} Rev.${data.revisionNumber}` },
    h(
      Page,
      { size: "A4", style: styles.page },
      !data.isFinal && h(Text, { style: styles.watermark }, "DRAFT"),
      h(
        View,
        { style: styles.header },
        h(
          View,
          null,
          h(Text, { style: styles.h1 }, "AgileWorks HVAC ERP"),
          h(Text, { style: styles.muted }, "Quotation"),
        ),
        h(
          View,
          null,
          h(Text, null, `Quotation No.: ${data.quotationNumber}`),
          h(Text, null, `Revision: ${data.revisionNumber}`),
          h(Text, { style: styles.muted }, data.isFinal ? "APPROVED" : "DRAFT — not yet approved"),
        ),
      ),
      h(
        View,
        { style: styles.section },
        h(Text, { style: styles.sectionTitle }, "Customer & Site"),
        h(Text, null, data.customerName),
        h(Text, null, data.siteLabel),
        h(Text, { style: styles.muted }, data.siteAddress),
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
              { key: i, style: styles.tableRow },
              h(
                View,
                { style: styles.colDescription },
                h(Text, null, item.description),
                item.brand || item.model ? h(Text, { style: styles.muted }, [item.brand, item.model].filter(Boolean).join(" ")) : null,
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
          { style: styles.totals },
          h(View, { style: styles.totalsRow }, h(Text, null, "Subtotal"), h(Text, null, money(data.subtotal))),
          h(View, { style: styles.totalsRow }, h(Text, null, "Discount"), h(Text, null, money(data.discountAmount))),
          h(View, { style: styles.totalsRow }, h(Text, null, "Net Amount"), h(Text, null, money(data.netAmount))),
          h(View, { style: styles.totalsRow }, h(Text, null, "VAT"), h(Text, null, money(data.vatAmount))),
          h(View, { style: styles.totalsFinal }, h(Text, null, "Total"), h(Text, null, money(data.totalAmount))),
        ),
      ),
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
                h(Text, null, `Approved: ${a.approvedAt}`),
                h(Text, null, `Quotation ${data.quotationNumber}, Revision ${data.revisionNumber}`),
              ),
            ),
          )
        : null,
      h(Text, { style: [styles.muted, { marginTop: 20, fontSize: 8 }] }, `Generated ${data.generatedAt}`),
    ),
  );
}
