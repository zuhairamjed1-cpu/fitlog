// ─── GOAL PLAN ENGINE (Phase 1) ─────────────────────────────────────────────
// Forward-looking, honesty-tiered planning. Everything here is a transparent
// DETERMINISTIC calculation or projection — no trained model, no fabricated
// probabilities. Each output carries a tier so the UI can label it:
//   measured  (Tier 1) — logged facts
//   calc      (Tier 2) — validated formulas (rates, required pace)
//   estimate  (Tier 3) — model-based inference (recovery, adherence)
//   forecast  (Tier 4) — projections (where the trend lands) — never facts
//
// Science notes (rough, evidence-based STARTING POINTS, not individual truth):
//  • Natural muscle gain slows with training age: ~1–1.5%/mo of bodyweight for a
//    novice, ~0.5–0.7%/mo intermediate, ~0.25–0.35%/mo advanced (Aragon/McDonald).
//  • A "lean" bulk adds ~0.25–0.5% BW/week total; faster skews to fat.
//  • Sustainable fat loss is ~0.5–1.0% BW/week; past ~1.25%/wk muscle-loss and
//    rebound risk climb. Higher body-fat tolerates the faster end.

import { computeWeightTrend } from "./weight.js";
import { computeRecovery } from "./recovery.js";
import { estimateSleepNeed, sleepTST } from "./sleep.js";
import { getTodayStr, daysAgo } from "../lib/dates.js";

