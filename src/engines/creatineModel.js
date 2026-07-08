// ─── CREATINE SATURATION MODEL ──────────────────────────────────────────────
// Discrete daily first-order kinetic model of muscle creatine saturation
// (percent full, BASELINE..MAX). Two competing processes each day:
//   FILL   — dose fills toward the ceiling with diminishing returns as it fills
//   DECAY  — the surplus above baseline drains back toward baseline (never below)
// Calibrated approximation of monohydrate kinetics — directional, NOT a medical
// predictor. The only thing drawn from this is the ring number; it also feeds
// the load-detection logic (needsLoading).
//
// ── CONSTANTS (single source of truth) ──────────────────────────────────────
// Literature anchors this is tuned against:
//   • 20 g/day loading  → ~99% by ~day 5
//   • 5 g/day steady    → ~90%+ plateau by ~day 28
//   • stop taking it    → back toward baseline over ~5–6 weeks
//
// NOTE ON CALIBRATION — this deviates from a naive K_UPTAKE=1.0 / K_DECAY=0.018.
// Those two numbers are mutually incompatible: a decay of 0.018/day leaves a
// 6-week washout still at ~80% (nowhere near baseline), and a decay fast enough
// to wash out in ~6 weeks mathematically caps the loading plateau below 99% in
// this linear model. K_UPTAKE=1.4 / K_DECAY=0.05 is the tuning that satisfies
// all three anchors above (loading ≈98–99% by day 5, 5 g ≈93% plateau by day 28,
// 6-week gap back to ~baseline). Change these together, not individually.
export const MAX = 100;         // % — full saturation ceiling
export const K_UPTAKE = 1.4;    // fill-rate constant (per gram, scaled by gap)
export const K_DECAY = 0.05;    // /day — decay of the surplus above baseline

/**
 * @typedef {Object} CreatineDay
 * @property {string} date       ISO yyyy-mm-dd
 * @property {number} doseGrams  logged intake for the day (0 if none)
 */

/**
 * @typedef {Object} CreatineSettings
 * @property {number} [bodyWeightKg]        optional; enables per-kg dosing
 * @property {number} baselineSaturation    default 65
 * @property {number} loadingDoseGrams      default 20  (or 0.3 * kg if bodyWeightKg set)
 * @property {number} maintenanceDoseGrams  default 5   (or 0.03 * kg, min 3)
 */

/** @type {CreatineSettings} */
export const DEFAULT_SETTINGS = {
  baselineSaturation: 65,
  loadingDoseGrams: 20,
  maintenanceDoseGrams: 5,
};

// Merge partial settings over the defaults so callers can pass just body weight.
export function withDefaults(settings = {}) {
  return { ...DEFAULT_SETTINGS, ...settings };
}

// ─── SATURATION SERIES ───────────────────────────────────────────────────────
// Advance saturation one day per entry, in date order. Returns the raw (unrounded)
// series so callers can round only at display time. Compute this over the ENTIRE
// intake history with missing calendar days filled as doseGrams=0 (decay only) so
// gaps correctly lower saturation and trigger needsLoading.
/**
 * @param {CreatineDay[]} days
 * @param {CreatineSettings} [settings]
 * @returns {number[]} saturation per day, unrounded, in [baseline, MAX]
 */
export function computeSaturation(days, settings = DEFAULT_SETTINGS) {
  const BASELINE = settings.baselineSaturation ?? DEFAULT_SETTINGS.baselineSaturation;
  let S = BASELINE;
  return days.map(({ doseGrams }) => {
    const gapFraction = (MAX - S) / (MAX - BASELINE); // diminishing returns as it fills
    const uptake = K_UPTAKE * (doseGrams || 0) * gapFraction;
    const decay = K_DECAY * (S - BASELINE);           // pulls toward baseline, never below
    S = Math.min(MAX, Math.max(BASELINE, S + uptake - decay));
    return S;
  });
}

