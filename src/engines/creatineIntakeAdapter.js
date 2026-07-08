// ─── CREATINE INTAKE ADAPTER ─────────────────────────────────────────────────
// Turns the app's raw supplement log (data.supplements) into the CreatineDay[]
// the saturation model consumes. This is the ONE place that knows how creatine
// intake is stored and how a free-text dose becomes grams.
//
//   CreatineDay { date: string (ISO yyyy-mm-dd, LOCAL), doseGrams: number }
//
// The supplement log has no structured unit or category — a dose is free text
// ("5 g", "5", "1 scoop", "2 caps"), and creatine is identified only by name.
import { localDateStr, getTodayStr, daysAgoFrom } from "../lib/dates";

// Grams per serving/scoop when the app doesn't store a structured serving size.
// TODO: if SupplementLibItem ever gains a numeric grams-per-serving, read it here.
export const GRAMS_PER_SERVING = 5;

// Saturation converges long before this, so older days don't change today's
// number — cap history for performance.
export const DEFAULT_LOOKBACK_DAYS = 90;

// A supplement entry is creatine if its name or brand mentions "creatin".
export function isCreatine(entry) {
  return /creatin/i.test(entry?.name || "") || /creatin/i.test(entry?.brand || "");
}

/**
 * Parse a free-text dose string to grams, detecting the unit.
 *   "5 g" / "5g" / "5"      → 5
 *   "500 mg"                → 0.5
 *   "1 scoop" / "2 servings"→ n * gramsPerServing
 *   "2 caps" (unknown unit) → warn, treat the number as grams
 * @param {string|number} dose
 * @param {number} [gramsPerServing]
 * @returns {number} grams (0 if unparseable/empty)
 */
export function parseDoseToGrams(dose, gramsPerServing = GRAMS_PER_SERVING) {
  if (dose == null) return 0;
  const str = String(dose).trim().toLowerCase();
  if (!str) return 0;
  const m = /(\d+(?:\.\d+)?)/.exec(str);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const rest = str.replace(m[1], " "); // remainder, for unit detection

  if (/\bmg\b|milligram/.test(rest)) return n / 1000;
  if (/\b(scoops?|servings?|serv|scoopfuls?)\b/.test(rest)) return n * gramsPerServing;
  if (/\bg\b|gram/.test(rest)) return n;

  // A number with no recognised unit -> grams. Warn only when there's stray text
  // (e.g. "2 caps"), not for a bare number like "5".
  if (/[a-z]/.test(rest)) {
    console.warn(`[creatine] unknown dose unit in "${dose}" — treating ${n} as grams`);
  }
  return n;
}

// The local calendar date for an entry: prefer the stored local `date`, else
// derive it from the epoch `ts` in the user's timezone (never raw UTC).
function entryLocalDate(entry) {
  if (entry?.date) return entry.date;
  if (entry?.ts != null) return localDateStr(new Date(entry.ts));
  return null;
}

/**
 * Build a continuous CreatineDay[] from the supplement log.
 * - Filters to creatine only.
 * - Normalizes each dose to grams and SUMS multiple entries on the same day.
 * - Buckets by LOCAL date, sorts chronologically (handles out-of-order entries).
 * - Fills every gap day as doseGrams:0 (so decay applies and reload detection fires).
 * - Caps the series to `lookbackDays` ending at `today`.
 * Returns [] when no creatine has ever been logged (the new-user case).
 *
 * @param {Array<{name?:string,brand?:string,dose?:string,date?:string,ts?:number}>} supplements
 * @param {{today?:string, lookbackDays?:number, gramsPerServing?:number}} [opts]
 * @returns {Array<{date:string, doseGrams:number}>}
 */
export function supplementsToCreatineDays(supplements, opts = {}) {
  const today = opts.today || getTodayStr();
  const lookbackDays = opts.lookbackDays || DEFAULT_LOOKBACK_DAYS;
  const gramsPerServing = opts.gramsPerServing || GRAMS_PER_SERVING;

  const creat = (supplements || []).filter(isCreatine);
  if (!creat.length) return [];

  const byDate = {};
  for (const e of creat) {
    const d = entryLocalDate(e);
    if (!d) continue;
    byDate[d] = (byDate[d] || 0) + parseDoseToGrams(e.dose, gramsPerServing);
  }
  const dates = Object.keys(byDate).sort(); // chronological
  if (!dates.length) return [];

  const last = dates[dates.length - 1];
  const end = today > last ? today : last;             // series runs through today
  const windowStart = daysAgoFrom(end, lookbackDays - 1); // lookback cap
  let first = dates[0];
  if (first < windowStart) first = windowStart;

  const out = [];
  const d = new Date(first + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  let guard = 0;
  while (d <= endD && guard++ < lookbackDays + 5) {
    const ds = localDateStr(d);
    out.push({ date: ds, doseGrams: +((byDate[ds] || 0).toFixed(2)) });
    d.setDate(d.getDate() + 1);
  }
  return out;
}
