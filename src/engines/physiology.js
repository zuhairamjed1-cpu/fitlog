// ─── PHYSIOLOGY STATE LAYER (Steps 1 + 2) ───────────────────────────────────
// One object every other engine can read instead of re-deriving sleep/recovery/
// adherence. Every field carries { tier, confidence } so nothing soft is ever
// laundered into something that looks measured. Soft scores are decomposed and
// banded — the integer is de-emphasised on purpose.
//
// Honesty notes:
//  • Recovery debt is a leaky integrator — its WEIGHTS are educated guesses, so
//    it is reported RELATIVE TO THE USER'S OWN BASELINE + a direction, never as
//    an absolute "score".
//  • Alignment = process (are inputs serving the goal now). Momentum = outcome
//    (are we actually moving toward it). Kept deliberately separate.
//  • This module imports NO goalplan code (one-way DAG: goalplan may read this).

import { computeWeightTrend } from "./weight";
import { computeRecovery } from "./recovery";
import { computeTraining } from "./training";
import { computeEnergyBalance } from "./energy";
import { estimateSleepNeed, sleepTST } from "./sleep";
import { activePhase, phaseReqRate, phaseDir } from "./phases";
import { getTodayStr, daysAgo } from "../lib/dates";

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r1 = x => (x == null ? null : Math.round(x * 10) / 10);
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// ── per-day strain vs recovery (inputs to the debt integrator) ──
function dayStrainRecovery(data, date, need) {
  const exDay = (data.exercise || []).filter(e => e.date === date).length;
  const sp = (data.sports || []).filter(s => s.date === date);
  const sportMin = sp.reduce((a, s) => a + (+s.duration || +s.durationMin || 45), 0);
  const trained = exDay > 0 || sp.length > 0;
  const trainLoad = clamp((exDay > 0 ? 1 : 0) + sportMin / 90, 0, 2.4);
  const sl = (data.sleep || []).find(s => s.date === date);
  const tst = sl ? sleepTST(sl) : null;
  const sleepDebtH = tst != null ? Math.max(0, need - tst) : 0;
  const sleptEnough = tst != null && tst >= need - 0.5;
  const nic = (data.nicotine || []).filter(n => n.date === date).length;
  const jr = (data.journal || []).find(j => j.date === date);
  const stress = jr && jr.stress != null ? clamp(jr.stress / 5, 0, 1) : 0;
  const strain = 1.0 * trainLoad + 1.1 * clamp(sleepDebtH / 2, 0, 2) + 0.25 * Math.min(nic, 4) + 0.6 * stress;
  const recovery = 1.0 * (sleptEnough ? 1 : 0) + 0.8 * (!trained ? 1 : 0);
  return { strain, recovery, net: strain - recovery, trained, tst, trainLoad };
}

export function computeRecoveryDebt(data, goals) {
  const need = estimateSleepNeed(data, goals).hours;
  const N = 28;
  const days = Array.from({ length: N }, (_, i) => daysAgo(N - 1 - i));
  let debt = 0; const series = []; const nets = [];
  days.forEach(d => {
    const sr = dayStrainRecovery(data, d, need);
    debt = clamp(debt * 0.85 + sr.net, 0, 40);
    series.push({ date: d, debt: +debt.toFixed(2) });
    nets.push(sr.net);
  });
  const cur = series[series.length - 1].debt;
  const baseline = mean(series.map(s => s.debt)) || 0;
  const recentNet = mean(nets.slice(-7)) || 0;
  const relPct = baseline > 0.5 ? Math.round((cur / baseline - 1) * 100) : 0;
  const trend = relPct > 15 ? "rising" : relPct < -15 ? "falling" : "steady";
  const THRESH = Math.max(baseline * 1.8, 12);
  const burnoutDays = (recentNet > 0.05 && cur < THRESH) ? Math.ceil((THRESH - cur) / recentNet) : null;
  const hasData = (data.sleep || []).length + (data.exercise || []).length + (data.sports || []).length >= 5;
  return {
    value: +cur.toFixed(1), baseline: +baseline.toFixed(1), relPct, trend,
    recentNet: +recentNet.toFixed(2), burnoutDays, series, need, hasData,
    tier: "estimate", confidence: "low–moderate",
  };
}

