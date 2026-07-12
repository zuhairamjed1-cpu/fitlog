import { localDateStr } from "../lib/dates";

// ─── Streaks + gym schedule ──────────────────────────────────────────────────
// Two independent streaks, both from logged training days (exercise + sports):
//  • volume    — consecutive weeks hitting the weekly session goal
//  • adherence — consecutive PLANNED gym days actually attended; a missed
//                planned day (in the past) breaks it.
// goals.plannedDays    = array of weekday indices (0=Sun … 6=Sat)
// goals.plannedSessions = weekly session goal (number)

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAYS = DOW;

const toD = s => new Date(s + "T00:00:00");
const addDays = (s, n) => { const d = toD(s); d.setDate(d.getDate() + n); return localDateStr(d); };
const mondayOf = s => { const d = toD(s); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return localDateStr(d); };
const dow = s => toD(s).getDay();

export function trainingDays(data) {
  const set = new Set();
  [...(data.exercise || []), ...(data.sports || [])].forEach(e => { if (e && e.date) set.add(e.date); });
  return set;
}

export function computeStreaks(data, goals, today) {
  const t = today || localDateStr(new Date());
  const days = trainingDays(data);
  const planned = (goals && Array.isArray(goals.plannedDays) ? goals.plannedDays : []).slice().sort((a, b) => a - b);
  const goal = Math.max(1, Math.round((goals && goals.plannedSessions) || planned.length || 4));

  // ── volume streak (weekly, last N weeks) ──
  const N = 8;
  const curMon = mondayOf(t);
  const weeks = Array.from({ length: N }, (_, i) => {
    const ws = addDays(curMon, -((N - 1) - i) * 7);
    const we = addDays(ws, 7);
    let c = 0;
    days.forEach(d => { if (d >= ws && d < we) c++; });
    return c;
  });
  const weekDone = weeks[N - 1];
  const hit = weekDone >= goal;
  let prior = 0;
  for (let i = N - 2; i >= 0; i--) { if (weeks[i] >= goal) prior++; else break; }
  const volStreak = prior + (hit ? 1 : 0);
  let vBest = 0, run = 0;
  weeks.forEach(c => { if (c >= goal) { run++; vBest = Math.max(vBest, run); } else run = 0; });
  vBest = Math.max(vBest, volStreak);

  // ── adherence streak (planned days attended) ──
  let adherence = null;
  if (planned.length) {
    // earliest date to scan from: first logged day, else 8 weeks back
    let first = t;
    days.forEach(d => { if (d < first) first = d; });
    if (first === t) first = addDays(curMon, -N * 7);
    // enumerate planned-day dates from `first` to today
    const plannedDates = [];
    for (let d = first; d <= t; d = addDays(d, 1)) { if (planned.includes(dow(d))) plannedDates.push(d); }
    const past = plannedDates.filter(d => d < t);
    let s = 0;
    for (let i = past.length - 1; i >= 0; i--) { if (days.has(past[i])) s++; else break; }
    const todayPlanned = planned.includes(dow(t));
    if (todayPlanned && days.has(t)) s++;
    // best run over all planned occurrences (incl today if attended)
    const seq = todayPlanned ? plannedDates : past;
    let aBest = 0, r = 0;
    seq.forEach(d => { const attended = days.has(d) && (d < t || (d === t)); if (attended) { r++; aBest = Math.max(aBest, r); } else if (d < t) r = 0; });
    aBest = Math.max(aBest, s);
    // next planned day from today forward
    let next = null;
    for (let d = t, k = 0; k < 14; d = addDays(d, 1), k++) { if (planned.includes(dow(d)) && !(d === t && days.has(t))) { next = d; break; } }
    const lastMissed = [...past].reverse().find(d => !days.has(d)) || null;
    adherence = {
      streak: s, best: aBest,
      todayPlanned, todayDone: days.has(t),
      next, nextDow: next ? DOW[dow(next)] : null,
      lastMissed, plannedCount: planned.length,
    };
  }

  return {
    goal, weeks, weekDone, hit,
    volume: { streak: volStreak, best: vBest },
    adherence,
    plannedDays: planned,
  };
}

// Monthly calendar grid. Returns weeks[] of 7 cells (Sun-first), each:
// { date|null, day, inMonth, status } — status ∈ hit|extra|missed|rest|planned|today|future|null
export function buildMonth(data, goals, year, month, today) {
  const t = today || localDateStr(new Date());
  const days = trainingDays(data);
  const planned = (goals && Array.isArray(goals.plannedDays) ? goals.plannedDays : []);
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay()); // back up to Sunday
  const weeksOut = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + w * 7 + i);
      const ds = localDateStr(d);
      const inMonth = d.getMonth() === month;
      const went = days.has(ds);
      const isPlanned = planned.includes(d.getDay());
      let status;
      if (went) status = isPlanned ? "hit" : "extra";
      else if (ds === t) status = "today";
      else if (ds > t) status = isPlanned ? "planned" : "future";
      else status = isPlanned ? "missed" : "rest";
      row.push({ date: ds, day: d.getDate(), inMonth, status, isPlanned });
    }
    weeksOut.push(row);
    // stop after we've covered the month
    if (row[6].date > t && new Date(start).getMonth() !== month && w >= 4 && row.every(c => !c.inMonth)) break;
  }
  return weeksOut;
}