// ─── DOSING ──────────────────────────────────────────────────────────────────
// Loading:     0.3 g/kg/day  (default 20 g), typically split 4 × 5 g, 5–7 days.
// Maintenance: 0.03 g/kg/day (default 5 g, floor 3 g).
/**
 * @param {CreatineSettings} settings
 * @param {'loading'|'maintenance'} phase
 * @returns {number} recommended grams for the day
 */
export function recommendedDose(settings, phase) {
  const s = withDefaults(settings);
  const kg = s.bodyWeightKg;
  if (phase === "loading") return kg ? Math.round(kg * 0.3) : s.loadingDoseGrams;
  return kg ? Math.max(3, Math.round(kg * 0.03)) : s.maintenanceDoseGrams;
}

// ─── LOAD DETECTION (system-driven) ───────────────────────────────────────────
// Days since the most recent logged dose (>0 g). Infinity when nothing logged.
export function daysSinceLastDose(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    if ((history[i].doseGrams || 0) > 0) return history.length - 1 - i;
  }
  return Infinity;
}

// Count trailing consecutive days with a dose logged, ending at `endIndex`
// (default: last day). Used to know how many days straight I've been dosing.
export function consecutiveDosingDays(history, endIndex = history.length - 1) {
  let n = 0;
  for (let i = endIndex; i >= 0; i--) {
    if ((history[i].doseGrams || 0) > 0) n++;
    else break;
  }
  return n;
}

/**
 * Whether I currently need to (re)load. Default is loading.
 * @param {CreatineDay[]} history
 * @param {number} saturation  latest estimated saturation (percent)
 */
export function needsLoading(history, saturation) {
  if (!history || history.length === 0) return true;   // default: new user loads
  if (daysSinceLastDose(history) >= 3) return true;     // stopped taking it -> reload
  if (saturation <= 72) return true;                    // near baseline -> reload
  return false;
}

/** Loading is done once stores are effectively full after several dosing days. */
export function isLoadingComplete(consecutiveDays, saturation) {
  return consecutiveDays >= 5 && saturation >= 95;
}

/**
 * The tick indicator: are we in a loading phase right now?
 * Checked when we need to load OR we started loading and it isn't complete yet.
 */
export function inLoadingPhase(history, saturation) {
  if (needsLoading(history, saturation)) return true;
  const started = consecutiveDosingDays(history) > 0;
  return started && !isLoadingComplete(consecutiveDosingDays(history), saturation);
}

// Intake parsing (dose string → grams) and the supplement-log → CreatineDay[]
// adapter live in ./creatineIntakeAdapter — the model stays pure kinetics.

// Local date string (yyyy-mm-dd) — mirrors lib/dates without importing types.
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── WEEK HELPERS (ISO week, Monday-anchored) ────────────────────────────────
export const DAYS_IN_WEEK = 7; // Mon–Sun. Set to 6 for Mon–Sat (layout still holds).

// Monday (yyyy-mm-dd) of the ISO week containing dateStr.
export function mondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return ymd(d);
}

// The DAYS_IN_WEEK ISO date strings starting at `monday`.
export function weekDates(monday, n = DAYS_IN_WEEK) {
  const out = [];
  const d = new Date(monday + "T00:00:00");
  for (let i = 0; i < n; i++) { out.push(ymd(d)); d.setDate(d.getDate() + 1); }
  return out;
}

// Shift a Monday anchor by ±weeks.
export function shiftWeek(monday, deltaWeeks) {
  const d = new Date(monday + "T00:00:00");
  d.setDate(d.getDate() + deltaWeeks * 7);
  return ymd(d);
}

// ─── SAMPLE DATA ─────────────────────────────────────────────────────────────
// A loading week (Mon–Sun, 20 g/day) anchored to the ISO week of `todayStr` so
// the card renders immediately with the tick checked before real data is wired.
// TODO: connect to real creatine intake source — remove this fallback once the
// supplement log reliably feeds the card.
export function sampleLoadingWeek(todayStr) {
  const monday = mondayOf(todayStr);
  return weekDates(monday).map(date => ({ date, doseGrams: 20 }));
}
