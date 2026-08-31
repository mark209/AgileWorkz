/**
 * Returns the calendar year/month for `at` (defaults to now) as observed in
 * Asia/Manila (UTC+8) — never the server/container's local time or raw UTC.
 * A quotation or inquiry created at 11:58 PM Manila time on Aug 31 must get
 * an August number, not September; naive UTC-based month math gets this
 * wrong for roughly the last 8 hours of every month. See approved plan §05a.
 */
export function currentManilaYearMonth(at: Date = new Date()): { year: number; month: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "numeric",
  });
  const parts = formatter.formatToParts(at);
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  return { year, month };
}
