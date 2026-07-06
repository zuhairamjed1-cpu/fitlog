// ─── CARB TIMING ENGINE (diet × training cross-domain) ──────────────────────
// Honest by construction. Total daily carbs/protein dominate recovery and growth;
// peri-workout timing is a SECONDARY lever and the "anabolic window" is largely a
// myth for once-a-day lifters. So this engine is descriptive, flags only the one
// case with real evidence (chronically training UNDER-FUELED hurts performance),
// reassures when timing is fine, and always defers to daily total intake.
//
// Needs both workout times and meal times to work (the app logs both).

import { daysAgo } from "../lib/dates";

const minsOf = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };

export function computeCarbTiming(data, goals) {
  const PRE = 180;        // 3h pre-window
  const POST = 120;       // 2h post-window
  const LIFT_DUR = 60;    // assumed lift duration (sports use logged duration)
  const FUELED = 25;      // ≥25g carbs pre = "fueled"
  const FASTED_PRE = 15;  // <15g pre …
  const FAST_GAP = 240;   // … and no meal in the prior 4h = trained fasted
  const WINDOW = 21;
  const since = daysAgo(WINDOW - 1);

  const sessions = [];
  (data.exercise || []).forEach(w => { if (w.date >= since && w.time && minsOf(w.time) != null) sessions.push({ date: w.date, start: minsOf(w.time), end: minsOf(w.time) + LIFT_DUR, type: "lift", label: w.label || "Workout" }); });
  (data.sports || []).forEach(s => { if (s.date >= since && s.time && minsOf(s.time) != null) sessions.push({ date: s.date, start: minsOf(s.time), end: minsOf(s.time) + (+s.duration || 60), type: "sport", label: s.sport || "Sport" }); });
  if (!sessions.length) return null;

  const meals = (data.diet || []).filter(d => d.date && d.time && d.carbs != null && minsOf(d.time) != null);
  const carbsIn = (date, from, to) => meals.filter(m => m.date === date && minsOf(m.time) >= from && minsOf(m.time) <= to).reduce((a, m) => a + (m.carbs || 0), 0);
  const lastMealBefore = (date, min) => meals.filter(m => m.date === date && minsOf(m.time) <= min).sort((a, b) => minsOf(b.time) - minsOf(a.time))[0] || null;

  let analyzed = 0, fueledCount = 0, fastedCount = 0, preSum = 0, postSum = 0, withMealData = 0;
  const perSession = [];
  sessions.sort((a, b) => (a.date + String(a.start)).localeCompare(b.date + String(b.start)));
  sessions.forEach(s => {
    const hasMeals = meals.some(m => m.date === s.date);
    if (!hasMeals) { perSession.push({ date: s.date, type: s.type, label: s.label, start: s.start, noData: true }); return; }
    withMealData++; analyzed++;
    const pre = carbsIn(s.date, s.start - PRE, s.start);
    const post = carbsIn(s.date, s.end, s.end + POST);
    const lastBefore = lastMealBefore(s.date, s.start);
    const gap = lastBefore ? s.start - minsOf(lastBefore.time) : null;
    const fueled = pre >= FUELED;
    const fasted = pre < FASTED_PRE && (gap == null || gap >= FAST_GAP);
    preSum += pre; postSum += post;
    if (fueled) fueledCount++;
    if (fasted) fastedCount++;
    perSession.push({ date: s.date, type: s.type, label: s.label, start: s.start, pre: Math.round(pre), post: Math.round(post), fueled, fasted, morning: s.start < 600 });
  });

  if (analyzed === 0) return { sessions: sessions.length, analyzed: 0, needMealTimes: true };

  const avgPre = Math.round(preSum / analyzed);
  const avgPost = Math.round(postSum / analyzed);
  const fueledPct = Math.round((fueledCount / analyzed) * 100);
  const fastedPct = Math.round((fastedCount / analyzed) * 100);
  const morningFasted = perSession.filter(p => p.fasted && p.morning).length;

  let status, lever;
  if (fastedPct >= 50) {
    status = "Often training under-fueled";
    lever = `${fastedPct}% of your recent sessions had little or no carbs beforehand (avg ${avgPre}g in the 3h prior${morningFasted >= 2 ? ", mostly morning sessions" : ""}). For hard or long sessions, ~30–60g of carbs 1–2h before can lift performance and training quality. This is a performance lever — your daily total still matters more for recovery and growth.`;
  } else if (fueledPct >= 70) {
    status = "Well-fueled sessions";
    lever = `You go into most sessions fueled (avg ${avgPre}g carbs in the 3h before). Nothing to fix here — keep it up.`;
  } else {
    status = "Carb timing looks fine";
    lever = `Your carbs around training are reasonable (avg ${avgPre}g pre, ${avgPost}g post). Honestly, for once-a-day training with enough daily carbs, timing is a minor lever — your total daily intake is what drives recovery and growth.`;
  }

  return {
    sessions: sessions.length, analyzed, avgPre, avgPost, fueledPct, fastedPct, morningFasted,
    status, lever,
    confidence: analyzed >= 6 ? "High" : analyzed >= 3 ? "Moderate" : "Low",
    recent: perSession.filter(p => !p.noData).slice(-5).reverse(),
    coverageGap: withMealData < sessions.length,
  };
}
