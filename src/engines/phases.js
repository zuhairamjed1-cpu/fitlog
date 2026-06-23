// ─── MULTI-PHASE ROADMAP (Step 3) ───────────────────────────────────────────
// A goalPlan may hold phases[]; legacy single-goal plans are migrated on READ so
// nothing in storage has to change. The active phase is the source of "target
// rate" that alignment, momentum and adaptation all reason against.
const DAY = 86400000;
const wkBetween = (a, b) => (!a || !b) ? null : (new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / (7 * DAY);
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Generate a sensible multi-phase roadmap from a simple goal (Build-Plan path).
// Deterministic + evidence-based: long lean bulks split into blocks with a
// maintenance tail; long cuts get a diet-break. Calories are left null so the
// macros engine derives them per active phase. Honest: these are starting
// structures, not prescriptions.
const GEN_GAIN_MAX_PCT_WK = { novice: 0.5, intermediate: 0.35, advanced: 0.25 };
export function generatePhases(goal, today) {
  const exp = ["novice", "intermediate", "advanced"].includes(goal && goal.experience) ? goal.experience : "intermediate";
  const start = (goal && goal.startDate) || today;
  const target = goal && goal.targetDate;
  const sw = goal && goal.startWeight, gw = goal && goal.goalWeight;
  if (sw == null || gw == null || !start || !target) return [];
  const weeks = wkBetween(start, target);
  if (!weeks || weeks <= 0) return [];
  const total = gw - sw;
  const dir = Math.abs(total) < 0.5 ? "maintain" : total > 0 ? "gain" : "loss";
  const base = Date.now();
  let idc = 0;
  const r1 = x => Math.round(x * 10) / 10;
  const statusFor = (s, e) => (e && today && e < today) ? "done" : (s && today && s <= today && (!e || e >= today)) ? "active" : "planned";
  const phase = (name, ptype, s, e, pSW, pGW) => {
    const wk = wkBetween(s, e);
    return { id: base + (idc++), name, type: ptype, startDate: s, endDate: e, startWeight: r1(pSW), goalWeight: r1(pGW), calories: null, protein: null, targetRate: wk ? Math.round(((pGW - pSW) / wk) * 100) / 100 : null, status: statusFor(s, e), origin: "generated" };
  };

  if (dir === "maintain") return [phase("Maintenance", "maintenance", start, target, sw, gw)];

  const out = [];
  if (dir === "gain") {
    const maintWeeks = weeks >= 16 ? Math.min(3, Math.round(weeks * 0.12)) : 0;
    const bulkWeeks = weeks - maintWeeks;
    const nBlocks = bulkWeeks >= 18 ? 2 : 1;
    const perWeeks = bulkWeeks / nBlocks, perGain = total / nBlocks;
    let cursor = start, w = sw;
    for (let i = 0; i < nBlocks; i++) {
      const e = (i === nBlocks - 1 && maintWeeks === 0) ? target : addDays(cursor, Math.round(perWeeks * 7));
      out.push(phase(nBlocks > 1 ? `Lean Bulk ${i + 1}` : "Lean Bulk", "leanbulk", cursor, e, w, w + perGain));
      w += perGain; cursor = e;
    }
    if (maintWeeks > 0) out.push(phase("Maintenance", "maintenance", cursor, target, w, w));
  } else {
    const maintWeeks = weeks >= 16 ? 2 : 0;
    const cutWeeks = weeks - maintWeeks;
    let cursor = start, w = sw;
    if (cutWeeks < 16) {
      const e = maintWeeks ? addDays(cursor, Math.round(cutWeeks * 7)) : target;
      out.push(phase("Cut", "cut", cursor, e, w, gw)); cursor = e; w = gw;
      if (maintWeeks) out.push(phase("Maintenance", "maintenance", cursor, target, w, w));
    } else {
      const breakWeeks = 2, halfCut = (cutWeeks - breakWeeks) / 2, half = total / 2;
      const e1 = addDays(cursor, Math.round(halfCut * 7));
      out.push(phase("Cut 1", "cut", cursor, e1, w, w + half)); cursor = e1; w += half;
      const eb = addDays(cursor, breakWeeks * 7);
      out.push(phase("Diet break", "maintenance", cursor, eb, w, w)); cursor = eb;
      out.push(phase("Cut 2", "cut", cursor, target, w, gw));
    }
  }
  return out;
}

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
