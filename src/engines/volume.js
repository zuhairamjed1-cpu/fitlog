// ─── WEEKLY MUSCLE-VOLUME ENGINE ─────────────────────────────────────────────
// Counts HARD WORKING SETS per muscle group from logged workouts and classifies
// each against evidence-based hypertrophy landmarks. Everything here is an
// ESTIMATE (tier "estimate"): set→muscle attribution is heuristic and individual
// volume tolerance varies, so the UI must never present these as universal truth.
//
// Week = calendar Monday 00:00 → Sunday 23:59 (NOT rolling, NOT biological day).
// Secondary muscles get half credit (0.5) — volume is distributed, not duplicated.

import { localDateStr, daysAgo } from "../lib/dates.js";
import { parseWorkout } from "./workout.js";

// 17 trackable groups, with display label, push/pull/legs/core role, and body side.
export const MUSCLES = {
  chest: { label: "Chest", role: "push", side: "front" },
  frontDelts: { label: "Front Delts", role: "push", side: "front" },
  sideDelts: { label: "Side Delts", role: "push", side: "front" },
  rearDelts: { label: "Rear Delts", role: "pull", side: "back" },
  triceps: { label: "Triceps", role: "push", side: "back" },
  biceps: { label: "Biceps", role: "pull", side: "front" },
  forearms: { label: "Forearms", role: "pull", side: "front" },
  lats: { label: "Lats", role: "pull", side: "back" },
  upperBack: { label: "Upper Back", role: "pull", side: "back" },
  traps: { label: "Traps", role: "pull", side: "back" },
  erectors: { label: "Spinal Erectors", role: "pull", side: "back" },
  abs: { label: "Abs", role: "core", side: "front" },
  obliques: { label: "Obliques", role: "core", side: "front" },
  glutes: { label: "Glutes", role: "legs", side: "back" },
  quads: { label: "Quads", role: "legs", side: "front" },
  hamstrings: { label: "Hamstrings", role: "legs", side: "back" },
  calves: { label: "Calves", role: "legs", side: "back" },
};
export const MUSCLE_KEYS = Object.keys(MUSCLES);

// Evidence-based weekly-set landmarks (general starting points, not universal).
export const VOLUME_BANDS = [
  { key: "veryLow", label: "Very Low", min: 0, max: 5, color: "#5a6472" },
  { key: "maintenance", label: "Maintenance", min: 6, max: 9, color: "#7d8aa0" },
  { key: "productive", label: "Productive", min: 10, max: 15, color: "#8fd989" },
  { key: "high", label: "High", min: 16, max: 20, color: "#5cc8df" },
  { key: "extreme", label: "Extremely High", min: 21, max: Infinity, color: "#f9c97e" },
];
export function classifyVolume(sets) {
  const s = sets || 0;
  const band = VOLUME_BANDS.find(b => s >= b.min && s <= b.max) || VOLUME_BANDS[0];
  return { key: band.key, label: band.label, color: band.color };
}

