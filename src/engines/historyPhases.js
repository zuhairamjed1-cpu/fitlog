// ─── HISTORICAL PHASE ANALYSIS (weekly cadence, dynamic maintenance) ─────────
// Maintenance, adaptation, energy balance, and phase classification recalculate
// ONCE PER WEEK over the previous 7 days of data — not daily. 2730 is only the
// starting prior; real maintenance falls with bodyweight (~25 kcal/kg) and with
// metabolic adaptation accrued during sustained deficits (recovering toward 0 at
// maintenance/surplus). Where weight is dense it CO-ESTIMATES maintenance.
// Phase boundaries require PERSISTENCE: a new weekly classification must hold for
// ≥2 consecutive weekly recalculations before a transition is confirmed, so
// cheat meals / refeeds / short fluctuations never create false phases. Daily
// calories are still emitted (calorieTrend) for the chart; maintenance/adaptation
// are emitted as weekly step series.

import { localDateStr } from "../lib/dates";

export const MAINTENANCE_PRIOR = 2730;
const KCAL_PER_KG = 7700;
const KCAL_PER_KG_BW = 25;     // maintenance shift per kg bodyweight
const ADAPT_RATE_WK = -8;      // kcal/day adaptation per qualifying deficit week
const ADAPT_RECOVER_WK = 12;   // kcal/day recovery per maintenance/surplus week
const ADAPT_CAP = -250;
const DEFICIT_TRIGGER = 400;   // trailing avg deficit (kcal) that triggers adaptation
const ROLL_DAYS = 14, WATER_DAYS = 14, PERSIST_WEEKS = 2, MIN_WEEK_DAYS = 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return localDateStr(d); };
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const sign = x => (x > 0 ? 1 : x < 0 ? -1 : 0);

