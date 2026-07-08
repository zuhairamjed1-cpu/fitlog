import { useMemo, useState, useId } from "react";
import { Card } from "./primitives";
import { getTodayStr, formatShortDate, WEEKDAYS } from "../lib/dates";
import {
  computeSaturation,
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
import { supplementsToCreatineDays } from "../engines/creatineIntakeAdapter";

// ─── CREATINE SATURATION CARD ───────────────────────────────────────────────
// One ISO week at a time (Monday-anchored). Amber dose bars per day + a ring for
// the latest day's modeled saturation + a system-driven "loading phase" tick.
// There is NO saturation line — the ring is the only place saturation is shown.
export function CreatineSaturationCard({ data, addEntry, settings = DEFAULT_SETTINGS }) {
  const uid = useId().replace(/:/g, "");
  const today = getTodayStr();

  // ── Real intake, derived from the supplement log (data.supplements). This is
  //    live: logging creatine anywhere calls setData in App, which re-renders
  //    this card with fresh supplements. The sample fallback is used ONLY for the
  //    empty case — no creatine ever logged, i.e. the new-user default-loading state.
  const { history, isSample } = useMemo(() => {
    const real = supplementsToCreatineDays(data?.supplements, { today });
    if (real.length) return { history: real, isSample: false };
    return { history: sampleLoadingWeek(today), isSample: true };
  }, [data?.supplements, today]);

  const [editing, setEditing] = useState(null); // date being logged via a bar tap

  const model = useMemo(() => {
    const sat = computeSaturation(history, settings); // continuous across weeks
    const byDate = {};
    history.forEach((d, i) => { byDate[d.date] = { doseGrams: d.doseGrams, sat: sat[i] }; });
    return { merged: history, sat, byDate, firstDate: history[0]?.date, lastDate: history[history.length - 1]?.date };
  }, [history, settings]);

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
  const ringSat = ringCell ? Math.round(ringCell.sat) : null; // true saturation (feeds the tick)

  // Ring DISPLAY = how full the loadable range is: 0% at dietary baseline, 100%
  // when fully saturated. Avoids the "93% with nothing logged" confusion caused
  // by the 65% baseline floor. Model + thresholds still use true saturation.
  const baseline = settings.baselineSaturation ?? DEFAULT_SETTINGS.baselineSaturation;
  const ringPct = ringCell
    ? Math.max(0, Math.min(100, Math.round(((ringCell.sat - baseline) / (100 - baseline)) * 100)))
    : null;

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

  // Tapping a bar logs a creatine dose for that day THROUGH THE SUPPLEMENT LOG —
  // the same path SupplementCard uses — so there's a single source of truth. The
  // card never writes its own intake store; the new entry flows back via `data`.
  const canLog = typeof addEntry === "function";
  const logDose = (date, raw) => {
    const g = Math.max(0, Math.min(200, Number(raw) || 0));
    if (g > 0 && canLog) {
      addEntry("supplements")({ id: Date.now(), date, ts: Date.now(), name: "Creatine", brand: "", dose: `${g} g` });
    }
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
        <div className="creat-ring-wrap" aria-label={ringPct != null ? `${ringPct} percent saturated` : "No saturation data"}>
          <div className="creat-ring-txt">
            <span className="creat-ring-l">Saturation</span>
            <span className="creat-ring-sub">of full stores</span>
          </div>
          <Ring value={ringPct} />
        </div>
      </div>

      {/* Chart row: ‹ prev · bars · next › */}
      <div className="creat-chart-row">
        <button className="creat-nav" aria-label="Previous week"
          onClick={() => setAnchor(a => shiftWeek(a, -1))}>‹</button>

        <div className="creat-bars" role="img"
          aria-label={`Creatine dose per day for ${rangeLabel}.${ringPct != null ? ` ${ringPct} percent saturated.` : ""}`}>
          {cells.map(c => {
            const empty = c.doseGrams <= 0;
            const pct = empty ? 0 : Math.max(8, Math.round((c.doseGrams / maxDose) * 100));
            const tappable = canLog && !c.isFuture;
            return (
              <button key={c.date} type="button"
                className={`creat-col ${c.isToday ? "today" : ""} ${c.isFuture ? "future" : ""}`}
                onClick={() => { if (tappable) setEditing(c.date); }}
                disabled={!tappable}
                aria-label={`${c.weekday} ${empty ? "no dose" : Math.round(c.doseGrams) + " grams"}${tappable ? " — tap to log" : ""}`}>
                <span className="creat-col-v">{empty ? "" : `${Math.round(c.doseGrams)}g`}</span>
                <span className="creat-track">
                  <span className={`creat-fill ${empty ? "empty" : ""}`} style={{ height: empty ? "6px" : `${pct}%` }} />
                </span>
                <span className="creat-wd">{c.weekday}</span>
              </button>
            );
          })}
        </div>

        <button className="creat-nav" aria-label="Next week" disabled={!canGoNext}
          onClick={() => canGoNext && setAnchor(a => shiftWeek(a, 1))}>›</button>
      </div>

      <p className="creat-range">{rangeLabel}{isSample ? " · sample data" : ""}</p>

      {/* Tap a bar to log a creatine dose for that day — writes to the supplement
          log (same path as the Supplements card), not a private store. */}
      {editing && (
        <div className="creat-edit">
          <label htmlFor={`creat-in-${uid}`}>Log creatine · {formatShortDate(editing)}</label>
          <input id={`creat-in-${uid}`} type="number" min="0" max="200" step="1" autoFocus placeholder="grams"
            onKeyDown={e => { if (e.key === "Enter") logDose(editing, e.currentTarget.value); if (e.key === "Escape") setEditing(null); }} />
          <span className="creat-edit-u">g</span>
          <button className="btn-ghost" onClick={() => { const el = document.getElementById(`creat-in-${uid}`); logDose(editing, el?.value); }}>Log</button>
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
