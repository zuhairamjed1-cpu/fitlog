import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { PRE_WORKOUT_PRESET, computeCarbs, toLineItems, inCarbRange } from "../lib/preWorkoutPreset";

// ─── Pre-workout quick-log checklist popup (§10.5) ──────────────────────────
// Mirrors the post-workout modal; carb-only. onLog(lineItems, carbs).

const T2 = "#9aa4b2", MUT = "#6b7480", TX = "#eef2f6", LINE = "#262d38", GOOD = "#5fcf80";
const TARGET = PRE_WORKOUT_PRESET.target.carbsG;

export function PreWorkoutQuickLogModal({ onLog, onClose, onManual }) {
  const [rows, setRows] = useState(() => PRE_WORKOUT_PRESET.items.map(it => ({ ...it, qty: it.defaultQty })));
  const carbs = useMemo(() => computeCarbs(rows), [rows]);
  const ok = inCarbRange(carbs, TARGET);

  const toggle = id => setRows(rs => rs.map(r => r.id === id ? { ...r, checked: !r.checked } : r));
  const step = (id, d) => setRows(rs => rs.map(r => r.id === id ? { ...r, qty: Math.max(0, (r.qty || 0) + d) } : r));

  const submit = () => {
    const items = toLineItems(rows);
    if (!items.length) return;
    onLog(items, carbs);
  };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(6,9,13,0.72)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000, animation: "pc-fade 0.18s ease" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", background: "#12161d", border: `1px solid ${LINE}`, borderBottom: "none", borderRadius: "22px 22px 0 0", padding: "8px 20px 22px", animation: "pc-rise 0.24s cubic-bezier(0.22,1,0.36,1)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 12px" }}><span style={{ width: 38, height: 4, borderRadius: 999, background: "#333c47" }} /></div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: TX }}>Pre-workout meal</div>
            <div className="muted small" style={{ marginTop: 2 }}>Fast carbs ~30 min before training — tweak as needed</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 999, background: "#1c232c", border: "none", color: T2, fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ marginTop: 12 }}>
          {rows.map(r => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 2px", borderTop: `1px solid ${LINE}`, opacity: r.checked ? 1 : 0.5 }}>
              <button onClick={() => toggle(r.id)} aria-label="toggle" style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, cursor: "pointer", border: `1.5px solid ${r.checked ? GOOD : "var(--border-strong)"}`, background: r.checked ? GOOD : "transparent", color: "#04191b", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{r.checked ? "✓" : ""}</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: TX, fontWeight: 500 }}>{r.name}</div>
                <div className="muted small" style={{ marginTop: 1 }}>{r.carbsPerUnit}g carbs / {r.unit}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <button onClick={() => step(r.id, -1)} disabled={(r.qty || 0) <= 0} style={stepBtn}>−</button>
                <span style={{ width: 30, textAlign: "center", fontVariantNumeric: "tabular-nums", fontSize: 14 }}>{r.qty}</span>
                <button onClick={() => step(r.id, 1)} style={stepBtn}>+</button>
              </div>
            </div>
          ))}
        </div>

        {/* running carb total */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, padding: "12px 14px", borderRadius: 12, border: `1px solid ${ok ? "rgba(95,207,128,0.4)" : LINE}`, background: ok ? "rgba(95,207,128,0.1)" : "var(--bg-2)" }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: MUT }}>Carbs</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: ok ? GOOD : TX, fontVariantNumeric: "tabular-nums" }}>{carbs}g <span style={{ color: MUT, fontWeight: 400, fontSize: 13 }}>/ {TARGET.min}–{TARGET.max}g</span></span>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>Fast-digesting, fructose-heavy — good for a short pre-workout window. Green = carb floor met.</p>

        <button className="btn full" style={{ marginTop: 14 }} onClick={submit}>Log meal</button>
        {onManual && <button onClick={onManual} style={{ display: "block", width: "100%", marginTop: 10, background: "none", border: "none", color: T2, fontSize: 13, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>log manually instead</button>}
      </div>
    </div>, document.body);
}

const stepBtn = { width: 28, height: 28, borderRadius: 8, border: `1px solid ${LINE}`, background: "var(--bg)", color: TX, fontSize: 15, cursor: "pointer" };

export default PreWorkoutQuickLogModal;
