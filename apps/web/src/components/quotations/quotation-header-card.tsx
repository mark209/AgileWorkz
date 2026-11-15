import { QUOTATION_TYPE_LABEL, type Customer, type Quotation, type Site, type Trade } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );
}

// Stable identity fields — quotation number, customer, site, type, trade —
// never change across revisions. This card never re-renders based on which
// revision is being viewed.
export function QuotationHeaderCard({
  quotation,
  customer,
  site,
  trade,
}: {
  quotation: Quotation;
  customer: Customer;
  site: Site | null;
  trade: Trade | null;
}) {
  return (
    <Card className="mb-4 shadow-none">
      <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Customer" value={customer.name} />
        <Field label="Site" value={site?.label ?? "—"} />
        <Field label="Type" value={quotation.quotationTypeOther || QUOTATION_TYPE_LABEL[quotation.quotationType]} />
        <Field label="Trade" value={quotation.primaryTradeOther || trade?.label || quotation.primaryTradeCode} />
        <Field label="Reference number" value={quotation.quotationNumber} />
        <Field label="Created" value={formatDate(quotation.createdAt)} />
      </CardContent>
    </Card>
  );
}
