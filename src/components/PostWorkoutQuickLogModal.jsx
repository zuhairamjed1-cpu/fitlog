import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { POST_WORKOUT_PRESET, computeTotals, toLineItems, inRange } from "../lib/postWorkoutPreset";

// ─── Post-workout quick-log checklist popup ─────────────────────────────────
// Pre-filled shortcut into the existing meal-log pipeline — not a parallel one.
// onLog(lineItems, totals) is called with the editable-item-table shape.

const T2 = "#9aa4b2", MUT = "#6b7480", TX = "#eef2f6", LINE = "#262d38", GOOD = "#5fcf80";
const TARGETS = POST_WORKOUT_PRESET.targets;

const chipMeta = [
  { key: "proteinG", label: "Protein", unit: "g" },
  { key: "glucoseG", label: "Glucose", unit: "g" },
  { key: "fructoseG", label: "Fructose", unit: "g" },
  { key: "saltTsp", label: "Salt", unit: "tsp" },
  { key: "omega3Mg", label: "Omega-3", unit: "mg" },
];
const tgtLabel = t => t == null ? "" : t.max != null ? `${t.min}–${t.max}` : `${t.min}+`;

export function PostWorkoutQuickLogModal({ onLog, onClose, onManual }) {
  const [rows, setRows] = useState(() => POST_WORKOUT_PRESET.items.map(it => ({ ...it, qty: it.defaultQty })));
  const totals = useMemo(() => computeTotals(rows), [rows]);

  const toggle = id => setRows(rs => rs.map(r => r.id === id ? { ...r, checked: !r.checked } : r));
  const step = (id, d) => setRows(rs => rs.map(r => r.id === id ? { ...r, qty: Math.max(0, (r.qty || 0) + d) } : r));

  const submit = () => {
    const items = toLineItems(rows);
    if (!items.length) return;
    onLog(items, totals);
  };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(6,9,13,0.72)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000, animation: "pc-fade 0.18s ease" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", background: "#12161d", border: `1px solid ${LINE}`, borderBottom: "none", borderRadius: "22px 22px 0 0", padding: "8px 20px 22px", animation: "pc-rise 0.24s cubic-bezier(0.22,1,0.36,1)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 12px" }}><span style={{ width: 38, height: 4, borderRadius: 999, background: "#333c47" }} /></div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: TX }}>Post-workout meal</div>
            <div className="muted small" style={{ marginTop: 2 }}>Check what you're having — estimates, tweak as needed</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 999, background: "#1c232c", border: "none", color: T2, fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ marginTop: 12 }}>
          {rows.map(r => {
            const per = r.macrosPerUnit;
            const sub = r.combined ? r.note
              : [per.proteinG && `${per.proteinG}g P`, per.glucoseG && `${per.glucoseG}g glu`, per.fructoseG && `${per.fructoseG}g fru`, per.omega3Mg && `${per.omega3Mg}mg ω3`].filter(Boolean).join(" · ") + ` / ${r.unit}`;
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 2px", borderTop: `1px solid ${LINE}`, opacity: r.checked ? 1 : 0.5 }}>
                <button onClick={() => toggle(r.id)} aria-label="toggle" style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, cursor: "pointer", border: `1.5px solid ${r.checked ? GOOD : "var(--border-strong)"}`, background: r.checked ? GOOD : "transparent", color: "#04191b", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{r.checked ? "✓" : ""}</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: TX, fontWeight: 500 }}>{r.name}</div>
                  <div className="muted small" style={{ marginTop: 1 }}>{sub}</div>
                </div>
                {!r.combined && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => step(r.id, -1)} disabled={(r.qty || 0) <= 0} style={stepBtn}>−</button>
                    <span style={{ width: 30, textAlign: "center", fontVariantNumeric: "tabular-nums", fontSize: 14 }}>{r.qty}</span>
                    <button onClick={() => step(r.id, 1)} style={stepBtn}>+</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* running totals */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, padding: "12px", background: "var(--bg-2)", borderRadius: 12 }}>
          {chipMeta.map(c => {
            const cur = totals[c.key];
            const ok = inRange(cur, TARGETS[c.key]);
            return (
              <div key={c.key} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "5px 10px", borderRadius: 9, border: `1px solid ${ok ? "rgba(95,207,128,0.4)" : LINE}`, background: ok ? "rgba(95,207,128,0.1)" : "transparent" }}>
                <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", color: MUT }}>{c.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: ok ? GOOD : TX, fontVariantNumeric: "tabular-nums" }}>{cur}{c.unit} <span style={{ color: MUT, fontWeight: 400 }}>/ {tgtLabel(TARGETS[c.key])}</span></span>
              </div>
            );
          })}
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>Rough targets for a fast-digesting recovery meal — not exact. Green = floor met.</p>

        <button className="btn full" style={{ marginTop: 14 }} onClick={submit}>Log meal</button>
        {onManual && <button onClick={onManual} style={{ display: "block", width: "100%", marginTop: 10, background: "none", border: "none", color: T2, fontSize: 13, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>log manually instead</button>}
      </div>
    </div>, document.body);
}

const stepBtn = { width: 28, height: 28, borderRadius: 8, border: `1px solid ${LINE}`, background: "var(--bg)", color: TX, fontSize: 15, cursor: "pointer" };

export default PostWorkoutQuickLogModal;
