// ─── FATIGUE ENGINE ──────────────────────────────────────────────────────────
// "Is accumulated stress impairing adaptation?" Completely separate from Recovery.
// ChronicFatigue = 0.50·Performance + 0.30·Wellness + 0.20·Load, then multiplied by
// a RecoveryPenalty. ESTIMATED, never measured. Performance (e1RM trend + RPE drift)
// and Load (EWMA of sessionRPE×duration) are computed from logged training; Wellness
// uses sleep as a partial proxy because energy/mood/soreness aren't logged yet — so
// confidence is reported honestly and capped when inputs are thin. Everything is
// compared to the user's OWN baseline via z-scores, never fixed thresholds.

import { localDateStr, getTodayStr } from "../lib/dates.js";
import { parseWorkout } from "./workout.js";
import { resolveMuscle, MUSCLES, MUSCLE_KEYS, MUSCLE_RANGE } from "./volume.js";

const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const zscore = (v, series) => { const m = mean(series), sd = std(series); return sd > 0 && m != null ? (v - m) / sd : 0; };
const dateAdd = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return localDateStr(d); };
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

// e1RM = average of Epley and Brzycki (kg).
function e1rmAvg(set) {
  if (!set || !set.weight || set.reps <= 0) return 0;
  const w = set.unit === "lb" ? set.weight * 0.453592 : set.weight;
  const epley = w * (1 + set.reps / 30);
  const brzycki = set.reps < 37 ? (w * 36) / (37 - set.reps) : epley;
  return (epley + brzycki) / 2;
}
const isWorking = s => s && (s.rpe == null || s.rpe >= 5) && s.weight != null && s.reps > 0;
const durationMin = txt => { const m = (txt || "").match(/(\d+)\s*h\s*(\d+)?\s*m|\b(\d+)\s*min/i); if (m) { if (m[3]) return +m[3]; return +m[1] * 60 + (m[2] ? +m[2] : 0); } return null; };

// EWMA value at the end of a daily series. λ = 2/(N+1).
function ewmaLast(dailySorted, N) {
  const lambda = 2 / (N + 1);
  let prev = null;
  dailySorted.forEach(L => { prev = prev == null ? L : L * lambda + prev * (1 - lambda); });
  return prev || 0;
}

