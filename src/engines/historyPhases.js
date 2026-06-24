// ─── HISTORICAL PHASE ANALYSIS (dynamic maintenance) ─────────────────────────
// "Where did the user come from?" — answered with a maintenance that MOVES over
// time. 2730 is only the starting PRIOR. Real maintenance falls as bodyweight
// drops (~25 kcal/kg) and as metabolic adaptation accrues during sustained
// deficits (recovering toward 0 during maintenance/surplus). Where weight data
// is dense, weight becomes a CO-ESTIMATOR that corrects maintenance (you can't
// eat at true maintenance and keep losing). Calories drive classification;
// classification is delta = rollingCalories − dynamicMaintenance(t), NOT − 2730.
// 14-day rolling smooths cheats/refeeds; phases split on sustained ≥200 kcal
// shifts. Sparse weight still classifies (lower confidence) — never refuses.

import { localDateStr } from "../lib/dates.js";

export const MAINTENANCE_PRIOR = 2730;
const KCAL_PER_KG = 7700;
const KCAL_PER_KG_BW = 25;     // maintenance shift per kg of bodyweight
const ADAPT_RATE_WK = -8;      // kcal/day adaptation accrued per week of sustained deficit
const ADAPT_RECOVER_WK = 12;   // kcal/day adaptation recovered per week at maintenance/surplus
const ADAPT_CAP = -250;        // floor
const DEFICIT_TRIGGER = 400;   // avg deficit (kcal) that triggers adaptation
const MIN_SHIFT = 200, SUSTAIN_DAYS = 14, ROLL_DAYS = 14, WATER_DAYS = 14;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return localDateStr(d); };
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const sign = x => (x > 0 ? 1 : x < 0 ? -1 : 0);

function classify(delta) {
  if (delta <= -700) return { key: "aggressiveCut", label: "Aggressive Cut" };
  if (delta <= -225) return { key: "cut", label: "Cut" };
  if (delta < 150) return { key: "maintenance", label: "Maintenance" };
  if (delta < 350) return { key: "leanBulk", label: "Lean Bulk" };
  return { key: "bulk", label: "Bulk" };
}
const NOT_READY = reason => ({ ready: false, phases: [], timeline: [], confidence: {}, maintenanceBaseline: MAINTENANCE_PRIOR, calorieTrend: [], maintenanceTrend: [], adaptationTrend: [], weightTrend: [], weightValidation: [], detectedTransitions: [], reason });

