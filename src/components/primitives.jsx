// ─── SHARED UI PRIMITIVES ─────────────────────────────────────────────────────
// Leaf presentational components + the global toast/confirm helpers, shared across
// every view. Kept dependency-light (react + dates + fx) so any view can import
// them without pulling in App.jsx.
import { useState, useEffect } from "react";
import { formatShortDate } from "../lib/dates";
import { haptic, SFX } from "../lib/fx";

export function Ring({ pct, label, value, unit, big }) {
  const size = big ? 130 : 88, stroke = big ? 9 : 7;
  const r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const filled = Math.min(1, pct / 100) * circ;
  return (
    <div className="ring">
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke}
          strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray .8s cubic-bezier(.4,0,.2,1)" }} />
      </svg>
      <div className="ring-center">
        <div className={`ring-val ${big ? "big" : ""}`}>{value}<span className="ring-unit">{unit}</span></div>
      </div>
      <div className="ring-label">{label}</div>
    </div>
  );
}

export function MacroDonut({ protein, carbs, fat, size = 88 }) {
  const pCal = protein * 4, cCal = carbs * 4, fCal = fat * 9;
  const tot = pCal + cCal + fCal;
  if (tot <= 0) return null;
  const r = (size - 12) / 2, circ = 2 * Math.PI * r;
  const segs = [
    { val: pCal, color: "#b4a8e8", label: "P" },
    { val: cCal, color: "#f9c97e", label: "C" },
    { val: fCal, color: "#f47e6e", label: "F" },
  ];
  let offset = 0;
  return (
    <div className="donut">
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--track)" strokeWidth="11" />
        {segs.map((s, i) => {
          const frac = s.val / tot;
          const dash = frac * circ;
          const el = (
            <circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={s.color} strokeWidth="11"
              strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset}
              style={{ transition: "stroke-dasharray .6s ease, stroke-dashoffset .6s ease" }} />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="donut-center"><span>{Math.round(tot)}</span><small>kcal</small></div>
    </div>
  );
}

export function MiniChart({ points, height = 80, showGoal = null, rollingAvg = false, unit = "" }) {
  const [sel, setSel] = useState(null);
  if (!points || points.length === 0) return <div className="muted-center">No data</div>;
  const W = 320, H = height, padX = 6, padY = 10;
  const vals = points.map(p => p.value).filter(v => v != null);
  if (vals.length === 0) return <div className="muted-center">Not enough data</div>;
  let min = Math.min(...vals), max = Math.max(...vals);
  if (showGoal != null) { min = Math.min(min, showGoal); max = Math.max(max, showGoal); }
  if (max === min) max = min + 1;
  const range = max - min; min -= range * 0.1; max += range * 0.1;
  const sx = i => padX + (i / Math.max(1, points.length - 1)) * (W - 2 * padX);
  const sy = v => H - padY - ((v - min) / (max - min)) * (H - 2 * padY);

  // Build line segments (skip nulls)
  const segments = [];
  let cur = [];
  points.forEach((p, i) => {
    if (p.value != null) cur.push({ x: sx(i), y: sy(p.value), i });
    else if (cur.length) { segments.push(cur); cur = []; }
  });
  if (cur.length) segments.push(cur);

  // Rolling 7-day average line
  let avgPath = "";
  if (rollingAvg) {
    const pts = [];
    points.forEach((p, i) => {
      const window = points.slice(Math.max(0, i - 6), i + 1).map(x => x.value).filter(v => v != null);
      if (window.length >= 2) pts.push({ x: sx(i), y: sy(window.reduce((a, b) => a + b, 0) / window.length) });
    });
    avgPath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  }

  const fmt = v => (v >= 1000 ? v.toLocaleString() : v) + unit;

  return (
    <div className="chart-wrap">
      {sel != null && points[sel]?.value != null && (
        <div className="chart-tip" style={{ left: `${(sx(sel) / W) * 100}%` }}>
          <span className="chart-tip-v">{fmt(points[sel].value)}</span>
          {points[sel].label && <span className="chart-tip-d">{formatShortDate(points[sel].label)}</span>}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chart">
        {showGoal != null && (
          <line x1={padX} x2={W - padX} y1={sy(showGoal)} y2={sy(showGoal)} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" opacity=".35" />
        )}
        {segments.map((seg, si) => {
          const path = seg.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
          const area = seg.length > 1 ? `${path} L${seg[seg.length-1].x.toFixed(1)},${H - padY} L${seg[0].x.toFixed(1)},${H - padY} Z` : null;
          return (
            <g key={si}>
              {area && <path d={area} fill="var(--accent)" opacity=".08" />}
              <path d={path} stroke="var(--accent)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        })}
        {avgPath && <path d={avgPath} stroke="#f9c97e" strokeWidth="1.4" fill="none" strokeDasharray="4 3" opacity=".8" strokeLinecap="round" />}
        {/* selection marker */}
        {sel != null && points[sel]?.value != null && (
          <line x1={sx(sel)} x2={sx(sel)} y1={padY} y2={H - padY} stroke="var(--accent)" strokeWidth="1" opacity=".3" />
        )}
        {points.map((p, i) => p.value != null && (
          <circle key={i} cx={sx(i)} cy={sy(p.value)} r={sel === i ? 3.5 : 2} fill="var(--accent)" />
        ))}
        {/* invisible tap targets */}
        {points.map((p, i) => (
          <rect key={"t" + i} x={sx(i) - (W / points.length) / 2} y={0} width={W / points.length} height={H} fill="transparent"
            onClick={() => { setSel(sel === i ? null : i); haptic(8); }} style={{ cursor: "pointer" }} />
        ))}
      </svg>
      {rollingAvg && <div className="chart-legend"><span className="cl-line solid" />daily<span className="cl-line dash" />7-day avg</div>}
    </div>
  );
}

export function Card({ title, sub, action, children, className = "" }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-hd">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {sub && <p className="card-sub">{sub}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ icon = "✦", title, hint, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action}
    </div>
  );
}

// ─── TOAST (global, no context needed) ────────────────────────────────────────
let _toastFn = null;
export function toast(msg, opts = {}) { haptic(12); if (!opts.silent) SFX.log(); if (_toastFn) _toastFn(msg); }

export function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    _toastFn = (msg) => {
      const id = Date.now() + Math.random();
      setItems(it => [...it, { id, msg }]);
      setTimeout(() => setItems(it => it.filter(x => x.id !== id)), 2200);
    };
    return () => { _toastFn = null; };
  }, []);
  return (
    <div className="toast-host">
      {items.map(t => <div key={t.id} className="toast">{t.msg}</div>)}
    </div>
  );
}

// ─── CONFIRM MODAL ────────────────────────────────────────────────────────────
export function ConfirmModal({ open, title, body, confirmLabel = "Confirm", danger, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        {body && <p className="modal-body">{body}</p>}
        <div className="modal-actions">
          <button className="btn-ghost flex" onClick={onCancel}>Cancel</button>
          <button className={danger ? "btn-danger flex" : "btn flex"} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// Hook for confirm flow
export function useConfirm() {
  const [state, setState] = useState({ open: false });
  const confirm = (opts) => new Promise(resolve => {
    setState({
      open: true, ...opts,
      onConfirm: () => { setState({ open: false }); resolve(true); },
      onCancel: () => { setState({ open: false }); resolve(false); },
    });
  });
  const modal = <ConfirmModal {...state} />;
  return [confirm, modal];
}