const r1 = x => (x == null ? null : Math.round(x * 10) / 10);
const r2 = x => (x == null ? null : Math.round(x * 100) / 100);
const DAY = 86400000;
const weeksBetween = (a, b) => { if (!a || !b) return null; return (new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / (7 * DAY); };

// monthly muscle-gain potential as %BW, and sustainable weekly TOTAL-gain ceiling
const MUSCLE_PCT_MO = { novice: 1.2, intermediate: 0.6, advanced: 0.3 };
const GAIN_MAX_PCT_WK = { novice: 0.5, intermediate: 0.35, advanced: 0.25 };
const LOSS_SUST_MAX_PCT_WK = 1.0;   // top of the sustainable fat-loss band
const LOSS_HARD_PCT_WK = 1.25;      // above this: muscle-loss / adherence risk

export function assessGoal({ goalPlan, currentWeight }) {
  const sw = goalPlan.startWeight ?? currentWeight;
  const gw = goalPlan.goalWeight;
  const weeks = weeksBetween(goalPlan.startDate, goalPlan.targetDate);
  const exp = goalPlan.experience || "intermediate";
  if (gw == null || sw == null || !weeks || weeks <= 0 || !currentWeight) return null;

  const totalChange = gw - sw;
  const reqKgWk = totalChange / weeks;
  const reqPctWk = (reqKgWk / currentWeight) * 100;
  const dir = Math.abs(totalChange) < 0.5 ? "maintain" : totalChange > 0 ? "gain" : "loss";

  let verdict = "realistic", note = "", expectedMuscleKg = null, expectedFatKg = null, realisticWeeks = null, realisticGoalWeight = null;

  if (dir === "gain") {
    const maxKgWk = (GAIN_MAX_PCT_WK[exp] / 100) * currentWeight;
    const months = weeks / 4.345;
    const muscleCap = (MUSCLE_PCT_MO[exp] / 100) * currentWeight * months;
    expectedMuscleKg = [r1(Math.min(totalChange, muscleCap * 0.7)), r1(Math.min(totalChange, muscleCap))];
    expectedFatKg = [r1(Math.max(0, totalChange - expectedMuscleKg[1])), r1(Math.max(0, totalChange - expectedMuscleKg[0]))];
    realisticWeeks = Math.ceil(totalChange / maxKgWk);
    realisticGoalWeight = r1(sw + maxKgWk * weeks);
    if (reqKgWk > maxKgWk * 1.4) verdict = "unrealistic";
    else if (reqKgWk > maxKgWk) verdict = "aggressive";
    note = verdict === "unrealistic"
      ? `Gaining ${r1(totalChange)}kg in ${Math.round(weeks)} weeks needs ~${r2(reqKgWk)}kg/wk — well above the ~${r2(maxKgWk)}kg/wk an ${exp} lifter adds as mostly muscle. Most of the excess would be fat.`
      : verdict === "aggressive"
        ? `This pace (~${r2(reqKgWk)}kg/wk) is a touch above the lean-gain ceiling (~${r2(maxKgWk)}kg/wk) — expect some extra fat. Slowing down keeps the gain leaner.`
        : `~${r2(reqKgWk)}kg/wk sits inside the lean-gain range for an ${exp} lifter — a sensible muscle-building pace.`;
  } else if (dir === "loss") {
    const lossKgWk = -reqKgWk;
    const sustMax = (LOSS_SUST_MAX_PCT_WK / 100) * currentWeight;
    const hardMax = (LOSS_HARD_PCT_WK / 100) * currentWeight;
    realisticWeeks = Math.ceil((-totalChange) / sustMax);
    realisticGoalWeight = r1(sw - sustMax * weeks);
    if (lossKgWk > hardMax) verdict = "unrealistic";
    else if (lossKgWk > sustMax) verdict = "aggressive";
    note = verdict === "unrealistic"
      ? `Losing ${r1(-totalChange)}kg in ${Math.round(weeks)} weeks is ~${r2(lossKgWk)}kg/wk (${r1(-reqPctWk)}%/wk) — above the ~${LOSS_HARD_PCT_WK}%/wk ceiling. Hard to do without losing muscle and rebounding.`
      : verdict === "aggressive"
        ? `~${r2(lossKgWk)}kg/wk is on the fast side. Keep protein high and keep lifting to hold onto muscle.`
        : `~${r2(lossKgWk)}kg/wk is a sustainable fat-loss pace.`;
  } else {
    note = "Maintenance — hold bodyweight while improving composition or performance. Realistic by definition; consistency is the whole game.";
  }

  return { weeks: r1(weeks), reqKgWk: r2(reqKgWk), reqPctWk: r2(reqPctWk), dir, verdict, note, expectedMuscleKg, expectedFatKg, realisticWeeks, realisticGoalWeight, exp, totalChange: r1(totalChange), startWeight: sw, goalWeight: gw };
}

// Verdict for a phase given only a weekly RATE (kg/wk) — same ceilings as assessGoal.
function verdictFromRate(rate, weight, exp) {
  const dir = rate > 0.02 ? "gain" : rate < -0.02 ? "loss" : "maintain";
  if (dir === "gain") {
    const maxKgWk = (GAIN_MAX_PCT_WK[exp] / 100) * weight;
    const verdict = rate > maxKgWk * 1.4 ? "unrealistic" : rate > maxKgWk ? "aggressive" : "realistic";
    return { dir, verdict, note: `~${r2(rate)}kg/wk vs a lean-gain ceiling of ~${r2(maxKgWk)}kg/wk for an ${exp} lifter.` };
  }
  if (dir === "loss") {
    const loss = -rate, sustMax = (LOSS_SUST_MAX_PCT_WK / 100) * weight, hardMax = (LOSS_HARD_PCT_WK / 100) * weight;
    const verdict = loss > hardMax ? "unrealistic" : loss > sustMax ? "aggressive" : "realistic";
    return { dir, verdict, note: `~${r2(loss)}kg/wk loss vs a sustainable ~${r2(sustMax)}kg/wk ceiling.` };
  }
  return { dir, verdict: "realistic", note: "Maintenance pace — composition/performance work." };
}

// ─── PER-PHASE ROADMAP ANALYSIS ──────────────────────────────────────────────
// Runs the SAME evidence-based reality check on every phase of an imported plan,
// so each leg (bulk / cut / recomp / mini-cut) gets its own verdict + risk flags.
// Weight-anchored phases reuse assessGoal verbatim; rate-only phases (e.g. a plan
// that just says "+0.25kg/week") use verdictFromRate. Chains start-weights forward
// when a phase doesn't state its own. Everything stays tier-honest: forecasts are
// modeled ranges, never measured.
export function analyzeRoadmap({ phases, currentWeight, experience = "intermediate" }) {
  if (!Array.isArray(phases) || !phases.length) return null;
  const exp = ["novice", "intermediate", "advanced"].includes(experience) ? experience : "intermediate";
  let prevGoal = null, totalWeeks = 0;
  const typeCounts = {}, risks = [], out = [];
  phases.forEach(p => {
    typeCounts[p.type] = (typeCounts[p.type] || 0) + 1;
    const weeks = weeksBetween(p.startDate, p.endDate);
    if (weeks && weeks > 0) totalWeeks += weeks;
    const sw = p.startWeight ?? prevGoal ?? currentWeight ?? null;
    let gw = p.goalWeight ?? null;
    if (gw == null && p.targetRate != null && sw != null && weeks && weeks > 0) gw = r1(sw + p.targetRate * weeks);

    let a = null;
    if (sw != null && gw != null && weeks && weeks > 0) {
      a = assessGoal({ goalPlan: { startWeight: sw, goalWeight: gw, startDate: p.startDate, targetDate: p.endDate, experience: exp }, currentWeight: sw });
    }
    let dir = a ? a.dir : null, verdict = a ? a.verdict : null, note = a ? a.note : null;
    const rate = a ? a.reqKgWk : (p.targetRate != null ? p.targetRate : null);
    if (!a && rate != null && (sw || currentWeight)) {
      const v = verdictFromRate(rate, sw || currentWeight, exp); dir = v.dir; verdict = v.verdict; note = v.note;
    }
    if (!dir) dir = (p.type === "cut" || p.type === "minicut") ? "loss" : p.type === "maintenance" ? "maintain" : "gain";

    const phaseRisks = [];
    if (verdict === "unrealistic") phaseRisks.push(dir === "gain" ? "Surplus likely too high — excess skews to fat" : dir === "loss" ? "Deficit too aggressive — muscle-loss & rebound risk" : "Pace exceeds evidence");
    else if (verdict === "aggressive") phaseRisks.push(dir === "gain" ? "Slightly fast gain — expect some extra fat" : dir === "loss" ? "Fast cut — keep protein high & keep lifting" : "On the fast side");
    if (weeks != null && weeks > 0 && weeks < 2) phaseRisks.push("Very short phase — limited adaptation window");
    if (p.calories == null && p.targetRate == null) phaseRisks.push("No calorie or rate target set");
    phaseRisks.forEach(r => risks.push(`${p.name || p.type}: ${r}`));

    out.push({
      id: p.id, name: p.name, type: p.type, startDate: p.startDate, endDate: p.endDate,
      weeks: r1(weeks), startWeight: sw, goalWeight: gw, calories: p.calories ?? null, protein: p.protein ?? null,
      targetRate: rate == null ? null : r2(rate), focus: p.focus || null,
      dir, verdict: verdict || "realistic", note,
      expectedMuscleKg: a ? a.expectedMuscleKg : null, expectedFatKg: a ? a.expectedFatKg : null,
      risks: phaseRisks,
    });
    if (gw != null) prevGoal = gw;
  });
  const order = { unrealistic: 3, aggressive: 2, realistic: 1 };
  const planVerdict = out.reduce((w, p) => (order[p.verdict] || 0) > (order[w] || 0) ? p.verdict : w, "realistic");
  return { phases: out, planVerdict, risks, totalWeeks: r1(totalWeeks), typeCounts, count: out.length, tier: "forecast" };
}

export function buildTrajectory({ goalPlan, weightTrend, today }) {
  const sw = goalPlan.startWeight, gw = goalPlan.goalWeight;
  if (sw == null || gw == null || !goalPlan.startDate || !goalPlan.targetDate) return null;
  const totalWeeks = weeksBetween(goalPlan.startDate, goalPlan.targetDate);
  const elapsed = Math.max(0, weeksBetween(goalPlan.startDate, today));
  const frac = totalWeeks > 0 ? Math.min(1, elapsed / totalWeeks) : 0;
  const expectedNow = sw + (gw - sw) * frac;
  const actualNow = weightTrend && weightTrend.current != null ? weightTrend.current : null;
  const deviation = actualNow != null ? r1(actualNow - expectedNow) : null;
  const goingUp = gw > sw;

  let status = "no-data";
  if (deviation != null) {
    const tol = Math.max(0.6, Math.abs(gw - sw) * 0.06);
    if (Math.abs(deviation) <= tol) status = "on-track";
    else if ((goingUp && deviation > 0) || (!goingUp && deviation < 0)) status = "ahead";
    else status = "behind";
  }
  const rate = weightTrend && weightTrend.ratePerWeekKg != null ? weightTrend.ratePerWeekKg : null;
  const weeksLeft = Math.max(0, totalWeeks - elapsed);
  const projectedEnd = (actualNow != null && rate != null) ? r1(actualNow + rate * weeksLeft) : null;
  const projGap = projectedEnd != null ? r1(projectedEnd - gw) : null;

  return { totalWeeks: r1(totalWeeks), elapsed: r1(elapsed), weeksLeft: r1(weeksLeft), expectedNow: r1(expectedNow), actualNow, deviation, status, rate: r2(rate), projectedEnd, projGap, startWeight: sw, goalWeight: gw, goingUp };
}

export function analyzeConstraints({ data, goals, goalPlan, recovery }) {
  const last14 = Array.from({ length: 14 }, (_, i) => daysAgo(i));
  const inWin = d => last14.includes(d);

  const dietDays = new Set((data.diet || []).filter(d => inWin(d.date)).map(d => d.date));
  const calScore = Math.round((dietDays.size / 14) * 100);

  const pByDay = {};
  (data.diet || []).filter(d => inWin(d.date)).forEach(d => { pByDay[d.date] = (pByDay[d.date] || 0) + (d.protein || 0); });
  const pVals = Object.values(pByDay);
  const meanP = pVals.length ? pVals.reduce((a, b) => a + b, 0) / pVals.length : 0;
  const proteinScore = goals && goals.protein ? Math.min(100, Math.round((meanP / goals.protein) * 100)) : null;

  const trainDays = new Set([...(data.exercise || []), ...(data.sports || [])].filter(s => inWin(s.date)).map(s => s.date));
  const perWk = trainDays.size / 2;
  const freq = (goalPlan && goalPlan.freq) || 4;
  const trainScore = Math.min(100, Math.round((perWk / freq) * 100));

  const need = estimateSleepNeed(data, goals).hours;
  const tsts = (data.sleep || []).filter(s => inWin(s.date)).map(s => sleepTST(s)).filter(x => x != null);
  const avgT = tsts.length ? tsts.reduce((a, b) => a + b, 0) / tsts.length : null;
  const sleepScore = avgT != null ? Math.min(100, Math.round((avgT / need) * 100)) : null;

  const recScore = recovery && recovery.readiness != null ? recovery.readiness : null;

  const levers = [
    { key: "calories", label: "Calories", score: calScore, tier: "calc", detail: `${dietDays.size}/14 days logged`, rec: "Log food consistently and hit your calorie target — it's the lever everything else rides on." },
    { key: "protein", label: "Protein", score: proteinScore, tier: "measured", detail: proteinScore != null ? `~${Math.round(meanP)}g/day vs ${goals.protein}g` : "no data", rec: `Get protein toward ${(goals && goals.protein) || "~1.8 g/kg"}g daily to build/keep muscle.` },
    { key: "training", label: "Training", score: trainScore, tier: "measured", detail: `~${r1(perWk)}×/wk vs ${freq}×`, rec: `Hit your ${freq}×/week sessions — that's what drives the adaptation.` },
    { key: "sleep", label: "Sleep", score: sleepScore, tier: "measured", detail: avgT != null ? `~${r1(avgT)}h vs ${need}h need` : "no data", rec: `Move sleep toward your ~${need}h need — it gates recovery and gains.` },
    { key: "recovery", label: "Recovery", score: recScore, tier: "estimate", detail: recScore != null ? `readiness ${recScore}/100` : "no data", rec: "Ease volume or add a rest day — recovery is lagging behind your training." },
  ].filter(l => l.score != null);

  const primary = levers.length ? levers.slice().sort((a, b) => a.score - b.score)[0] : null;
  return { levers, primary };
}

export function goalProbability({ assess, trajectory, constraints, weightConfidence }) {
  if (!assess || !trajectory || trajectory.status === "no-data") return null;
  const totalAbs = Math.max(Math.abs(assess.totalChange || 1), 1);
  const projGap = trajectory.projGap != null ? Math.abs(trajectory.projGap) : null;
  // how close the current trend projects to the goal (1 = lands on it, 0 = off by half the journey)
  const alignment = projGap == null ? 0.5 : Math.max(0, 1 - projGap / Math.max(totalAbs * 0.5, 1));
  const levers = (constraints && constraints.levers) || [];
  const adherence = levers.length ? levers.reduce((a, l) => a + l.score, 0) / levers.length / 100 : 0.5;
  const realismMap = { realistic: 1, aggressive: 0.6, unrealistic: 0.25 };
  const realism = realismMap[assess.verdict] != null ? realismMap[assess.verdict] : 0.6;
  let pct = Math.round(100 * (0.45 * alignment + 0.35 * adherence + 0.20 * realism));
  pct = Math.min(pct, Math.round(realism * 100) + 15);   // an unrealistic goal can't score high, period
  pct = Math.max(2, Math.min(98, pct));
  const confMap = { high: "moderate", moderate: "low–moderate", low: "low" };
  return {
    pct, confidence: confMap[weightConfidence] || "low",
    inputs: [
      { label: "Trajectory alignment", val: `${Math.round(alignment * 100)}%`, w: "45%" },
      { label: "Adherence", val: `${Math.round(adherence * 100)}%`, w: "35%" },
      { label: "Goal realism", val: assess.verdict, w: "20%" },
    ],
  };
}

export function buildForecasts({ trajectory }) {
  if (!trajectory || trajectory.actualNow == null || trajectory.rate == null) return null;
  const cur = trajectory.actualNow, rate = trajectory.rate;
  const at = wk => r1(cur + rate * wk);
  return { rate, current: cur, d30: at(30 / 7), d90: at(90 / 7), atGoalDate: trajectory.projectedEnd, weeksLeft: trajectory.weeksLeft, goalWeight: trajectory.goalWeight };
}

export function assessRisks({ assess, trajectory, constraints, recovery }) {
  const risks = [];
  const lever = k => ((constraints && constraints.levers) || []).find(l => l.key === k);
  const proteinL = lever("protein"), sleepL = lever("sleep");
  const levers = (constraints && constraints.levers) || [];
  const adherence = levers.length ? levers.reduce((a, l) => a + l.score, 0) / levers.length : null;
  const dir = assess && assess.dir, rate = trajectory && trajectory.rate, elapsed = trajectory && trajectory.elapsed;
  const cur = (trajectory && trajectory.actualNow) || (assess && assess.startWeight) || null;

  if (rate != null && Math.abs(rate) < 0.05 && (dir === "gain" || dir === "loss") && elapsed >= 3)
    risks.push({ key: "plateau", label: "Plateau", level: "moderate", tier: "estimate", why: `Trend weight has been ~flat (${rate} kg/wk) for ${Math.round(elapsed)} weeks while you're aiming to ${dir} — progress has stalled.` });

  if (dir === "gain" && rate != null && cur && rate > (0.5 / 100) * cur * 1.1)
    risks.push({ key: "fat", label: "Excess fat gain", level: rate > (0.7 / 100) * cur ? "high" : "moderate", tier: "estimate", why: `You're gaining ~${rate} kg/wk — above the lean-gain ceiling, so a growing share of that is fat.` });

  if (dir === "loss") {
    const lossWk = rate != null ? -rate : null;
    const tooFast = cur && lossWk != null && lossWk > (1.25 / 100) * cur;
    const lowProtein = proteinL && proteinL.score < 70;
    if (tooFast || lowProtein)
      risks.push({ key: "muscle", label: "Muscle loss", level: tooFast && lowProtein ? "high" : "moderate", tier: "estimate", why: `${tooFast ? `Losing ~${lossWk.toFixed(2)} kg/wk is aggressive` : ""}${tooFast && lowProtein ? ", and " : ""}${lowProtein ? "protein is low for a deficit" : ""} — that puts muscle at risk.` });
  }

  if (recovery && recovery.readiness != null && recovery.readiness < 55)
    risks.push({ key: "burnout", label: "Burnout / overreaching", level: recovery.readiness < 40 ? "high" : "moderate", tier: "estimate", why: `Recovery readiness is ${recovery.readiness}/100${sleepL && sleepL.score < 80 ? " and sleep is running short" : ""} — fatigue may be outrunning recovery.` });

  if ((assess && assess.verdict === "unrealistic") || (adherence != null && adherence < 50 && trajectory && trajectory.status === "behind"))
    risks.push({ key: "failure", label: "Goal-date risk", level: assess && assess.verdict === "unrealistic" ? "high" : "moderate", tier: "forecast", why: assess && assess.verdict === "unrealistic" ? "The goal itself sits above what's biologically likely in this timeline." : "You're behind pace with low adherence — the target date is at risk on the current trend." });

  return risks;
}

export function formatGoalText(gp) {
  if (!gp) return "";
  const L = [], a = gp.assess, t = gp.trajectory, c = gp.constraints, f = gp.forecasts, p = gp.probability;
  L.push(`GOAL: ${gp.goalPlan.type} — ${gp.goalPlan.startWeight}kg → ${gp.goalPlan.goalWeight}kg over ${a ? Math.round(a.weeks) : "?"} weeks (${gp.goalPlan.experience}, ${gp.goalPlan.freq}x/wk).`);
  if (a) L.push(`REALITY: ${a.verdict}. Needs ${a.reqKgWk} kg/wk. ${a.note}`);
  if (t) L.push(`TRAJECTORY: ${t.status}. Should be ~${t.expectedNow}kg, actually ~${t.actualNow}kg (off ${t.deviation}kg). Current trend ${t.rate} kg/wk → projected ${t.projectedEnd}kg at target (${t.projGap > 0 ? "+" : ""}${t.projGap}kg vs goal).`);
  if (p) L.push(`GOAL PROBABILITY (heuristic): ${p.pct}% — alignment ${p.inputs[0].val}, adherence ${p.inputs[1].val}, realism ${a ? a.verdict : "?"}.`);
  if (f) L.push(`FORECAST (current trend): 30d ~${f.d30}kg, 90d ~${f.d90}kg, target date ~${f.atGoalDate}kg.`);
  if (c && c.levers.length) L.push(`LEVERS (0-100): ${c.levers.map(l => `${l.label} ${l.score}`).join(", ")}. Primary constraint: ${c.primary ? c.primary.label : "none"}.`);
  if (gp.risks && gp.risks.length) L.push(`RISKS: ${gp.risks.map(r => `${r.label} (${r.level})`).join(", ")}.`);
  return L.join("\n");
}

// ─── COUNTERFACTUAL SIMULATOR ───────────────────────────────────────────────
// "What if I…" — shift one or more inputs and project the outcome at the goal
// date. Energy balance (~7700 kcal/kg) is reasonably predictable in aggregate
// (moderate confidence); protein/sleep composition effects are qualitative
// (low confidence). Everything here is a forecast, never a fact.
const CARDIO_KCAL = 300; // rough kcal per added cardio session
export function simulateGoal({ gp, calDelta = 0, cardioPerWk = 0, proteinGkg = null, sleepH = null }) {
  const t = gp && gp.trajectory;
  if (!t || t.projectedEnd == null || t.goalWeight == null) return null;
  const weeksLeft = Math.max(0, t.weeksLeft || 0);
  const cardioKcalDay = (cardioPerWk * CARDIO_KCAL) / 7;
  const netDailyKcal = calDelta - cardioKcalDay;               // + surplus shift, − deficit shift
  const deltaKg = (netDailyKcal * 7 * weeksLeft) / 7700;       // energy balance over the time left
  const baseProjected = t.projectedEnd;
  const simProjected = r1(baseProjected + deltaKg);
  const baseGap = r1(baseProjected - t.goalWeight);
  const simGap = r1(simProjected - t.goalWeight);
  const closer = Math.abs(simGap) < Math.abs(baseGap) - 0.2 ? "closer" : Math.abs(simGap) > Math.abs(baseGap) + 0.2 ? "further" : "about the same";

  const proteinOk = proteinGkg == null ? null : proteinGkg >= 1.6;
  const sleepOk = sleepH == null ? null : sleepH >= 7;
  const surplus = netDailyKcal > 60, deficit = netDailyKcal < -60;
  let env, envNote;
  if (surplus) { env = "Muscle-building"; envNote = `Net surplus${proteinOk === false ? ", but protein looks low for lean gains" : proteinOk ? " with enough protein" : ""}${sleepOk === false ? "; short sleep blunts growth & partitioning" : ""}.`; }
  else if (deficit) { env = "Fat-loss"; envNote = `Net deficit${proteinOk ? " with protein high enough to protect muscle" : proteinGkg != null ? ", but low protein risks muscle loss" : ""}${sleepOk === false ? "; short sleep worsens retention & hunger" : ""}.`; }
  else { env = "Maintenance"; envNote = "Roughly energy-balanced — good for recomp or holding."; }

  const changes = [];
  if (calDelta) changes.push(`${calDelta > 0 ? "+" : ""}${calDelta} kcal/day`);
  if (cardioPerWk) changes.push(`+${cardioPerWk}× cardio/wk (~${Math.round(cardioKcalDay)} kcal/day)`);
  if (proteinGkg != null) changes.push(`protein ${proteinGkg} g/kg`);
  if (sleepH != null) changes.push(`sleep ${sleepH} h`);

  return {
    weeksLeft: r1(weeksLeft), netDailyKcal: Math.round(netDailyKcal), deltaKg: r1(deltaKg),
    baseProjected, simProjected, baseGap, simGap, goalWeight: t.goalWeight, goingUp: t.goingUp,
    closer, env, envNote, changes,
    confidence: (proteinGkg != null || sleepH != null) ? "low" : "low–moderate",
  };
}

export function computeGoalPlan(data, goals) {
  const gp = goals && goals.goalPlan;
  if (!gp || gp.goalWeight == null || !gp.targetDate || !gp.startDate) return null;
  const wt = computeWeightTrend(data);
  const currentWeight = (wt && wt.current != null) ? wt.current : (gp.startWeight ?? (goals.profile && goals.profile.weightKg) ?? null);
  const recovery = computeRecovery(data, goals);
  const assess = assessGoal({ goalPlan: gp, currentWeight });
  const trajectory = buildTrajectory({ goalPlan: gp, weightTrend: wt, today: getTodayStr() });
  const startMs = new Date(gp.startDate + "T00:00:00").getTime();
  const actualPts = (data.weight || []).filter(w => w && w.kg > 0 && w.date >= gp.startDate)
    .map(w => ({ x: +(((new Date(w.date + "T00:00:00") - startMs) / (7 * DAY))).toFixed(2), y: w.kg }))
    .sort((a, b) => a.x - b.x);
  const constraints = analyzeConstraints({ data, goals, goalPlan: gp, recovery });
  const probability = goalProbability({ assess, trajectory, constraints, weightConfidence: (wt && wt.confidence) || null });
  const forecasts = buildForecasts({ trajectory });
  const risks = assessRisks({ assess, trajectory, constraints, recovery });
  return { goalPlan: gp, assess, trajectory, actualPts, constraints, probability, forecasts, risks, currentWeight, weightConfidence: (wt && wt.confidence) || null };
}
