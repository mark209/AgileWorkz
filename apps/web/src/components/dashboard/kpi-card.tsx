import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export interface KpiCardProps {
  label: string;
  value: number | string;
  compact?: boolean;
  /**
   * When present, the whole card is a link and gets hover/focus affordance.
   * When absent, the card renders as plain, non-interactive content — no
   * hover style, no cursor change, no <a> tag — per the approved Phase 6
   * decision that an informational-only metric (e.g. Work Orders, which has
   * no detail page to link to yet) must never *look* clickable.
   */
  href?: string;
  /** Short caption shown under the value — used to explain why a card has no link (e.g. "Detail pages not yet available"). */
  note?: string;
}

export function KpiCard({ label, value, href, note, compact = false }: KpiCardProps) {
  const body = (
    <CardContent className={compact ? "flex h-full flex-col justify-between gap-2 p-4" : "flex flex-col gap-1 pt-6"}>
      <span className={`${compact ? "text-xs" : "text-sm"} text-muted-foreground`}>{label}</span>
      <span className="text-2xl font-semibold tabular-nums text-foreground">{value}</span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </CardContent>
  );

  if (!href) {
    return <Card className={compact ? "h-full shadow-none" : undefined}>{body}</Card>;
  }

  return (
    <Link href={href} className={compact ? "block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : "block rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"}>
      <Card className={compact ? "h-full shadow-none transition-colors hover:border-primary/50" : "transition-colors hover:border-primary/50"}>{body}</Card>
    </Link>
  );
}
