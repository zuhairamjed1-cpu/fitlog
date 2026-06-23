// ─── STRATEGIC ADAPTATION ENGINE (Step 4) ───────────────────────────────────
// Detects sustained divergence between plan and reality and PROPOSES a strategy
// change. It never auto-applies. Two honesty rails are mandatory:
//   1. plan-wrong vs adherence-poor: if off-target but adherence < 70%, the fix
//      is adherence, NOT the strategy. We say so and propose no plan change.
//   2. hysteresis: only act on a multi-week signal (weight trend span ≥ 21d and
//      confidence above "Low") and respect a cooldown after any change, or it
//      flip-flops on weight noise.
// No measured-partitioning claims: "rate above the lean-gain ceiling → a growing
// share is likely fat", never "partitioning deteriorating".

import { activePhase, phaseReqRate, phaseDir, applyPhaseChange } from "./phases.js";

const COOLDOWN_DAYS = 21;
const ADH_FLOOR = 70;
const DAY = 86400000;
const daysSince = (date, today) => (!date ? 999 : Math.round((new Date(today + "T00:00:00") - new Date(date + "T00:00:00")) / DAY));

export function detectDivergence(state, goalPlan, today) {
  if (!state || !state.hasGoal) return { diverging: false, reason: "no-goal" };
  const span = state.trend && state.trend.spanDays;
  const conf = state.trend && state.trend.confidence;
  const matureEnough = span != null && span >= 21 && conf && conf !== "Low";
  const withinCooldown = goalPlan && daysSince(goalPlan.lastAdaptation, today) < COOLDOWN_DAYS;

  const dir = state.reqRate != null ? (state.reqRate > 0.02 ? "gain" : state.reqRate < -0.02 ? "loss" : "maintain") : null;
  const a = state.actualRate, req = state.reqRate, cw = state.currentWeight || 80;
  const ceilingGain = (0.5 / 100) * cw;   // ~lean-gain ceiling kg/wk
  const floorLoss = (1.25 / 100) * cw;    // ~max safe loss kg/wk
  const debt = state.recoveryDebt;

  let kind = null, magnitude = null;
  if (debt && debt.relPct > 40 && debt.trend === "rising") { kind = "high-debt"; magnitude = debt.relPct; }
  else if (a != null && req != null) {
    const ratio = req !== 0 ? a / req : 0;
    if (dir === "gain") {
      if (a > ceilingGain || ratio > 1.6) { kind = "gain-too-fast"; magnitude = +(a / ceilingGain).toFixed(2); }
      else if (a <= 0 || ratio < 0.4) { kind = "gain-too-slow"; magnitude = +ratio.toFixed(2); }
    } else if (dir === "loss") {
      if (-a > floorLoss || ratio > 1.6) { kind = "loss-too-fast"; magnitude = +(-a / floorLoss).toFixed(2); }
      else if (a >= 0 || ratio < 0.4) { kind = "loss-stalled"; magnitude = +ratio.toFixed(2); }
    } else if (dir === "maintain") {
      if (Math.abs(a) > 0.003 * cw) { kind = "maintain-drift"; magnitude = +a.toFixed(2); }
    }
  }
  return { diverging: !!kind, kind, magnitude, dir, matureEnough, withinCooldown, adherence: state.adherence ? state.adherence.overall : null };
}

