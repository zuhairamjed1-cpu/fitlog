// ─── MUSCLE PRIORITIZATION + AUTO-REGULATION ─────────────────────────────────
// The user prioritizes up to 3 muscles, manually choosing 12–16 sets/week each;
// everything else defaults to 10 sets/week. This drives the training prescription
// (target sets per muscle). The auto-regulation layer continuously evaluates
// whether added volume is still productive — tracking performance slope, RIR
// drift, and recovery in parallel — and produces a per-muscle stall-risk
// (green/amber/red) plus an instant 2×2 diagnosis. It NEVER changes the user's
// chosen volume; it only recommends, warns, and diagnoses. The user is final.

import { localDateStr } from "../lib/dates.js";
import { resolveMuscle } from "./volume.js";
import { parseWorkout, e1rm, bestSet } from "./workout.js";
import { computeRecoveryCapacity } from "./recoveryCapacity.js";
import { computeFatigue } from "./fatigue.js";

export const PRIO_DEFAULT_SETS = 10, PRIO_MIN = 12, PRIO_MAX = 16, PRIO_MAX_COUNT = 3;
export const RIR_TARGET = "0–2 RIR";

// RPE → RIR (reps in reserve), per the user's table
export function rpeToRIR(rpe) {
  if (rpe == null) return null;
  if (rpe >= 10) return "0"; if (rpe >= 9.5) return "0–1"; if (rpe >= 9) return "1";
  if (rpe >= 8.5) return "1–2"; if (rpe >= 8) return "2"; if (rpe >= 7.5) return "2–3";
  if (rpe >= 7) return "3"; if (rpe >= 5) return "4–6"; return "7+";
}

// ▸ = expandable into measurable sub-heads. Triceps/Biceps/legs/abs are whole-muscle
// targets — FitLog tracks one volume signal for them, so splitting heads would be
// false precision. Each target maps to the muscle keys the volume engine measures.
export const PRIO_GROUPS = [
  { group: "Shoulders", expandable: true, targets: [
    { id: "sideDelts", label: "Side Delts", keys: ["sideDelts"] },
    { id: "frontDelts", label: "Front Delts", keys: ["frontDelts"] },
    { id: "rearDelts", label: "Rear Delts", keys: ["rearDelts"] },
  ] },
  { group: "Back", expandable: true, targets: [
    { id: "lats", label: "Lats (width)", keys: ["lats"] },
    { id: "upperBackTraps", label: "Upper back / traps (thickness)", keys: ["upperBack", "midBack", "traps"] },
  ] },
  { group: "Chest", expandable: true, targets: [
    { id: "upperChest", label: "Upper Chest", keys: ["upperChest"] },
    { id: "lowerChest", label: "Lower Chest", keys: ["lowerChest", "midChest"] },
  ] },
  { group: "Triceps", expandable: false, targets: [{ id: "triceps", label: "Triceps", keys: ["triceps"] }] },
  { group: "Biceps", expandable: false, targets: [{ id: "biceps", label: "Biceps", keys: ["biceps", "brachialis"] }] },
  { group: "Quads", expandable: false, targets: [{ id: "quads", label: "Quads", keys: ["quads"] }] },
  { group: "Hamstrings", expandable: false, targets: [{ id: "hamstrings", label: "Hamstrings", keys: ["hamstrings"] }] },
  { group: "Glutes", expandable: false, targets: [{ id: "glutes", label: "Glutes", keys: ["glutes"] }] },
  { group: "Calves", expandable: false, targets: [{ id: "calves", label: "Calves", keys: ["calves"] }] },
  { group: "Abs", expandable: false, targets: [{ id: "abs", label: "Abs", keys: ["upperAbs", "lowerAbs", "obliques"] }] },
];
export const PRIO_TARGETS = PRIO_GROUPS.flatMap(g => g.targets.map(t => ({ ...t, group: g.group })));
export const targetById = id => PRIO_TARGETS.find(t => t.id === id);

const isWorking = s => !(s && (s.warmup || (s.rpe != null && s.rpe < 5)));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return localDateStr(d); };
function trendSlope(arr) { const pts = arr.map((v, i) => [i, v]).filter(p => p[1] != null); if (pts.length < 3) return null; const mx = mean(pts.map(p => p[0])), my = mean(pts.map(p => p[1])); let num = 0, den = 0; pts.forEach(([x, y]) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; }); return den ? +(num / den).toFixed(2) : null; }
function decelerating(arr) { const pts = arr.map((v, i) => [i, v]).filter(p => p[1] != null); if (pts.length < 4) return { flag: false, ratio: null }; const half = Math.floor(pts.length / 2); const es = trendSlope(pts.slice(0, half + 1).map(p => p[1])), ls = trendSlope(pts.slice(half).map(p => p[1])); if (es == null || ls == null || es <= 0.05) return { flag: false, ratio: null }; const ratio = ls / es; return { flag: ratio < 0.5 && ls >= 0, ratio: +ratio.toFixed(2) }; }
function risingRPE(rpeArr, e1Arr) { const r = rpeArr.filter(x => x != null); if (r.length < 3) return false; const s = trendSlope(rpeArr), es = trendSlope(e1Arr); return s != null && s > 0.15 && (es == null || es <= 0.1); }

