// ─── MULTI-PHASE ROADMAP (Step 3) ───────────────────────────────────────────
// A goalPlan may hold phases[]; legacy single-goal plans are migrated on READ so
// nothing in storage has to change. The active phase is the source of "target
// rate" that alignment, momentum and adaptation all reason against.
const DAY = 86400000;
const wkBetween = (a, b) => (!a || !b) ? null : (new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / (7 * DAY);

export function getPhases(goalPlan) {
  if (!goalPlan) return [];
  if (Array.isArray(goalPlan.phases) && goalPlan.phases.length) return goalPlan.phases;
  // migrate a legacy single goal → one active phase
  if (goalPlan.goalWeight != null && goalPlan.startDate && goalPlan.targetDate) {
    return [{
      id: 1, type: goalPlan.type || "custom",
      startDate: goalPlan.startDate, endDate: goalPlan.targetDate,
      startWeight: goalPlan.startWeight ?? null, goalWeight: goalPlan.goalWeight,
      freq: goalPlan.freq, status: "active", origin: "user",
    }];
  }
  return [];
}

export function activePhase(goalPlan, today) {
  const ph = getPhases(goalPlan);
  if (!ph.length) return null;
  const inWindow = ph.find(p => (!p.startDate || p.startDate <= today) && (!p.endDate || p.endDate >= today) && p.status !== "done");
  return inWindow || ph.find(p => p.status === "active") || ph[ph.length - 1];
}

export function phaseReqRate(phase) {
  if (!phase) return null;
  if (phase.goalWeight != null && phase.startWeight != null) {
    const weeks = wkBetween(phase.startDate, phase.endDate);
    if (weeks && weeks > 0) return +(((phase.goalWeight - phase.startWeight) / weeks)).toFixed(3);
  }
  return phase.targetRateKgWk != null ? phase.targetRateKgWk : null;
}

export function phaseDir(phase) {
  const r = phaseReqRate(phase);
  if (r == null) return null;
  return r > 0.02 ? "gain" : r < -0.02 ? "loss" : "maintain";
}

// Insert/replace a phase in the roadmap and return the new phases array.
export function applyPhaseChange(goalPlan, change) {
  const ph = getPhases(goalPlan).map(p => ({ ...p }));
  if (change.kind === "edit-active") {
    const a = ph.find(p => p.status === "active") || ph[ph.length - 1];
    if (a) Object.assign(a, change.patch || {});
  } else if (change.kind === "insert-phase") {
    // mark current active done at the insert date; insert the new phase as active
    const a = ph.find(p => p.status === "active");
    if (a && change.atDate) a.endDate = change.atDate;
    ph.push({ id: Date.now(), status: "active", origin: "adaptation", ...change.phase });
    if (a) a.status = "done";
  }
  return ph;
}
