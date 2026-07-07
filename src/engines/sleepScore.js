// ─── SLEEP SCORE ENGINE ─────────────────────────────────────────────────────
// Oura-style 0–100 nightly sleep score. Not one formula — each input becomes its
// own 0–100 sub-score through a non-linear scoring CURVE, and the final score is a
// weighted blend of the sub-scores that have data. Contributors with no data drop
// out and the remaining weights renormalize.
//
// Pipeline: raw log → derived metrics (TST, efficiency, midsleep) → per-contributor
// sub-scores (curves) → weighted overall → rating band.
//
// Works over the user's existing history: `duration` on a sleep entry is TIME IN
// BED (see SleepForm), latencyMin/wakeMin are optional. When they're absent we
// can't read efficiency, so that contributor is skipped for that night.

const QMAP = { Poor: 1, Fair: 2, Good: 3, Great: 4, Excellent: 5 };

// ── curves: anchor points [input, score], linearly interpolated ──
const DURATION_CURVE = [[0.50, 15], [0.60, 35], [0.70, 55], [0.80, 75], [0.90, 90], [1.00, 100], [1.15, 100], [1.30, 92]];
const REG_CURVE      = [[20, 100], [45, 92], [60, 82], [90, 62], [120, 45], [180, 22], [240, 10]];
const EFF_CURVE      = [[0.55, 15], [0.65, 35], [0.75, 58], [0.85, 85], [0.92, 100], [1.00, 100]];

export function curve(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, s0] = pts[i], [x1, s1] = pts[i + 1];
    if (x >= x0 && x <= x1) return s0 + ((x - x0) / (x1 - x0)) * (s1 - s0);
  }
  return pts[pts.length - 1][1];
}

// ── rating bands (Oura language) ──
export const SLEEP_SCORE_BANDS = [
  { min: 85, label: "Optimal", color: "#3fb98f" },
  { min: 70, label: "Good", color: "#4ec48f" },
  { min: 55, label: "Fair", color: "#f0a868" },
  { min: 0,  label: "Pay attention", color: "#f47e6e" },
];
export function scoreBand(s) { return SLEEP_SCORE_BANDS.find(b => s >= b.min) || SLEEP_SCORE_BANDS[SLEEP_SCORE_BANDS.length - 1]; }

const toMin = t => { if (!t || typeof t !== "string") return null; const [h, m] = t.split(":").map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };

// Time in bed (minutes). Prefer the stored `duration` (hours in bed); fall back to
// wake − bed with midnight wraparound.
function tibMinutes(e) {
  if (e.duration != null && Number.isFinite(e.duration)) return e.duration * 60;
  const bed = toMin(e.bedtime), wake = toMin(e.wakeTime);
  if (bed == null || wake == null) return null;
  return ((wake - bed) + 1440) % 1440;
}

// Midsleep point as minute-of-day (0..1440). Bedtime + TIB/2, wrapped.
function midsleep(e) {
  const bed = toMin(e.bedtime);
  const tib = tibMinutes(e);
  if (bed == null || tib == null) return null;
  return (bed + tib / 2 + 1440) % 1440;
}

// Circular SD (minutes) of clock times on a 24h dial — correct across midnight.
function circularSDmin(mins) {
  if (!mins || mins.length < 2) return null;
  let sx = 0, sy = 0;
  for (const v of mins) { const a = (v / 1440) * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a); }
  const R = Math.sqrt(sx * sx + sy * sy) / mins.length;
  if (R >= 1) return 0;
  const sdRad = Math.sqrt(-2 * Math.log(R));
  return (sdRad / (2 * Math.PI)) * 1440;
}

// Score a single night. `priorMids` = midsleep values of the trailing window
// (already restricted to ~14 nights before this one) for the regularity read.
export function computeNightScore(entry, priorMids, needMin) {
  const q = QMAP[entry.quality] || 3;
  const tib = tibMinutes(entry);
  const hasDetail = entry.latencyMin != null || entry.wakeMin != null;
  const lat = entry.latencyMin != null ? entry.latencyMin : 0;
  const waso = entry.wakeMin != null ? entry.wakeMin : 0;
  const tst = tib != null ? Math.max(0, tib - (hasDetail ? lat + waso : 0)) : null;
  const eff = (hasDetail && tib > 0) ? tst / tib : null;
  const ratio = (tst != null && needMin > 0) ? tst / needMin : null;

  const mid = midsleep(entry);
  let regSD = null;
  if (mid != null) {
    const window = [mid, ...(priorMids || [])];
    if (window.length >= 3) regSD = circularSDmin(window);
  }

  const durScore = ratio != null ? curve(ratio, DURATION_CURVE) : null;
  const regScore = regSD != null ? curve(regSD, REG_CURVE) : null;
  const effScore = eff != null ? curve(eff, EFF_CURVE) : null;
  const subjScore = ((q - 1) / 4) * 100;

  const defs = [
    { key: "duration", label: "Duration", icon: "🕐", score: durScore, w: 0.30 },
    { key: "regularity", label: "Regularity", icon: "🗓", score: regScore, w: 0.25 },
    { key: "efficiency", label: "Efficiency", icon: "🛏", score: effScore, w: 0.20 },
    { key: "subjective", label: "How you felt", icon: "☺", score: subjScore, w: 0.25 },
  ].filter(c => c.score != null);

  const wsum = defs.reduce((a, c) => a + c.w, 0) || 1;
  const overall = Math.round(defs.reduce((a, c) => a + c.score * (c.w / wsum), 0));
  const contributors = defs.map(c => ({ key: c.key, label: c.label, icon: c.icon, score: Math.round(c.score), band: scoreBand(c.score) }));

  return {
    id: entry.id, date: entry.date,
    score: overall, band: scoreBand(overall),
    tstMin: tst != null ? Math.round(tst) : null,
    tibMin: tib != null ? Math.round(tib) : null,
    efficiency: eff != null ? Math.round(eff * 100) : null,
    regSD: regSD != null ? Math.round(regSD) : null,
    quality: q, hadDetail: hasDetail,
    contributors,
  };
}

// Score every logged night (ascending by date). Each night's regularity uses the
// trailing ≤14 nights before it — real, growing history from the data you have.
export function computeSleepScores(sleepArr, needHours) {
  const needMin = (needHours > 0 ? needHours : 8) * 60;
  const sorted = [...(sleepArr || [])].filter(e => e && e.date).sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const priorMids = [];
    for (let j = i - 1; j >= 0; j--) {
      const dd = (new Date(e.date + "T00:00:00") - new Date(sorted[j].date + "T00:00:00")) / 86400000;
      if (dd > 13) break;
      const m = midsleep(sorted[j]);
      if (m != null) priorMids.push(m);
    }
    out.push(computeNightScore(e, priorMids, needMin));
  }
  return out;
}
