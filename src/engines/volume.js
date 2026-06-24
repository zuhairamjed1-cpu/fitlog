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
  adductors: { label: "Adductors", role: "legs", side: "front" },
  hamstrings: { label: "Hamstrings", role: "legs", side: "back" },
  calves: { label: "Calves", role: "legs", side: "back" },
};
export const MUSCLE_KEYS = Object.keys(MUSCLES);

// Per-muscle evidence-based weekly working-set ranges (general MEV→MRV guidance,
// not universal truth). Status is judged relative to each muscle's own range.
export const MUSCLE_RANGE = {
  chest: [10, 20], frontDelts: [6, 12], sideDelts: [10, 20], rearDelts: [8, 15],
  triceps: [10, 18], biceps: [10, 18], forearms: [6, 14], lats: [10, 20],
  upperBack: [10, 20], traps: [8, 16], erectors: [6, 14], abs: [8, 18],
  obliques: [6, 14], glutes: [8, 16], quads: [10, 20], adductors: [4, 12],
  hamstrings: [10, 18], calves: [10, 18],
};

// Suggested fixes for an undertrained muscle (used by Weak Points).
export const MUSCLE_FIXES = {
  chest: ["Incline Press", "Cable Fly"], frontDelts: ["Overhead Press", "Front Raise"],
  sideDelts: ["Lateral Raise", "Cable Lateral Raise"], rearDelts: ["Face Pull", "Reverse Pec Deck"],
  triceps: ["Pushdown", "Overhead Extension"], biceps: ["Incline Curl", "Hammer Curl"],
  forearms: ["Wrist Curl", "Farmer Carry"], lats: ["Lat Pulldown", "Pull Up"],
  upperBack: ["Chest-Supported Row", "Cable Row"], traps: ["Shrug", "Rack Pull"],
  erectors: ["Back Extension", "Deadlift"], abs: ["Cable Crunch", "Hanging Leg Raise"],
  obliques: ["Cable Woodchop", "Side Plank"], glutes: ["Hip Thrust", "Bulgarian Split Squat"],
  quads: ["Squat", "Leg Press"], adductors: ["Adduction Machine", "Copenhagen Plank"],
  hamstrings: ["Romanian Deadlift", "Leg Curl"], calves: ["Standing Calf Raise", "Seated Calf Raise"],
};