// ── 14-day adherence (logs vs targets) ──
function adherence14(data, goals, phase) {
  const last14 = Array.from({ length: 14 }, (_, i) => daysAgo(i));
  const inWin = d => last14.includes(d);
  const dietDays = new Set((data.diet || []).filter(d => inWin(d.date)).map(d => d.date));
  const cal = Math.round((dietDays.size / 14) * 100);
  const pByDay = {};
  (data.diet || []).filter(d => inWin(d.date)).forEach(d => { pByDay[d.date] = (pByDay[d.date] || 0) + (d.protein || 0); });
  const meanP = mean(Object.values(pByDay)) || 0;
  const protein = (goals && goals.protein) ? clamp(Math.round((meanP / goals.protein) * 100), 0, 100) : null;
  const trainDays = new Set([...(data.exercise || []), ...(data.sports || [])].filter(s => inWin(s.date)).map(s => s.date));
  const perWk = trainDays.size / 2;
  const freq = (phase && phase.freq) || (goals && goals.goalPlan && goals.goalPlan.freq) || 4;
  const training = clamp(Math.round((perWk / freq) * 100), 0, 100);
  const parts = [cal, protein, training].filter(x => x != null);
  return { overall: parts.length ? Math.round(mean(parts)) : null, cal, protein, training, meanProtein: Math.round(meanP), perWk: r1(perWk), freq, tier: "calc" };
}

const band4 = (s, a, b, c) => (s >= a ? "On track" : s >= b ? "Drifting" : "Off track");

function computeAlignment({ reqRate, actualRate, dir, adh, rec, debt, cw, goalProtein }) {
  // trajectory: how close actual pace is to required pace (direction-aware)
  let traj = null;
  if (reqRate != null && actualRate != null) {
    if (Math.abs(reqRate) < 0.02) traj = Math.abs(actualRate) < 0.05 ? 95 : 60; // maintenance
    else { const ratio = actualRate / reqRate; traj = clamp(ratio <= 0 ? 20 : Math.round(100 - Math.abs(1 - ratio) * 80), 0, 100); }
  }
  const training = adh.training;
  const nutrition = adh.protein != null ? Math.round((adh.cal + adh.protein) / 2) : adh.cal;
  // recovery: readiness, docked when debt is rising
  let recovery = rec && rec.readiness != null ? rec.readiness : null;
  if (recovery != null && debt && debt.trend === "rising") recovery = Math.max(0, recovery - 12);
  // risk adjustment: rate above lean-gain ceiling, too-fast loss, or high debt
  let riskAdj = 0;
  if (dir === "gain" && actualRate != null && cw && actualRate > (0.5 / 100) * cw) riskAdj -= 8;
  if (dir === "loss" && actualRate != null && cw && -actualRate > (1.25 / 100) * cw) riskAdj -= 8;
  if (debt && debt.relPct > 30) riskAdj -= 6;
  const comps = { trajectory: traj, training, nutrition, recovery };
  const present = Object.values(comps).filter(x => x != null);
  const overall = present.length ? clamp(Math.round(mean(present) + riskAdj), 0, 100) : null;

  // ── why each lever is where it is + the highest-leverage fix ──
  const advice = [];
  // trajectory
  if (traj == null) advice.push({ lever: "Trajectory", score: null, why: "No weight trend yet to compare against your required pace.", fix: "Log your morning weight 3–4×/week so trajectory can read." });
  else if (traj < 80 && actualRate != null && reqRate != null) {
    if (dir === "gain") {
      if (actualRate < reqRate) advice.push({ lever: "Trajectory", score: traj, why: `Gaining ~${r1(actualRate)}kg/wk vs the +${r1(reqRate)} you need.`, fix: "Nudge intake up ~150 kcal/day, or tighten food logging if intake is being under-counted." });
      else advice.push({ lever: "Trajectory", score: traj, why: `Gaining ~${r1(actualRate)}kg/wk, faster than the +${r1(reqRate)} target.`, fix: "Trim the surplus ~200 kcal/day to bias toward lean tissue." });
    } else if (dir === "loss") {
      if (-actualRate < -reqRate) advice.push({ lever: "Trajectory", score: traj, why: `Losing ~${r1(Math.abs(actualRate))}kg/wk vs the ${r1(reqRate)} target — slower than planned.`, fix: "Tighten the deficit ~150 kcal/day or add light cardio." });
      else advice.push({ lever: "Trajectory", score: traj, why: `Losing ~${r1(Math.abs(actualRate))}kg/wk, faster than target — muscle-loss risk.`, fix: "Ease the deficit ~200 kcal/day and keep protein high." });
    }
  }
  // training
  if (training < 80) advice.push({ lever: "Training", score: training, why: `~${adh.perWk ?? "?"}×/wk logged vs ${adh.freq}× planned.`, fix: `Add ${Math.max(1, Math.ceil((adh.freq || 4) - (adh.perWk || 0)))} session(s)/week to hit your plan.` });
  // nutrition
  if (nutrition != null && nutrition < 80) {
    const bits = [];
    if (adh.cal < 80) bits.push(`food logged only ${Math.round(adh.cal / 100 * 14)}/14 days`);
    if (adh.protein != null && adh.protein < 80 && goalProtein) bits.push(`protein ~${adh.meanProtein}g vs ${goalProtein}g target`);
    advice.push({ lever: "Nutrition", score: nutrition, why: bits.length ? bits.join("; ") + "." : "Calories/protein are under target.", fix: adh.protein != null && adh.protein < 80 ? "Add a protein-dense meal or shake; log every meal so the read is real." : "Log every meal for two weeks to make this trustworthy." });
  }
  // recovery
  if (recovery != null && recovery < 80) {
    const bits = [`readiness ${rec && rec.readiness != null ? rec.readiness : "?"}/100`];
    if (debt && debt.trend === "rising") bits.push("recovery debt rising");
    advice.push({ lever: "Recovery", score: recovery, why: bits.join(", ") + (rec && rec.limiter ? ` — limiter: ${rec.limiter.label || rec.limiter.category}.` : "."), fix: "Protect sleep (consistent wake time, 7–9h) and take a rest day if you've trained several days straight." });
  }
  advice.sort((a, b) => (a.score == null ? -1 : b.score == null ? 1 : a.score - b.score));

  return {
    band: overall == null ? "no-data" : band4(overall, 80, 60), overall,
    components: comps, riskAdj, advice, tier: "estimate", confidence: "low–moderate",
  };
}

