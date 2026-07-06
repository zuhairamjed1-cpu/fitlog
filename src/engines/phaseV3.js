// ─── GOAL PLAN V3 — PHASE ENGINE ─────────────────────────────────────────────
// The phase is the operating system. Phases are stored as an ordered array, each
// carrying a `durationWeeks` (never hard dates) and an optional set of overrides.
// derivePhases() walks that array and DERIVES everything deterministically:
// chained start/end dates, projected bodyweight at each boundary, and per-phase
// calories/macros from a template + projected weight. Every Trajectory/Report
// card reads the active phase's LENS (template thresholds, overridable) to decide
// what a raw metric MEANS in the current phase.

import { localDateStr } from "../lib/dates";
import { mifflinBMR } from "./energy";

const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return localDateStr(d); };
const r1 = x => Math.round(x * 10) / 10;
const ACTIVITY = 1.5; // maintenance multiplier over BMR (moderate)

// Phase templates = defaults, not rules. Each supplies the interpretation params
// (the "lens") the raw plan never states: rate band, protein target, recovery
// floor, fatigue ceiling, plus a calorie delta vs maintenance and a fat budget.
export const PHASE_TEMPLATES = {
  leanbulk:    { type: "leanbulk",    label: "Lean Bulk",         weeks: 12, rate: [0.13, 0.35],  rateDefault: 0.22,  protein: [1.8, 2.2], proteinDefault: 2.0, calDelta: 250,  recoveryFloor: 60, fatigueCeiling: 60, fatPct: 0.25, dir: "gain" },
  bulk:        { type: "bulk",        label: "Bulk",              weeks: 14, rate: [0.35, 0.6],   rateDefault: 0.45,  protein: [1.6, 2.0], proteinDefault: 1.8, calDelta: 450,  recoveryFloor: 55, fatigueCeiling: 70, fatPct: 0.25, dir: "gain" },
  minicut:     { type: "minicut",     label: "Mini Cut",          weeks: 4,  rate: [-0.9, -0.5],  rateDefault: -0.7,  protein: [2.2, 2.6], proteinDefault: 2.4, calDelta: -650, recoveryFloor: 65, fatigueCeiling: 50, fatPct: 0.30, dir: "loss" },
  cut:         { type: "cut",         label: "Cut",               weeks: 10, rate: [-0.7, -0.35], rateDefault: -0.5,  protein: [2.2, 2.6], proteinDefault: 2.4, calDelta: -450, recoveryFloor: 65, fatigueCeiling: 55, fatPct: 0.30, dir: "loss" },
  maintenance: { type: "maintenance", label: "Maintenance",       weeks: 6,  rate: [-0.1, 0.1],   rateDefault: 0.0,   protein: [1.8, 2.2], proteinDefault: 2.0, calDelta: 0,    recoveryFloor: 60, fatigueCeiling: 60, fatPct: 0.28, dir: "maintain" },
  recomp:      { type: "recomp",      label: "Recomp",            weeks: 12, rate: [-0.1, 0.15],  rateDefault: 0.03,  protein: [2.0, 2.4], proteinDefault: 2.2, calDelta: -100, recoveryFloor: 60, fatigueCeiling: 60, fatPct: 0.28, dir: "maintain" },
  strength:    { type: "strength",    label: "Strength Block",    weeks: 8,  rate: [-0.1, 0.2],   rateDefault: 0.1,   protein: [1.8, 2.2], proteinDefault: 2.0, calDelta: 150,  recoveryFloor: 60, fatigueCeiling: 65, fatPct: 0.27, dir: "gain" },
  hypertrophy: { type: "hypertrophy", label: "Hypertrophy Block", weeks: 8,  rate: [0.0, 0.3],    rateDefault: 0.15,  protein: [1.8, 2.2], proteinDefault: 2.0, calDelta: 250,  recoveryFloor: 60, fatigueCeiling: 62, fatPct: 0.26, dir: "gain" },
};
export const TEMPLATE_LIST = Object.values(PHASE_TEMPLATES);
export const templateFor = type => PHASE_TEMPLATES[type] || PHASE_TEMPLATES.maintenance;

