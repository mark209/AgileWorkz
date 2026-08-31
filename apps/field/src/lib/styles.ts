import { CSSProperties } from "react";

/**
 * Phase 4 Operations Frontend (approved Decision 3) — shared inline-style
 * constants only, no CSS framework/component library introduced. Kept
 * mobile-first: every tappable control is at least 44px tall (Apple/Android
 * HIG's minimum touch target), single-column layouts, generous spacing for
 * a technician tapping with work gloves on a phone in the field, not a
 * mouse on a desktop monitor.
 */

const GREEN = "#0e7a68"; // matches layout.tsx's existing themeColor
const GREEN_DARK = "#0a5c4e";
const RED = "#a52f2f";
const TEXT_MUTED = "#4d635c";
const BORDER = "#d7e3e0";

export const colors = { green: GREEN, greenDark: GREEN_DARK, red: RED, textMuted: TEXT_MUTED, border: BORDER };

export const page: CSSProperties = {
  maxWidth: 480,
  margin: "0 auto",
  padding: "20px 16px 40px",
};

export const pageHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 20,
};

export const heading: CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  margin: 0,
};

export const subheading: CSSProperties = {
  color: TEXT_MUTED,
  fontSize: 14,
  margin: "4px 0 0",
};

export const card: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: 16,
  marginBottom: 12,
  background: "#fff",
  color: "inherit",
  textDecoration: "none",
  boxSizing: "border-box",
};

export const button: CSSProperties = {
  minHeight: 48,
  padding: "12px 20px",
  borderRadius: 8,
  border: "none",
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
};

export const primaryButton: CSSProperties = {
  ...button,
  background: GREEN,
  color: "#fff",
};

export const secondaryButton: CSSProperties = {
  ...button,
  background: "#fff",
  color: GREEN,
  border: `1px solid ${GREEN}`,
};

export const dangerText: CSSProperties = {
  color: RED,
  fontSize: 14,
};

export const badgeBase: CSSProperties = {
  display: "inline-block",
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
};

const STATUS_BADGE_COLOR: Record<string, CSSProperties> = {
  DRAFT: { background: "#e7e7e7", color: "#555" },
  SCHEDULED: { background: "#fdf1d6", color: "#8a6a1c" },
  IN_PROGRESS: { background: "#dbe9ff", color: "#1c4e8a" },
  COMPLETED: { background: "#d9f2e6", color: "#1c6b45" },
  CLOSED: { background: "#e7e7e7", color: "#555" },
  CANCELLED: { background: "#fbdede", color: "#8a1c1c" },
};

export function statusBadgeStyle(status: string): CSSProperties {
  return { ...badgeBase, ...(STATUS_BADGE_COLOR[status] ?? STATUS_BADGE_COLOR.DRAFT) };
}

export const input: CSSProperties = {
  display: "block",
  width: "100%",
  minHeight: 44,
  padding: "10px 12px",
  fontSize: 16,
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  marginTop: 4,
  boxSizing: "border-box",
};

export const label: CSSProperties = {
  display: "block",
  fontSize: 14,
  fontWeight: 600,
  marginTop: 16,
};