function computeMomentum({ reqRate, actualRate, trn, debt, adh }) {
  // gapClosing: is actual pace moving toward the goal at the expected rate?
  let gap = null;
  if (reqRate != null && actualRate != null) {
    if (Math.abs(reqRate) < 0.02) gap = Math.abs(actualRate) < 0.07 ? "on" : "off";
    else { const ratio = actualRate / reqRate; gap = ratio >= 0.7 ? "on" : ratio >= 0.3 ? "slow" : ratio >= -0.1 ? "stalled" : "reversing"; }
  }
  // strength outcome
  const prog = trn && trn.progression;
  const strength = !prog ? null : (prog.progressing > prog.stalls ? "up" : prog.progressing < prog.stalls ? "down" : "flat");
  // recovery outcome (debt direction)
  const recoveryDir = debt ? (debt.trend === "falling" ? "up" : debt.trend === "rising" ? "down" : "flat") : null;
  // band
  const score = (gap === "on" ? 2 : gap === "slow" ? 1 : gap === "stalled" ? 0 : gap === "reversing" ? -2 : 0)
    + (strength === "up" ? 1 : strength === "down" ? -1 : 0)
    + (recoveryDir === "down" ? -1 : 0);
  let mBand = gap == null ? "no-data" : score >= 2 ? "Strong" : score >= 1 ? "Steady" : score >= -1 ? "Stalling" : "Reversing";
  // the philosophical core: inputs lagging but outcomes on track → no action
  const outcomesOk = mBand === "Strong" || mBand === "Steady";
  const inputsLow = adh.overall != null && adh.overall < 70;
  const divergenceNote = (outcomesOk && inputsLow)
    ? "Inputs are lagging, but your weight, strength and recovery are still tracking toward the goal — no intervention needed."
    : null;
  return { band: mBand, components: { gapClosing: gap, strength, recovery: recoveryDir }, divergenceNote, tier: "estimate", confidence: "low–moderate" };
}

