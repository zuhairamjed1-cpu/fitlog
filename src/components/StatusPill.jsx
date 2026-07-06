// Shared status pill — a small colored confidence/quality chip.
// Used by the Sleep, Energy-balance, and Training views.
const SLEEP_STATUS = { good: { c: "var(--good)", w: "Good" }, warn: { c: "#f9c97e", w: "Watch" }, bad: { c: "var(--bad)", w: "Fix" } };

export function StatusPill({ status, label }) {
  if (!status) return <span className="sleep-pill" style={{ color: "var(--muted)", borderColor: "var(--border)" }}>Need data</span>;
  const m = SLEEP_STATUS[status];
  return <span className="sleep-pill" style={{ color: m.c, borderColor: m.c }}>{label || m.w}</span>;
}