let _seq = 0;
export function newPhase(type = "leanbulk") {
  const tpl = templateFor(type);
  return { id: `ph_${Date.now()}_${_seq++}`, type, name: tpl.label, durationWeeks: tpl.weeks, targetRateKgWk: null, calories: null, proteinGkg: null }; // null override = use template
}

// The lens: interpretation thresholds for a phase (template defaults, overridable).
export function lensFor(phase) {
  const tpl = templateFor(phase && phase.type);
  const rate = phase && phase.targetRateKgWk != null ? phase.targetRateKgWk : tpl.rateDefault;
  const proteinTarget = phase && phase.proteinGkg != null ? phase.proteinGkg : tpl.proteinDefault;
  return {
    type: tpl.type, label: tpl.label, dir: tpl.dir,
    rateBand: tpl.rate, rateTarget: rate,
    proteinBand: tpl.protein, proteinTarget,
    recoveryFloor: tpl.recoveryFloor, fatigueCeiling: tpl.fatigueCeiling,
  };
}

// Deterministic derivation: ordered phases + startDate + startWeight → enriched
// phases with chained dates, projected weights, and computed calories/macros.
export function derivedPhases(goalPlan, profile, today) {
  const phases = (goalPlan && goalPlan.phases) || [];
  const startDate = (goalPlan && goalPlan.startDate) || (today || localDateStr(new Date()));
  let bw = (goalPlan && goalPlan.startWeight != null) ? goalPlan.startWeight : (profile && profile.weightKg ? parseFloat(profile.weightKg) : 80);
  let cursor = startDate;
  const t = today || localDateStr(new Date());

  return phases.map(p => {
    const tpl = templateFor(p.type);
    const weeks = p.durationWeeks || tpl.weeks;
    const rate = p.targetRateKgWk != null ? p.targetRateKgWk : tpl.rateDefault;
    const startW = bw;
    const expectedChange = r1(rate * weeks);
    const endW = r1(startW + expectedChange);
    const s = cursor, e = addDays(cursor, Math.round(weeks * 7));
    const midBW = (startW + endW) / 2;
    const maint = (profile && profile.sex && profile.age && profile.heightCm) ? Math.round((mifflinBMR(profile, midBW) || 0) * ACTIVITY) : null;
    const calories = p.calories != null ? p.calories : (maint ? maint + tpl.calDelta : null);
    const proteinGkg = p.proteinGkg != null ? p.proteinGkg : tpl.proteinDefault;
    const protein = Math.round(midBW * proteinGkg);
    let fat = null, carbs = null;
    if (calories) { fat = Math.round((calories * tpl.fatPct) / 9); carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4)); }
    const status = e < t ? "done" : (s <= t && e >= t) ? "active" : "planned";
    const ph = {
      id: p.id, type: p.type, name: p.name || tpl.label, durationWeeks: weeks,
      start: s, end: e, startWeight: startW, endWeight: endW,
      targetRateKgWk: rate, expectedChangeKg: expectedChange,
      calories, protein, carbs, fat, maintenance: maint, status,
      lens: lensFor({ type: p.type, targetRateKgWk: rate, proteinGkg }),
    };
    cursor = e; bw = endW;
    return ph;
  });
}

export function activePhase(derived, today) {
  const t = today || localDateStr(new Date());
  if (!derived || !derived.length) return null;
  const hit = derived.find(p => p.start <= t && p.end >= t);
  if (hit) return hit;
  if (t < derived[0].start) return derived[0];     // plan hasn't started → first
  return derived[derived.length - 1];               // plan finished → last
}

export function planEndDate(derived) { return derived && derived.length ? derived[derived.length - 1].end : null; }
export function planSpanWeeks(goalPlan) { return ((goalPlan && goalPlan.phases) || []).reduce((s, p) => s + (p.durationWeeks || templateFor(p.type).weeks), 0); }