function classify(balance) {
  if (balance <= -700) return { key: "aggressiveCut", label: "Aggressive Cut" };
  if (balance <= -225) return { key: "cut", label: "Cut" };
  if (balance < 150) return { key: "maintenance", label: "Maintenance" };
  if (balance < 350) return { key: "leanBulk", label: "Lean Bulk" };
  return { key: "bulk", label: "Bulk" };
}
const NOT_READY = reason => ({ ready: false, phases: [], timeline: [], confidence: {}, maintenanceBaseline: MAINTENANCE_PRIOR, calorieTrend: [], maintenanceTrend: [], adaptationTrend: [], weightTrend: [], weeklyTrend: [], weightValidation: [], detectedTransitions: [], reason });

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
  if (daysBetween(firstDay, lastDay) < 14) return NOT_READY("Not enough history span yet to detect phases.");

  const allDays = []; for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) allDays.push(d);

  // daily 14-day rolling calories (chart only)
  const rollAt = {};
  allDays.forEach(d => { const ws = addDays(d, -(ROLL_DAYS - 1)); const vals = loggedDays.filter(ld => ld >= ws && ld <= d).map(ld => dayCal[ld]); rollAt[d] = vals.length >= 4 ? Math.round(mean(vals)) : null; });

  // interpolated bodyweight (sparse-tolerant)
  const wlogs = (data && data.weight || []).map(w => ({ date: w.date, kg: w.kg != null ? w.kg : w.weight })).filter(w => w.date && w.kg != null).sort((a, b) => a.date.localeCompare(b.date));
  const startWeight = wlogs.length ? wlogs[0].kg : ((profile && profile.weightKg) ? parseFloat(profile.weightKg) : null);
  const weightAt = iso => {
    if (!wlogs.length) return null;
    if (iso <= wlogs[0].date) return wlogs[0].kg;
    if (iso >= wlogs[wlogs.length - 1].date) return wlogs[wlogs.length - 1].kg;
    for (let i = 1; i < wlogs.length; i++) if (wlogs[i].date >= iso) { const a = wlogs[i - 1], b = wlogs[i]; const f = daysBetween(a.date, iso) / Math.max(1, daysBetween(a.date, b.date)); return +(a.kg + (b.kg - a.kg) * f).toFixed(2); }
    return wlogs[wlogs.length - 1].kg;
  };

  // ── build consecutive 7-day weeks anchored to the first logged day ──
  const weeks = [];
  for (let s = firstDay; s <= lastDay; s = addDays(s, 7)) weeks.push({ start: s, end: addDays(s, 6) > lastDay ? lastDay : addDays(s, 6) });

  // ── weekly forward pass: aggregate 7 days; recompute maint, adaptation, balance, class ──
  let adapt = 0;
  const wrecs = [];
  weeks.forEach((w, wi) => {
    const days = loggedDays.filter(d => d >= w.start && d <= w.end);
    const cals = days.map(d => dayCal[d]);
    const enough = days.length >= MIN_WEEK_DAYS;
    const avgCal = enough ? Math.round(mean(cals)) : null;
    const wt = weightAt(w.end);
    const bwAdj = (wt != null && startWeight != null) ? (wt - startWeight) * KCAL_PER_KG_BW : 0;
    const maintModel = prior + bwAdj + adapt;

    // weight co-estimator (weekly): correct toward observed maintenance where weight is dense,
    // skipping the ~14-day water-weight window at the very start of tracking
    let maint = maintModel;
    if (enough) {
      const winStart = addDays(w.end, -27);
      const wWin = wlogs.filter(x => x.date >= winStart && x.date <= w.end && x.date >= addDays(firstDay, WATER_DAYS));
      const span = wWin.length >= 2 ? daysBetween(wWin[0].date, wWin[wWin.length - 1].date) : 0;
      const intake = loggedDays.filter(x => x >= winStart && x <= w.end).map(x => dayCal[x]);
      if (wWin.length >= 3 && span >= 14 && intake.length >= 7) {
        const rateKgWk = (wWin[wWin.length - 1].kg - wWin[0].kg) / (span / 7);
        const observed = mean(intake) - rateKgWk * KCAL_PER_KG / 7;
        const density = wWin.length / 28, alpha = density >= 0.5 ? 0.6 : density >= 0.25 ? 0.35 : 0.15;
        if (observed > 1200 && observed < 5000) maint = maintModel * (1 - alpha) + observed * alpha;
      }
    }
    maint = Math.round(maint);
    const balance = avgCal != null ? avgCal - maint : null; // negative = deficit
    const cls = balance != null ? classify(balance) : (wi > 0 ? wrecs[wi - 1].cls : { key: "maintenance", label: "Maintenance" });

    wrecs.push({ ...w, days: days.length, avgCal, weight: wt, maint, balance, adapt: Math.round(adapt), cls });

    // integrate adaptation ONCE this week, using trailing 3-week avg balance (the weekly "sustained" test)
    const trail = wrecs.slice(Math.max(0, wi - 2)).map(r => r.balance).filter(b => b != null);
    if (trail.length >= 2 || (trail.length === 1 && balance != null)) {
      const avgBal = mean(trail.length ? trail : [balance]);
      if (avgBal < -DEFICIT_TRIGGER) adapt = clamp(adapt + ADAPT_RATE_WK, ADAPT_CAP, 0);
      else if (avgBal > -150) adapt = clamp(adapt + ADAPT_RECOVER_WK, ADAPT_CAP, 0);
    }
  });

  // ── persistence-based segmentation: a NEW class must hold ≥2 consecutive weeks ──
  const segs = [];
  let cur = { startIdx: 0, key: wrecs[0].cls.key };
  for (let i = 1; i < wrecs.length; i++) {
    const k = wrecs[i].cls.key;
    if (k === cur.key) continue;
    // candidate change: confirm only if it persists for PERSIST_WEEKS consecutive weeks
    let persists = 1;
    for (let j = i + 1; j < wrecs.length && wrecs[j].cls.key === k; j++) persists++;
    if (persists >= PERSIST_WEEKS) { segs.push({ startIdx: cur.startIdx, endIdx: i - 1, key: cur.key }); cur = { startIdx: i, key: k }; }
    // else: single/short deviation (refeed, cheat week) → absorb into current phase
  }
  segs.push({ startIdx: cur.startIdx, endIdx: wrecs.length - 1, key: cur.key });

  const weightNear = iso => { if (!wlogs.length) return null; let best = null, gap = Infinity; wlogs.forEach(w => { const g = Math.abs(new Date(w.date) - new Date(iso)); if (g < gap) { gap = g; best = w; } }); return gap <= 10 * 86400000 ? best.kg : null; };

  // ── build phases from confirmed segments ──
  const phases = [], weightValidation = [], confidence = {};
  segs.forEach((s, idx) => {
    const segWeeks = wrecs.slice(s.startIdx, s.endIdx + 1);
    const start = segWeeks[0].start, end = segWeeks[segWeeks.length - 1].end;
    const daysIn = loggedDays.filter(d => d >= start && d <= end);
    const cals = daysIn.map(d => dayCal[d]);
    const avgCalories = Math.round(mean(cals));
    const maintVals = segWeeks.map(w => w.maint);
    const estMaintenance = Math.round(mean(maintVals));
    const maintenanceStart = segWeeks[0].maint, maintenanceEnd = segWeeks[segWeeks.length - 1].maint;
    const delta = avgCalories - estMaintenance;          // averageEnergyBalance
    const cls = classify(delta);
    const nWeeks = +(((daysBetween(start, end) + 1) / 7).toFixed(1));
    const wStart = weightNear(start), wEnd = weightNear(end);
    const weightChange = (wStart != null && wEnd != null) ? +(wEnd - wStart).toFixed(1) : null;
    const avgRateKgWk = (weightChange != null && nWeeks > 0) ? +(weightChange / nWeeks).toFixed(2) : null;
    const wPts = wlogs.filter(w => w.date >= start && w.date <= end).length;
    const adaptationStart = segWeeks[0].adapt, adaptationEnd = segWeeks[segWeeks.length - 1].adapt;

    let c = 50;
    c += clamp(nWeeks * 3, 0, 25);
    const cv = avgCalories ? stdev(cals) / avgCalories : 1;
    c += cv < 0.10 ? 15 : cv < 0.18 ? 8 : cv < 0.28 ? 0 : -10;
    let agreement = "sparse";
    if (wStart != null && wEnd != null && wPts >= 2) {
      const expected = delta < -150 ? -1 : delta > 150 ? 1 : 0, actual = sign(wEnd - wStart);
      if (expected === 0) { agreement = Math.abs(weightChange) < 0.6 ? "supports" : "contradicts"; c += agreement === "supports" ? 10 : -8; }
      else if (actual === expected) { agreement = "supports"; c += wPts >= 4 ? 18 : 10; }
      else { agreement = "contradicts"; c -= 12; }
    } else c -= 8;
    if (nWeeks < 3) c -= 8;
    c = Math.round(clamp(c, 5, 97));
    const band = c >= 75 ? "High" : c >= 50 ? "Medium" : "Low";
    const days = daysBetween(start, end) + 1;
    const rationale = `Weekly intake averaged ${avgCalories} kcal — ~${Math.abs(delta)} kcal ${delta < 0 ? "below" : delta > 0 ? "above" : "around"} estimated maintenance (${maintenanceStart}→${maintenanceEnd} kcal as bodyweight${adaptationEnd < 0 ? " and adaptation" : ""} shifted it) across ${Math.round(nWeeks)} weeks (${days} days).`;

    phases.push({
      key: cls.key, label: cls.label, phaseType: cls.label, start, end, weeks: nWeeks,
      avgCalories, maintenanceStart, maintenanceEnd, estMaintenance,
      averageEnergyBalance: delta, delta,
      weightStart: wStart, weightEnd: wEnd, weightChange, avgRateKgWk,
      adaptationStart, adaptationEnd, confidence: c, confidenceBand: band, tier: "estimate", rationale,
    });
    weightValidation.push({ phase: cls.label, weightPoints: wPts, agreement });
    confidence[idx] = c;
  });

  const detectedTransitions = [];
  for (let k = 1; k < phases.length; k++) detectedTransitions.push({ date: phases[k].start, from: phases[k - 1].label, to: phases[k].label });

  // expand weekly maint/adapt to daily step series for the charts
  const weekFor = iso => { for (let i = wrecs.length - 1; i >= 0; i--) if (iso >= wrecs[i].start) return wrecs[i]; return wrecs[0]; };
  const maintenanceTrend = allDays.map(d => { const w = weekFor(d); return { date: d, maintenance: w.maint, model: w.maint, adaptation: w.adapt }; });
  const adaptationTrend = allDays.map(d => ({ date: d, adaptation: weekFor(d).adapt }));
  const weightTrend = allDays.map(d => ({ date: d, kg: weightAt(d) }));

  return {
    ready: phases.length > 0, tier: "estimate", maintenanceBaseline: prior,
    phases, timeline: phases, current: phases[phases.length - 1] || null, confidence,
    calorieTrend: allDays.map(d => ({ date: d, rolling: rollAt[d], logged: dayCal[d] != null ? Math.round(dayCal[d]) : null })),
    maintenanceTrend, adaptationTrend, weightTrend,
    weeklyTrend: wrecs.map(w => ({ weekStart: w.start, weekEnd: w.end, days: w.days, avgCalories: w.avgCal, maintenance: w.maint, balance: w.balance, adaptation: w.adapt, phaseType: w.cls.label })),
    weightValidation, detectedTransitions,
    weeksAnalyzed: weeks.length,
  };
}
