// ─── PROTEIN DISTRIBUTION / MPS ENGINE (B1) ───────────────────────────────
import { minsOfTime } from "../lib/time.js";
import { daysAgo, getTodayStr } from "../lib/dates.js";
import { computeWeightTrend } from "./weight.js";
import { getDayContext } from "./dayContext.js";

// Per-meal protein target ≈ 0.4 g/kg bodyweight (the per-bout MPS-saturation dose).
function proteinPerMealTarget(data, goals) {
  const bwTrend = computeWeightTrend(data);
  const profileBw = goals?.profile?.weightKg ? parseFloat(goals.profile.weightKg) : null;
  const bw = (bwTrend && bwTrend.current) || (profileBw && profileBw > 0 ? profileBw : null);
  return { bw, perMeal: bw ? Math.round(0.4 * bw) : 30 };
}

export function clusterFeedings(dayEntries) {
  const timed = dayEntries.filter(e => minsOfTime(e.time) != null).map(e => ({ ...e, _m: minsOfTime(e.time) })).sort((a, b) => a._m - b._m);
  const untimed = dayEntries.filter(e => minsOfTime(e.time) == null);
  const feedings = [];
  let cur = null;
  for (const e of timed) {
    const pro = e.protein || 0;
    if (cur && e._m - cur.endMin <= 45) { cur.proteinG += pro; cur.endMin = e._m; }
    else { cur = { proteinG: pro, startMin: e._m, endMin: e._m, hasTime: true }; feedings.push(cur); }
  }
  const byLabel = {};
  untimed.forEach(e => { const k = e.meal || "Meal"; byLabel[k] = (byLabel[k] || 0) + (e.protein || 0); });
  Object.values(byLabel).forEach(p => feedings.push({ proteinG: p, startMin: null, endMin: null, hasTime: false }));
  return feedings;
}

export function computeProteinDistribution(data, goals) {
  const diet = data.diet || [];
  if (diet.length === 0) return null;
  const { bw, perMeal } = proteinPerMealTarget(data, goals);
  const proteinGoal = goals?.protein || 0;
  // Bucket meals by the ACTIVE day (biological or calendar) via the gateway.
  const ctx = getDayContext(data, goals);
  const today = ctx.currentDayKey();
  const win = ctx.window(7);                      // last 7 active days → { dayKey: meals[] }

  const dayStats = [];
  Object.keys(win).forEach(date => {
    const entries = win[date];
    // sleep.date is the wake-morning date, which ≈ the bio-day start date → safe to match
    if (entries.length === 0) return;
    const feedings = clusterFeedings(entries);
    const dayProtein = entries.reduce((a, e) => a + (e.protein || 0), 0);
    const effective = feedings.filter(f => f.proteinG >= perMeal).length;
    const anyTime = feedings.some(f => f.hasTime);
    const timed = feedings.filter(f => f.hasTime).sort((a, b) => a.startMin - b.startMin);
    let largestGap = null;
    if (timed.length >= 2) { let g = 0; for (let i = 1; i < timed.length; i++) g = Math.max(g, (timed[i].startMin - timed[i - 1].startMin) / 60); largestGap = +g.toFixed(1); }
    const maxFeed = feedings.reduce((m, f) => Math.max(m, f.proteinG), 0);
    const skew = dayProtein > 0 ? maxFeed / dayProtein : null;
    const slp = (data.sleep || []).find(s => s.date === date);
    const bedMin = slp ? minsOfTime(slp.bedtime) : null;
    let preSleepEligible = false, preSleepOK = false;
    if (bedMin != null && timed.length) {
      preSleepEligible = true;
      const bedAdj = bedMin < 300 ? bedMin + 1440 : bedMin; // wrap past-midnight bedtimes
      preSleepOK = timed.some(f => f.proteinG >= 20 && bedAdj - f.startMin >= 0 && bedAdj - f.startMin <= 180);
    }
    dayStats.push({ dayProtein, effective, anyTime, largestGap, skew, preSleepEligible, preSleepOK, hitGoal: proteinGoal ? dayProtein >= proteinGoal : false });
  });
  if (dayStats.length === 0) return null;

  const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const daysWithMeals = dayStats.length;
  const daysWithTimes = dayStats.filter(d => d.anyTime).length;
  const avgEffective = +mean(dayStats.map(d => d.effective)).toFixed(1);
  const avgProtein = Math.round(mean(dayStats.map(d => d.dayProtein)));
  const goalHitDays = dayStats.filter(d => d.hitGoal).length;
  const skews = dayStats.map(d => d.skew).filter(v => v != null);
  const avgSkew = skews.length ? +(mean(skews) * 100).toFixed(0) : null;
  const gaps = dayStats.map(d => d.largestGap).filter(v => v != null);
  const avgLargestGap = gaps.length ? +mean(gaps).toFixed(1) : null;
  const preEligibleDays = dayStats.filter(d => d.preSleepEligible).length;
  const preOKDays = dayStats.filter(d => d.preSleepOK).length;

  let confidence = "Low";
  if (daysWithMeals >= 4) confidence = "Moderate";
  if (daysWithMeals >= 6 && daysWithTimes >= 4) confidence = "High";

  const todayEntries = ctx.meals(today);
  const todayFeedings = clusterFeedings(todayEntries).sort((a, b) => (a.startMin ?? 99999) - (b.startMin ?? 99999));
  const todaySnap = {
    dayProtein: Math.round(todayEntries.reduce((a, e) => a + (e.protein || 0), 0)),
    effective: todayFeedings.filter(f => f.proteinG >= perMeal).length,
    feedings: todayFeedings.map(f => ({
      proteinG: Math.round(f.proteinG),
      effective: f.proteinG >= perMeal,
      time: f.hasTime ? `${String(Math.floor(f.startMin / 60)).padStart(2, "0")}:${String(f.startMin % 60).padStart(2, "0")}` : null,
    })),
  };

  return { bw, perMeal, proteinGoal, avgEffective, avgProtein, goalHitDays, daysWithMeals, daysWithTimes, avgSkew, avgLargestGap, preEligibleDays, preOKDays, confidence, today: todaySnap };
}
