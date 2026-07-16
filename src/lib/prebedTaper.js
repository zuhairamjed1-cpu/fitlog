// ─── PRE-BED CALORIE TAPER + BEDTIME PREDICTION (§13, pure/testable) ─────────
// Layered on top of the partitioning slots. Sizes/shapes flexible meals near
// predicted bedtime and predicts tonight's bedtime from sleep history. Floors
// and the reflow engine are untouched (only referenced for the override rule).
import { timeToMin } from "./partitioning";

export const SLEEP_ANOMALY_THRESHOLD_HOURS = 2;
export const PREFERRED_LAST_MEAL_KCAL = 800;          // planning target, NOT a cap
// Tapering ceilings by hours-before-bed (config map — tunable, not inlined).
export const PRE_BED_TAPER = [
  { hoursBeforeBed: 3, ceilingKcal: 800, form: "full-meal" },              // no hard cap
  { hoursBeforeBed: 2, ceilingKcal: 400, form: "lighter-solid-or-shake", lowFat: true },
  { hoursBeforeBed: 1, ceilingKcal: 150, form: "liquid-preferred", lowFat: true },
  { hoursBeforeBed: 0.5, ceilingKcal: 100, form: "casein-or-milk-shake", lowFat: true, skipIfPossible: true },
];

const toMin = t => (typeof t === "number" ? t : timeToMin(t));
// Bedtimes near/after midnight live on a "night" scale (pre-noon => +24h) so
// 23:30 and 00:30 average to 00:00, not to noon.
const nightMin = t => { let m = toMin(t); if (m < 12 * 60) m += 1440; return m; };

export function averageSleepTime(times) {
  const v = (times || []).filter(x => x != null).map(nightMin);
  if (!v.length) return null;
  return Math.round(v.reduce((a, b) => a + b, 0) / v.length) % 1440;
}

// Shortest circular distance between two clock times, in hours.
export function hoursDeviation(a, b) {
  if (a == null || b == null) return 0;
  let d = Math.abs(nightMin(a) - nightMin(b));
  if (d > 720) d = 1440 - d;
  return d / 60;
}

// sleepHistory: bedtimes, most-recent first ("HH:MM" or minutes). Source-agnostic
// (Sleep Log today; Fitbit later) — keep it behind this param.
export function predictBedtime(sleepHistory) {
  const h = (sleepHistory || []).filter(x => x != null);
  if (!h.length) return { bedtime: 23 * 60, confidence: "low", anomaly: false, reason: "no-history" };
  if (h.length < 3) return { bedtime: nightMin(h[0]) % 1440, confidence: "low", anomaly: false, reason: "sparse-history" };
  const yesterday = h[0];
  const priorPattern = averageSleepTime([h[1], h[2]]);
  if (hoursDeviation(yesterday, priorPattern) >= SLEEP_ANOMALY_THRESHOLD_HOURS) {
    return { bedtime: priorPattern, confidence: "ok", anomaly: true, reason: "yesterday-outlier" };
  }
  return { bedtime: nightMin(yesterday) % 1440, confidence: "ok", anomaly: false };
}

// Hours from `now` forward to the next occurrence of `bed`.
export function forwardHours(now, bed) {
  let n = toMin(now), b = toMin(bed);
  if (b <= n) b += 1440;
  return (b - n) / 60;
}

const tierFor = h => h >= 3 ? PRE_BED_TAPER[0] : h >= 2 ? PRE_BED_TAPER[1] : h >= 1 ? PRE_BED_TAPER[2] : PRE_BED_TAPER[3];

// Stateful, time-aware readjustment. Re-call as the clock advances / meals log.
// remainingKcal = daily target − already logged (incl. floors' planned kcal).
export function planRemainingIntake(now, predictedBedtime, remainingKcal, remainingMacros = null) {
  const hoursToBed = forwardHours(now, predictedBedtime);
  const tier = tierFor(hoursToBed);

  if (hoursToBed >= 3) {
    const onTrack = remainingKcal <= PREFERRED_LAST_MEAL_KCAL;
    // Behind → consolidate remaining into the last pre-line meal; 800 CAN be
    // exceeded (cramming beats missing the daily target).
    const suggestKcal = onTrack ? Math.min(remainingKcal, PREFERRED_LAST_MEAL_KCAL) : remainingKcal;
    return {
      hoursToBed, tier, form: "full-meal",
      ceilingKcal: onTrack ? PREFERRED_LAST_MEAL_KCAL : Infinity,
      suggestKcal, tapered: false, onTrack,
      exceeded: suggestKcal > PREFERRED_LAST_MEAL_KCAL,
      skipIfPossible: false, lowFat: false,
    };
  }
  // Inside the taper — ceilings cap SUGGESTIONS only, never what can be logged.
  return {
    hoursToBed, tier, form: tier.form,
    ceilingKcal: tier.ceilingKcal,
    suggestKcal: Math.min(Math.max(0, remainingKcal), tier.ceilingKcal),
    tapered: true, onTrack: false, exceeded: false,
    skipIfPossible: !!tier.skipIfPossible, lowFat: !!tier.lowFat,
  };
}
