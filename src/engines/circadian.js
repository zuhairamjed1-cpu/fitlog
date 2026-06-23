// ─── CIRCADIAN ENGINE ────────────────────────────────────────────────────────
// A biological day ends when you normally fall asleep, not at midnight. We derive
// the boundary from logged sleep onset/wake times using a ROLLING circular mean
// (clock times wrap at 24h, so 11:50 PM and 12:10 AM must average to ~midnight,
// not noon). Everything here is a transparent calculation tied to tracked data —
// tier "calc" — with a confidence that drops when sleep data is sparse or erratic.
// Nothing is hardcoded to midnight.

import { localDateStr } from "../lib/dates.js";

const DAY = 86400000;

export const toMin = hhmm => {
  if (hhmm == null) return null;
  const m = String(hhmm).match(/(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
};
export const fmtClock = min => {
  if (min == null) return null;
  const t = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60), mm = t % 60;
  const ap = h < 12 ? "AM" : "PM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, "0")} ${ap}`;
};

// Circular mean + spread (in minutes) over a list of minute-of-day values.
function circStats(vals) {
  if (!vals.length) return { mean: null, sd: null };
  const ang = vals.map(v => (v / 1440) * 2 * Math.PI);
  const s = ang.reduce((a, x) => a + Math.sin(x), 0) / ang.length;
  const c = ang.reduce((a, x) => a + Math.cos(x), 0) / ang.length;
  let mean = Math.atan2(s, c); if (mean < 0) mean += 2 * Math.PI;
  const R = Math.sqrt(s * s + c * c);                         // resultant length 0..1
  const sd = Math.sqrt(-2 * Math.log(Math.max(R, 1e-9))) / (2 * Math.PI) * 1440; // circular SD (min)
  return { mean: (mean / (2 * Math.PI)) * 1440, sd };
}

// computeCircadian(data, today?, windowDays?) → the biological-day model.
export function computeCircadian(data, today, windowDays = 30) {
  const sleeps = (data && data.sleep || []).filter(s => s && s.bedtime && s.wakeTime && s.date);
  const sorted = sleeps.slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const recent = sorted.slice(-windowDays);
  const beds = recent.map(s => toMin(s.bedtime)).filter(v => v != null);
  const wakes = recent.map(s => toMin(s.wakeTime)).filter(v => v != null);
  const n = recent.length;

  if (n < 3 || beds.length < 3) {
    return {
      ready: false, n, tier: "calc", confidence: "low",
      reason: "Need ~3+ nights of sleep logs to learn your biological day.",
      avgSleepTime: null, avgWakeTime: null, sleepConsistency: null, sleepConsistencySD: null,
      biologicalDayStart: null, biologicalDayEnd: null, boundaryMin: null, startMin: null, windowDays,
    };
  }

  const bedS = circStats(beds), wakeS = circStats(wakes);
  const endMin = bedS.mean;     // sleep onset → end of the biological day
  const startMin = wakeS.mean;  // wake → start of the biological day
  const sd = bedS.sd == null ? 90 : bedS.sd;
  const consistency = Math.max(0, Math.min(100, Math.round(100 - sd / 1.8))); // ~0 SD → 100
  const confidence = (n >= 14 && sd < 75) ? "high" : (n >= 7 && sd < 110) ? "moderate" : "low";

  return {
    ready: true, n, tier: "calc", confidence, windowDays,
    avgSleepTime: fmtClock(endMin), avgWakeTime: fmtClock(startMin),
    biologicalDayStart: fmtClock(startMin), biologicalDayEnd: fmtClock(endMin),
    boundaryMin: Math.round(endMin),   // the cut point between biological days (onset)
    startMin: Math.round(startMin),
    sleepConsistency: consistency, sleepConsistencySD: Math.round(sd),
  };
}

// Which biological-day a timestamp belongs to (returns a YYYY-MM-DD label = the
// calendar date the bio-day STARTS on). Anything before the onset boundary counts
// toward the previous day's biological day (e.g. a 1 AM meal belongs to "yesterday").
export function bioDayKey(ts, circ) {
  const d = new Date(ts);
  if (!circ || !circ.ready || circ.boundaryMin == null) return localDateStr(d);
  const tod = d.getHours() * 60 + d.getMinutes();
  if (tod < circ.boundaryMin) return localDateStr(new Date(ts - DAY));
  return localDateStr(d);
}

// Group arbitrary timestamped entries into { bioDate: [entries] }.
export function bucketByBioDay(entries, circ, getTs) {
  const out = {};
  (entries || []).forEach(e => {
    const ts = getTs ? getTs(e) : (e.ts ?? (e.date ? new Date(e.date + "T12:00:00").getTime() : null));
    if (ts == null) return;
    const key = bioDayKey(ts, circ);
    (out[key] = out[key] || []).push(e);
  });
  return out;
}

// Per-biological-day nutrition totals from diet entries (calories/protein/carbs/fat).
export function bioDayNutrition(diet, circ) {
  const buckets = bucketByBioDay(diet, circ, e => e.ts ?? (e.date ? new Date(`${e.date}T${e.time || "12:00"}:00`).getTime() : null));
  const out = {};
  Object.keys(buckets).forEach(k => {
    const sum = { date: k, calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 };
    buckets[k].forEach(m => { sum.calories += m.calories || 0; sum.protein += m.protein || 0; sum.carbs += m.carbs || 0; sum.fat += m.fat || 0; sum.meals += 1; });
    sum.calories = Math.round(sum.calories); sum.protein = Math.round(sum.protein); sum.carbs = Math.round(sum.carbs); sum.fat = Math.round(sum.fat);
    out[k] = sum;
  });
  return out;
}

// Totals for the biological day that the given moment falls in (default: now).
export function todaysBioNutrition(diet, circ, now) {
  const key = bioDayKey(now == null ? Date.now() : now, circ);
  const all = bioDayNutrition(diet, circ);
  return all[key] || { date: key, calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 };
}
