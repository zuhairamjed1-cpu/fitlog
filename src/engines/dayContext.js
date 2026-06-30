// ─── DAY CONTEXT — the single source of truth for "what day is this?" ─────────
// Every NUTRITION calculation goes through here instead of reading data.diet or
// comparing date strings directly. One gateway means there is exactly one place
// that decides how a meal maps to a day — calendar or biological.
//
// Biological day = a day that resets at the user's habitual sleep ONSET, not at
// midnight. The onset boundary is FROZEN PER ISO-WEEK from a rolling sleep mean:
// a meal logged in week N always uses week N's boundary forever, so historical
// totals never silently shift as the user's sleep schedule drifts. Future weeks
// adapt automatically.
//
// `consumedAt` (when the food was eaten) is authoritative. `loggedAt` (when Save
// was pressed) is audit-only and never used for bucketing.
import { localDateStr, daysAgoFrom } from "../lib/dates.js";
import { avgTimeMins, minsOfTime } from "../lib/time.js";
import { computeCircadian } from "./circadian.js";

const DAY = 86400000;

// ── authoritative timestamp for a meal (tolerates legacy rows: no consumedAt/ts/id) ──
export function mealTs(m) {
  if (!m) return null;
  if (m.consumedAt != null) return m.consumedAt;
  if (m.ts != null) return m.ts;
  if (m.date) return new Date(`${m.date}T${m.time || "12:00"}:00`).getTime();
  return null;
}

// Derive consumedAt/loggedAt for the write path. Never stores biologicalDayId
// (the boundary moves; a stored key would go stale). Read-time only.
export function normMeal(m) {
  const consumedAt = mealTs(m);
  const looksEpoch = typeof m.id === "number" && m.id > 1e12;
  const loggedAt = m.loggedAt ?? (looksEpoch ? m.id : consumedAt);
  return { ...m, consumedAt, loggedAt };
}

