// ─── THE BRAIN ────────────────────────────────────────────────────────────
// Digests all engines + raw logs into structured signals (buildBrain) and
// flattens them to the text every AI call reads (formatBrainText).
import { daysAgo, daysAgoFrom, getTodayStr, localDateStr, formatDate, formatShortDate, WEEKDAYS } from "../lib/dates.js";
import { avgTimeMins, avgTimeHHMM, minsOfTime } from "../lib/time.js";
import { computeWeightTrend } from "../engines/weight.js";
import { parseWorkout } from "../engines/workout.js";
import { computeProteinDistribution } from "../engines/protein.js";
import { computeEnergyBalance } from "../engines/energy.js";
import { computeTraining } from "../engines/training.js";
import { computeSleep, estimateSleepNeed, sleepTST } from "../engines/sleep.js";
import { computeRecovery } from "../engines/recovery.js";
import { computeCircadian, todaysBioNutrition, bioDayKey } from "../engines/circadian.js";
import { computeVolume } from "../engines/volume.js";
import { computeNicotineStats } from "../engines/nicotine.js";
import { computeSkin } from "../engines/skin.js";
import { computeCarbTiming } from "../engines/carbtiming.js";
import { planFueling, reconcileFueling, sleepWindow } from "../engines/fueling.js";

export function insightCategory(text) {
  const t = (text || "").toLowerCase();
  if (/sleep|bedtime|rested|circadian|awake|deload|overtrain/.test(t)) return "sleep/recovery";
  if (/protein|mps|feeding|leucine/.test(t)) return "protein";
  if (/carb|glycogen/.test(t)) return "carbs";
  if (/trend weight|%bw|lean-gain|gaining fast|losing fast|surplus|deficit|maintenance|calorie|kcal|under-eat|fuel/.test(t)) return "energy/weight";
  if (/volume|rpe|days in a row|days straight|training/.test(t)) return "training";
  if (/hydration|water/.test(t)) return "hydration";
  return "other";
}

export function prioritizeInsights(insights) {
  const impactByPriority = { critical: 100, important: 60, notable: 30 };
  const actionCue = /\b(shift|add|move|consider|recheck|aim|spread|reduce|increase|swap|deload|smaller|protect|raise|cut|keep|prioriti|eat)\b/i;
  const scored = (insights || []).map((ins, idx) => {
    let score = impactByPriority[ins.priority] ?? 20;
    if (ins.text.includes("—") || ins.text.includes(" - ")) score += 8; // embeds a "what to do"
    if (actionCue.test(ins.text)) score += 7;
    return { ...ins, category: insightCategory(ins.text), score, _idx: idx };
  });
  const ranked = scored.slice().sort((a, b) => b.score - a.score || a._idx - b._idx);
  // headline focus: highest-scored per category, up to 5 (keeps the top list diverse)
  const seen = new Set();
  const top = [];
  for (const i of ranked) {
    if (seen.has(i.category)) continue;
    seen.add(i.category);
    top.push(i);
    if (top.length >= 5) break;
  }
  return { ranked, top };
}