export function computeFatigue(data, goals, today) {
  const t = today || getTodayStr();
  const since = n => dateAdd(t, -n);
  const profile = (goals && goals.profile) || {};
  const ex = (data.exercise || []).filter(e => e && e.date).sort((a, b) => a.date.localeCompare(b.date));
  if (ex.length < 3) return { ready: false, reason: "Log a few workouts and your fatigue picture will build here." };

  // ── parse sessions: per-session avg RPE, duration, load, and per-exercise top e1RM ──
  const sessions = ex.map(e => {
    const p = e._parsed || parseWorkout(e.text || "");
    const working = []; (p.exercises || []).forEach(x => (x.sets || []).forEach(s => { if (isWorking(s)) working.push({ name: x.name, ...s }); }));
    const rpes = working.map(s => s.rpe).filter(x => x != null);
    const sRPE = rpes.length ? mean(rpes) : 7; // default moderate if RPE not logged
    let dur = durationMin(e.text); const durEst = dur == null; if (dur == null) dur = Math.max(20, working.length * 3.5);
    const topE1 = {}; working.forEach(s => { const m = resolveMuscle(s.name); const key = (s.name || "").toLowerCase().trim(); const v = e1rmAvg(s); if (v > (topE1[key] || 0)) topE1[key] = v; });
    return { date: e.date, sRPE, dur, durEst, load: sRPE * dur, working, topE1, exercises: p.exercises || [] };
  });

  // ── LOAD (20%) — EWMA acute (7d) vs chronic (28d) ──
  const dayLoad = {}; sessions.forEach(s => { dayLoad[s.date] = (dayLoad[s.date] || 0) + s.load; });
  const start28 = since(27), start7 = since(6);
  const fill = startIso => { const out = []; for (let d = startIso; d <= t; d = dateAdd(d, 1)) out.push(dayLoad[d] || 0); return out; };
  const acute = ewmaLast(fill(start7), 7);
  const chronic = ewmaLast(fill(start28), 28);
  const loadRatio = chronic > 0 ? +(acute / chronic).toFixed(2) : null;
  // load fatigue: ratio >1 means ramping faster than adapted; ~0.8–1.3 is fine
  let loadFat = 40;
  if (loadRatio != null) loadFat = clamp(40 + (loadRatio - 1.0) * 90, 5, 100);
  const recentDur = sessions.filter(s => s.date >= start7).every(s => s.durEst);

  // ── PERFORMANCE (50%) — e1RM trend + RPE drift, per-exercise, z-scored ──
  const byEx = {}; sessions.forEach(s => { Object.entries(s.topE1).forEach(([k, v]) => { (byEx[k] = byEx[k] || []).push({ date: s.date, e1: v }); }); });
  const recentCut = since(13), baseCut = since(41);
  const trends = [];
  Object.entries(byEx).forEach(([k, series]) => {
    if (series.length < 4) return;
    const recent = series.filter(p => p.date >= recentCut).map(p => p.e1);
    const base = series.filter(p => p.date < recentCut && p.date >= baseCut).map(p => p.e1);
    if (!recent.length || base.length < 2) return;
    const pct = ((mean(recent) - mean(base)) / mean(base)) * 100;
    trends.push({ ex: k, pct, n: series.length });
  });
  let perfFat = 45, e1rmTrendPct = null, perfKnown = trends.length > 0;
  if (perfKnown) {
    const wsum = trends.reduce((s, x) => s + x.n, 0);
    e1rmTrendPct = +(trends.reduce((s, x) => s + x.pct * x.n, 0) / wsum).toFixed(1);
    perfFat = clamp(42 - e1rmTrendPct * 4.5, 5, 100); // decline → higher fatigue
  }
  // RPE drift: recent avg session RPE vs baseline (z)
  const recentRPE = sessions.filter(s => s.date >= recentCut).map(s => s.sRPE);
  const baseRPE = sessions.filter(s => s.date < recentCut).map(s => s.sRPE);
  let rpeDriftZ = 0;
  if (recentRPE.length && baseRPE.length >= 3) { rpeDriftZ = +zscore(mean(recentRPE), baseRPE).toFixed(2); perfFat = clamp(perfFat + rpeDriftZ * 8, 5, 100); }

  // ── WELLNESS (30%) — sleep proxy, z-scored vs own baseline (energy/mood not logged) ──
  const sleep = (data.sleep || []).filter(s => s && s.date && s.duration != null);
  let wellFat = 45, wellKnown = false, sleepDebtH = 0;
  if (sleep.length >= 4) {
    wellKnown = true;
    const recentS = sleep.filter(s => s.date >= since(6)).map(s => s.duration);
    const baseS = sleep.map(s => s.duration);
    const need = 8;
    if (recentS.length) { const z = zscore(mean(recentS), baseS); wellFat = clamp(45 - z * 12, 5, 100); sleepDebtH = +(recentS.reduce((s, d) => s + Math.max(0, need - d), 0)).toFixed(1); }
    const Q = { Excellent: 1, Great: .7, Good: .4, Fair: -.3, Poor: -.8 };
    const recentQ = sleep.filter(s => s.date >= since(6)).map(s => Q[s.quality]).filter(x => x != null);
    if (recentQ.length) wellFat = clamp(wellFat - mean(recentQ) * 8, 5, 100);
  }

  // ── CHRONIC FATIGUE = 0.5·perf + 0.3·wellness + 0.2·load ──
  const chronicFatigue = 0.5 * perfFat + 0.3 * wellFat + 0.2 * loadFat;

  // ── RECOVERY PENALTY = 1 + sleepDebt + deficitSeverity + stress(0, no data) ──
  const sleepDebtFrac = clamp(sleepDebtH / 7 * 0.25, 0, 0.25);
  let deficitFrac = 0;
  const diet = (data.diet || []).filter(d => d && d.date && d.date >= since(6));
  if (diet.length && profile.sex && profile.age && profile.heightCm) {
    const byDay = {}; diet.forEach(e => (byDay[e.date] = (byDay[e.date] || 0) + (e.calories || 0)));
    const bw = profile.weightKg ? parseFloat(profile.weightKg) : (data.weight && data.weight.length ? data.weight[data.weight.length - 1].weight : null);
    if (bw) { const maint = (require_mifflin(profile, bw)) * 1.5; const avgCal = mean(Object.values(byDay)); if (maint > 0 && avgCal < maint) deficitFrac = clamp((maint - avgCal) / maint * 0.6, 0, 0.25); }
  }
  const penalty = +(1 + sleepDebtFrac + deficitFrac).toFixed(2); // stress term = 0 (untracked)
  const finalFatigue = Math.round(clamp(chronicFatigue * penalty, 0, 100));
  const band = finalFatigue >= 75 ? "Severe" : finalFatigue >= 55 ? "High" : finalFatigue >= 35 ? "Moderate" : "Low";
  const bandColor = finalFatigue >= 75 ? "#f47e6e" : finalFatigue >= 55 ? "#f9c97e" : finalFatigue >= 35 ? "#5cc8df" : "#8fd989";

  // ── ACUTE READINESS (green/amber/red): last night sleep + time since trained + perf ──
  const lastTrain = sessions[sessions.length - 1].date;
  const daysSince = daysBetween(lastTrain, t);
  const lastNight = sleep.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  let readinessScore = 70;
  if (lastNight && daysBetween(lastNight.date, t) <= 1) { readinessScore += (lastNight.duration - 7) * 6; if (lastNight.quality === "Poor" || lastNight.quality === "Fair") readinessScore -= 12; }
  readinessScore -= clamp((perfFat - 45) * 0.5, -15, 25);
  if (daysSince === 0) readinessScore -= 8;
  readinessScore = clamp(readinessScore, 0, 100);
  const readiness = readinessScore >= 66 ? "Green" : readinessScore >= 45 ? "Amber" : "Red";
  const readinessColor = readiness === "Green" ? "#8fd989" : readiness === "Amber" ? "#f9c97e" : "#f47e6e";

  // ── DELOAD: performance decline AND ≥1 corroborator ──
  const perfDecline = e1rmTrendPct != null && e1rmTrendPct <= -2;
  const corroborators = [];
  if (wellKnown && wellFat >= 60) corroborators.push("low/declining sleep vs your baseline");
  if (loadRatio != null && loadRatio >= 1.3) corroborators.push(`acute load ${loadRatio}× your chronic load`);
  if (sleepDebtH >= 4) corroborators.push(`~${sleepDebtH}h sleep debt this week`);
  if (deficitFrac >= 0.12) corroborators.push("sizeable calorie deficit");
  if (rpeDriftZ >= 1) corroborators.push("RPE drifting up for the same work");
  const deloadRecommended = perfDecline && corroborators.length >= 1;

  // ── PER-MUSCLE FATIGUE (recent stimulus vs tolerance) ──
  const RW = 3; // recovery window (days)
  const recentSets = {}; MUSCLE_KEYS.forEach(k => (recentSets[k] = 0));
  const lastHit = {};
  sessions.filter(s => s.date >= since(RW)).forEach(s => (s.exercises || []).forEach(x => { const m = resolveMuscle(x.name); const w = (x.sets || []).filter(isWorking).length; if (m && recentSets[m] != null) { recentSets[m] += w; if (w) lastHit[m] = s.date; } }));
  const perMuscle = MUSCLE_KEYS.map(k => {
    const sets = recentSets[k], max = MUSCLE_RANGE[k][1];
    let state = "Fresh";
    if (sets > 0) state = sets >= max * 0.55 ? "Overreached" : "Accumulating";
    return { key: k, label: MUSCLES[k].label, recentSets: sets, lastTrained: lastHit[k] || null, daysSince: lastHit[k] ? daysBetween(lastHit[k], t) : null, state };
  });
  const overreached = perMuscle.filter(m => m.state === "Overreached").map(m => m.label);

  const known = [perfKnown, wellKnown, true].filter(Boolean).length; // load always known
  const confidence = perfKnown && wellKnown ? "moderate" : "low";

  return {
    ready: true, tier: "estimate", confidence,
    finalFatigue, band, bandColor, chronicFatigue: Math.round(chronicFatigue), penalty,
    layers: { performance: Math.round(perfFat), wellness: Math.round(wellFat), load: Math.round(loadFat) },
    performance: { e1rmTrendPct, rpeDriftZ, exercisesTracked: trends.length, known: perfKnown },
    load: { acute: Math.round(acute), chronic: Math.round(chronic), ratio: loadRatio, durationEstimated: recentDur },
    wellness: { known: wellKnown, sleepDebtH, note: wellKnown ? "Sleep-based proxy (energy/mood/soreness not logged)." : "Not enough sleep logs." },
    readiness, readinessColor, readinessScore: Math.round(readinessScore),
    deload: { recommended: deloadRecommended, perfDecline, corroborators },
    perMuscle, overreached,
    missing: ["energy", "mood", "soreness", "motivation"],
    note: "Estimated fatigue. Energy/mood/soreness aren't logged in FitLog yet, so Wellness uses sleep as a partial proxy and confidence is capped.",
  };
}

// tiny local Mifflin (avoid circular import surprises); mirrors energy.js
function require_mifflin(p, bw) {
  const sex = (p.sex || "").toLowerCase();
  const age = parseFloat(p.age), h = parseFloat(p.heightCm);
  if (!bw || !age || !h || !(sex === "male" || sex === "female")) return 0;
  return Math.round(10 * bw + 6.25 * h - 5 * age + (sex === "male" ? 5 : -161));
}
