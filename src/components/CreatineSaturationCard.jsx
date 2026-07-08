import { useMemo, useState, useId } from "react";
import { Card } from "./primitives";
import { getTodayStr, formatShortDate, WEEKDAYS } from "../lib/dates";
import {
  computeSaturation,
  creatineDaysFromSupplements,
  sampleLoadingWeek,
  needsLoading,
  isLoadingComplete,
  consecutiveDosingDays,
  inLoadingPhase,
  DAYS_IN_WEEK,
  DEFAULT_SETTINGS,
  mondayOf,
  weekDates,
  shiftWeek,
} from "../engines/creatineModel";

// ─── CREATINE SATURATION CARD ───────────────────────────────────────────────
// One ISO week at a time (Monday-anchored). Amber dose bars per day + a ring for
// the latest day's modeled saturation + a system-driven "loading phase" tick.
// There is NO saturation line — the ring is the only place saturation is shown.
export function CreatineSaturationCard({ data, settings = DEFAULT_SETTINGS }) {
  const uid = useId().replace(/:/g, "");
  const today = getTodayStr();

  // ── Real intake, read from the supplement log. Falls back to a sample loading
  //    week so the card renders before real data is wired.
  // TODO: connect to real creatine intake source — thread the same store the
  //       SupplementCard writes to, and drop the sample fallback.
  const { history, isSample } = useMemo(() => {
    const real = creatineDaysFromSupplements(data?.supplements, today);
    if (real.length) return { history: real, isSample: false };
    return { history: sampleLoadingWeek(today), isSample: true };
  }, [data?.supplements, today]);

  // ── Local per-day edits (tap a bar to set grams). Merged over history, then
  //    saturation is recomputed for that day and every day after it.
  // TODO: persist these back to the supplement log instead of local state.
  const [overrides, setOverrides] = useState({}); // { [date]: grams }
  const [editing, setEditing] = useState(null);    // date being edited

  const model = useMemo(() => {
    const merged = history.map(d =>
      overrides[d.date] != null ? { ...d, doseGrams: overrides[d.date] } : d
    );
    const sat = computeSaturation(merged, settings); // continuous across weeks
    const byDate = {};
    merged.forEach((d, i) => { byDate[d.date] = { doseGrams: d.doseGrams, sat: sat[i] }; });
    return { merged, sat, byDate, firstDate: merged[0]?.date, lastDate: merged[merged.length - 1]?.date };
  }, [history, overrides, settings]);

  // ── Visible week (Monday-anchored). Defaults to the week containing today.
  const [anchor, setAnchor] = useState(() => mondayOf(today));
  const days = weekDates(anchor); // DAYS_IN_WEEK ISO date strings
  const todayMonday = mondayOf(today);
  const canGoNext = anchor < todayMonday;

  // Per-day cells for the visible week (0 g when nothing modeled that day).
  const cells = days.map(date => {
    const rec = model.byDate[date];
    return {
      date,
      weekday: WEEKDAYS[(new Date(date + "T00:00:00").getDay() + 6) % 7],
      doseGrams: rec ? rec.doseGrams : 0,
      sat: rec ? rec.sat : null,
      isToday: date === today,
      isFuture: date > today,
      hasData: !!rec,
    };
  });

  // ── Ring = the latest modeled day within the visible week (≤ today), else the
  //    last day that has data. Sliced from the continuous series.
  const ringCell =
    [...cells].reverse().find(c => c.hasData && c.date <= today) ||
    [...cells].reverse().find(c => c.hasData) ||
    null;
  const ringSat = ringCell ? Math.round(ringCell.sat) : null;

  // ── Loading tick — system-driven, computed over the FULL history up to the
  //    ring day (not just the visible week).
  const ringIdx = ringCell ? model.merged.findIndex(d => d.date === ringCell.date) : model.merged.length - 1;
  const histUpToRing = model.merged.slice(0, ringIdx + 1);
  const satAtRing = ringSat ?? settings.baselineSaturation;
  const loadingOn = inLoadingPhase(histUpToRing, satAtRing);
  const streak = consecutiveDosingDays(histUpToRing);
  const phaseLabel = needsLoading(histUpToRing, satAtRing)
    ? "Loading recommended"
    : isLoadingComplete(streak, satAtRing)
      ? "Stores full — maintenance"
      : "Loading in progress";

  // ── Week date range caption.
  const rangeLabel = `${formatShortDate(days[0])} – ${formatShortDate(days[days.length - 1])}`;

  // ── Bar geometry ──
  const maxDose = Math.max(10, ...cells.map(c => c.doseGrams)); // scale, min ceiling 10 g
  const commitEdit = (date, raw) => {
    const g = Math.max(0, Math.min(100, Number(raw) || 0));
    setOverrides(o => ({ ...o, [date]: g }));
    setEditing(null);
  };

  return (
    <Card title="Creatine saturation" sub="daily dose vs modeled muscle saturation">
      {/* Status row: loading-phase tick (left) · saturation ring (right) */}
      <div className="creat-status">
        <div className="creat-tick" role="img"
          aria-label={loadingOn ? `Loading phase on — ${phaseLabel}` : `Loading phase off — ${phaseLabel}`}>
          <span className={`creat-tick-box ${loadingOn ? "on" : ""}`} aria-hidden="true">{loadingOn ? "✓" : ""}</span>
          <span className="creat-tick-l">Loading phase</span>
        </div>
        <div className="creat-ring-wrap" aria-label={ringSat != null ? `${ringSat} percent saturated` : "No saturation data"}>
          <Ring value={ringSat} />
          <span className="creat-ring-l">Saturation %</span>
        </div>
      </div>

      {/* Chart row: ‹ prev · bars · next › */}
      <div className="creat-chart-row">
        <button className="creat-nav" aria-label="Previous week"
          onClick={() => setAnchor(a => shiftWeek(a, -1))}>‹</button>

        <svg className="creat-bars" viewBox={`0 0 ${DAYS_IN_WEEK * 44} 150`} preserveAspectRatio="none"
          role="img" aria-label={`Creatine dose per day for ${rangeLabel}. ${ringSat != null ? ringSat + " percent saturated." : ""}`}>
          {cells.map((c, i) => {
            const slot = 44, bw = 26, x = i * slot + (slot - bw) / 2;
            const top = 26, bottom = 124, h = bottom - top;
            const bh = c.doseGrams > 0 ? Math.max(4, (c.doseGrams / maxDose) * h) : h;
            const y = bottom - bh;
            const empty = c.doseGrams <= 0;
            return (
              <g key={c.date} className="creat-bar-g" onClick={() => setEditing(c.date)} style={{ cursor: "pointer" }}>
                {c.isToday && <rect x={i * slot + 1} y={12} width={slot - 2} height={128} rx="8" className="creat-today" />}
                {empty ? (
                  <rect x={x} y={top} width={bw} height={h} rx="6" className="creat-slot" />
                ) : (
                  <rect x={x} y={y} width={bw} height={bh} rx="6" className="creat-bar" />
                )}
                {!empty && <text x={x + bw / 2} y={y - 5} className="creat-dose" textAnchor="middle">{Math.round(c.doseGrams)}g</text>}
                <text x={x + bw / 2} y={140} className={`creat-wd ${c.isToday ? "on" : ""}`} textAnchor="middle">{c.weekday}</text>
              </g>
            );
          })}
        </svg>

        <button className="creat-nav" aria-label="Next week" disabled={!canGoNext}
          onClick={() => canGoNext && setAnchor(a => shiftWeek(a, 1))}>›</button>
      </div>

      <p className="creat-range">{rangeLabel}{isSample ? " · sample data" : ""}</p>

      {/* Inline dose editor for the tapped day */}
      {editing && (
        <div className="creat-edit">
          <label htmlFor={`creat-in-${uid}`}>{formatShortDate(editing)} dose</label>
          <input id={`creat-in-${uid}`} type="number" min="0" max="100" step="1" autoFocus
            defaultValue={Math.round(cells.find(c => c.date === editing)?.doseGrams || 0)}
            onKeyDown={e => { if (e.key === "Enter") commitEdit(editing, e.currentTarget.value); if (e.key === "Escape") setEditing(null); }} />
          <span className="creat-edit-u">g</span>
          <button className="btn-ghost" onClick={() => { const el = document.getElementById(`creat-in-${uid}`); commitEdit(editing, el?.value); }}>Set</button>
          <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      )}
    </Card>
  );
}

// Circular saturation ring (SVG). aria handled by the wrapper.
function Ring({ value, size = 56 }) {
  const r = (size - 8) / 2, circ = 2 * Math.PI * r;
  const frac = value == null ? 0 : Math.max(0, Math.min(1, value / 100));
  const dash = frac * circ;
  return (
    <div className="creat-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
          style={{ transition: "stroke-dasharray .6s ease" }} />
      </svg>
      <span className="creat-ring-v">{value == null ? "–" : value}</span>
    </div>
  );
}