export function buildBrain(data, goals) {
  const now = new Date();
  const today = getTodayStr();
  const yesterday = daysAgo(1);
  const todayName = WEEKDAYS[(now.getDay() + 6) % 7];
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeNow = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const timeOfDay = hour < 5 ? "late night" : hour < 11 ? "morning" : hour < 14 ? "midday" : hour < 18 ? "afternoon" : hour < 22 ? "evening" : "night";
  const isWeekend = todayName === "Sat" || todayName === "Sun";

  // ── Time windows
  const inWindow = (arr, days) => arr.filter(i => i.date >= daysAgo(days - 1));
  const last7 = a => inWindow(a, 7);
  const last14 = a => inWindow(a, 14);
  const last30 = a => inWindow(a, 30);

  // Helper: parse HH:MM into minutes since midnight, or null
  const minsOf = t => { if (!t) return null; const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? +m[1] * 60 + +m[2] : null; };

  // ── TODAY: nutrition + intake so far
  const todayDiet = data.diet.filter(d => d.date === today);
  const todayCal = todayDiet.reduce((a, m) => a + (m.calories || 0), 0);
  const todayP = todayDiet.reduce((a, m) => a + (m.protein || 0), 0);
  const todayC = todayDiet.reduce((a, m) => a + (m.carbs || 0), 0);
  const todayF = todayDiet.reduce((a, m) => a + (m.fat || 0), 0);
  const calRemaining = (goals.calories || 0) - todayCal;
  const pRemaining = (goals.protein || 0) - todayP;
  const cRemaining = (goals.carbs || 0) - todayC;
  const fRemaining = (goals.fat || 0) - todayF;
  const todayWaterMl = data.water.filter(w => w.date === today).reduce((a, w) => a + w.ml, 0);
  const waterRemainingMl = (goals.waterGoalMl || 0) - todayWaterMl;
  const todaySupps = data.supplements.filter(s => s.date === today);
  const todaySleep = data.sleep.find(s => s.date === today);
  const yestSleep = data.sleep.find(s => s.date === yesterday);
  const todayWorkout = data.exercise.find(e => e.date === today);
  const todaySport = data.sports.find(s => s.date === today);

  // Time since last meal
  const todayMealsWithTime = todayDiet.filter(m => m.time).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const lastMealTime = todayMealsWithTime.length ? todayMealsWithTime[todayMealsWithTime.length - 1].time : null;
  const hoursSinceLastMeal = (() => {
    if (!lastMealTime) return null;
    const m = minsOf(lastMealTime);
    const nowMins = hour * 60 + minute;
    const diff = nowMins - m;
    return diff >= 0 ? +(diff / 60).toFixed(1) : null;
  })();

  // ── PLAN
  const plan = goals.plan || null;
  const isTrainingDay = plan?.trainingDays?.includes(todayName) || false;
  const todayPlanLabel = plan?.assignments?.[todayName] || (isTrainingDay ? "Training day" : "Rest day");
  const tomorrowName = WEEKDAYS[(now.getDay() + 7) % 7];
  const tomorrowPlanLabel = plan?.assignments?.[tomorrowName] || (plan?.trainingDays?.includes(tomorrowName) ? "Training" : "Rest");

  // ── DAILY TIMELINES — chronological event list per day (last 7 days)
  // This is the heart of "mapping everything out." Each day becomes a sequence:
  //   08:15 Breakfast 450kcal P25g | 10:30 Workout (Push) | 13:00 Lunch 700kcal | ...
  function buildTimeline(date) {
    const events = [];
    data.diet.filter(d => d.date === date).forEach(m => events.push({ t: m.time || "??:??", kind: "meal", text: `${m.meal} ${m.calories}kcal P${m.protein}g`, sortKey: minsOf(m.time) ?? 9999 }));
    data.exercise.filter(e => e.date === date).forEach(e => {
      const p = e._parsed || parseWorkout(e.text || "");
      events.push({ t: e.time || "??:??", kind: "workout", text: `Workout: ${e.label}${p.totalVolume ? ` (${p.totalVolume}kg vol)` : ""}${e.prs?.length ? ` 🏆${e.prs.length}` : ""}`, sortKey: minsOf(e.time) ?? 9999 });
    });
    data.sports.filter(s => s.date === date).forEach(s => events.push({ t: s.time || "??:??", kind: "sport", text: `${s.sport} ${s.duration}min ${s.intensity}${s.calories ? ` ${s.calories}kcal` : ""}`, sortKey: minsOf(s.time) ?? 9999 }));
    data.water.filter(w => w.date === date).forEach(w => {
      const t = w.ts ? new Date(w.ts) : null;
      const ts = t ? `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}` : "??:??";
      events.push({ t: ts, kind: "water", text: `Water ${w.ml}ml`, sortKey: t ? t.getHours() * 60 + t.getMinutes() : 9999 });
    });
    data.supplements.filter(s => s.date === date).forEach(s => {
      const t = s.ts ? new Date(s.ts) : null;
      const ts = t ? `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}` : "??:??";
      events.push({ t: ts, kind: "supp", text: `Supp: ${s.name}${s.dose ? ` ${s.dose}` : ""}`, sortKey: t ? t.getHours() * 60 + t.getMinutes() : 9999 });
    });
    const slp = data.sleep.find(s => s.date === date);
    if (slp) events.push({ t: slp.bedtime || "??:??", kind: "sleep", text: `Slept ${slp.duration}h (${slp.quality}) until ${slp.wakeTime || "?"}`, sortKey: 0 });
    return events.sort((a, b) => a.sortKey - b.sortKey);
  }

  // Aggregate water by day for compactness, since dozens of entries would bloat the timeline
  function compactTimeline(events) {
    const waters = events.filter(e => e.kind === "water");
    const totalWater = waters.reduce((a, e) => { const m = /Water (\d+)ml/.exec(e.text); return a + (m ? +m[1] : 0); }, 0);
    const out = events.filter(e => e.kind !== "water");
    if (totalWater > 0) out.push({ t: "—", kind: "water", text: `Total water ${totalWater}ml`, sortKey: 9999 });
    return out;
  }

  const timelines = Array.from({ length: 7 }, (_, i) => {
    const d = daysAgo(6 - i);
    const events = compactTimeline(buildTimeline(d));
    return { date: d, dayName: WEEKDAYS[(new Date(d + "T00:00:00").getDay() + 6) % 7], events };
  });

  // ── 7-DAY NUTRITION
  const last7Diet = last7(data.diet);
  const dietByDay7 = {};
  last7Diet.forEach(d => {
    if (!dietByDay7[d.date]) dietByDay7[d.date] = { cal: 0, p: 0, c: 0, f: 0, meals: 0, firstMeal: null, lastMeal: null };
    const day = dietByDay7[d.date];
    day.cal += d.calories || 0;
    day.p += d.protein || 0;
    day.c += d.carbs || 0;
    day.f += d.fat || 0;
    day.meals++;
    if (d.time) {
      if (!day.firstMeal || d.time < day.firstMeal) day.firstMeal = d.time;
      if (!day.lastMeal || d.time > day.lastMeal) day.lastMeal = d.time;
    }
  });
  const dietDays7 = Object.values(dietByDay7);
  const avgCal7 = dietDays7.length ? Math.round(dietDays7.reduce((a, d) => a + d.cal, 0) / dietDays7.length) : null;
  const avgP7 = dietDays7.length ? Math.round(dietDays7.reduce((a, d) => a + d.p, 0) / dietDays7.length) : null;
  const proteinHits7 = dietDays7.filter(d => d.p >= (goals.protein || 0)).length;
  const calDeficit7 = avgCal7 != null ? (goals.calories || 0) - avgCal7 : null;
  // Average first/last meal times across the week
  const firstMealTimes = dietDays7.map(d => d.firstMeal).filter(Boolean);
  const lastMealTimes = dietDays7.map(d => d.lastMeal).filter(Boolean);
  const avgFirstMeal = firstMealTimes.length ? avgTimeHHMM(firstMealTimes) : null;
  const avgLastMeal = lastMealTimes.length ? avgTimeHHMM(lastMealTimes) : null;

  // ── 14-day calorie trend (rising/falling)
  const last14Diet = last14(data.diet);
  const trendBucket = (start, end) => {
    const days = {};
    last14Diet.filter(d => d.date >= start && d.date <= end).forEach(d => { days[d.date] = (days[d.date] || 0) + (d.calories || 0); });
    const vs = Object.values(days);
    return vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) : null;
  };
  const recentHalf = trendBucket(daysAgo(6), today);
  const olderHalf = trendBucket(daysAgo(13), daysAgo(7));
  const calorieTrend = (recentHalf && olderHalf) ? (recentHalf - olderHalf) : null;

  // ── SLEEP
  const sleepIntel = computeSleep(data, goals);
  const sleepNeed = (sleepIntel?.need?.hours) ?? estimateSleepNeed(data, goals).hours;
  const last7Sleep = last7(data.sleep);
  const avgSleep7 = last7Sleep.length ? +(last7Sleep.reduce((a, s) => a + s.duration, 0) / last7Sleep.length).toFixed(1) : null;
  const sleepDebt7 = last7Sleep.reduce((d, s) => d + (sleepNeed - sleepTST(s)), 0);
  const sleepPatternIssue = last7Sleep.length >= 3 && avgSleep7 != null && avgSleep7 < sleepNeed - 0.5;
  // Average bedtime / wake time across the week
  const bedtimes = last7Sleep.map(s => s.bedtime).filter(Boolean);
  const wakeTimes = last7Sleep.map(s => s.wakeTime).filter(Boolean);
  const avgBedtime = bedtimes.length ? avgTimeHHMM(bedtimes, true) : null;
  const avgWakeTime = wakeTimes.length ? avgTimeHHMM(wakeTimes) : null;
  // Weekend vs weekday sleep gap
  const weekdaySleeps = last7Sleep.filter(s => { const wd = WEEKDAYS[(new Date(s.date + "T00:00:00").getDay() + 6) % 7]; return wd !== "Sat" && wd !== "Sun"; });
  const weekendSleeps = last7Sleep.filter(s => { const wd = WEEKDAYS[(new Date(s.date + "T00:00:00").getDay() + 6) % 7]; return wd === "Sat" || wd === "Sun"; });
  const wkdayAvgSleep = weekdaySleeps.length ? +(weekdaySleeps.reduce((a, s) => a + s.duration, 0) / weekdaySleeps.length).toFixed(1) : null;
  const wkendAvgSleep = weekendSleeps.length ? +(weekendSleeps.reduce((a, s) => a + s.duration, 0) / weekendSleeps.length).toFixed(1) : null;

  // ── TRAINING
  const last7Lifts = last7(data.exercise);
  const last7Sports = last7(data.sports);
  const last14Lifts = last14(data.exercise);
  const last7TotalSessions = last7Lifts.length + last7Sports.length;
  const volume7 = last7Lifts.reduce((sum, e) => sum + ((e._parsed || parseWorkout(e.text || "")).totalVolume || 0), 0);
  const volume7_olderHalf = inWindow(data.exercise, 14).filter(e => e.date < daysAgo(6)).reduce((sum, e) => sum + ((e._parsed || parseWorkout(e.text || "")).totalVolume || 0), 0);
  const volumeTrend = (volume7 && volume7_olderHalf) ? volume7 - volume7_olderHalf : null;
  // Average session RPE over last 7 days (from parsed Strong RPE), if logged
  const rpe7vals = last7Lifts.map(e => (e._parsed || parseWorkout(e.text || "")).avgRPE).filter(v => v != null);
  const avgRPE7 = rpe7vals.length ? +(rpe7vals.reduce((a, b) => a + b, 0) / rpe7vals.length).toFixed(1) : null;
  const trainingDates = new Set([...data.exercise.map(e => e.date), ...data.sports.map(s => s.date)]);
  let consecutiveTrained = 0;
  {
    let cur = new Date(); if (!trainingDates.has(getTodayStr())) cur.setDate(cur.getDate() - 1);
    for (;;) { const ds = localDateStr(cur); if (trainingDates.has(ds)) { consecutiveTrained++; cur.setDate(cur.getDate() - 1); } else break; }
  }
  const daysSinceLastRest = (() => {
    let c = 0; const cur = new Date();
    for (let i = 0; i < 14; i++) {
      const ds = localDateStr(cur);
      if (trainingDates.has(ds)) c++; else return c;
      cur.setDate(cur.getDate() - 1);
    }
    return c;
  })();
  const recentPRs = last14Lifts.flatMap(e => (e.prs || []).map(pr => ({ date: e.date, ...pr }))).slice(0, 5);

  // ── WATER PATTERNS
  const last7Water = last7(data.water);
  const waterByDay7 = {};
  last7Water.forEach(w => { waterByDay7[w.date] = (waterByDay7[w.date] || 0) + w.ml; });
  const avgWaterMl7 = Object.values(waterByDay7).length ? Math.round(Object.values(waterByDay7).reduce((a, b) => a + b, 0) / Object.values(waterByDay7).length) : null;

  // ── STREAK
  const dayHas = {};
  [...data.diet, ...data.sleep, ...data.exercise, ...data.sports, ...data.water, ...data.supplements].forEach(e => { if (e.date) dayHas[e.date] = true; });
  let streak = 0;
  {
    let cur = new Date(); if (!dayHas[getTodayStr()]) cur.setDate(cur.getDate() - 1);
    for (;;) { const ds = localDateStr(cur); if (dayHas[ds]) { streak++; cur.setDate(cur.getDate() - 1); } else break; }
  }

  // ── CROSS-CATEGORY PATTERNS
  // Sleep-on-training-day vs rest-day
  const trainNightSleep = last7Sleep.filter(s => trainingDates.has(s.date));
  const restNightSleep = last7Sleep.filter(s => !trainingDates.has(s.date));
  const trainNightAvg = trainNightSleep.length ? +(trainNightSleep.reduce((a, s) => a + s.duration, 0) / trainNightSleep.length).toFixed(1) : null;
  const restNightAvg = restNightSleep.length ? +(restNightSleep.reduce((a, s) => a + s.duration, 0) / restNightSleep.length).toFixed(1) : null;

  // ── WEIGHT TREND (A1 engine)
  const weightTrend = computeWeightTrend(data);

  // ── PROTEIN DISTRIBUTION / MPS (B1 engine)
  const proteinDist = computeProteinDistribution(data, goals);

  // ── RECOVERY (D1 engine — now fed to the Coach, not just the Plan card)
  const recovery = computeRecovery(data, goals);

  // ── ENERGY BALANCE / ADAPTIVE TDEE
  const energy = computeEnergyBalance(data, goals);

  // ── TRAINING INTELLIGENCE (per-lift progression + per-muscle volume)
  const training = computeTraining(data, goals);

  // ── SKIN INTELLIGENCE (separate lens — kept out of the physiology insight pool)
  const skin = computeSkin(data, goals);
  const carbTiming = computeCarbTiming(data, goals);
  const _sw = sleepWindow(data);
  const fuelPlan = planFueling({ sessions: (data.plannedSessions || []).filter(s => s.date === getTodayStr()), weightKg: goals && goals.profile && goals.profile.weightKg, goals, wakeMin: _sw.wakeMin, sleepMin: _sw.sleepMin });
  const fuelStatus = (fuelPlan && fuelPlan.blocks) ? reconcileFueling({ plan: fuelPlan, meals: (data.diet || []).filter(d => d.date === getTodayStr()), nowMin: new Date().getHours() * 60 + new Date().getMinutes() }) : null;

  // ── EJAC (private metric — neutral data only, NO insights/judgments generated)
  const ejacAll = data.ejac || [];
  const ejac30 = ejacAll.filter(e => e.date >= daysAgo(29));
  const ejacSummary = ejacAll.length ? {
    last7: ejacAll.filter(e => e.date >= daysAgo(6)).length,
    last30: ejac30.length,
    avgPerDay30: +(ejac30.length / 30).toFixed(2),
    pornPct30: ejac30.length ? Math.round(ejac30.filter(e => e.porn).length / ejac30.length * 100) : 0,
    goonPct30: ejac30.length ? Math.round(ejac30.filter(e => e.gooning).length / ejac30.length * 100) : 0,
  } : null;

  // ── DERIVED INSIGHTS — high-signal flags
  // Insights are now { text, priority: "critical" | "important" | "notable" }
  // Critical = recovery is at risk or strategy is broken; Important = clear pattern worth acting on;
  // Notable = mention only if the user's question is in that area.
  const insights = [];
  const wins = []; // things going well — used to reinforce positive behavior

  // --- CRITICAL: recovery / safety / strategy breaks ---
  if (consecutiveTrained >= 5) insights.push({ text: `Trained ${consecutiveTrained} days in a row with no rest — overtraining risk, deload strongly suggested`, priority: "critical" });
  else if (consecutiveTrained >= 4) insights.push({ text: `Trained ${consecutiveTrained} days in a row with no rest — deload signal`, priority: "important" });
  if (sleepDebt7 > 8) insights.push({ text: `Sleep debt accumulating fast: ${sleepDebt7.toFixed(1)}h short over last week — recovery compromised`, priority: "critical" });
  else if (sleepDebt7 > 5) insights.push({ text: `Sleep debt: ${sleepDebt7.toFixed(1)}h short over last week`, priority: "important" });
  if (sleepPatternIssue) insights.push({ text: `Avg sleep ${avgSleep7}h is below your ~${sleepNeed}h need — recovery limiter`, priority: avgSleep7 < sleepNeed - 1.5 ? "critical" : "important" });
  // Sleep Intelligence Engine — fold in the NEW dimensions (regularity, continuity,
  // disorder screening, cross-domain coupling) that the legacy sleep insights above
  // don't cover. Quantity is already handled above, so skip those to avoid dupes.
  if (sleepIntel) {
    sleepIntel.insights.filter(i => i.axis !== "quantity").forEach(i => insights.push({ text: i.text, priority: i.priority }));
  }
  // Adaptive TDEE / energy-balance insights (real maintenance, deficit/surplus, plateau, under-logging)
  if (energy && energy.ready) energy.insights.forEach(i => insights.push(i));
  // Training intelligence insights (stalls, neglected muscles, imbalances, progress)
  if (training) training.insights.forEach(i => insights.push(i));

  // --- IMPORTANT: nutrition and trend issues ---
  if (calDeficit7 != null && Math.abs(calDeficit7) > 400) {
    insights.push({ text: `7-day avg calories ${avgCal7} is ${Math.abs(calDeficit7)}kcal ${calDeficit7 > 0 ? "BELOW" : "ABOVE"} target — large gap from plan`, priority: "important" });
  } else if (calDeficit7 != null && Math.abs(calDeficit7) > 200) {
    insights.push({ text: `7-day avg calories ${avgCal7} is ${Math.abs(calDeficit7)}kcal ${calDeficit7 > 0 ? "below" : "above"} target`, priority: "notable" });
  }
  if (avgP7 != null && goals.protein && avgP7 < goals.protein * 0.75) {
    insights.push({ text: `Protein well below target: ${avgP7}g avg vs ${goals.protein}g target (${proteinHits7}/${dietDays7.length} days hit goal)`, priority: "important" });
  } else if (avgP7 != null && goals.protein && avgP7 < goals.protein * 0.85) {
    insights.push({ text: `Protein consistently a bit low: ${avgP7}g avg vs ${goals.protein}g target`, priority: "notable" });
  }
  if (calorieTrend != null && Math.abs(calorieTrend) > 300) {
    insights.push({ text: `Calorie intake ${calorieTrend > 0 ? "rising" : "falling"} sharply: ${calorieTrend > 0 ? "+" : ""}${calorieTrend}kcal/day vs prev week`, priority: "important" });
  }
  if (volumeTrend != null && Math.abs(volumeTrend) > 2000) {
    insights.push({ text: `Training volume ${volumeTrend > 0 ? "UP" : "DOWN"} ${Math.round(Math.abs(volumeTrend)).toLocaleString()}kg vs previous week`, priority: "important" });
  }
  if (last7TotalSessions === 0 && plan?.trainingDays?.length) {
    insights.push({ text: `No training in 7 days despite ${plan.trainingDays.length}-day/week plan`, priority: "important" });
  }
  if (avgWaterMl7 != null && goals.waterGoalMl && avgWaterMl7 < goals.waterGoalMl * 0.6) {
    insights.push({ text: `Hydration low: avg ${avgWaterMl7}ml/day vs ${goals.waterGoalMl}ml target`, priority: "important" });
  }

  // --- weight trend vs intent (only once there's enough signal) ---
  if (weightTrend && weightTrend.confidence !== "Low" && weightTrend.ratePerWeekG != null) {
    const pct = weightTrend.pctBWPerWeek;
    const goalLower = (goals.goal || "").toLowerCase();
    const phase = (goals.strategy?.phase || "").toLowerCase();
    const wantGain = goalLower.includes("muscle") || /bulk|surplus|gain/.test(phase);
    const wantLose = goalLower.includes("fat") || goalLower.includes("lose") || /cut|deficit/.test(phase);
    const rateStr = `${weightTrend.ratePerWeekG > 0 ? "+" : ""}${weightTrend.ratePerWeekG}g/wk`;
    if (wantGain && weightTrend.direction !== "gaining") {
      insights.push({ text: `Goal is to build muscle but trend weight is ${weightTrend.direction} (${rateStr}) — not the surplus the plan assumes; recheck intake vs true maintenance`, priority: "important" });
    } else if (wantLose && weightTrend.direction !== "losing") {
      insights.push({ text: `Goal is fat loss but trend weight is ${weightTrend.direction} (${rateStr}) — the intended deficit isn't translating to weight change`, priority: "important" });
    }
    if (pct != null && pct > 1.0) insights.push({ text: `Gaining fast: trend +${pct}%BW/wk, above the ~0.25–0.5%/wk lean-gain range — more of this is likely fat than muscle`, priority: "notable" });
    if (pct != null && pct < -1.2) insights.push({ text: `Losing fast: trend ${pct}%BW/wk — aggressive enough to risk muscle loss; a smaller deficit may protect lean mass`, priority: "notable" });
  }

  // --- protein distribution / MPS (B1 — no new data needed) ---
  if (proteinDist && proteinDist.confidence !== "Low") {
    const pd = proteinDist;
    const hittingTotal = pd.proteinGoal && pd.avgProtein >= pd.proteinGoal * 0.9;
    if (hittingTotal && pd.avgEffective < 3) {
      insights.push({ text: `Protein TOTAL is on point (${pd.avgProtein}g/day) but distribution isn't: only ${pd.avgEffective} of your meals/day cross the ~${pd.perMeal}g MPS threshold (aim 3–5). Same protein, more growth stimulus if you shift some earlier.`, priority: "important" });
    } else if (pd.avgEffective < 3 && pd.daysWithMeals >= 4) {
      insights.push({ text: `Few MPS-effective protein feedings: ${pd.avgEffective}/day cross ~${pd.perMeal}g (aim 3–5)`, priority: "notable" });
    }
    if (pd.avgSkew != null && pd.avgSkew >= 50) insights.push({ text: `Protein skewed: ~${pd.avgSkew}% of the day's protein lands in one meal — spreading it raises total daily MPS`, priority: "notable" });
    if (pd.avgLargestGap != null && pd.avgLargestGap >= 6) insights.push({ text: `Long protein gaps: ~${pd.avgLargestGap}h between feedings on average — a mid-gap feeding keeps MPS elevated`, priority: "notable" });
    if (pd.preEligibleDays >= 3 && pd.preOKDays / pd.preEligibleDays < 0.4) insights.push({ text: `Rarely a protein feeding near bedtime (${pd.preOKDays}/${pd.preEligibleDays} nights) — a ~30–40g pre-sleep dose may support overnight recovery`, priority: "notable" });
  }

  // --- NOTABLE: contextual patterns the AI should mention if relevant ---
  if (avgLastMeal && minsOf(avgLastMeal) > 21 * 60) insights.push({ text: `Eating late: avg last meal at ${avgLastMeal} — may affect sleep quality`, priority: "notable" });
  if (trainNightAvg != null && restNightAvg != null && Math.abs(trainNightAvg - restNightAvg) > 0.8) {
    insights.push({ text: `Sleep ${trainNightAvg > restNightAvg ? "BETTER" : "WORSE"} on training nights (${trainNightAvg}h vs ${restNightAvg}h on rest nights)`, priority: "notable" });
  }
  if (wkdayAvgSleep != null && wkendAvgSleep != null && Math.abs(wkdayAvgSleep - wkendAvgSleep) > 1.5) {
    insights.push({ text: `Weekend sleep ${wkendAvgSleep > wkdayAvgSleep ? "much longer" : "much shorter"} than weekdays (${wkdayAvgSleep}h vs ${wkendAvgSleep}h) — circadian disruption`, priority: "notable" });
  }

  // --- WINS: reinforce what's working ---
  if (avgP7 != null && goals.protein && avgP7 >= goals.protein * 0.95 && dietDays7.length >= 4) wins.push(`Protein dialed in: ${avgP7}g/day avg vs ${goals.protein}g target, ${proteinHits7}/${dietDays7.length} days on goal`);
  if (avgSleep7 != null && avgSleep7 >= 7.5) wins.push(`Sleep solid: ${avgSleep7}h/day avg`);
  if (last7TotalSessions >= (plan?.trainingDays?.length || 3) && plan?.trainingDays?.length) wins.push(`Training consistent: ${last7TotalSessions} sessions in the last 7 days`);
  if (recentPRs.length > 0) wins.push(`${recentPRs.length} recent PR${recentPRs.length === 1 ? "" : "s"}: ${recentPRs.slice(0, 2).map(p => `${p.name} ${p.weight}${p.unit}×${p.reps}`).join(", ")}`);
  if (streak >= 7) wins.push(`${streak}-day logging streak`);
  if (avgWaterMl7 != null && goals.waterGoalMl && avgWaterMl7 >= goals.waterGoalMl * 0.9) wins.push(`Hydration consistent: ${avgWaterMl7}ml/day avg`);
  if (weightTrend && weightTrend.confidence !== "Low" && weightTrend.pctBWPerWeek != null) {
    const pct = weightTrend.pctBWPerWeek, gl = (goals.goal || "").toLowerCase();
    if (gl.includes("muscle") && pct >= 0.15 && pct <= 0.6) wins.push(`Lean-gain pace dialed in: trend +${pct}%BW/wk`);
    if ((gl.includes("fat") || gl.includes("lose")) && pct <= -0.4 && pct >= -1.0) wins.push(`Fat-loss pace dialed in: trend ${pct}%BW/wk`);
  }
  if (proteinDist && proteinDist.confidence !== "Low" && proteinDist.avgEffective >= 3.5 && proteinDist.daysWithMeals >= 4) {
    wins.push(`Protein distribution dialed: ~${proteinDist.avgEffective} MPS-effective feedings/day`);
  }

  return {
    // Real-time awareness
    now: { iso: now.toISOString(), date: today, dayName: todayName, time: timeNow, hour, timeOfDay, isWeekend },
    circadian: (() => {      const c = computeCircadian(data, today);
      const bio = todaysBioNutrition(data.diet, c);
      return {
        ready: c.ready, tier: c.tier, confidence: c.confidence,
        biologicalDayStart: c.biologicalDayStart, biologicalDayEnd: c.biologicalDayEnd,
        avgSleepTime: c.avgSleepTime, avgWakeTime: c.avgWakeTime, sleepConsistency: c.sleepConsistency,
        bioDayNutrition: c.ready ? { calories: bio.calories, protein: bio.protein, carbs: bio.carbs, fat: bio.fat, meals: bio.meals } : null,
      };
    })(),
    weeklyVolume: (() => {
      const v = computeVolume(data, goals, today);
      if (!v.ready) return null;
      return {
        weekStart: v.weekStart,
        belowTarget: v.muscles.filter(m => m.target && m.thisWeek < m.target).map(m => ({ muscle: m.label, sets: m.thisWeek, target: m.target })),
        weakPoints: v.weakPoints.map(w => ({ muscle: w.label, sets: w.sets })),
        highest: v.summary.highest, lowest: v.summary.lowest, totalSets: v.summary.totalSets, musclesTrained: v.summary.musclesTrained,
        push: v.balance.push, pull: v.balance.pull, upper: v.balance.upper, lower: v.balance.lower,
      };
    })(),
    goal: goals.goal,
    targets: { calories: goals.calories, protein: goals.protein, carbs: goals.carbs, fat: goals.fat, waterMl: goals.waterGoalMl },
    todayProgress: {
      cal: todayCal, protein: todayP, carbs: todayC, fat: todayF,
      calRemaining, pRemaining, cRemaining, fRemaining,
      waterMl: todayWaterMl, waterRemainingMl,
      supplements: todaySupps.map(s => `${s.name}${s.dose ? ` (${s.dose})` : ""}`),
      sleep: todaySleep ? { duration: todaySleep.duration, quality: todaySleep.quality, bedtime: todaySleep.bedtime, wakeTime: todaySleep.wakeTime } : null,
      yesterdaySleep: yestSleep ? { duration: yestSleep.duration, quality: yestSleep.quality, bedtime: yestSleep.bedtime, wakeTime: yestSleep.wakeTime } : null,
      workoutLogged: !!todayWorkout, sportLogged: !!todaySport,
      meals: todayDiet.map(d => ({ time: d.time, meal: d.meal, food: d.food, cal: d.calories, p: d.protein })),
      lastMealTime, hoursSinceLastMeal,
    },
    plan: plan ? { split: plan.split, todayLabel: todayPlanLabel, tomorrowLabel: tomorrowPlanLabel, trainingDays: plan.trainingDays, isTrainingDay, tomorrowName } : null,
    timelines, // chronological event sequence for each of the last 7 days
    week: {
      avgCal: avgCal7, avgProtein: avgP7, proteinHitDays: proteinHits7, daysLogged: dietDays7.length,
      avgSleep: avgSleep7, sleepDebt: +sleepDebt7.toFixed(1),
      avgBedtime, avgWakeTime, wkdayAvgSleep, wkendAvgSleep,
      avgFirstMeal, avgLastMeal,
      sessions: last7TotalSessions, volumeKg: Math.round(volume7), volumeTrend, calorieTrend, avgRPE: avgRPE7,
      consecutiveTrained, daysSinceLastRest,
      recentPRs, streak,
      avgWaterMl: avgWaterMl7,
      trainNightSleep: trainNightAvg, restNightSleep: restNightAvg,
    },
    insights,
    topInsights: prioritizeInsights(insights).top,
    wins,
    weight: weightTrend,
    proteinDist,
    sleepIntel,
    sleepScreen: goals.sleepScreen || null,
    energy,
    training,
    skin,
    carbTiming,
    fuelPlan,
    fuelStatus,
    recovery: {
      verdict: recovery.verdict,
      readiness: recovery.readiness,
      limiter: recovery.limiter,
      plannedToday: recovery.plannedToday,
      todayLabel: recovery.todayLabel,
      topNeg: recovery.reasons.filter(r => r.dir === "neg").slice(0, 4).map(r => r.text),
    },
    ejac: ejacSummary,
    profile: goals.profile || {},
    strategy: goals.strategy || {},
    nicotine: (() => {
      if (!data.nicotine || data.nicotine.length === 0) return null;
      const ns = computeNicotineStats(data);
      const plans = (data.nicotinePlans || []).filter(p => p.when && new Date(p.when) >= new Date(Date.now() - 3600000))
        .sort((a, b) => a.when.localeCompare(b.when)).slice(0, 3);
      return {
        today: ns.today.count, avg7: ns.avgCount7, mg7: ns.avg7, mg30: ns.avg30,
        last7: ns.w7.count, last30: ns.w30.count,
        types: ns.typeTotals, topContexts: ns.topContexts.map(([c]) => c),
        plannedSessions: plans.map(p => ({ when: p.when, label: p.label })),
      };
    })(),
    journal: (() => {
      const j = (data.journal || []).filter(e => e.date >= daysAgo(13)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      if (!j.length) return null;
      // Keep it bounded: most recent ~8 entries, trimmed.
      return j.slice(0, 8).map(e => ({ date: e.date, text: e.text.length > 280 ? e.text.slice(0, 280) + "…" : e.text }));
    })(),
  };
}

