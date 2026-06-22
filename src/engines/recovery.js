// ─── RECOVERY ENGINE (D1 — readiness, limiter, train/rest verdict) ────────
import { daysAgo, getTodayStr, localDateStr, WEEKDAYS } from "../lib/dates.js";
import { avgTimeMins } from "../lib/time.js";
import { computeWeightTrend } from "./weight.js";
import { computeProteinDistribution } from "./protein.js";
import { estimateSleepNeed, sleepTST } from "./sleep.js";
import { parseWorkout } from "./workout.js";
import { computeNicotineStats } from "./nicotine.js";

export function computeRecovery(data, goals) {
  const today = getTodayStr();
  const reasons = [];   // { text, dir: "neg" | "pos" } — neg pushes toward rest
  const unknown = [];
  let negScore = 0;     // weighted points pushing toward rest
  const negByCat = {};  // weighted negatives grouped by category → finds the limiter

  const add = (text, dir, weight = 1, category = "load") => {
    reasons.push({ text, dir, category });
    if (dir === "neg") { negScore += weight; negByCat[category] = (negByCat[category] || 0) + weight; }
  };

  // What does the plan say for today?
  const todayName = WEEKDAYS[(new Date(today + "T00:00:00").getDay() + 6) % 7];
  const plannedToday = goals.plan?.trainingDays?.includes(todayName);
  const todayLabel = goals.plan?.assignments?.[todayName] || (plannedToday ? "training" : "rest");

  // ── Last night's sleep ──
  const sortedSleep = (data.sleep || []).filter(s => s.date && s.duration != null).sort((a, b) => b.date.localeCompare(a.date));
  const lastSleep = sortedSleep[0];
  const lastNightDate = (data.sleep || []).some(s => s.date === today) ? today : daysAgo(1);
  if (!lastSleep || Math.round((new Date(lastNightDate + "T00:00:00") - new Date(lastSleep.date + "T00:00:00")) / 86400000) >= 1) {
    unknown.push("last night's sleep");
  } else {
    const poor = lastSleep.quality === "Poor" || lastSleep.quality === "Fair";
    if (lastSleep.duration < 5.5) add(`Only ${lastSleep.duration}h sleep last night — recovery is significantly down`, "neg", 2, "sleep");
    else if (lastSleep.duration < 7 || poor) add(`Slept ${lastSleep.duration}h${poor ? ` (${lastSleep.quality.toLowerCase()})` : ""} last night — a bit under-recovered`, "neg", 1, "sleep");
    else add(`Slept ${lastSleep.duration}h (${(lastSleep.quality || "ok").toLowerCase()}) last night — well rested`, "pos");
  }

  // ── Sleep timing: hours awake since waking, estimated hours until next sleep ──
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const minsOf = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
  // Hours awake: from last logged wake time (if today/last night)
  let hoursAwake = null;
  if (lastSleep?.wakeTime) {
    const wake = minsOf(lastSleep.wakeTime);
    if (wake != null) {
      // If the sleep log is for today, wake was today; otherwise assume it was yesterday morning
      const wakeWasToday = lastSleep.date === today;
      let mins = nowMins - wake;
      if (!wakeWasToday) mins += 24 * 60; // woke yesterday
      if (mins >= 0 && mins < 36 * 60) hoursAwake = +(mins / 60).toFixed(1);
    }
  }
  // Estimated next bedtime: 7-day average bedtime (fallback last night's)
  const recentBeds = (data.sleep || []).filter(s => s.date >= daysAgo(7) && s.bedtime).map(s => s.bedtime);
  let nextBedMins = recentBeds.length >= 2 ? avgTimeMins(recentBeds) : (lastSleep?.bedtime ? minsOf(lastSleep.bedtime) : null);
  let hoursToBed = null, nextBedLabel = null;
  if (nextBedMins != null) {
    nextBedLabel = `${String(Math.floor((nextBedMins % 1440) / 60)).padStart(2, "0")}:${String(nextBedMins % 60).padStart(2, "0")}`;
    let toBed = nextBedMins - nowMins;
    if (toBed < -60) toBed += 24 * 60; // bedtime already passed → next one is tomorrow
    if (toBed >= -60 && toBed <= 24 * 60) hoursToBed = +(toBed / 60).toFixed(1);
  }
  // Surface as context (not heavily weighted — informational, plus a nudge if up very late)
  if (hoursAwake != null && hoursAwake >= 16) add(`You've been awake ~${hoursAwake}h — long day, recovery capacity is lower late`, "neg", 0.5, "sleep");

  const sleepTiming = { hoursAwake, hoursToBed, nextBedLabel, lastWake: lastSleep?.wakeTime || null, lastBed: lastSleep?.bedtime || null };

  // ── 7-day sleep debt (vs the user's personal need, not a hardcoded 8h) ──
  const last7Sleep = (data.sleep || []).filter(s => s.date >= daysAgo(6));
  if (last7Sleep.length >= 3) {
    const need = estimateSleepNeed(data, goals).hours;
    const debt = last7Sleep.reduce((d, s) => d + (need - sleepTST(s)), 0);
    if (debt > 8) add(`Sleep debt is high (~${debt.toFixed(0)}h short of your ${need}h need this week)`, "neg", 2, "sleep");
    else if (debt > 4) add(`Some sleep debt building this week (~${debt.toFixed(0)}h short of your ${need}h need)`, "neg", 1, "sleep");
  }

  // ── Consecutive training days / days since rest ──
  const trainDates = new Set([...(data.exercise || []).map(e => e.date), ...(data.sports || []).map(s => s.date)]);
  let consec = 0;
  { let cur = new Date(); if (!trainDates.has(getTodayStr())) cur.setDate(cur.getDate() - 1);
    for (;;) { const ds = localDateStr(cur); if (trainDates.has(ds)) { consec++; cur.setDate(cur.getDate() - 1); } else break; } }
  if (consec >= 5) add(`Trained ${consec} days straight with no rest — strong deload signal`, "neg", 2, "load");
  else if (consec >= 3) add(`${consec} training days in a row — fatigue accumulating`, "neg", 1, "load");
  else if (consec === 0 && trainDates.size > 0) add(`Rested recently — you're fresh`, "pos");

  // ── Recent RPE trend (from parsed Strong data) ──
  const last5Lifts = (data.exercise || []).filter(e => e.date >= daysAgo(6))
    .map(e => (e._parsed || parseWorkout(e.text || "")).avgRPE).filter(v => v != null);
  if (last5Lifts.length >= 2) {
    const avgRPE = last5Lifts.reduce((a, b) => a + b, 0) / last5Lifts.length;
    if (avgRPE >= 8.5) add(`Recent sessions have felt very hard (avg RPE ${avgRPE.toFixed(1)})`, "neg", 1, "load");
    else if (avgRPE <= 6.5) add(`Recent sessions felt manageable (avg RPE ${avgRPE.toFixed(1)})`, "pos");
  }

  // ── Under-fuelling over the last few days ──
  const calByDay = {};
  (data.diet || []).filter(d => d.date >= daysAgo(2)).forEach(d => { calByDay[d.date] = (calByDay[d.date] || 0) + (d.calories || 0); });
  const calDays = Object.values(calByDay);
  if (calDays.length >= 2 && goals.calories) {
    const avg = calDays.reduce((a, b) => a + b, 0) / calDays.length;
    if (avg < goals.calories * 0.7) add(`Under-eating recently (~${Math.round(avg)} vs ${goals.calories} target) — under-fuelled recovery`, "neg", 1, "fuel");
  }

  // ── Protein adequacy (B1) & aggressive-deficit signal (A1) ──
  const pdRec = computeProteinDistribution(data, goals);
  if (pdRec && pdRec.confidence !== "Low" && pdRec.proteinGoal && pdRec.avgProtein < pdRec.proteinGoal * 0.8) {
    add(`Protein's been low (~${pdRec.avgProtein}g vs ${pdRec.proteinGoal}g) — under-supports tissue repair`, "neg", 1, "fuel");
  }
  const wtRec = computeWeightTrend(data);
  if (wtRec && wtRec.confidence !== "Low" && wtRec.pctBWPerWeek != null && wtRec.pctBWPerWeek <= -0.9) {
    add(`Losing weight fast (trend ${wtRec.pctBWPerWeek}%BW/wk) — an aggressive deficit lowers recovery capacity`, "neg", 1, "fuel");
  }

  // ── Carbs vs a hard session (conservative placeholder until the C1 glycogen engine) ──
  if (goals.carbs) {
    const hardSession = (data.exercise || []).some(e => {
      if (e.date !== today && e.date !== daysAgo(1)) return false;
      const pr = e._parsed || parseWorkout(e.text || "");
      return (pr.avgRPE != null && pr.avgRPE >= 8) || (pr.totalVolume != null && pr.totalVolume >= 12000);
    }) || (data.sports || []).some(s => (s.date === today || s.date === daysAgo(1)) && (s.duration || 0) >= 60);
    const carbsToday = (data.diet || []).filter(d => d.date === today).reduce((a, d) => a + (d.carbs || 0), 0);
    if (hardSession && carbsToday > 0 && carbsToday < goals.carbs * 0.5) {
      add(`Hard session but carbs are low today (~${Math.round(carbsToday)}g vs ${goals.carbs}g) — glycogen may be under-replenished`, "neg", 0.5, "carbs");
    }
  }

  // ── Journal sentiment (light touch — only explicit fatigue words) ──
  const recentJournal = (data.journal || []).filter(e => e.date >= daysAgo(2));
  const fatigueWords = /\b(exhausted|drained|run down|rundown|burnt out|burned out|wrecked|sore|aching|tired|sick|ill|stressed|no energy|knackered)\b/i;
  const flagged = recentJournal.find(e => fatigueWords.test(e.text));
  if (flagged) add(`Your recent journal notes mention feeling run down`, "neg", 1, "stress");

  // ── Nicotine load (only if notably high) ──
  if ((data.nicotine || []).length) {
    const ns = computeNicotineStats(data);
    if (ns.avg7 > 0 && ns.today.count >= 5) add(`High nicotine intake today may blunt recovery`, "neg", 0.5, "stress");
  }

  // ── ROLL INTO VERDICT ──
  // Heavy single signals (sleep<5.5h, 5+ consec days) already weighted 2.
  let verdict;
  if (negScore >= 4) verdict = "rest";
  else if (negScore >= 2) verdict = "caution";
  else verdict = "go";

  // If sleep is unknown, don't confidently say "go" — soften to caution and flag.
  let lowData = false;
  if (verdict === "go" && unknown.includes("last night's sleep")) { verdict = "caution"; lowData = true; }

  // Reconcile with the plan: note when the verdict and the plan disagree.
  let reconcile = null;
  if (verdict === "rest" && plannedToday) reconcile = `Your plan has ${todayLabel} today, but your recovery says rest. Consider swapping today with an upcoming rest day.`;
  else if (verdict === "go" && !plannedToday) reconcile = `You're recovered, but today is a scheduled rest day. Extra rest never hurts — or move a session here if you're keen.`;
  else if (verdict === "caution" && plannedToday) reconcile = `Plan says ${todayLabel}. You can train, but keep intensity in check and cut volume if it feels rough.`;

  // ── LIMITER + READINESS ──
  // The limiter is the category dragging recovery down the most — the single
  // bottleneck to name instead of generic advice. Only surfaced once there's
  // meaningful negative load (caution/rest); at "go" nothing is limiting.
  const catLabels = { sleep: "Sleep", fuel: "Fuel / nutrition", carbs: "Carbs / glycogen", load: "Training load", stress: "Stress / lifestyle" };
  let limiter = null;
  const ranked = Object.entries(negByCat).sort((a, b) => b[1] - a[1]);
  if (ranked.length && negScore >= 2) {
    const [cat, w] = ranked[0];
    const topReason = reasons.find(r => r.dir === "neg" && r.category === cat);
    limiter = { category: cat, label: catLabels[cat] || cat, weight: w, topReason: topReason ? topReason.text : null };
  }
  const readiness = Math.max(0, Math.min(100, Math.round(100 - negScore * 14)));

  return { verdict, reasons, unknown, lowData, plannedToday, todayLabel, reconcile, negScore, sleepTiming, limiter, readiness, negByCat };
}