// ── ISO-week key (Thursday-based), lexically sortable: "2026-W07" ──
function isoWeekKey(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (date.getDay() + 6) % 7;          // Mon=0
  date.setDate(date.getDate() - day + 3);        // Thursday of this week
  const firstThu = new Date(date.getFullYear(), 0, 4);
  const fday = (firstThu.getDay() + 6) % 7;
  firstThu.setDate(firstThu.getDate() - fday + 3);
  const week = 1 + Math.round((date - firstThu) / (7 * DAY));
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── period-frozen boundary history, memoized by data.sleep identity ──
const _histCache = new WeakMap();
export function buildBoundaryHistory(data) {
  const sleepArr = (data && data.sleep) || [];
  const cached = _histCache.get(sleepArr);
  if (cached) return cached;

  const sleeps = sleepArr
    .filter(s => s && s.bedtime && s.date && minsOfTime(s.bedtime) != null)
    .map(s => ({ date: s.date, bed: s.bedtime }))   // avgTimeMins parses "HH:MM" strings
    .sort((a, b) => a.date.localeCompare(b.date));

  let result;
  if (sleeps.length < 3) {
    result = { byWeek: {}, weekKeys: [], latest: null, ready: false };
  } else {
    const wkOf = s => isoWeekKey(new Date(s.date + "T12:00:00"));
    const weeks = [...new Set(sleeps.map(wkOf))].sort();
    const byWeek = {};
    for (const wk of weeks) {
      const upto = sleeps.filter(s => wkOf(s) <= wk).slice(-21);   // trailing 21 as of week-end
      if (upto.length >= 3) byWeek[wk] = avgTimeMins(upto.map(s => s.bed)); // circular mean (minutes)
    }
    const last21 = sleeps.slice(-21);
    const latest = last21.length >= 3 ? avgTimeMins(last21.map(s => s.bed)) : null;
    const weekKeys = Object.keys(byWeek).sort();
    result = { byWeek, weekKeys, latest, ready: latest != null };
  }
  _histCache.set(sleepArr, result);
  return result;
}

// Frozen onset boundary (minute-of-day) for the week a timestamp falls in.
export function boundaryForTs(ts, history) {
  if (!history || !history.ready) return null;
  const wk = isoWeekKey(new Date(ts));
  if (history.byWeek[wk] != null) return history.byWeek[wk];
  let best = null;                                  // nearest earlier week
  for (const k of history.weekKeys) { if (k <= wk) best = history.byWeek[k]; else break; }
  if (best != null) return best;
  return history.weekKeys.length ? history.byWeek[history.weekKeys[0]] : history.latest;
}

// ── DayContext provider, memoized by (data identity + toggle) ──
let _ctxCache = null; // { data, enabled, ctx }
export function getDayContext(data, goals) {
  const enabled = goals?.nutrition?.biologicalDay !== false; // default ON
  if (_ctxCache && _ctxCache.data === data && _ctxCache.enabled === enabled) return _ctxCache.ctx;

  const history = enabled ? buildBoundaryHistory(data) : null;
  const circ = enabled ? computeCircadian(data) : null;        // display only (live average)
  const mode = enabled && history && history.ready ? "biological" : "calendar";
  const diet = (data && data.diet) || [];

  const boundaryFor = ts => (mode === "biological" ? boundaryForTs(ts, history) : null);

  // Single cut at the sleep-ONSET boundary, labeled by the day you're awake for.
  // AM onset (sleeps after midnight, b<12:00): early hours before onset belong to the
  //   PREVIOUS calendar day (a 1 AM snack still counts toward yesterday's waking day).
  // PM onset (sleeps in the evening, b>=12:00): the bio day ends at onset, so anything
  //   AT/AFTER onset rolls into the NEXT calendar day; daytime stays put.
  const dayKeyOf = meal => {
    const ts = mealTs(meal);
    if (ts == null) return meal?.date ?? null;
    if (mode === "calendar") return localDateStr(new Date(ts));
    const b = boundaryFor(ts);
    if (b == null) return localDateStr(new Date(ts));
    const d = new Date(ts);
    const tod = d.getHours() * 60 + d.getMinutes();
    if (b >= 720) return tod >= b ? localDateStr(new Date(ts + DAY)) : localDateStr(d);
    return tod < b ? localDateStr(new Date(ts - DAY)) : localDateStr(d);
  };

  const currentDayKey = (now) => dayKeyOf({ consumedAt: now == null ? Date.now() : now });

  let _bucket = null;
  const bucket = () => {
    if (_bucket) return _bucket;
    const out = {};
    diet.forEach(m => { const k = dayKeyOf(m); if (k != null) (out[k] = out[k] || []).push(m); });
    _bucket = out;
    return out;
  };
  const meals = dayKey => bucket()[dayKey] || [];
  const totals = dayKey => meals(dayKey).reduce((a, m) => ({
    cal: a.cal + (m.calories || 0), protein: a.protein + (m.protein || 0),
    carbs: a.carbs + (m.carbs || 0), fat: a.fat + (m.fat || 0),
  }), { cal: 0, protein: 0, carbs: 0, fat: 0 });

  // last n active days, inclusive of the current day → { dayKey: Meal[] }
  const window = nDays => {
    const b = bucket();
    const lo = daysAgoFrom(currentDayKey(), nDays - 1);
    const out = {};
    Object.keys(b).forEach(k => { if (k >= lo) out[k] = b[k]; });
    return out;
  };

  const ctx = {
    mode, circ, history,
    mealTs, dayKeyOf, currentDayKey, meals, bucket, totals, window, boundaryFor,
    // resolve a chosen day-key + clock time into a stored {date,time,consumedAt}.
    // A time before that day's onset boundary belongs to the NEXT calendar date.
    resolveConsumedAt(dayKey, time) {
      const mins = minsOfTime(time);
      let calDate = dayKey;
      if (mode === "biological" && mins != null) {
        const b = boundaryForTs(new Date(`${dayKey}T12:00:00`).getTime(), history);
        if (b != null) {
          if (b >= 720 && mins >= b) calDate = daysAgoFrom(dayKey, 1);       // PM onset, after onset → prev calendar date
          else if (b < 720 && mins < b) calDate = daysAgoFrom(dayKey, -1);   // AM onset, early hours → next calendar date
        }
      }
      const t = time || "12:00";
      return { date: calDate, time: t, consumedAt: new Date(`${calDate}T${t}:00`).getTime() };
    },
  };

  _ctxCache = { data, enabled, ctx };
  return ctx;
}
