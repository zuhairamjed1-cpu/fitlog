// ─── MACRO TARGET ENGINE ─────────────────────────────────────────────────────
// Derives calorie + macro targets from the active goal phase so the Log Meal tab
// can be driven by the plan. Honest rails:
//  • The surplus/deficit is built from the phase's required pace, but CLAMPED to
//    physiological ceilings (lean-gain ≤ ~0.5%BW/wk, loss ≤ ~1.0%BW/wk) so an
//    over-ambitious goal never produces a reckless target.
//  • Hard safety floor on calories (never below ~1.2×BMR / sex floor).
//  • Protein/fat are evidence-based g/kg starting points, not a prescription.
//  • Tiered: "measured" TDEE when there's enough logging, else "estimated".

import { computeEnergyBalance, mifflinBMR, KCAL_PER_KG } from "./energy";
import { computeWeightTrend } from "./weight";
import { activePhase, phaseReqRate, phaseDir } from "./phases";
import { getTodayStr } from "../lib/dates";

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// Total-daily-energy multipliers over BMR. Deliberately conservative — the high
// end of typical activity tables (1.7–1.9) routinely overshoots real maintenance
// by hundreds of kcal. Logged intake-vs-weight or the plan's own maintenance
// should override these whenever available.
const activityFactor = freq => (freq <= 2 ? 1.35 : freq <= 4 ? 1.45 : freq <= 5 ? 1.55 : 1.6);

export function computeMacroTargets(data, goals, date = getTodayStr()) {
  const wt = computeWeightTrend(data);
  const cw = (wt && wt.current != null) ? wt.current : ((goals.profile && parseFloat(goals.profile.weightKg)) || null);
  if (!cw) return { ready: false, reason: "Add your current weight (or log a few weigh-ins) to compute targets." };

  const gp = goals.goalPlan;
  const phase = activePhase(gp, date);
  const dir = phase ? phaseDir(phase) : "maintain";
  const reqRate = phase ? (phaseReqRate(phase) || 0) : 0;

  // clamp the pace used for the surplus/deficit to physiological ceilings
  const gainCeil = 0.005 * cw, lossFloor = -0.010 * cw;
  let usedRate = reqRate, clampedToCeiling = false;
  if (reqRate > gainCeil) { usedRate = gainCeil; clampedToCeiling = true; }
  if (reqRate < lossFloor) { usedRate = lossFloor; clampedToCeiling = true; }

  // TDEE — measured from logs if available, else the plan's stated maintenance, else Mifflin × activity
  const eb = computeEnergyBalance(data, goals);
  let tdee = (eb && eb.ready && eb.tdee) ? eb.tdee : null;
  let tdeeSource = tdee ? "measured" : null;
  const bmr = mifflinBMR(goals.profile, cw);
  const planMaint = gp && gp.roadmap && gp.roadmap.meta && gp.roadmap.meta.maintenance;
  if (!tdee && planMaint) { tdee = planMaint; tdeeSource = "plan"; }
  if (!tdee) {
    const freq = (gp && gp.freq) || 4;
    tdee = bmr ? Math.round(bmr * activityFactor(freq)) : null;
    tdeeSource = "estimated";
  }
  if (!tdee) return { ready: false, reason: "Add your profile (sex/age/height) or log food + weight so I can estimate TDEE." };

  const dailyDelta = Math.round((usedRate * KCAL_PER_KG) / 7);
  let calories = tdee + dailyDelta;
  let fromPlan = false;
  // if the active phase came from an imported plan with explicit calories, honour it
  if (phase && phase.calories && phase.calories > 0) { calories = phase.calories; fromPlan = true; }

  // hard safety floor
  const sexF = (goals.profile && (goals.profile.sex || "").toLowerCase().startsWith("f"));
  const floor = Math.max(bmr ? Math.round(bmr * 1.2) : 0, sexF ? 1200 : 1500);
  let flooredTo = null;
  if (calories < floor) { calories = floor; flooredTo = floor; }

  // protein: imported phase protein if present, else evidence-based g/kg
  const ppk = clamp(dir === "loss" ? 2.2 : dir === "gain" ? 2.0 : 1.8, 1.6, 2.4);
  const protein = (phase && phase.protein && phase.protein > 0) ? phase.protein : Math.round(ppk * cw);
  // fat: ~0.9 g/kg, hormone floor ~0.6
  const fat = Math.round(0.9 * cw);
  // carbs: remainder
  const carbKcal = Math.max(0, calories - protein * 4 - fat * 9);
  const carbs = Math.round(carbKcal / 4);

  return {
    ready: true, calories, protein, carbs, fat, fromPlan,
    tdee, tdeeSource, dailyDelta, usedRate: +usedRate.toFixed(3), reqRate: +(reqRate || 0).toFixed(3),
    clampedToCeiling, flooredTo, dir, proteinGkg: +ppk.toFixed(1), currentWeight: cw,
    tier: fromPlan ? "calc" : tdeeSource === "measured" ? "measured" : tdeeSource === "plan" ? "calc" : "estimate",
    confidence: tdeeSource === "measured" ? "moderate" : tdeeSource === "plan" || fromPlan ? "moderate" : "low",
    estimateOnly: !fromPlan && tdeeSource === "estimated",
    note: fromPlan
      ? `From your imported plan${phase.name ? ` (${phase.name})` : ""}: ${calories} kcal, ${protein}g protein.`
      : tdeeSource === "estimated"
        ? `Rough estimate only: BMR (${bmr}) × a conservative activity factor ≈ ${tdee} kcal maintenance${planMaint ? ` — note your plan says ~${planMaint}` : ""}. Formula multipliers run high; log ~1 week of food + weight and I'll replace this with your real TDEE.`
        : `${tdeeSource === "measured" ? "TDEE from your logged intake vs weight change" : "Maintenance from your imported plan"} (${tdee} kcal); ${dailyDelta === 0 ? "maintenance" : (dailyDelta > 0 ? `+${dailyDelta}` : dailyDelta) + " kcal/day"}${clampedToCeiling ? " (capped to a safe pace)" : ""}.`,
  };
}

// true only when the recomputed targets differ enough from current goals to write
export function macrosDiffer(t, goals) {
  if (!t || !t.ready) return false;
  const d = (a, b, tol) => Math.abs((a || 0) - (b || 0)) > tol;
  return d(t.calories, goals.calories, 25) || d(t.protein, goals.protein, 5) || d(t.carbs, goals.carbs, 10) || d(t.fat, goals.fat, 5);
}
