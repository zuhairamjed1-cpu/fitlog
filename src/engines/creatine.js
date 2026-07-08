// ─── CREATINE SATURATION MODEL ──────────────────────────────────────────────
// Muscle creatine saturation s ∈ [0,1] (0% = normal unsupplemented baseline,
// 100% = fully saturated ceiling). Two independent processes on different
// timescales: dose-dependent FILL toward the ceiling, and a slower first-order
// WASHOUT of the excess pool (~1.6–2%/day creatine→creatinine). Calibrated
// approximation, not a medical predictor.
import { localDateStr } from "../lib/dates";

export const K_WASH = 0.086; // /day  -> ~4–5 week washout to near baseline
export const M_HOLD = 2.0;   // g/day that exactly holds full saturation

// dose-dependent fill rate; higher dose fills faster, same ceiling
export function rFill(intakeGrams) {
  return Math.min(0.6, Math.max(0, 0.045 + 0.023 * intakeGrams));
}

// advance saturation by one day given that day's intake (4 sub-steps for stability)
export function stepDay(s, intakeGrams) {
  const dt = 0.25;
  let x = s;
  for (let i = 0; i < 4; i++) {
    const holdNeed = M_HOLD * x;
    let ds;
    if (intakeGrams > holdNeed) {
      ds = rFill(intakeGrams) * (1 - x);               // filling toward ceiling
    } else {
      ds = -K_WASH * Math.max(0, x - intakeGrams / M_HOLD); // draining excess
    }
    x += ds * dt;
    x = Math.min(1, Math.max(0, x));
  }
  return x;
}

// build the saturation series from an intake series, starting at s = 0
export function saturationSeries(intakes) {
  const out = [];
  let s = 0;
  for (const g of intakes) { s = stepDay(s, g); out.push(s); }
  return out;
}

// ─── projection: "if I stop now" ─────────────────────────────────────────────
// From the current saturation, iterate stepDay(s, 0) and record the day it
// crosses each threshold. 5% is the practical floor (exponential never hits 0).
export function washoutProjection(sFrom, maxDays = 120) {
  let s = sFrom;
  const cross = { below90: null, below50: null, below5: null };
  for (let day = 1; day <= maxDays; day++) {
    s = stepDay(s, 0);
    if (cross.below90 == null && s < 0.90) cross.below90 = day;
    if (cross.below50 == null && s < 0.50) cross.below50 = day;
    if (cross.below5 == null && s < 0.05) { cross.below5 = day; break; }
  }
  return cross;
}

// ─── data adapter — read creatine grams out of the supplements log ───────────
// grams from a dose string: "5 g" / "5g" / "1 scoop (5g)" / "3". Prefer an
// explicit "<n> g"; fall back to the first number.
export function doseGrams(dose) {
  if (!dose) return 0;
  const m = /(\d+(?:\.\d+)?)\s*g\b/i.exec(dose) || /(\d+(?:\.\d+)?)/.exec(dose);
  return m ? parseFloat(m[1]) : 0;
}

export function isCreatine(entry) {
  return /creatin/i.test(entry?.name || "") || /creatin/i.test(entry?.brand || "");
}

// DailyIntake[] { date, grams } from first creatine log → today, gaps filled 0.
export function creatineDailyIntake(supplements, todayStr) {
  const creat = (supplements || []).filter(isCreatine);
  if (!creat.length) return [];
  const byDate = {};
  creat.forEach(s => { if (s.date) byDate[s.date] = (byDate[s.date] || 0) + doseGrams(s.dose); });
  const dates = Object.keys(byDate).sort();
  if (!dates.length) return [];
  const first = dates[0];
  const last = dates[dates.length - 1];
  const end = (todayStr && todayStr > last) ? todayStr : last;
  const out = [];
  const d = new Date(first + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  let guard = 0;
  while (d <= endD && guard++ < 1000) {
    const ds = localDateStr(d);
    out.push({ date: ds, grams: +(byDate[ds] || 0).toFixed(2) });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// target grams for a given day index (loading window vs maintenance baseline)
export function targetForDay(i, config) {
  const { loading, maintenanceGrams } = config;
  return (loading?.enabled && i < loading.durationDays) ? loading.targetGrams : maintenanceGrams;
}