export function computeHistoricalPhases(data, profile, today, windowDays = 365) {
  const prior = (profile && profile.historicalMaintenance) || MAINTENANCE_PRIOR;
  const t = today || localDateStr(new Date());
  const cutoff = addDays(t, -windowDays);
  const diet = (data && data.diet || []).filter(d => d && d.date && d.date >= cutoff);

  const dayCal = {};
  diet.forEach(e => { dayCal[e.date] = (dayCal[e.date] || 0) + (e.calories || 0); });
  const loggedDays = Object.keys(dayCal).sort();
  if (loggedDays.length < 10) return NOT_READY("Need at least ~10 days of logged nutrition to reconstruct your phases.");
  const firstDay = loggedDays[0], lastDay = loggedDays[loggedDays.length - 1];
  if (daysBetween(firstDay, lastDay) < SUSTAIN_DAYS) return NOT_READY("Not enough history span yet to detect phases.");

  const allDays = []; for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) allDays.push(d);

  // 14-day trailing rolling calories (≥4 logged in window)
  const rollAt = {};
  allDays.forEach(d => { const ws = addDays(d, -(ROLL_DAYS - 1)); const vals = loggedDays.filter(ld => ld >= ws && ld <= d).map(ld => dayCal[ld]); rollAt[d] = vals.length >= 4 ? Math.round(mean(vals)) : null; });

  // interpolated bodyweight (sparse-tolerant; smooths water noise between points)
  const wlogs = (data && data.weight || []).map(w => ({ date: w.date, kg: w.kg != null ? w.kg : w.weight })).filter(w => w.date && w.kg != null).sort((a, b) => a.date.localeCompare(b.date));
  const startWeight = wlogs.length ? wlogs[0].kg : ((profile && profile.weightKg) ? parseFloat(profile.weightKg) : null);
  const weightAt = iso => {
    if (!wlogs.length) return null;
    if (iso <= wlogs[0].date) return wlogs[0].kg;
    if (iso >= wlogs[wlogs.length - 1].date) return wlogs[wlogs.length - 1].kg;
    for (let i = 1; i < wlogs.length; i++) { if (wlogs[i].date >= iso) { const a = wlogs[i - 1], b = wlogs[i]; const f = daysBetween(a.date, iso) / Math.max(1, daysBetween(a.date, b.date)); return +(a.kg + (b.kg - a.kg) * f).toFixed(2); } }
    return wlogs[wlogs.length - 1].kg;
  };

  // ── forward pass: dynamic maintenance + adaptation integration ──
  let adapt = 0;
  const maintenanceTrend = [], adaptationTrend = [], weightTrend = [], defArr = [];
  allDays.forEach((d, idx) => {
    const wt = weightAt(d);
    const bwAdj = (wt != null && startWeight != null) ? (wt - startWeight) * KCAL_PER_KG_BW : 0;
    const maintModel = prior + bwAdj + adapt;

    // weight co-estimator: correct toward observed maintenance where weight is dense
    // (skip during the ~14d water-weight window right after a calorie change)
    let maint = maintModel;
    const transition = (rollAt[d] != null && rollAt[addDays(d, -ROLL_DAYS)] != null && Math.abs(rollAt[d] - rollAt[addDays(d, -ROLL_DAYS)]) >= MIN_SHIFT);
    if (!transition) {
      const ws = addDays(d, -27);
      const wWin = wlogs.filter(w => w.date >= ws && w.date <= d && w.date >= addDays(firstDay, WATER_DAYS));
      const span = wWin.length >= 2 ? daysBetween(wWin[0].date, wWin[wWin.length - 1].date) : 0;
      const intakeDays = loggedDays.filter(x => x >= ws && x <= d).map(x => dayCal[x]);
      if (wWin.length >= 3 && span >= 14 && intakeDays.length >= 7) {
        const rateKgWk = (wWin[wWin.length - 1].kg - wWin[0].kg) / (span / 7);
        const observed = mean(intakeDays) - rateKgWk * KCAL_PER_KG / 7;
        const density = wWin.length / 28;
        const alpha = density >= 0.5 ? 0.6 : density >= 0.25 ? 0.35 : 0.15;
        if (observed > 1200 && observed < 5000) maint = maintModel * (1 - alpha) + observed * alpha;
      }
    }

    const roll = rollAt[d];
    const def = roll != null ? roll - maint : null; // negative = deficit
    defArr[idx] = def;
    maintenanceTrend.push({ date: d, maintenance: Math.round(maint), model: Math.round(maintModel), adaptation: Math.round(adapt) });
    adaptationTrend.push({ date: d, adaptation: Math.round(adapt) });
    weightTrend.push({ date: d, kg: wt });

    // integrate adaptation from trailing 21-day avg deficit
    const trail = defArr.slice(Math.max(0, idx - 20), idx + 1).filter(x => x != null);
    if (trail.length >= 10) {
      const avgDef = mean(trail);
      if (avgDef < -DEFICIT_TRIGGER) adapt = clamp(adapt + ADAPT_RATE_WK / 7, ADAPT_CAP, 0);
      else if (avgDef > -150) adapt = clamp(adapt + ADAPT_RECOVER_WK / 7, ADAPT_CAP, 0);
    }
  });
  const maintAt = {}; maintenanceTrend.forEach(p => (maintAt[p.date] = p.maintenance));
  const adaptAt = {}; adaptationTrend.forEach(p => (adaptAt[p.date] = p.adaptation));

  // ── segmentation on rolling calories (sustained ≥200 kcal shift ≥14 days) ──
  const rolled = allDays.filter(d => rollAt[d] != null);
  if (rolled.length < SUSTAIN_DAYS) return NOT_READY("Not enough consistent logging to build a calorie trend.");
  const segs = [];
  let i = 0;
  while (i < rolled.length) {
    const startIdx = i; let vals = [rollAt[rolled[i]]], bm = rollAt[rolled[i]]; let j = i + 1;
    while (j < rolled.length) {
      if (Math.abs(rollAt[rolled[j]] - bm) >= MIN_SHIFT) {
        const ahead = rolled.slice(j, j + SUSTAIN_DAYS).map(d => rollAt[d]);
        if (ahead.length >= Math.min(SUSTAIN_DAYS, rolled.length - j) && Math.abs(mean(ahead) - bm) >= MIN_SHIFT) break;
      }
      vals.push(rollAt[rolled[j]]); bm = mean(vals); j++;
    }
    segs.push({ startDate: rolled[startIdx], endDate: rolled[j - 1] });
    i = j > i ? j : i + 1;
  }
  const segMean = s => mean(loggedDays.filter(d => d >= s.startDate && d <= s.endDate).map(d => dayCal[d]));
  for (let k = 0; k < segs.length; k++) {
    if (segs.length === 1) break;
    if (daysBetween(segs[k].startDate, segs[k].endDate) + 1 < SUSTAIN_DAYS) {
      const prevS = segs[k - 1], nextS = segs[k + 1], m = segMean(segs[k]);
      if (prevS && (!nextS || Math.abs(segMean(prevS) - m) <= Math.abs(segMean(nextS) - m))) { prevS.endDate = segs[k].endDate; segs.splice(k, 1); k -= 2; }
      else if (nextS) { nextS.startDate = segs[k].startDate; segs.splice(k, 1); k -= 1; }
    }
  }

  const weightNear = iso => { if (!wlogs.length) return null; let best = null, gap = Infinity; wlogs.forEach(w => { const g = Math.abs(new Date(w.date) - new Date(iso)); if (g < gap) { gap = g; best = w; } }); return gap <= 10 * 86400000 ? best.kg : null; };

  // ── build phases (classified against DYNAMIC maintenance) ──
  const phases = [], weightValidation = [], confidence = {};
  segs.forEach((s, idx) => {
    const daysIn = loggedDays.filter(d => d >= s.startDate && d <= s.endDate);
    const cals = daysIn.map(d => dayCal[d]);
    const avgCalories = Math.round(mean(cals));
    const maintsIn = allDays.filter(d => d >= s.startDate && d <= s.endDate).map(d => maintAt[d]);
    const avgMaint = Math.round(mean(maintsIn));
    const maintenanceStart = maintAt[s.startDate], maintenanceEnd = maintAt[s.endDate];
    const delta = avgCalories - avgMaint;                       // averageEnergyBalance
    const cls = classify(delta);
    const weeks = +(((daysBetween(s.startDate, s.endDate) + 1) / 7).toFixed(1));
    const wStart = weightNear(s.startDate), wEnd = weightNear(s.endDate);
    const weightChange = (wStart != null && wEnd != null) ? +(wEnd - wStart).toFixed(1) : null;
    const avgRateKgWk = (weightChange != null && weeks > 0) ? +(weightChange / weeks).toFixed(2) : null;
    const wPts = wlogs.filter(w => w.date >= s.startDate && w.date <= s.endDate).length;
    const adaptationStart = adaptAt[s.startDate], adaptationEnd = adaptAt[s.endDate];

    let c = 50;
    c += clamp(weeks * 3, 0, 25);
    const cv = avgCalories ? stdev(cals) / avgCalories : 1;
    c += cv < 0.10 ? 15 : cv < 0.18 ? 8 : cv < 0.28 ? 0 : -10;
    let agreement = "sparse";
    if (wStart != null && wEnd != null && wPts >= 2) {
      const expected = delta < -150 ? -1 : delta > 150 ? 1 : 0;
      const actual = sign(wEnd - wStart);
      if (expected === 0) { agreement = Math.abs(weightChange) < 0.6 ? "supports" : "contradicts"; c += agreement === "supports" ? 10 : -8; }
      else if (actual === expected) { agreement = "supports"; c += wPts >= 4 ? 18 : 10; }
      else { agreement = "contradicts"; c -= 12; }
    } else c -= 8;
    if (weeks < 3) c -= 8;
    c = Math.round(clamp(c, 5, 97));
    const band = c >= 75 ? "High" : c >= 50 ? "Medium" : "Low";

    const days = daysBetween(s.startDate, s.endDate) + 1;
    const rationale = `Average intake ${avgCalories} ran ~${Math.abs(delta)} kcal ${delta < 0 ? "below" : delta > 0 ? "above" : "around"} estimated maintenance (${maintenanceStart}→${maintenanceEnd} kcal as bodyweight${adaptationEnd < 0 ? " and adaptation" : ""} shifted it) over ${days} days.`;

    phases.push({
      key: cls.key, label: cls.label, phaseType: cls.label, start: s.startDate, end: s.endDate, weeks,
      avgCalories, maintenanceStart, maintenanceEnd, estMaintenance: avgMaint,
      averageEnergyBalance: delta, delta,
      weightStart: wStart, weightEnd: wEnd, weightChange, avgRateKgWk,
      adaptationStart, adaptationEnd,
      confidence: c, confidenceBand: band, tier: "estimate", rationale,
    });
    weightValidation.push({ phase: cls.label, weightPoints: wPts, agreement });
    confidence[idx] = c;
  });

  const detectedTransitions = [];
  for (let k = 1; k < phases.length; k++) detectedTransitions.push({ date: phases[k].start, from: phases[k - 1].label, to: phases[k].label });

  return {
    ready: phases.length > 0, tier: "estimate", maintenanceBaseline: prior,
    phases, timeline: phases, current: phases[phases.length - 1] || null,
    confidence, calorieTrend: allDays.map(d => ({ date: d, rolling: rollAt[d], logged: dayCal[d] != null ? Math.round(dayCal[d]) : null })),
    maintenanceTrend, adaptationTrend, weightTrend, weightValidation, detectedTransitions,
    weeksAnalyzed: +(((daysBetween(firstDay, lastDay) + 1) / 7).toFixed(1)),
  };
}