// Exercise name → { primary:[], secondary:[] } using the fine taxonomy.
const P = (primary, secondary = []) => ({ primary, secondary });
export function mapExercise(rawName) {
  const n = (rawName || "").toLowerCase().replace(/[()]/g, " ").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return null;
  // legs
  if (/\b(leg curls?|lying curls?|seated leg curls?|hamstring curls?|nordic)\b/.test(n)) return P(["hamstrings"]);
  if (/\b(romanian|rdl|stiff leg|good morning)\b/.test(n)) return P(["hamstrings", "glutes"], ["erectors"]);
  if (/\b(leg extensions?|quad extensions?|knee extensions?)\b/.test(n)) return P(["quads"]);
  if (/\bcalf\b|\bcalves\b|\bcalf raises?\b/.test(n)) return P(["calves"]);
  if (/\b(hip thrusts?|glute bridges?|kickbacks?|glute|abductions?)\b/.test(n)) return P(["glutes"], ["hamstrings"]);
  if (/\b(leg press|hack squats?)\b/.test(n)) return P(["quads"], ["glutes"]);
  if (/\b(front squats?)\b/.test(n)) return P(["quads"], ["glutes", "erectors"]);
  if (/\b(squats?)\b/.test(n)) return P(["quads"], ["glutes", "hamstrings", "erectors"]);
  if (/\b(lunges?|split squats?|bulgarian|step ups?)\b/.test(n)) return P(["quads"], ["glutes", "hamstrings"]);
  // posterior chain / pulls
  if (/\b(deadlifts?|trap bar|sumo)\b/.test(n)) return P(["erectors", "glutes", "hamstrings"], ["traps", "lats"]);
  if (/\b(back extensions?|hyperextensions?|45 extensions?)\b/.test(n)) return P(["erectors"], ["glutes", "hamstrings"]);
  if (/\b(face pulls?|rear delts?|reverse flys?|reverse flyes?|reverse pec|rear flys?)\b/.test(n)) return P(["rearDelts"], ["upperBack"]);
  if (/\b(shrugs?)\b/.test(n)) return P(["traps"]);
  if (/\b(pullovers?)\b/.test(n)) return P(["lats"], ["chest"]);
  if (/\b(pulldowns?|pull downs?|lat pulls?|pull ups?|pullups?|chin ups?|chinups?)\b/.test(n)) return P(["lats"], ["biceps", "upperBack"]);
  if (/\b(rows?|t bar|seal rows?|pendlay|meadows)\b/.test(n)) return P(["upperBack", "lats"], ["biceps", "rearDelts"]);
  // shoulders
  if (/\b(lateral raises?|side raises?|lat raises?|side delts?|cable raises?|y raises?)\b/.test(n)) return P(["sideDelts"]);
  if (/\b(front raises?)\b/.test(n)) return P(["frontDelts"]);
  if (/\b(overhead press|shoulder press|ohp|military|arnold|push press|strict press|seated press)\b/.test(n)) return P(["frontDelts"], ["sideDelts", "triceps"]);
  // arms
  if (/\b(wrist curls?|reverse curls?|forearm|grip|farmers?)\b/.test(n)) return P(["forearms"]);
  if (/\b(hammer curls?)\b/.test(n)) return P(["biceps", "forearms"]);
  if (/\bcurls?\b/.test(n)) return P(["biceps"], ["forearms"]);
  if (/\b(triceps?|pushdowns?|push downs?|skull|close grip|overhead extensions?|kickbacks?|dips?)\b/.test(n)) return P(["triceps"], /dips?|close grip/.test(n) ? ["chest"] : []);
  // chest
  if (/\b(flys?|flyes?|pec decks?|pec dec)\b/.test(n)) return P(["chest"], ["frontDelts"]);
  if (/\b(incline bench|incline press|incline)\b/.test(n)) return P(["chest"], ["frontDelts", "triceps"]);
  if (/\b(bench|chest press|decline press|chest|push ups?|pushups?)\b/.test(n)) return P(["chest"], ["triceps", "frontDelts"]);
  // core
  if (/\b(obliques?|side bends?|russian twists?|woodchops?|twists?)\b/.test(n)) return P(["obliques"], ["abs"]);
  if (/\b(crunch|crunches|sit ups?|situps?|planks?|leg raises?|knee raises?|hanging|ab wheel|cable crunch|core|abs?)\b/.test(n)) return P(["abs"]);
  // generic fallbacks
  if (/\bpress(es)?\b/.test(n)) return P(["chest"], ["triceps", "frontDelts"]);
  if (/\bextensions?\b/.test(n)) return P(["triceps"]);
  if (/\braises?\b/.test(n)) return P(["sideDelts"]);
  return null;
}

// A "working set" = a logged set that isn't an obvious warmup. We don't have an
// explicit warmup flag, so we only drop sets the user marked very easy (RPE < 5).
const isWorkingSet = s => !(s && s.rpe != null && s.rpe < 5);

const mondayOf = dateStr => {
  const d = new Date(dateStr + "T00:00:00");
  const day = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - day);
  return localDateStr(d);
};

// Sum per-muscle working sets for a list of exercise log entries.
function volumeForEntries(entries) {
  const vol = {}; MUSCLE_KEYS.forEach(m => (vol[m] = 0));
  let unmapped = 0, totalSets = 0;
  entries.forEach(e => {
    const parsed = e._parsed || parseWorkout(e.text || "");
    (parsed.exercises || []).forEach(ex => {
      const working = (ex.sets || []).filter(isWorkingSet).length;
      if (!working) return;
      totalSets += working;
      const map = mapExercise(ex.name);
      if (!map) { unmapped += working; return; }
      map.primary.forEach(m => { if (vol[m] != null) vol[m] += working * 1.0; });
      (map.secondary || []).forEach(m => { if (vol[m] != null) vol[m] += working * 0.5; });
    });
  });
  return { vol, unmapped, totalSets };
}