// Status relative to a muscle's own recommended range, with a body-map fill opacity.
export function statusFor(sets, range) {
  const [min, max] = range || [8, 16];
  if (!sets) return { key: "untrained", label: "Untrained", color: "#4a525f", opacity: 0.45 };
  if (sets < min) return { key: "under", label: "Undertrained", color: "#d99d6a", opacity: 0.55 };
  if (sets <= max) return { key: "optimal", label: "Optimal", color: "#8fd989", opacity: 0.95 };
  if (sets <= max * 1.3) return { key: "high", label: "High", color: "#5cc8df", opacity: 1 };
  return { key: "excessive", label: "Excessive", color: "#f9c97e", opacity: 1 };
}
export const STATUS_LEGEND = [
  { key: "under", label: "Undertrained", color: "#d99d6a", opacity: 0.55 },
  { key: "optimal", label: "Optimal", color: "#8fd989", opacity: 0.95 },
  { key: "high", label: "High", color: "#5cc8df", opacity: 1 },
  { key: "excessive", label: "Excessive", color: "#f9c97e", opacity: 1 },
];

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
// Normalize an exercise name to a stable key (drops equipment in parens, punctuation).
export function normExercise(raw) {
  return (raw || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// Exercise name → ONE primary muscle key (or null). No secondary, no percentages.
export function mapExercise(rawName) {
  const n = normExercise(rawName);
  if (!n) return null;
  // legs
  if (/\b(leg curls?|lying curls?|seated leg curls?|hamstring curls?|nordic)\b/.test(n)) return "hamstrings";
  if (/\b(romanian|rdl|stiff leg|good morning)\b/.test(n)) return "hamstrings";
  if (/\b(leg extensions?|quad extensions?|knee extensions?)\b/.test(n)) return "quads";
  if (/\b(adduction|adductor|copenhagen|thigh squeeze)\b/.test(n)) return "adductors";
  if (/\bcalf\b|\bcalves\b|\bcalf raises?\b|soleus\b/.test(n)) return "calves";
  if (/\b(hip thrusts?|glute bridges?|kickbacks?|glute|abduction)\b/.test(n)) return "glutes";
  if (/\b(leg press|hack squats?)\b/.test(n)) return "quads";
  if (/\b(front squats?|squats?|lunges?|split squats?|bulgarian|step ups?)\b/.test(n)) return "quads";
  // posterior chain / pulls
  if (/\b(deadlifts?|trap bar|sumo)\b/.test(n)) return "erectors";
  if (/\b(back extensions?|hyperextensions?|45 extensions?)\b/.test(n)) return "erectors";
  if (/\b(face pulls?|rear delts?|reverse flys?|reverse flyes?|reverse pec|rear flys?)\b/.test(n)) return "rearDelts";
  if (/\b(shrugs?|rack pulls?)\b/.test(n)) return "traps";
  if (/\b(pullovers?)\b/.test(n)) return "lats";
  if (/\b(pulldowns?|pull downs?|lat pulls?|pull ups?|pullups?|chin ups?|chinups?|straight arm)\b/.test(n)) return "lats";
  if (/\b(rows?|t bar|seal rows?|pendlay|meadows)\b/.test(n)) return "upperBack";
  // shoulders
  if (/\b(lateral raises?|side raises?|lat raises?|side delts?|cable raises?|y raises?)\b/.test(n)) return "sideDelts";
  if (/\b(front raises?)\b/.test(n)) return "frontDelts";
  if (/\b(overhead press|shoulder press|ohp|military|arnold|push press|strict press|seated press)\b/.test(n)) return "frontDelts";
  // arms
  if (/\b(wrist curls?|reverse curls?|forearm|grip|farmers?)\b/.test(n)) return "forearms";
  if (/\b(hammer curls?|curls?)\b/.test(n)) return "biceps";
  if (/\b(triceps?|pushdowns?|push downs?|skull|close grip|overhead extensions?|kickbacks?|dips?)\b/.test(n)) return "triceps";
  // chest
  if (/\b(flys?|flyes?|pec decks?|pec dec)\b/.test(n)) return "chest";
  if (/\b(incline bench|incline press|incline|bench|chest press|decline press|chest|push ups?|pushups?)\b/.test(n)) return "chest";
  // core
  if (/\b(obliques?|side bends?|russian twists?|woodchops?|twists?)\b/.test(n)) return "obliques";
  if (/\b(crunch|crunches|sit ups?|situps?|planks?|leg raises?|knee raises?|hanging|ab wheel|cable crunch|core|abs?)\b/.test(n)) return "abs";
  // generic fallbacks
  if (/\bpress(es)?\b/.test(n)) return "chest";
  if (/\bextensions?\b/.test(n)) return "triceps";
  if (/\braises?\b/.test(n)) return "sideDelts";
  return null;
}

// Resolve an exercise to its muscle, honoring user overrides (normExercise-keyed).
export function resolveMuscle(rawName, overrides) {
  const n = normExercise(rawName);
  if (overrides && overrides[n]) return overrides[n];
  return mapExercise(rawName);
}

// Built-in catalog (display name → muscle), derived from mapExercise so it's always consistent.
const CATALOG_NAMES = ["Bench Press", "Incline Bench Press", "Dumbbell Bench Press", "Chest Press", "Push Up", "Cable Fly", "Pec Deck", "Dips", "Overhead Press", "Arnold Press", "Lateral Raise", "Cable Lateral Raise", "Front Raise", "Face Pull", "Reverse Pec Deck", "Rear Delt Fly", "Lat Pulldown", "Pull Up", "Chin Up", "Straight Arm Pulldown", "Pullover", "Barbell Row", "Dumbbell Row", "Cable Row", "Chest Supported Row", "T-Bar Row", "Shrug", "Rack Pull", "Bicep Curl", "Hammer Curl", "Preacher Curl", "Incline Curl", "Tricep Pushdown", "Overhead Tricep Extension", "Skull Crusher", "Close Grip Bench Press", "Wrist Curl", "Reverse Curl", "Squat", "Front Squat", "Leg Press", "Hack Squat", "Lunge", "Bulgarian Split Squat", "Leg Extension", "Romanian Deadlift", "Deadlift", "Leg Curl", "Hip Thrust", "Glute Bridge", "Back Extension", "Standing Calf Raise", "Seated Calf Raise", "Cable Crunch", "Hanging Leg Raise", "Plank", "Russian Twist", "Cable Woodchop", "Adduction Machine"];
export const EXERCISE_CATALOG = CATALOG_NAMES.map(name => ({ name, norm: normExercise(name), muscle: mapExercise(name) })).filter(x => x.muscle);

// All exercises FitLog knows about (catalog + ones the user has logged) with their
// current primary muscle (after overrides). Powers the Exercise Mapping card.
export function listExerciseMappings(data, goals) {
  const overrides = (goals && goals.exerciseMap) || {};
  const seen = new Map();
  EXERCISE_CATALOG.forEach(c => seen.set(c.norm, { name: c.name, norm: c.norm, source: "catalog" }));
  (data && data.exercise || []).forEach(e => {
    const p = e._parsed || parseWorkout(e.text || "");
    (p.exercises || []).forEach(ex => {
      const n = normExercise(ex.name);
      if (!n) return;
      if (!seen.has(n)) seen.set(n, { name: (ex.name || "").replace(/\s+/g, " ").trim(), norm: n, source: "logged" });
    });
  });
  return [...seen.values()]
    .map(o => ({ ...o, muscle: overrides[o.norm] || mapExercise(o.name), overridden: overrides[o.norm] != null }))
    .filter(o => o.muscle)
    .sort((a, b) => a.name.localeCompare(b.name));
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
function volumeForEntries(entries, overrides) {
  const vol = {}; MUSCLE_KEYS.forEach(m => (vol[m] = 0));
  let unmapped = 0, totalSets = 0;
  entries.forEach(e => {
    const parsed = e._parsed || parseWorkout(e.text || "");
    (parsed.exercises || []).forEach(ex => {
      const working = (ex.sets || []).filter(isWorkingSet).length;
      if (!working) return;
      totalSets += working;
      const m = resolveMuscle(ex.name, overrides);
      if (m && vol[m] != null) vol[m] += working; else unmapped += working;
    });
  });
  return { vol, unmapped, totalSets };
}

// computeVolume(data, goals, today?, weekOffset?) → the weekly-volume model.
// weekOffset 0 = current Mon–Sun week, 1 = the previous week (toggle).
export function computeVolume(data, goals, today, weekOffset = 0) {
  const t = today || localDateStr(new Date());
  const ex = (data && data.exercise || []).filter(e => e && e.date);
  if (!ex.length) return { ready: false, tier: "estimate", weeklyVolume: {}, muscles: [], reason: "Log some workouts to see your weekly muscle volume." };

  const curMon = mondayOf(t);
  const shift = (mon, weeks) => { const d = new Date(mon + "T00:00:00"); d.setDate(d.getDate() - weeks * 7); return localDateStr(d); };
  const selMon = shift(curMon, weekOffset);
  const prevMon = shift(selMon, 1);

  const overrides = (goals && goals.exerciseMap) || {};
  const weekEntries = ex.filter(e => mondayOf(e.date) === selMon);
  const thisWk = volumeForEntries(weekEntries, overrides);
  const lastWk = volumeForEntries(ex.filter(e => mondayOf(e.date) === prevMon), overrides);

  const targets = (goals && goals.goalPlan && goals.goalPlan.volumeTargets) || {};
  const round = x => Math.round(x);
  const weeklyVolume = {};
  const muscles = MUSCLE_KEYS.map(key => {
    const now = round(thisWk.vol[key]);
    const prev = round(lastWk.vol[key]);
    weeklyVolume[key] = now;
    const range = MUSCLE_RANGE[key] || [8, 16];
    const target = targets[key] != null ? targets[key] : null;
    return {
      key, label: MUSCLES[key].label, role: MUSCLES[key].role, side: MUSCLES[key].side,
      thisWeek: now, lastWeek: prev, change: now - prev,
      changePct: prev > 0 ? Math.round(((now - prev) / prev) * 100) : null,
      range, recommended: `${range[0]}-${range[1]}`, status: statusFor(now, range),
      target, progress: target ? Math.round((now / target) * 100) : null,
    };
  });

  const thisTotal = round(MUSCLE_KEYS.reduce((s, k) => s + thisWk.vol[k], 0));
  const lastTotal = round(MUSCLE_KEYS.reduce((s, k) => s + lastWk.vol[k], 0));
  let totalExercises = 0;
  weekEntries.forEach(e => { const p = e._parsed || parseWorkout(e.text || ""); totalExercises += (p.exercises || []).filter(x => (x.sets || []).some(isWorkingSet)).length; });
  const trained = muscles.filter(m => m.thisWeek > 0);
  const sorted = muscles.slice().sort((a, b) => b.thisWeek - a.thisWeek);
  const summary = {
    highest: sorted[0] && sorted[0].thisWeek > 0 ? { label: sorted[0].label, sets: sorted[0].thisWeek } : null,
    lowest: trained.length ? (() => { const l = trained.slice().sort((a, b) => a.thisWeek - b.thisWeek)[0]; return { label: l.label, sets: l.thisWeek }; })() : null,
    totalSets: thisTotal, totalExercises, totalSessions: weekEntries.length,
    trainingDays: new Set(weekEntries.map(e => e.date)).size,
    musclesTrained: trained.length, unmappedSets: thisWk.unmapped,
    volumeTrendPct: lastTotal > 0 ? Math.round(((thisTotal - lastTotal) / lastTotal) * 100) : null,
  };

  // weak points: below each muscle's recommended minimum, most-deficient first
  const weakPoints = muscles
    .filter(m => m.thisWeek < m.range[0])
    .sort((a, b) => (a.thisWeek - a.range[0]) - (b.thisWeek - b.range[0]))
    .slice(0, 5)
    .map(m => ({
      key: m.key, label: m.label, sets: m.thisWeek, range: m.range,
      suggestedTarget: `${m.range[0]}-${m.range[1]}`, exercises: MUSCLE_FIXES[m.key] || [],
      reason: m.thisWeek === 0 ? `No sets logged this week (recommended ${m.range[0]}–${m.range[1]}).` : `Only ${m.thisWeek} set${m.thisWeek === 1 ? "" : "s"} this week — below the ~${m.range[0]}-set minimum.`,
    }));

  // raw volume balance (NO symmetry score / percentage — just the totals)
  const sumKeys = keys => round(keys.reduce((s, k) => s + thisWk.vol[k], 0));
  const balance = {
    push: sumKeys(MUSCLE_KEYS.filter(k => MUSCLES[k].role === "push")),
    pull: sumKeys(MUSCLE_KEYS.filter(k => MUSCLES[k].role === "pull")),
    upper: sumKeys(MUSCLE_KEYS.filter(k => ["push", "pull"].includes(MUSCLES[k].role))),
    lower: sumKeys(MUSCLE_KEYS.filter(k => MUSCLES[k].role === "legs")),
    anterior: sumKeys(MUSCLE_KEYS.filter(k => MUSCLES[k].side === "front")),
    posterior: sumKeys(MUSCLE_KEYS.filter(k => MUSCLES[k].side === "back")),
  };

  return {
    ready: true, tier: "estimate", weekOffset, weekStart: selMon, prevWeekStart: prevMon,
    weeklyVolume, muscles, summary, weakPoints, balance, hasTargets: Object.keys(targets).length > 0,
  };
}

// Per-muscle volume across the last N calendar weeks (oldest→newest) for trends.
export function volumeTrend(data, muscleKey, weeks = 6, today, overrides) {
  const t = today || localDateStr(new Date());
  const ex = (data && data.exercise || []).filter(e => e && e.date);
  const thisMon = mondayOf(t);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(thisMon + "T00:00:00"); d.setDate(d.getDate() - i * 7);
    const mon = localDateStr(d);
    const { vol } = volumeForEntries(ex.filter(e => mondayOf(e.date) === mon), overrides);
    out.push({ weekStart: mon, sets: Math.round(vol[muscleKey] || 0) });
  }
  return out;
}