// ── Phase array operations (pure; operate on RAW phases, then re-derive) ──
export function addPhaseOp(phases, type) { return [...phases, newPhase(type)]; }
export function insertPhaseOp(phases, index, type) { const a = [...phases]; a.splice(Math.max(0, Math.min(index, a.length)), 0, newPhase(type)); return a; }
export function deletePhaseOp(phases, id) { return phases.filter(p => p.id !== id); }
export function duplicatePhaseOp(phases, id) { const i = phases.findIndex(p => p.id === id); if (i < 0) return phases; const copy = { ...phases[i], id: `ph_${Date.now()}_${_seq++}` }; const a = [...phases]; a.splice(i + 1, 0, copy); return a; }
export function movePhaseOp(phases, from, to) { const a = [...phases]; if (from < 0 || from >= a.length) return a; const [m] = a.splice(from, 1); a.splice(Math.max(0, Math.min(to, a.length)), 0, m); return a; }
export function updatePhaseOp(phases, id, patch) { return phases.map(p => p.id === id ? { ...p, ...patch } : p); }

// ── GOAL ALIGNMENT — the executive summary. Judges current behavior against the
// ACTIVE PHASE lens. Same metrics, different verdict per phase. ──
const within = (v, [lo, hi]) => v >= lo && v <= hi;
export function alignmentFor(phase, metrics) {
  if (!phase) return { ready: false, reason: "No active phase." };
  const L = phase.lens;
  const m = metrics || {};
  const criteria = [];

  // Weight rate vs phase band (direction-aware)
  if (m.actualRateKgWk != null) {
    const tol = 0.1;
    const band = [L.rateBand[0] - tol, L.rateBand[1] + tol];
    const status = within(m.actualRateKgWk, band) ? "good" : (L.dir === "gain" ? (m.actualRateKgWk < band[0] ? "warn" : "bad") : L.dir === "loss" ? (m.actualRateKgWk > band[1] ? "warn" : "bad") : (Math.abs(m.actualRateKgWk) <= 0.15 ? "good" : "warn"));
    criteria.push({ key: "rate", label: "Weight rate", status, actual: `${m.actualRateKgWk > 0 ? "+" : ""}${m.actualRateKgWk} kg/wk`, target: `${L.rateBand[0]} … ${L.rateBand[1]} kg/wk` });
  } else criteria.push({ key: "rate", label: "Weight rate", status: "unknown", actual: "—", target: `${L.rateBand[0]} … ${L.rateBand[1]} kg/wk` });

  // Protein vs phase target
  if (m.proteinGkg != null) {
    const status = m.proteinGkg >= L.proteinTarget - 0.2 ? "good" : m.proteinGkg >= L.proteinTarget - 0.5 ? "warn" : "bad";
    criteria.push({ key: "protein", label: "Protein", status, actual: `${m.proteinGkg} g/kg`, target: `${L.proteinTarget} g/kg` });
  } else criteria.push({ key: "protein", label: "Protein", status: "unknown", actual: "—", target: `${L.proteinTarget} g/kg` });

  // Recovery vs phase floor
  if (m.recovery != null) {
    const status = m.recovery >= L.recoveryFloor ? "good" : m.recovery >= L.recoveryFloor - 12 ? "warn" : "bad";
    criteria.push({ key: "recovery", label: "Recovery", status, actual: `${m.recovery}`, target: `≥ ${L.recoveryFloor}` });
  } else criteria.push({ key: "recovery", label: "Recovery", status: "unknown", actual: "—", target: `≥ ${L.recoveryFloor}` });

  // Fatigue vs phase ceiling
  if (m.fatigue != null) {
    const status = m.fatigue <= L.fatigueCeiling ? "good" : m.fatigue <= L.fatigueCeiling + 12 ? "warn" : "bad";
    criteria.push({ key: "fatigue", label: "Fatigue", status, actual: `${m.fatigue}`, target: `≤ ${L.fatigueCeiling}` });
  } else criteria.push({ key: "fatigue", label: "Fatigue", status: "unknown", actual: "—", target: `≤ ${L.fatigueCeiling}` });

  const known = criteria.filter(c => c.status !== "unknown");
  const bad = known.filter(c => c.status === "bad").length;
  const warn = known.filter(c => c.status === "warn").length;
  let verdict = "On Track", color = "#8fd989";
  if (bad >= 2 || (bad >= 1 && warn >= 1)) { verdict = "Off Track"; color = "#f47e6e"; }
  else if (bad === 1 || warn >= 1) { verdict = "Slightly Off"; color = "#f9c97e"; }
  const confidence = known.length >= 3 ? "moderate" : known.length >= 1 ? "low" : "none";

  return { ready: known.length > 0, phaseLabel: L.label, verdict, color, criteria, confidence };
}