// computeVolume(data, goals, today?) → the full weekly-volume model.
export function computeVolume(data, goals, today) {
  const t = today || localDateStr(new Date());
  const ex = (data && data.exercise || []).filter(e => e && e.date);
  const thisMon = mondayOf(t);
  const prevMon = (() => { const d = new Date(thisMon + "T00:00:00"); d.setDate(d.getDate() - 7); return localDateStr(d); })();

  const inWeek = (e, mon) => { const m = mondayOf(e.date); return m === mon; };
  const thisWk = volumeForEntries(ex.filter(e => inWeek(e, thisMon)));
  const lastWk = volumeForEntries(ex.filter(e => inWeek(e, prevMon)));

  if (!ex.length) return { ready: false, tier: "estimate", weeklyVolume: {}, muscles: [], reason: "Log some workouts to see your weekly muscle volume." };

  const targets = (goals && goals.goalPlan && goals.goalPlan.volumeTargets) || {};

  const round = x => Math.round(x);
  const weeklyVolume = {};
  const muscles = MUSCLE_KEYS.map(key => {
    const now = round(thisWk.vol[key]);
    const prev = round(lastWk.vol[key]);
    weeklyVolume[key] = now;
    const target = targets[key] != null ? targets[key] : null;
    return {
      key, label: MUSCLES[key].label, role: MUSCLES[key].role, side: MUSCLES[key].side,
      thisWeek: now, lastWeek: prev, change: now - prev,
      status: classifyVolume(now), target,
      progress: target ? Math.round((now / target) * 100) : null,
    };
  });

  const trained = muscles.filter(m => m.thisWeek > 0);
  const sorted = muscles.slice().sort((a, b) => b.thisWeek - a.thisWeek);
  const summary = {
    highest: sorted[0] && sorted[0].thisWeek > 0 ? { label: sorted[0].label, sets: sorted[0].thisWeek } : null,
    lowest: trained.length ? (() => { const l = trained.slice().sort((a, b) => a.thisWeek - b.thisWeek)[0]; return { label: l.label, sets: l.thisWeek }; })() : null,
    totalSets: round(MUSCLE_KEYS.reduce((s, k) => s + thisWk.vol[k], 0)),
    musclesTrained: trained.length,
    unmappedSets: thisWk.unmapped,
  };

  // weak points: trained-but-low or untrained major muscles, below maintenance (<6)
  const weakPoints = muscles
    .filter(m => m.thisWeek < 6)
    .sort((a, b) => a.thisWeek - b.thisWeek)
    .slice(0, 6)
    .map(m => ({ label: m.label, sets: m.thisWeek, target: m.target }));

  // symmetry
  const sumRole = role => round(MUSCLE_KEYS.filter(k => MUSCLES[k].role === role).reduce((s, k) => s + thisWk.vol[k], 0));
  const push = sumRole("push"), pull = sumRole("pull");
  const upperKeys = MUSCLE_KEYS.filter(k => ["push", "pull"].includes(MUSCLES[k].role));
  const lowerKeys = MUSCLE_KEYS.filter(k => MUSCLES[k].role === "legs");
  const upper = round(upperKeys.reduce((s, k) => s + thisWk.vol[k], 0));
  const lower = round(lowerKeys.reduce((s, k) => s + thisWk.vol[k], 0));
  const symmetry = { push, pull, pushPullDiff: push - pull, upper, lower, upperLowerDiff: upper - lower };

  return {
    ready: true, tier: "estimate", weekStart: thisMon, weeklyVolume, muscles, summary, weakPoints, symmetry,
    hasTargets: Object.keys(targets).length > 0,
  };
}

// Per-muscle volume across the last N calendar weeks (oldest→newest) for trends.
export function volumeTrend(data, muscleKey, weeks = 6, today) {
  const t = today || localDateStr(new Date());
  const ex = (data && data.exercise || []).filter(e => e && e.date);
  const thisMon = mondayOf(t);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(thisMon + "T00:00:00"); d.setDate(d.getDate() - i * 7);
    const mon = localDateStr(d);
    const { vol } = volumeForEntries(ex.filter(e => mondayOf(e.date) === mon));
    out.push({ weekStart: mon, sets: Math.round(vol[muscleKey] || 0) });
  }
  return out;
}