export function computePhysiologyState(data, goals, date = getTodayStr()) {
  const wt = computeWeightTrend(data);
  const rec = computeRecovery(data, goals);
  const trn = computeTraining(data, goals);
  const eb = computeEnergyBalance(data, goals);
  const debt = computeRecoveryDebt(data, goals);
  const phase = activePhase(goals && goals.goalPlan, date);
  const reqRate = phase ? phaseReqRate(phase) : null;
  const dir = phase ? phaseDir(phase) : null;
  const actualRate = wt && wt.ratePerWeekKg != null ? wt.ratePerWeekKg : null;
  const cw = (wt && wt.current != null) ? wt.current : ((goals.profile && goals.profile.weightKg) || null);
  const adh = adherence14(data, goals, phase);

  // energy balance (kcal/day vs maintenance). True EA needs FFM; this is the honest proxy.
  const energyAvailability = (eb && eb.ready)
    ? { value: eb.realDelta != null ? Math.round(eb.realDelta) : null, unit: "kcal/day vs maintenance", tdee: eb.tdee, intake: eb.meanIntake != null ? Math.round(eb.meanIntake) : null, tier: "calc", confidence: eb.confidence || "moderate" }
    : { value: null, unit: "kcal/day vs maintenance", tier: "calc", confidence: "low", note: "needs ~1–2 weeks of food + weight logs" };

  // training load: acute(7d) vs chronic(28d) → ACWR
  const dayLoad = d => { const ex = (data.exercise || []).some(e => e.date === d) ? 1 : 0; const sm = (data.sports || []).filter(s => s.date === d).reduce((a, s) => a + (+s.duration || +s.durationMin || 45), 0); return ex + sm / 90; };
  const last7 = Array.from({ length: 7 }, (_, i) => daysAgo(i));
  const last28 = Array.from({ length: 28 }, (_, i) => daysAgo(i));
  const acute = last7.reduce((a, d) => a + dayLoad(d), 0);
  const chronicWk = last28.reduce((a, d) => a + dayLoad(d), 0) / 4;
  const acwr = chronicWk > 0.3 ? +(acute / chronicWk).toFixed(2) : null;
  const trainingLoad = { acute: r1(acute), chronicWk: r1(chronicWk), acwr, tier: "calc", confidence: "moderate", note: acwr != null && acwr > 1.5 ? "load spiking vs your norm" : null };

  const fatigue = { value: rec && rec.readiness != null ? 100 - rec.readiness : null, tier: "estimate", confidence: "moderate", limiter: rec ? rec.limiter : null };

  // stress budget: allostatic sum vs the user's rolling ceiling (relative, not absolute)
  const stressUsed = clamp((debt.value / Math.max(debt.baseline, 4)) * 60 + (trainingLoad.acwr && trainingLoad.acwr > 1.3 ? 15 : 0) + (fatigue.value || 0) * 0.3, 0, 100);
  const stressBudget = { usedPct: Math.round(stressUsed), trend: debt.trend, tier: "estimate", confidence: "low", note: "rough allostatic load vs your own baseline" };

  const adherence = { overall: adh.overall, byLever: { cal: adh.cal, protein: adh.protein, training: adh.training }, detail: { meanProtein: adh.meanProtein, perWk: adh.perWk, freq: adh.freq }, tier: "calc", confidence: "high" };

  const alignment = computeAlignment({ reqRate, actualRate, dir, adh, rec, debt, cw, goalProtein: goals && goals.protein });
  const momentum = computeMomentum({ reqRate, actualRate, trn, debt, adh });

  // adaptation status summary (full proposal is in adaptation.js, Step 4)
  let adState = "no-goal";
  if (phase) {
    if (momentum.band === "Reversing" || alignment.band === "Off track") adState = "intervention";
    else if (momentum.band === "Stalling" || alignment.band === "Drifting") adState = "drifting";
    else adState = "on-track";
  }
  const adaptationStatus = { state: adState, tier: "estimate", confidence: "low–moderate" };

  return {
    date, hasGoal: !!phase, phase,
    reqRate, actualRate, currentWeight: cw,
    trend: { confidence: wt ? wt.confidence : null, spanDays: wt ? wt.spanDays : null },
    energyAvailability, trainingLoad, fatigue, recoveryDebt: debt, stressBudget,
    adherence, alignment, momentum, adaptationStatus,
  };
}
