import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { QuotationRevision } from "@/lib/api";

function Row({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={emphasize ? "text-sm font-medium" : "text-sm text-muted-foreground"}>{label}</span>
      <span className={emphasize ? "text-xl font-semibold tabular-nums" : "text-sm tabular-nums"}>{value}</span>
    </div>
  );
}

// Every figure here is rendered exactly as the server returned it — no
// client-side pricing math anywhere in this component (D7). Deliberately
// shows only customer-facing selling totals; internal costing per line
// lives in its own visually distinct panel next to each line-item group
// (see revision-editor.tsx), not aggregated here.
export function RevisionSummaryCard({ revision }: { revision: QuotationRevision }) {
  const hasDiscount = Number(revision.discountAmount) > 0;
  const vatExempt = revision.defaultTaxTreatment === "VAT_EXEMPT" && Number(revision.vatAmount) === 0;
  return (
    <Card className="shadow-none">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base">Quotation summary</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <Row label={vatExempt ? "Subtotal (VAT exempt)" : "Subtotal (includes VAT)"} value={formatMoney(revision.subtotal)} />
        {hasDiscount && (
          <Row label={`Discount (${formatPercent(revision.discountPercent)})`} value={`− ${formatMoney(revision.discountAmount)}`} />
        )}
        <Row label={vatExempt ? "Net amount" : "Net of VAT"} value={formatMoney(revision.netAmount)} />
        <Row label={vatExempt ? "VAT (Exempt)" : `VAT (${formatPercent(revision.vatRatePercent)})`} value={formatMoney(revision.vatAmount)} />
        <div className="mt-1 border-t pt-1.5">
          <Row label="Total" value={formatMoney(revision.totalAmount)} emphasize />
        </div>
        <div className="mt-3 border-t pt-2 text-sm">
          <p><span className="text-muted-foreground">Payment:</span> {revision.paymentTerms?.trim() || "—"}</p>
          <p><span className="text-muted-foreground">{/^\d{4}-\d{2}-\d{2}$/.test(revision.warranty ?? "") ? "Warranty until:" : "Warranty:"}</span> {/^\d{4}-\d{2}-\d{2}$/.test(revision.warranty ?? "") ? formatDate(`${revision.warranty}T00:00:00`) : revision.warranty || "—"}</p>
          <p><span className="text-muted-foreground">{/^\d{4}-\d{2}-\d{2}$/.test(revision.leadTime ?? "") ? "Lead time date:" : "Lead time:"}</span> {/^\d{4}-\d{2}-\d{2}$/.test(revision.leadTime ?? "") ? formatDate(`${revision.leadTime}T00:00:00`) : revision.leadTime || "—"}</p>
          <p><span className="text-muted-foreground">Valid until:</span> {formatDate(revision.validUntil)}</p>
        </div>
      </CardContent>
    </Card>
  );
}