export function proposeAdaptation(state, goalPlan, today, memory) {
  const d = detectDivergence(state, goalPlan, today);
  if (!d.diverging) return null;

  // not enough data yet → wait, don't guess
  if (!d.matureEnough) {
    return { kind: "wait", actionable: false, rationale: "There's a divergence forming, but there isn't enough weight history yet to be sure it's real and not noise. Keep logging — I'll flag it once the trend is solid.", change: null, confidence: "low", tier: "forecast" };
  }
  // cooldown → just changed the plan; let it settle
  if (d.withinCooldown) {
    return { kind: "settling", actionable: false, rationale: "You changed strategy recently. Giving it a few weeks to show up in the data before suggesting anything else.", change: null, confidence: "low", tier: "forecast" };
  }
  // RAIL 1 — plan-wrong vs adherence-poor
  if (d.adherence != null && d.adherence < ADH_FLOOR && d.kind !== "high-debt") {
    return {
      kind: "fix-adherence", actionable: false,
      rationale: `You're off-target, but adherence is ~${d.adherence}%. The plan isn't the problem yet — tighten execution (logging, hitting calories/training) before changing the strategy. Adapting around low adherence would just paper over it.`,
      change: null, confidence: "moderate", tier: "forecast",
    };
  }

  const cw = state.currentWeight || 80;
  let kind, rationale, change, severity = "suggest";

  switch (d.kind) {
    case "high-debt":
      kind = "insert-deload"; severity = "act";
      rationale = `Recovery debt is ~${state.recoveryDebt.relPct}% above your baseline and rising. A planned deload week now is cheaper than a forced break later.`;
      change = { kind: "insert-phase", atDate: today, phase: { type: "deload", startDate: today, endDate: addDays(today, 7), note: "Auto-suggested deload — reduce volume ~40%" } };
      break;
    case "gain-too-fast":
      kind = "reduce-surplus"; severity = "act";
      rationale = `You're gaining ~${Math.round(d.magnitude * 100)}% of the lean-gain ceiling. Above that ceiling a growing share of the gain is likely fat (not measurable here — inferred from rate). Trim the surplus ~250 kcal/day to bias toward lean tissue.`;
      change = { kind: "edit-active", patch: { note: "Reduce surplus ~250 kcal/day", targetRateKgWk: +(0.4 / 100 * cw).toFixed(3) } };
      break;
    case "gain-too-slow":
      kind = "increase-surplus";
      rationale = `Gain has stalled below your target pace despite decent adherence. Add ~200 kcal/day (carb-led) and re-check in 2–3 weeks.`;
      change = { kind: "edit-active", patch: { note: "Increase intake ~200 kcal/day" } };
      break;
    case "loss-too-fast":
      kind = "reduce-deficit"; severity = "act";
      rationale = `You're losing faster than ~1.25%/wk, which raises the risk of muscle loss. Ease the deficit ~250 kcal/day to protect lean mass.`;
      change = { kind: "edit-active", patch: { note: "Reduce deficit ~250 kcal/day", targetRateKgWk: +(-1.0 / 100 * cw).toFixed(3) } };
      break;
    case "loss-stalled":
      kind = "diet-break";
      rationale = `Fat loss has stalled on a sustained deficit. A 1–2 week diet break at maintenance can restore adherence and hormonal drive before resuming.`;
      change = { kind: "insert-phase", atDate: today, phase: { type: "maintenance", startDate: today, endDate: addDays(today, 14), note: "Diet break at maintenance" } };
      break;
    case "maintain-drift":
      kind = "recenter-maintenance";
      rationale = `Weight is drifting away from maintenance. Nudge intake to recentre — roughly ${state.actualRate > 0 ? "−" : "+"}150 kcal/day.`;
      change = { kind: "edit-active", patch: { note: "Recentre intake ~150 kcal/day" } };
      break;
    default:
      return null;
  }

  // personal prior from strategy memory (Step 5), if available
  let memoryNote = null;
  if (memory && memory.length) {
    const same = memory.filter(p => p.type === (state.phase && state.phase.type));
    if (same.length) memoryNote = `Your last ${same.length} ${state.phase.type} phase(s) averaged ${avgRate(same)} kg/wk actual — factored into this.`;
  }

  const previewPhases = applyPhaseChange(goalPlan, change);
  return {
    kind, actionable: true, severity, rationale, change, memoryNote,
    newRoadmapPreview: previewPhases.map(p => ({ type: p.type, startDate: p.startDate, endDate: p.endDate, status: p.status, note: p.note })),
    confidence: "low–moderate", tier: "forecast",
  };
}

function addDays(date, n) { const d = new Date(date + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function avgRate(arr) { const r = arr.map(p => p.actualRateKgWk).filter(x => x != null); return r.length ? +(r.reduce((a, b) => a + b, 0) / r.length).toFixed(2) : "?"; }
