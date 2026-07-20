// ─── Google Health sleep normalizer ─────────────────────────────────────────
// Turns a raw Google Health `sleep` dataPoint (from /api/google-health?action=data
// &metric=sleep) into a FitLog sleep entry: stage timeline + per-stage totals +
// a derived sleep score (Google Health exposes no native score).
//
// TODO(reconcile): field paths are per the integration brief. Confirm the exact
// nesting against ONE real `sleep` dataPoint from the OAuth 2.0 Playground and
// adjust the picks below — a wrong path yields empty stages, not an error.

const STAGE_LABEL = { AWAKE: "Awake", DEEP: "Deep", REM: "REM", LIGHT: "Light", OUT_OF_BED: "Out of bed" };
const hhmm = t => { const m = /T(\d{2}):(\d{2})/.exec(t || ""); return m ? `${m[1]}:${m[2]}` : ""; };
const toMs = t => { const d = t ? Date.parse(t) : NaN; return Number.isNaN(d) ? null : d; };
const minutes = ms => Math.round((ms || 0) / 60000);

export function normalizeSleep(dp) {
  const s = dp.sleep || dp; // point may be wrapped under `sleep`
  const interval = s.interval || {};
  const startT = interval.startTime || interval.start_time || interval.civilStartTime || s.startTime;
  const endT = interval.endTime || interval.end_time || interval.civilEndTime || s.endTime;
  const date = (endT || startT || "").slice(0, 10);
  if (!date) return null;

  const rawSegs = s.stages || s.stage || s.segments || s.stageSegments || [];
  const stages = rawSegs.map(seg => {
    const type = (seg.type || seg.stage || seg.level || seg.stageType || "").toUpperCase();
    const si = seg.interval || {};
    const a = si.startTime || si.start_time || si.civilStartTime || seg.startTime || seg.start;
    const b = si.endTime || si.end_time || si.civilEndTime || seg.endTime || seg.end;
    const dur = toMs(b) != null && toMs(a) != null ? toMs(b) - toMs(a) : (seg.durationMillis || 0);
    return { type, label: STAGE_LABEL[type] || type, start: a, end: b, min: minutes(dur) };
  }).filter(x => x.type);

  const totals = { DEEP: 0, REM: 0, LIGHT: 0, AWAKE: 0, OUT_OF_BED: 0 };
  for (const seg of stages) if (seg.type in totals) totals[seg.type] += seg.min;

  const asleepMin = totals.DEEP + totals.REM + totals.LIGHT;
  const inBedMin = toMs(endT) != null && toMs(startT) != null ? minutes(toMs(endT) - toMs(startT)) : asleepMin + totals.AWAKE;
  const efficiency = inBedMin > 0 ? Math.round((asleepMin / inBedMin) * 100) : null;

  return {
    id: `gh${s.id || s.logId || `${date}-${startT}`}`,
    date,
    bedtime: hhmm(startT),
    wakeTime: hhmm(endT),
    duration: +(asleepMin / 60).toFixed(1),   // hours asleep
    inBedHours: +(inBedMin / 60).toFixed(1),
    stages,
    stageTotals: totals,
    efficiency,
    sleepType: s.sleepType || s.type || (stages.length ? "stages" : "classic"),
    derivedScore: derivedSleepScore({ totals, asleepMin, inBedMin, efficiency, awakeMin: totals.AWAKE }),
    quality: qualityFor(efficiency),
    source: "googlehealth",
    ghId: s.id || s.logId || `${date}-${startT}`,
  };
}

const qualityFor = eff => eff == null ? "—" : eff >= 90 ? "Great" : eff >= 80 ? "Good" : eff >= 70 ? "Fair" : "Poor";

// Google Health has NO sleep score — compute one from stages + efficiency.
// 0–100: efficiency (50%) + deep/REM adequacy (35%) + low restlessness (15%).
export function derivedSleepScore({ totals, asleepMin, inBedMin, efficiency, awakeMin }) {
  if (!asleepMin) return null;
  const eff = efficiency ?? (inBedMin ? (asleepMin / inBedMin) * 100 : 0);
  const effPts = Math.max(0, Math.min(1, eff / 100)) * 50;
  const deepFrac = totals.DEEP / asleepMin, remFrac = totals.REM / asleepMin;
  const deepPts = Math.min(1, deepFrac / 0.13) * 17.5;
  const remPts = Math.min(1, remFrac / 0.23) * 17.5;
  const restPts = Math.max(0, 1 - (awakeMin / Math.max(asleepMin, 1)) / 0.15) * 15;
  return Math.round(effPts + deepPts + remPts + restPts);
}
