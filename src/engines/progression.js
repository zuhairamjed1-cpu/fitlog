// ─── PROGRESSION VERDICT ENGINE ──────────────────────────────────────────────
// Read-only. For each exercise it answers ONE question: did I progressively
// overload it versus the last time I trained it (near failure)?
//
// It does NOT prescribe. No recommended loads, no deloads, no prefill. The engine
// reads data.exercise[] and the exercise→muscle map; it writes nothing back into
// the analysis pipeline (volume/training/musclePrio/fatigue/brain untouched).
//
// Muscle grouping binds to the FINE 27-group map in volume.js (resolveMuscle) — we
// do NOT create a third taxonomy. Primary muscle only: one exercise = one row.

import { e1rm } from "./workout";
import { parseWorkout } from "./workout";
import { resolveMuscle, MUSCLES, normExercise } from "./volume";
import { localDateStr } from "../lib/dates";

const KG = (w, unit) => (unit === "lb" ? w * 0.453592 : w);
const EPS = 0.01;
const DEADBAND = 0.02; // ±2% e1RM = statistically nothing → flat

// Canonical, order-preserving exercise key: lowercase, strip punctuation (so
// "Bench Press (Barbell)" → "bench press barbell"), collapse whitespace, trim.
// Keep the original string for display.
export function canonKey(raw) {
  return (raw || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// RIR from a parsed set. The engine only ever speaks RIR — normalise at the
// boundary. Parser stores RPE → RIR = 10 - RPE. A "[Failure]" set with no RPE is
// ~0 RIR. Unknown effort (no RPE, no failure flag) → null.
function setRIR(s) {
  if (s.rpe != null) return Math.max(0, Math.min(10, 10 - s.rpe));
  if (s.failure) return 0;
  return null;
}

// Reduce one session's sets for one exercise into a comparable instance.
// Warm-ups (flagged, or below 85% of the session top weight) are excluded before
// anything is computed. reps = TOTAL reps at the top weight, summed across sets.
function instanceFrom(sets, date) {
  const working = (sets || []).filter(s => !s.warmup && s.reps > 0);
  if (!working.length) return null;
  const topKg = Math.max(...working.map(s => KG(s.weight, s.unit)));
  if (!(topKg > 0)) {
    // bodyweight / rep-only movement: fall back to rep comparison at "top" = 0
    const kept = working;
    const reps = kept.reduce((a, s) => a + s.reps, 0);
    const last = kept[kept.length - 1];
    return { weightKg: 0, weight: 0, unit: "kg", reps, sets: kept.map(s => s.reps),
             rir: setRIR(last), topReps: Math.max(...kept.map(s => s.reps)), date };
  }
  // Drop warm-up-like sets under 85% of top, then keep sets AT the top weight.
  const nearTop = working.filter(s => KG(s.weight, s.unit) >= 0.85 * topKg - EPS);
  const atTop = nearTop.filter(s => Math.abs(KG(s.weight, s.unit) - topKg) < EPS);
  const reps = atTop.reduce((a, s) => a + s.reps, 0);
  const last = atTop[atTop.length - 1];               // lowest RIR reached at top
  return {
    weightKg: topKg,
    weight: last.weight, unit: last.unit,
    reps,
    sets: atTop.map(s => s.reps),
    rir: setRIR(last),
    topReps: Math.max(...atTop.map(s => s.reps)),
    date,
  };
}

const dir = (delta) => (delta > EPS ? "up" : delta < -EPS ? "down" : "flat");

// e1RM of an instance's representative top set (best single top set).
const instE1rm = (inst) => e1rm({ weight: inst.weightKg, unit: "kg", reps: inst.topReps });

// Core verdict between a baseline (prev) and a current instance.
function judge(prev, curr) {
  const wtDelta = curr.weightKg - prev.weightKg;
  const repsDelta = curr.reps - prev.reps;
  const rirDelta = (curr.rir != null && prev.rir != null) ? curr.rir - prev.rir : null;
  const wt = dir(wtDelta), reps = dir(repsDelta);
  const rirDir = rirDelta == null ? "flat" : dir(rirDelta);

  const axes = {
    wt: { dir: wt, delta: +wtDelta.toFixed(2), lit: false },
    reps: { dir: reps, delta: repsDelta, lit: false },
    rir: { dir: rirDir, delta: rirDelta, lit: false },
  };

  let verdict, decidedBy, note = null;

  if (wt === "up" && reps !== "down") { verdict = "up"; decidedBy = "wt"; }
  else if (wt === "down" && reps !== "up") { verdict = "down"; decidedBy = "wt"; }
  else if (wt === "flat" && reps === "up") { verdict = "up"; decidedBy = "reps"; }
  else if (wt === "flat" && reps === "down") { verdict = "down"; decidedBy = "reps"; }
  else if (wt !== "flat" && reps !== "flat") {
    // Mixed: weight and reps oppose → e1RM deadband arbitrates.
    const a = instE1rm(prev), b = instE1rm(curr);
    const pct = a > 0 ? (b - a) / a : 0;
    decidedBy = "e1rm";
    verdict = pct > DEADBAND ? "up" : pct < -DEADBAND ? "down" : "flat";
    note = `e1RM ${a.toFixed(1)} → ${b.toFixed(1)}${verdict === "flat" ? " · a wash" : ""}`;
  } else {
    // wt flat & reps flat → RIR is the arbitrator (more headroom at same work = up).
    decidedBy = "rir";
    verdict = rirDir; // up / down / flat
    if (verdict === "flat") note = "same work, same effort";
  }

  // Light exactly the deciding cell — only when the verdict actually moved.
  if ((verdict === "up" || verdict === "down") && (decidedBy === "wt" || decidedBy === "reps" || decidedBy === "rir")) {
    axes[decidedBy].lit = true;
  }

  return { axes, verdict, decidedBy, note };
}

const evidenceStr = (inst) =>
  `${inst.weight}${inst.unit} ${inst.sets.join(",")}${inst.rir != null ? ` @${inst.rir}` : ""}`;

// An instance is eligible as a BASELINE only if it was taken near failure. A set
// logged at 3+ RIR wasn't a real overload attempt — skip it and reach further back.
// Unknown effort (no RPE) is allowed (we can't call it low-effort).
const baselineEligible = (inst) => inst.rir == null || inst.rir <= 2;

function dayGap(from, to) {
  const a = new Date(from + "T00:00:00"), b = new Date(to + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

// Primary muscle for grouping. resolveMuscle already returns ONE muscle key
// (honoring goals.exerciseMap overrides), which is exactly the primary. If the
// override carries an explicit { primary } object, respect it.
function primaryMuscle(name, exerciseMap) {
  const ov = exerciseMap && exerciseMap[normExercise(name)];
  if (ov && typeof ov === "object" && ov.primary) return ov.primary;
  return resolveMuscle(name, exerciseMap);
}

// computeProgression(entries, exerciseMap, today?) → one verdict row per exercise.
export function computeProgression(entries, exerciseMap, today) {
  const now = today || localDateStr(new Date());
  // Gather per-exercise ordered instances (oldest → newest).
  const byKey = new Map();
  const dated = (entries || []).filter(e => e && e.date);
  // sort ascending by date so streak math walks forward
  dated.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const e of dated) {
    const parsed = e._parsed || parseWorkout(e.text || "");
    for (const ex of parsed.exercises || []) {
      const key = canonKey(ex.raw || ex.name);
      const inst = instanceFrom(ex.sets, e.date);
      if (!inst) continue;
      if (!byKey.has(key)) byKey.set(key, { key, name: ex.name, raw: ex.raw || ex.name, insts: [] });
      byKey.get(key).insts.push(inst);
    }
  }

  const rows = [];
  for (const { key, name, insts } of byKey.values()) {
    const muscleKey = primaryMuscle(name, exerciseMap);
    const muscle = muscleKey && MUSCLES[muscleKey] ? MUSCLES[muscleKey].label : "Other";
    const curr = insts[insts.length - 1];
    const daysSince = dayGap(curr.date, now);

    // Walk forward computing a verdict at each step vs the last eligible baseline,
    // so streaks reflect the real history — then read the final verdict for curr.
    let baseline = null;
    const verdicts = [];
    for (const inst of insts) {
      if (baseline) verdicts.push(judge(baseline, inst).verdict);
      else verdicts.push(null);
      if (baselineEligible(inst)) baseline = inst;
    }

    // Baseline for the CURRENT session = most recent prior eligible instance.
    let prev = null;
    for (let i = insts.length - 2; i >= 0; i--) {
      if (baselineEligible(insts[i])) { prev = insts[i]; break; }
    }

    if (!prev) {
      rows.push({
        muscle, exercise: name, key,
        prev: null, curr,
        axes: { wt: { dir: "flat", delta: 0, lit: false }, reps: { dir: "flat", delta: 0, lit: false }, rir: { dir: "flat", delta: null, lit: false } },
        verdict: "stale", decidedBy: null,
        evidence: evidenceStr(curr),
        note: `no read · ${daysSince}d since last`,
        streak: 0, flatStreak: 0, daysSince,
      });
      continue;
    }

    const j = judge(prev, curr);
    // Trailing same-verdict runs for the streak badges.
    let streak = 0, flatStreak = 0;
    for (let i = verdicts.length - 1; i >= 0; i--) {
      if (verdicts[i] === "up") streak++; else break;
    }
    for (let i = verdicts.length - 1; i >= 0; i--) {
      if (verdicts[i] === "flat") flatStreak++; else break;
    }

    rows.push({
      muscle, exercise: name, key,
      prev, curr,
      axes: j.axes,
      verdict: j.verdict, decidedBy: j.decidedBy,
      evidence: `${evidenceStr(prev)} → ${evidenceStr(curr)}`,
      note: j.note,
      streak: j.verdict === "up" ? streak : 0,
      flatStreak: j.verdict === "flat" ? flatStreak : 0,
      daysSince,
    });
  }

  return rows;
}

// Group rows by primary muscle for the card. Within a group, the untouched lift
// floats up: sort by daysSince descending.
export function groupProgression(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.muscle)) groups.set(r.muscle, []);
    groups.get(r.muscle).push(r);
  }
  return [...groups.entries()].map(([muscle, items]) => {
    items.sort((a, b) => b.daysSince - a.daysSince);
    const progressed = items.filter(i => i.verdict !== "stale").length;
    const regressed = items.some(i => i.verdict === "down");
    return { muscle, items, upCount: items.filter(i => i.verdict === "up").length, total: items.length, progressed, regressed };
  }).sort((a, b) => a.muscle.localeCompare(b.muscle));
}