export function resolvePriorities(goals) {
  const map = (goals && goals.musclePriorities) || {};
  return PRIO_TARGETS.map(t => ({ ...t, sets: map[t.id] != null ? map[t.id] : PRIO_DEFAULT_SETS, prioritized: map[t.id] != null && map[t.id] >= PRIO_MIN, custom: map[t.id] != null }));
}
export function prioritizedCount(goals) { const map = (goals && goals.musclePriorities) || {}; return Object.values(map).filter(v => v >= PRIO_MIN).length; }

export function computeMusclePrio(data, goals, today = localDateStr(new Date())) {
  const overrides = (goals && goals.exerciseMap) || {};
  const WEEKS = 8;
  const logs = (data && data.exercise || []).map(e => ({ date: e.date, p: (e._parsed && e._parsed.exercises) ? e._parsed : parseWorkout(e.text || "") })).filter(l => l.date);
  const targets = resolvePriorities(goals);
  const rec = computeRecoveryCapacity(data, goals, today);
  const fat = computeFatigue(data, goals, today);
  const recVerdict = (!rec.ready && !fat.ready) ? "unknown" : (((!rec.ready || rec.score >= 58) && (!fat.ready || fat.finalFatigue <= 60)) ? "good" : "poor");

  const out = targets.map(t => {
    const setsByWk = [], e1rmByWk = [], rpeByWk = [];
    for (let wi = 0; wi < WEEKS; wi++) {
      const s = addDays(today, -(wi * 7 + 6)), e = addDays(today, -(wi * 7));
      let sets = 0, best = 0, rpes = [];
      logs.filter(l => l.date >= s && l.date <= e).forEach(l => (l.p.exercises || []).forEach(ex => {
        if (!t.keys.includes(resolveMuscle(ex.name, overrides))) return;
        const work = (ex.sets || []).filter(isWorking);
        sets += work.length;
        work.forEach(st => { if (st.rpe != null) rpes.push(st.rpe); });
        const er = e1rm(bestSet(work)); if (er && er > best) best = er;
      }));
      setsByWk.push(sets); e1rmByWk.push(best || null); rpeByWk.push(rpes.length ? +mean(rpes).toFixed(1) : null);
    }
    const setsChron = [...setsByWk].reverse(), e1Chron = [...e1rmByWk].reverse(), rpeChron = [...rpeByWk].reverse();
    const current = setsByWk[0], target = t.sets;
    const pct = target ? Math.round((current / target) * 100) : null;
    const status = current >= target ? "Complete" : `${pct}% Complete`;
    const slope = trendSlope(e1Chron), decel = decelerating(e1Chron), rpeDrift = risingRPE(rpeChron, e1Chron);
    const haveData = e1Chron.filter(x => x != null).length;
    const stalled = haveData >= 3 && slope != null && slope <= 0;

    // last productive volume = highest weekly sets that still produced an e1RM increase
    let lpv = null;
    for (let i = 1; i < e1Chron.length; i++) if (e1Chron[i] != null && e1Chron[i - 1] != null && e1Chron[i] > e1Chron[i - 1]) lpv = Math.max(lpv || 0, setsChron[i]);
    if (lpv == null) { const nz = setsChron.filter(x => x > 0); lpv = nz.length ? Math.max(...nz) : target; }

    const signals = [];
    if (decel.flag) signals.push("Progress is slowing");
    if (rpeDrift) signals.push("Effort rising on the same lifts (RIR drifting)");
    if (recVerdict === "poor") signals.push("Recovery is slipping");
    if (current >= target && slope != null && slope <= 0.05) signals.push("You're at your volume ceiling");
    let risk = "green";
    if (stalled) risk = "red"; else if (signals.length) risk = "amber";

    let diagnosis = null, action = null;
    if (risk !== "green") {
      const perfBad = stalled || decel.flag;
      if (perfBad && recVerdict === "poor") { diagnosis = "Recovery bottleneck"; action = "Keep the volume — fix recovery first (sleep, food, stress)."; }
      else if (perfBad && recVerdict === "good") { diagnosis = "Volume bottleneck"; action = `Consider rolling back toward your last productive volume (~${lpv} sets).`; }
      else if (!perfBad && recVerdict === "poor") { diagnosis = "Under-recovering but coping"; action = "Monitor closely — progress is holding despite low recovery."; }
      else { diagnosis = "Approaching ceiling"; action = "Hold volume and watch the next 1–2 sessions."; }
    }
    return { ...t, current, target, pct, status, weeklySets: setsChron, e1rm: e1Chron, slope, decelerating: decel.flag, rpeDrift, stalled, risk, signals, diagnosis, action, lastProductiveVolume: lpv };
  });

  return { ready: logs.length > 0, today, targets: out, recVerdict, recovery: rec, fatigue: fat, prioritizedCount: out.filter(t => t.prioritized).length, riskTargets: out.filter(t => t.risk !== "green") };
}