export function formatBrainText(brain) {
  const tp = brain.todayProgress;
  const w = brain.week;
  const n = brain.now;
  const lines = [];

  // ─── RIGHT NOW ────────────────────────────────────────────────────────────
  // The model is trained to hedge about real-time access by default. Tell it
  // explicitly that this block is authoritative.
  lines.push(`== RIGHT NOW (current real-time clock from user's device — this is authoritative; never claim you don't know what time/day it is) ==`);
  lines.push(`Date: ${n.date} (${n.dayName}${n.isWeekend ? ", weekend" : ""}) | Time: ${n.time} (${n.timeOfDay}) | Local ISO: ${n.iso}`);
  lines.push(`Goal: ${brain.goal}`);
  lines.push(`Targets — ${brain.targets.calories}kcal | P${brain.targets.protein}g C${brain.targets.carbs}g F${brain.targets.fat}g | water ${brain.targets.waterMl}ml`);
  if (brain.plan) {
    lines.push(`Plan: ${brain.plan.split} | Today: ${brain.plan.todayLabel} | Tomorrow (${brain.plan.tomorrowName}): ${brain.plan.tomorrowLabel} | Training days: ${brain.plan.trainingDays.join(", ")}`);
  }
  if (brain.circadian && brain.circadian.ready) {
    const cc = brain.circadian;
    lines.push(`Biological day (Calculated, ${cc.confidence} confidence): runs ${cc.biologicalDayStart} → ${cc.biologicalDayEnd} (avg sleep ${cc.avgSleepTime}, wake ${cc.avgWakeTime}, consistency ${cc.sleepConsistency}/100). Late-night meals before ${cc.biologicalDayEnd} count toward the prior day. Prefer biological-day totals over calendar days.${cc.bioDayNutrition ? ` This biological day so far: ${cc.bioDayNutrition.calories}kcal, ${cc.bioDayNutrition.protein}g protein across ${cc.bioDayNutrition.meals} meals.` : ""}`);
  }
  if (brain.weeklyVolume) {
    const wv = brain.weeklyVolume;
    const bt = wv.belowTarget.length ? ` Below goal-plan target: ${wv.belowTarget.map(b => `${b.muscle} ${b.sets}/${b.target}`).join(", ")}.` : "";
    const wk = wv.weakPoints.length ? ` Low/untrained (<6 sets): ${wv.weakPoints.slice(0, 4).map(w => `${w.muscle} ${w.sets}`).join(", ")}.` : "";
    lines.push(`Weekly muscle volume (Estimated, Mon–Sun hard sets): ${wv.totalSets} total across ${wv.musclesTrained}/28 muscles${wv.highest ? `, most ${wv.highest.label} (${wv.highest.sets})` : ""}. Volume balance — push ${wv.push} / pull ${wv.pull}, upper ${wv.upper} / lower ${wv.lower}.${bt}${wk} Reference this when the user asks about training volume or weak points; note these set→muscle counts are estimates.`);
  }

  // ─── ABOUT THE USER (profile + strategy) ─────────────────────────────────
  // These are facts the user has explicitly told their coach. Reference and respect them.
  const p = brain.profile || {};
  const s = brain.strategy || {};
  const profileBits = [];
  if (p.sex) profileBits.push(p.sex);
  if (p.age) profileBits.push(`${p.age}y`);
  if (p.heightCm) profileBits.push(`${p.heightCm}cm`);
  if (p.weightKg) profileBits.push(`${p.weightKg}kg`);
  if (p.trainingExp) profileBits.push(`${p.trainingExp} lifter`);
  const hasProfile = profileBits.length || p.injuries || p.allergies || p.equipment || p.preferences || p.lifeContext || p.liftingBackground;
  if (hasProfile) {
    lines.push("");
    lines.push("== ABOUT THE USER ==");
    if (profileBits.length) lines.push(`Body: ${profileBits.join(", ")}`);
    if (p.liftingBackground) lines.push(`Lifting background (historical, not current strategy):\n${p.liftingBackground}`);
    if (p.injuries) lines.push(`Injuries / limitations: ${p.injuries}  ← respect these. Avoid suggesting movements that conflict.`);
    if (p.allergies) lines.push(`Food allergies / restrictions: ${p.allergies}  ← never recommend foods on this list.`);
    if (p.equipment) lines.push(`Equipment access: ${p.equipment}`);
    if (p.preferences) lines.push(`Preferences: ${p.preferences}`);
    if (p.lifeContext) lines.push(`Current life context: ${p.lifeContext}  ← factor this into expectations and advice.`);
  }
  const hasStrategy = s.phase || s.focus || s.blockStarted || s.notes;
  if (hasStrategy) {
    lines.push("");
    lines.push("== CURRENT STRATEGY ==");
    const bits = [];
    if (s.phase) bits.push(`Phase: ${s.phase}`);
    if (s.focus) bits.push(`Focus: ${s.focus}`);
    if (s.blockStarted && s.blockWeeks) {
      // Compute which week of the block we're in
      const startMs = new Date(s.blockStarted + "T00:00:00").getTime();
      const weeksIn = Math.max(1, Math.floor((Date.now() - startMs) / (7 * 86400000)) + 1);
      bits.push(`Block: week ${weeksIn} of ${s.blockWeeks}`);
    } else if (s.blockStarted) {
      bits.push(`Block started: ${s.blockStarted}`);
    }
    if (bits.length) lines.push(bits.join(" | "));
    if (s.notes) lines.push(`Strategy notes: ${s.notes}`);
    lines.push(`Evaluate progress AGAINST this strategy — not in a vacuum.`);
  }

  // ─── TODAY SO FAR ─────────────────────────────────────────────────────────
  lines.push("");
  lines.push(`== TODAY SO FAR (${n.date} only — counts ONLY events dated ${n.date}, never yesterday) ==`);
  lines.push(`Nutrition consumed today: ${tp.cal}/${brain.targets.calories} kcal (${tp.calRemaining >= 0 ? tp.calRemaining + " remaining today" : Math.abs(tp.calRemaining) + " OVER today's target"}) | P ${tp.protein}/${brain.targets.protein}g (${tp.pRemaining > 0 ? tp.pRemaining + "g to go" : "hit"}) | C ${tp.carbs}g | F ${tp.fat}g`);
  lines.push(`Water today: ${tp.waterMl}/${brain.targets.waterMl}ml (${tp.waterRemainingMl > 0 ? tp.waterRemainingMl + "ml to go" : "hit"})`);
  if (tp.supplements.length) lines.push(`Supplements today: ${tp.supplements.join(", ")}`);
  if (tp.sleep) lines.push(`Slept last night: ${tp.sleep.duration}h (${tp.sleep.quality})${tp.sleep.bedtime ? `, ${tp.sleep.bedtime}→${tp.sleep.wakeTime}` : ""}`);
  else if (tp.yesterdaySleep) lines.push(`Most recent sleep log: ${tp.yesterdaySleep.duration}h (${tp.yesterdaySleep.quality}) — note: nothing logged for last night yet`);
  if (tp.workoutLogged) lines.push(`✓ Workout logged today`);
  if (tp.sportLogged) lines.push(`✓ Sport logged today`);
  if (tp.lastMealTime) lines.push(`Last meal today: ${tp.lastMealTime}${tp.hoursSinceLastMeal != null ? ` (${tp.hoursSinceLastMeal}h ago)` : ""}`);
  else lines.push(`No meals logged for today yet.`);

  // ─── KEY SIGNALS — ranked top priorities, then the rest grouped by tier ─────
  const topInsights = brain.topInsights || [];
  const topTexts = new Set(topInsights.map(i => i.text));
  const rest = brain.insights.filter(i => !topTexts.has(i.text));
  const critical = rest.filter(i => i.priority === "critical");
  const important = rest.filter(i => i.priority === "important");
  const notable = rest.filter(i => i.priority === "notable");
  if (topInsights.length || critical.length || important.length || notable.length) {
    lines.push("");
    lines.push("== KEY SIGNALS ==");
    if (topInsights.length) {
      lines.push("TOP PRIORITIES (ranked highest-leverage first — lead with #1 unless the user asks about something else):");
      topInsights.forEach((i, n) => lines.push(`  ${n + 1}. ${i.text}`));
    }
    if (critical.length) {
      lines.push("Other CRITICAL (address even if not asked):");
      critical.forEach(i => lines.push("  • " + i.text));
    }
    if (important.length) {
      lines.push("Other IMPORTANT (lead with if relevant):");
      important.forEach(i => lines.push("  • " + i.text));
    }
    if (notable.length) {
      lines.push("Notable (mention if the user's question is in this area):");
      notable.forEach(i => lines.push("  • " + i.text));
    }
  }

  // ─── WINS — what's going well, reinforce when natural ────────────────────
  if (brain.wins?.length) {
    lines.push("");
    lines.push("== WINS (acknowledge briefly when relevant, don't force) ==");
    brain.wins.forEach(w => lines.push("  ✓ " + w));
  }

  // ─── 7-DAY OVERVIEW ───────────────────────────────────────────────────────
  lines.push("");
  lines.push("== 7-DAY OVERVIEW ==");
  lines.push(`Calories: ${w.avgCal ?? "—"} avg (target ${brain.targets.calories}) across ${w.daysLogged} logged days${w.calorieTrend != null ? ` | trend vs prev wk: ${w.calorieTrend > 0 ? "+" : ""}${w.calorieTrend}kcal/day` : ""}`);
  lines.push(`Protein: ${w.avgProtein ?? "—"}g avg, hit goal ${w.proteinHitDays}/${w.daysLogged} days`);
  lines.push(`Sleep: ${w.avgSleep ?? "—"}h avg, debt ${w.sleepDebt}h${w.avgBedtime ? ` | avg bedtime ${w.avgBedtime}, wake ${w.avgWakeTime}` : ""}`);
  if (w.wkdayAvgSleep != null && w.wkendAvgSleep != null) {
    lines.push(`  Weekday sleep ${w.wkdayAvgSleep}h vs weekend ${w.wkendAvgSleep}h`);
  }
  if (w.trainNightSleep != null && w.restNightSleep != null) {
    lines.push(`  Sleep on training nights ${w.trainNightSleep}h vs rest nights ${w.restNightSleep}h`);
  }
  if (w.avgFirstMeal && w.avgLastMeal) {
    lines.push(`Meal timing: avg first meal ${w.avgFirstMeal}, avg last meal ${w.avgLastMeal} (eating window ~${meanGap(w.avgFirstMeal, w.avgLastMeal)}h)`);
  }
  lines.push(`Training: ${w.sessions} sessions | ${w.volumeKg.toLocaleString()}kg volume${w.volumeTrend != null ? ` (${w.volumeTrend > 0 ? "+" : ""}${w.volumeTrend.toLocaleString()}kg vs prev wk)` : ""} | ${w.consecutiveTrained}-day streak | ${w.daysSinceLastRest} days since rest`);
  if (w.avgRPE != null) lines.push(`Avg session RPE (last 7d): ${w.avgRPE}/10`);
  if (w.avgWaterMl != null) lines.push(`Water: ${w.avgWaterMl}ml/day avg`);
  if (w.recentPRs.length) lines.push(`Recent PRs: ${w.recentPRs.slice(0, 3).map(p => `${p.name} ${p.weight}${p.unit}×${p.reps} on ${p.date}`).join("; ")}`);
  lines.push(`Logging streak: ${w.streak} day${w.streak === 1 ? "" : "s"}`);

  // ─── BODYWEIGHT ───────────────────────────────────────────────────────────
  if (brain.weight) {
    const wt = brain.weight;
    lines.push("");
    lines.push("== BODYWEIGHT (trend weight is the smoothed line — it reflects real tissue change; the raw daily number is mostly water/glycogen/gut) ==");
    const rateStr = wt.ratePerWeekG != null
      ? `${wt.ratePerWeekG > 0 ? "+" : ""}${wt.ratePerWeekG}g/wk${wt.pctBWPerWeek != null ? ` (${wt.pctBWPerWeek > 0 ? "+" : ""}${wt.pctBWPerWeek}%BW/wk)` : ""}`
      : "rate not yet estimable";
    lines.push(`Trend weight: ${wt.current}kg | latest scale: ${wt.latestRaw}kg (${wt.latestDate}) | ${wt.nDays} weigh-ins over ${wt.spanDays}d | confidence: ${wt.confidence}`);
    lines.push(`Direction: ${wt.direction} — ${rateStr}`);
    if (Math.abs(wt.divergence) >= 0.6) {
      lines.push(`Note: latest scale reading is ${wt.divergence > 0 ? "above" : "below"} the trend by ${Math.abs(wt.divergence)}kg — likely water/glycogen, not real tissue change. Judge progress by the trend, not the daily number.`);
    }
    lines.push(`Use the TREND weight + rate for any energy-balance reasoning.${wt.confidence === "Low" ? " Confidence is Low (few weigh-ins) — treat the rate as provisional and avoid strong conclusions." : ""}`);
  }

  // ─── PROTEIN DISTRIBUTION (MPS) ───────────────────────────────────────────
  if (brain.proteinDist) {
    const pd = brain.proteinDist;
    lines.push("");
    lines.push("== PROTEIN DISTRIBUTION / MPS (distribution is a SEPARATE lever from daily total — 3–5 feedings each crossing the per-meal threshold beats the same protein skewed into 1–2 meals) ==");
    lines.push(`Per-meal MPS threshold: ~${pd.perMeal}g (${pd.bw ? `0.4g/kg × ${pd.bw}kg` : "default — no bodyweight set"}) | avg effective feedings/day: ${pd.avgEffective} (target 3–5) | avg daily protein: ${pd.avgProtein}g${pd.proteinGoal ? ` (goal ${pd.proteinGoal}g, hit ${pd.goalHitDays}/${pd.daysWithMeals}d)` : ""} | confidence: ${pd.confidence}`);
    if (pd.avgSkew != null) lines.push(`Skew: ~${pd.avgSkew}% of daily protein in the single biggest meal${pd.avgLargestGap != null ? ` | avg largest gap between feedings: ${pd.avgLargestGap}h` : ""}`);
    if (pd.preEligibleDays >= 1) lines.push(`Pre-sleep protein: ${pd.preOKDays}/${pd.preEligibleDays} nights had a ≥20g feeding within 3h of bedtime`);
    lines.push(`When advising on protein, treat DISTRIBUTION (per-meal dose + timing) separately from total grams — if the total is already met, the lever is spreading it, not "eat more protein".${pd.confidence === "Low" ? " Confidence Low (few logged days) — keep it gentle." : ""}`);
  }

  // ─── RECOVERY ─────────────────────────────────────────────────────────────
  if (brain.recovery) {
    const rc = brain.recovery;
    const vlabel = rc.verdict === "go" ? "good to train" : rc.verdict === "caution" ? "train with caution" : "rest";
    lines.push("");
    lines.push("== RECOVERY (today's training readiness) ==");
    lines.push(`Verdict: ${vlabel} | readiness: ${rc.readiness}/100 | plan today: ${rc.plannedToday ? rc.todayLabel : "rest day"}`);
    if (rc.limiter) {
      lines.push(`#1 LIMITER right now: ${rc.limiter.label}${rc.limiter.topReason ? ` — ${rc.limiter.topReason}` : ""}. If recovery comes up, name THIS specific bottleneck rather than generic "rest more" advice.`);
      const others = (rc.topNeg || []).filter(t => t !== rc.limiter.topReason).slice(0, 3);
      if (others.length) lines.push(`Other drags on recovery: ${others.join("; ")}`);
    } else {
      lines.push(`Nothing is meaningfully limiting recovery right now — fine to train as planned.`);
    }
  }

  // ─── SLEEP (the intelligence engine — three axes + cross-domain coupling) ──
  if (brain.sleepIntel) {
    const sl = brain.sleepIntel;
    const q = sl.quantity, r = sl.regularity, c = sl.continuity;
    lines.push("");
    lines.push("== SLEEP (modelled as 3 separate problems: quantity vs the user's OWN need, regularity/timing, and continuity/quality — never assume 8h is their target) ==");
    lines.push(`Personal sleep need: ${sl.need.hours}h (${sl.need.source}${sl.need.source === "learned" ? `, from ${sl.need.nGood} best nights` : ""}) | overall confidence: ${sl.confidence}`);
    lines.push(`Quantity: avg ${q.avgTST7 ?? "—"}h asleep/night (7d) vs ${q.need}h need — ${q.label}${q.debt7 > 0.5 ? `, ~${q.debt7}h debt this week` : ""}`);
    if (r.status) lines.push(`Regularity: ${r.label} (mid-sleep varies ±${r.midSD}min${r.socialJetlag != null ? `, social jetlag ${r.socialJetlag}h` : ""})${r.anchorWake ? ` | their anchor wake time ≈ ${r.anchorWake}` : ""}`);
    if (c.status) lines.push(`Continuity/quality: ${c.label}${c.avgEff != null ? ` (efficiency ${c.avgEff}%)` : ""}${c.avgLatency != null ? `, ~${c.avgLatency}min to fall asleep` : ""}${c.unrefreshing ? " — UNREFRESHING-SLEEP flag (enough hours, poor quality; possible disorder — encourage a clinician check, do NOT diagnose)" : ""}`);
    if (sl.coupling.length) {
      lines.push(`How sleep is shaping the rest of their body (correlations from their own data — never state as proven causation):`);
      sl.coupling.forEach(co => lines.push(`  • ${co.text}`));
    }
    if (sl.topLever) lines.push(`Biggest sleep lever right now: ${sl.topLever.text}`);
    if (brain.sleepScreen?.risk && brain.sleepScreen.risk.band !== "low") {
      const sk = brain.sleepScreen.risk;
      lines.push(`Sleep screen flagged: ${sk.osaCluster ? "possible OSA cluster; " : ""}${sk.insomniaCluster ? "insomnia pattern (CBT-I-treatable); " : ""}${sk.rls ? "restless-legs symptoms; " : ""}worth a clinician conversation. Reference supportively if sleep comes up; never diagnose.`);
    }
    lines.push(`SLEEP COACHING RULES: Treat the three axes as separate levers. If total sleep is fine but timing is irregular, the fix is regularity, not "sleep more". Anchor a fixed wake time as the #1 move. Do not chase sleep-stage/deep-sleep numbers (unreliable). Under a deficit, frame sleep as a muscle-retention tool.`);
  }

  // ─── ENERGY BALANCE / ADAPTIVE TDEE ───────────────────────────────────────
  if (brain.energy) {
    const en = brain.energy;
    lines.push("");
    if (!en.ready) {
      lines.push("== ENERGY BALANCE / TDEE ==");
      lines.push(`Not enough data to measure maintenance yet: ${en.reason} Do NOT estimate their TDEE from a formula or guess — say it's still being measured from their logs.`);
    } else {
      lines.push("== ENERGY BALANCE / TDEE (measured from their OWN intake + weight trend — this is real, not a Mifflin estimate) ==");
      lines.push(`Measured maintenance: ~${en.tdee} kcal/day | confidence: ${en.confidence} (${en.loggedDays} logged days, ${Math.round(en.completeness * 100)}% complete) | their target: ${en.currentTarget ?? "—"}`);
      lines.push(`At ~${en.meanIntake} kcal/day they're in a real ${en.realDelta < 0 ? `deficit of ~${Math.abs(en.realDelta)}` : en.realDelta > 0 ? `surplus of ~${en.realDelta}` : "neutral balance"}/day | trend weight ${en.weightRateKgWk > 0 ? "+" : ""}${en.weightRateKgWk}kg/wk | suggested intake for ${en.intent}: ~${en.recommendedIntake}`);
      if (en.underLogging) lines.push(`⚠ UNDER-LOGGING SUSPECTED: measured maintenance is implausibly low — their food logs are probably incomplete. Gently flag this; don't trust the deficit until logging tightens.`);
      if (en.plateau) lines.push(`PLATEAU: fat loss has stalled despite an apparent deficit — adaptation or under-logging. Reference this if they ask why the scale isn't moving.`);
      lines.push(`Use the MEASURED maintenance (not formulas) for any calorie-target advice. If their target and measured maintenance disagree, trust the measured number. Confidence ${en.confidence} — ${en.confidence === "Low" ? "treat as provisional and say so" : "solid enough to act on"}.`);
    }
  }

  // ─── TRAINING INTELLIGENCE (per-lift progression + per-muscle weekly volume) ─
  if (brain.training) {
    const tr = brain.training;
    lines.push("");
    lines.push("== TRAINING (progression = est-1RM trend per lift; volume = working sets/muscle/week. Progressive overload + weekly volume are the two evidence-based drivers. MEV/MAV/MRV landmark numbers are soft heuristics — guide with them, don't dictate) ==");
    if (tr.progression.lifts.length) {
      lines.push(`Lift progression (8wk): ${tr.progression.lifts.map(l => `${l.name} ${l.status}${l.status === "progressing" ? ` +${l.slopePct}%/wk` : ""} (~${l.e1rmNow}kg)`).join("; ")}`);
      if (tr.progression.stalls.length) lines.push(`STALLED/REGRESSING — needs a variable changed: ${tr.progression.stalls.map(l => l.name).join(", ")}. Suggest concrete fixes (add a set, change rep range + load, or deload), not generic "push harder".`);
    } else {
      lines.push(`Not enough repeated sessions yet to trend any single lift (need a lift logged 3+ times over 2+ weeks).`);
    }
    if (tr.week.trained.length) {
      lines.push(`This week's volume (working sets, fractional for secondary): ${tr.week.sortedVol.map(m => `${m.label} ${m.sets}`).join(", ")} — ${tr.week.sessions} sessions.`);
      if (tr.week.neglected.length) lines.push(`Under-trained majors (<6 sets): ${tr.week.neglected.join(", ")}.`);
      if (tr.week.imbalances.length) lines.push(`Imbalance: ${tr.week.imbalances[0]}.`);
    }
    if (tr.week.unmapped.length) lines.push(`Couldn't map these lifts to muscles (name didn't match): ${tr.week.unmapped.slice(0, 5).join(", ")} — their volume isn't counted, so don't claim total-body volume is complete.`);
    lines.push(`TRAINING COACHING RULES: For a stall, the fix is a changed variable, not more effort. ~10–20 hard sets/muscle/week is the rough productive range for growth; treat it as guidance, not law. Volume landmarks are individual.`);
  }

  // ─── PERSONAL METRIC (EJAC) — neutral data only, with guardrails ──────────
  if (brain.ejac) {
    const e = brain.ejac;
    lines.push("");
    lines.push("== PERSONAL METRIC (EJAC) — private behavioral tracker ==");
    lines.push(`Last 7d: ${e.last7} sessions | last 30d: ${e.last30} (avg ${e.avgPerDay30}/day) | porn ${e.pornPct30}% | gooning ${e.goonPct30}%`);
    lines.push(`GUARDRAILS: This is a neutral self-tracked metric. Only discuss it if the user explicitly raises it. Do NOT moralize, pathologize, judge, congratulate, shame, or give unsolicited health/behavioral advice about it. If the user asks, report the numbers factually and matter-of-factly.`);
  }

  // ─── NICOTINE ─────────────────────────────────────────────────────────────
  if (brain.nicotine) {
    const nic = brain.nicotine;
    lines.push("");
    lines.push("== NICOTINE ==");
    lines.push(`Today: ${nic.today} entries | 7-day: ${nic.last7} entries (${nic.avg7}/day) | 30-day: ${nic.last30} entries`);
    lines.push(`Est. nicotine load: ${nic.mg7}mg/day (7d), ${nic.mg30}mg/day (30d)`);
    const typeBits = Object.entries(nic.types).filter(([, v]) => v > 0).map(([t, v]) => `${t} ${v}`);
    if (typeBits.length) lines.push(`Type mix (30d): ${typeBits.join(", ")}`);
    if (nic.topContexts.length) lines.push(`Common triggers: ${nic.topContexts.join(", ")}`);
    if (nic.plannedSessions.length) {
      lines.push(`PLANNED sessions (user told you in advance — treat as EXPECTED, do NOT nag about these; instead help protect training/sleep around them):`);
      nic.plannedSessions.forEach(p => {
        const d = new Date(p.when);
        lines.push(`  • ${p.label} — ${d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`);
      });
    }
    lines.push(`NICOTINE COACHING RULES: The user is NOT trying to quit (maybe reduce). Do not lecture or push abstinence. Your job is timing guidance — help them keep intake away from the ~1-2h before training, the post-workout recovery window, and the 1-2h before sleep, since those are when it most blunts gains and recovery. When you cite effects on their data, be honest these are correlations not proven causation. Never invent precise figures like "X% of gains lost".`);
  }

  // ─── JOURNAL — the user's own words, the context behind the numbers ───
  if (brain.journal?.length) {
    lines.push("");
    lines.push("== JOURNAL (recent notes in the user's own words — use these for context; reference them naturally when relevant, e.g. how they've been feeling, life stress, injuries, what they tried) ==");
    brain.journal.forEach(e => lines.push(`[${e.date}] ${e.text}`));
    lines.push(`(These are personal reflections. Weigh them alongside the data — if they wrote they're stressed or hurt, factor that into recovery expectations. Don't quote them back verbatim unless it helps; weave the context in.)`);
  }


  // ─── DAY-BY-DAY TIMELINES — the chronological "map" the user asked for ───
  // For each of the last 7 days, list every event in order. Lets the model
  // see meal-to-workout gaps, late dinners, training-after-poor-sleep, etc.
  if (brain.timelines?.length) {
    lines.push("");
    lines.push("== DAY-BY-DAY TIMELINE (last 7 days, chronological) ==");
    lines.push("Each day shows events as they happened. Look for cross-category patterns: meal timing vs sleep, training vs energy intake, water gaps, etc.");
    brain.timelines.forEach(day => {
      if (!day.events.length) {
        lines.push(`${day.date} (${day.dayName}): no logs`);
        return;
      }
      lines.push(`${day.date} (${day.dayName}):`);
      day.events.forEach(e => {
        lines.push(`  ${e.t}  ${e.text}`);
      });
    });
  }

  // ─── FUEL PLAN (today's planned sessions → timed carb/protein targets) ────
  if (brain.fuelPlan && brain.fuelPlan.blocks && brain.fuelPlan.blocks.length) {
    const fp = brain.fuelPlan;
    lines.push("");
    lines.push("== TODAY'S FUEL PLAN (the user has planned sessions today; this is their periodized fuelling target. Honest: evidence-based starting points scaled to bodyweight + load, not exact truth — adjust by performance/gut. Help them follow or adapt it; for weight-cut/boxing defer to individual guidance) ==");
    lines.push(`Load: ${fp.loadLevel} → ~${fp.gPerKg} g/kg = ${fp.dailyCarbs}g carbs, ${fp.dailyProtein}g protein (~${fp.dailyCalories} kcal). Sessions: ${fp.sessions.map(s => `${s.label} ${s.time} ${s.durMin}min ${s.intensity}`).join("; ")}.`);
    lines.push("Timeline: " + fp.blocks.map(b => `${b.time} ${b.label} ${b.carbsG}gC${b.proteinG ? `/${b.proteinG}gP` : ""}`).join(" | "));
    if (brain.fuelStatus) {
      const fs = brain.fuelStatus;
      lines.push(`So far today: ${fs.consumedCarbs}g carbs / ${fs.consumedProtein}g protein eaten; ${fs.carbsLeft}g carbs + ${fs.proteinLeft}g protein still to go. Status: ${fs.status}. ${fs.advice}`);
    }
  }

  // ─── CARB TIMING (diet × training; honest — daily total dominates) ───────
  if (brain.carbTiming && brain.carbTiming.analyzed > 0) {
    const ct = brain.carbTiming;
    lines.push("");
    lines.push("== CARB TIMING (peri-workout carbs. HONESTY RULES: total daily carbs/protein dominate recovery & growth; the post-workout 'anabolic window' is largely a myth for once-a-day lifters — do NOT push it. The one real lever is PRE-fuel for hard/long sessions. Reassure when timing is fine) ==");
    lines.push(`Last ${ct.analyzed} sessions: avg ${ct.avgPre}g carbs in the 3h before, ${ct.avgPost}g in the 2h after. Fueled going in: ${ct.fueledPct}%. Trained essentially fasted: ${ct.fastedPct}%.${ct.morningFasted >= 2 ? " Fasted sessions cluster in the morning." : ""}`);
    lines.push(`Read: ${ct.status}. ${ct.lever}`);
  }

  // ─── SKIN (separate lens — guarded: non-diagnostic, no prescribing) ───────
  if (brain.skin) {
    const sk = brain.skin;
    lines.push("");
    lines.push("== SKIN (a separate domain; physiology-aware. NEVER diagnose a skin condition, NEVER recommend prescription actives or procedures — defer those to a dermatologist. Frame correlations as personal, not proven) ==");
    const skTrend = sk.condTrend != null ? `, trend ${sk.condTrend > 0 ? "+" : ""}${sk.condTrend}` : "";
    const skBreak = sk.breakouts14 != null ? ` | breakouts ~${sk.breakouts14}/log` : "";
    lines.push(`Condition (1–5, higher better): ${sk.avgCond14 ?? "—"} avg (14d)${skTrend}${skBreak} | confidence ${sk.confidence}`);
    if (sk.correlations.length) {
      lines.push(`Cross-domain patterns from their OWN data (correlation, not cause — and this is the unfair advantage no skincare app has):`);
      sk.correlations.forEach(c => lines.push(`  • [${c.evidence} evidence] ${c.text}`));
    }
    if (sk.conflicts.length) lines.push(`Routine conflicts flagged: ${sk.conflicts.join(" | ")}`);
    if (sk.procedures && sk.procedures.length) lines.push(`Procedures logged (most recent first): ${sk.procedures.map(p => `${p.type}${p.date ? ` on ${p.date}` : ""}${p.notes ? ` (${p.notes})` : ""}`).join(" | ")}`);
    lines.push(`SKIN COACHING RULES: lead with the best-evidenced levers (nicotine, sun/SPF strong; dairy/glycemic-load moderate; hydration weak — don't push water-for-skin). Suggest one-variable experiments over shotgun changes.`);
    lines.push(`ON PROCEDURES (microneedling, PRP, peels, lasers, etc.): you CAN educate — explain what a procedure does, the rough state of evidence, typical recovery/aftercare, how it interacts with their actives and physiology (e.g. don't microneedle over active retinoid irritation; nicotine slows healing), and what to ask a provider. You may help them weigh options against their goals and data. You must NOT prescribe a specific medical protocol, settings, depths, or substitute for an in-person assessment — send them to a qualified provider/dermatologist for the actual treatment decision and anything that looks medical (cystic/persistent acne, suspicious lesions, prescription actives).`);
  }

  return lines.join("\n");
}

export function meanGap(first, last) {
  const m1 = /^(\d{1,2}):(\d{2})/.exec(first);
  const m2 = /^(\d{1,2}):(\d{2})/.exec(last);
  if (!m1 || !m2) return "?";
  const mins = (+m2[1] * 60 + +m2[2]) - (+m1[1] * 60 + +m1[2]);
  return Math.max(0, +(mins / 60).toFixed(1));
}
