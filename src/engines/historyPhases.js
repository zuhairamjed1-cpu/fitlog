// ─── HISTORICAL PHASE ANALYSIS ───────────────────────────────────────────────
// "Where did the user come from?" Reconstructs the past as a timeline of
// physiological phases (deficit / maintenance / surplus) from logged intake and
// measured weight trend. Weight is the primary, MEASURED signal; when it's
// present the phase is classified from the actual rate of change (and intake is
// reported for context). When weight is missing we fall back to intake vs an
// estimated Mifflin maintenance (ESTIMATED, lower confidence). Consecutive weeks
// of the same kind are merged into phases.

import { localDateStr, daysAgo } from "../lib/dates.js";
import { mifflinBMR } from "./energy.js";

const KCAL_PER_KG = 7700;
const mondayOf = dateStr => { const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDateStr(d); };
const addWk = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n * 7); return localDateStr(d); };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

// Classify a week from its measured weekly weight change (kg/wk).
function classifyByRate(kgWk) {
  if (kgWk <= -0.6) return { key: "aggressiveDeficit", label: "Aggressive Deficit" };
  if (kgWk <= -0.15) return { key: "deficit", label: "Deficit" };
  if (kgWk < 0.15) return { key: "maintenance", label: "Maintenance" };
  if (kgWk < 0.45) return { key: "leanBulk", label: "Lean Bulk" };
  return { key: "aggressiveSurplus", label: "Aggressive Surplus" };
}
// Fallback: classify from intake vs estimated maintenance (no weight data).
function classifyByIntake(intake, maint) {
  const d = intake - maint;
  if (d <= -500) return { key: "aggressiveDeficit", label: "Aggressive Deficit" };
  if (d <= -150) return { key: "deficit", label: "Deficit" };
  if (d < 150) return { key: "maintenance", label: "Maintenance" };
  if (d < 400) return { key: "leanBulk", label: "Lean Bulk" };
  return { key: "aggressiveSurplus", label: "Aggressive Surplus" };
}

export function computeHistoricalPhases(data, profile, today, windowDays = 240) {
  const t = today || localDateStr(new Date());
  const cutoff = (() => { const d = new Date(t + "T00:00:00"); d.setDate(d.getDate() - windowDays); return localDateStr(d); })();
  const diet = (data && data.diet || []).filter(d => d && d.date && d.date >= cutoff);
  const weights = (data && data.weight || []).filter(w => w && w.date && w.weight != null && w.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));

  if (!diet.length && weights.length < 2) return { ready: false, phases: [], reason: "Not enough nutrition or weight history yet to reconstruct your past phases." };

  // bucket intake by week (avg daily kcal over days actually logged that week)
  const byWeek = {};
  diet.forEach(e => { const wk = mondayOf(e.date); (byWeek[wk] = byWeek[wk] || {}); const day = e.date; (byWeek[wk][day] = (byWeek[wk][day] || 0) + (e.calories || 0)); });
  const weekIntake = {}; // wk -> avg daily kcal, nDays
  Object.keys(byWeek).forEach(wk => { const days = Object.values(byWeek[wk]); weekIntake[wk] = { avg: Math.round(mean(days)), nDays: days.length }; });

  // weight at/near a date (nearest within 10 days)
  const weightNear = iso => {
    if (!weights.length) return null;
    let best = null, bestGap = Infinity;
    weights.forEach(w => { const gap = Math.abs(new Date(w.date) - new Date(iso)); if (gap < bestGap) { bestGap = gap; best = w; } });
    return bestGap <= 10 * 86400000 ? best.weight : null;
  };

  // full set of weeks spanning the data
  const allWeeks = [...new Set([...Object.keys(weekIntake), ...weights.map(w => mondayOf(w.date))])].sort();
  if (!allWeeks.length) return { ready: false, phases: [], reason: "Not enough history yet." };

  const weekly = allWeeks.map(wk => {
    const intake = weekIntake[wk] || null;
    const wStart = weightNear(wk), wEnd = weightNear(addWk(wk, 1));
    const kgWk = (wStart != null && wEnd != null) ? +(wEnd - wStart).toFixed(2) : null;
    let cls, tier, maint = null;
    if (kgWk != null) {
      cls = classifyByRate(kgWk); tier = "measured";
      if (intake) maint = Math.round(intake.avg - (kgWk * KCAL_PER_KG / 7)); // back-calculated TDEE
    } else if (intake && profile && wStart != null) {
      maint = Math.round((mifflinBMR(profile, wStart) || 0) * 1.5) || null;
      cls = maint ? classifyByIntake(intake.avg, maint) : null; tier = "estimated";
    } else if (intake && profile) {
      const mw = weights.length ? weights[weights.length - 1].weight : (profile.weightKg ? parseFloat(profile.weightKg) : null);
      maint = mw ? Math.round((mifflinBMR(profile, mw) || 0) * 1.5) || null : null;
      cls = maint ? classifyByIntake(intake.avg, maint) : null; tier = "estimated";
    }
    return { wk, intake: intake ? intake.avg : null, nDays: intake ? intake.nDays : 0, kgWk, maint, cls, tier };
  }).filter(w => w.cls);

  if (!weekly.length) return { ready: false, phases: [], reason: "Not enough overlapping nutrition + weight history to classify phases." };

  // merge consecutive weeks of the same class into phases
  const phases = [];
  weekly.forEach(w => {
    const last = phases[phases.length - 1];
    if (last && last.key === w.cls.key) { last.endWk = w.wk; last._w.push(w); }
    else phases.push({ key: w.cls.key, label: w.cls.label, startWk: w.wk, endWk: w.wk, _w: [w] });
  });

  const out = phases.map(p => {
    const intakes = p._w.map(w => w.intake).filter(x => x != null);
    const rates = p._w.map(w => w.kgWk).filter(x => x != null);
    const maints = p._w.map(w => w.maint).filter(x => x != null);
    const measured = p._w.some(w => w.tier === "measured");
    return {
      key: p.key, label: p.label, start: p.startWk, end: addWk(p.endWk, 1), weeks: p._w.length,
      avgCalories: intakes.length ? Math.round(mean(intakes)) : null,
      avgRateKgWk: rates.length ? +mean(rates).toFixed(2) : null,
      estMaintenance: maints.length ? Math.round(mean(maints)) : null,
      tier: measured ? "measured" : "estimated",
    };
  });

  const current = out[out.length - 1];
  return { ready: true, tier: "mixed", phases: out, current, weeksAnalyzed: weekly.length };
}
