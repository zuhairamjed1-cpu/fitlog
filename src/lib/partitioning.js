// ─── NUTRITION PARTITIONING ENGINE (pure, testable) ─────────────────────────
// Redistributes the user's EXISTING daily macro total across time slots. Never
// computes a new total. Floors (pre/post activity) are fixed inputs; flexible
// slots are the reflowable output.
import { SESSION_TYPES } from "../engines/fueling";

// ── tunable constants (spec §9 open questions + md-only numerics) ──
export const TIGHT_GAP_THRESHOLD_MINUTES = 45;   // floor↔flex closeness → "tight" badge (no merge). TODO: confirm threshold
export const DRIFT_DAMPING_MINUTES = 15;         // ignore logging variance below this before reflow. TODO: confirm
export const MAX_ACTIVITIES_PER_DAY = null;      // no cap yet. TODO: decide if floors crowd out neutral time
const MERGE_GAP_MINUTES = 75;                    // adjacent flexible slots closer than this merge visually. TODO: confirm against spec
const LOG_MATCH_MINUTES = 90;                    // a logged meal within this of a slot marks it logged. TODO: confirm against spec
const NEUTRAL_WINDOW_MINUTES = 180;              // required ≥1 activity-free span. TODO: confirm against spec
// Floor sizing (md §3): fraction of the DAY's carbs/protein/fat per floor, then
// scaled by intensity × duration. Fat mostly kept out of the peri-workout window.
const FLOOR_FRAC = { preCarb: 0.12, preProt: 0.04, postCarb: 0.12, postProt: 0.12, fat: 0.02 }; // TODO: confirm against spec
const FLOOR_CARB_CAP = 0.50;  // floors may claim at most this share of daily carbs. TODO: confirm against spec
const FLOOR_PROT_CAP = 0.45;
const INTENSITY_FACTOR = { light: 0.8, moderate: 1.0, hard: 1.3 };
const FLEX_WEIGHTS = { Breakfast: 0.30, Lunch: 0.35, Dinner: 0.30, Snack: 0.05 };
// Natural clock anchors (minutes-of-day). TODO: confirm against spec / make user-set.
const MEAL_CLOCK = { Breakfast: 8 * 60, Lunch: 13 * 60, Snack: 16 * 60, Dinner: 19 * 60 };

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const timeToMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : 0; };
export const minToTime = m => { const x = clamp(Math.round(m), 0, 1439); return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
export const minToISO = (dayKey, m) => `${dayKey}T${minToTime(m)}:00`;

// Integer split of `total` across weights[], remainder handed out in order.
function splitInt(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map(w => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rem = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; rem > 0 && i < out.length; i = (i + 1) % out.length) { out[i]++; rem--; if (i === out.length - 1 && rem === 0) break; }
  return out;
}

function floorMacros(totals, session) {
  const typeLoad = (SESSION_TYPES[session.type] || {}).load || 1;
  const dur = session.durationMin || (SESSION_TYPES[session.type] || {}).defMin || 60;
  const scale = (INTENSITY_FACTOR[session.intensity] || 1) * typeLoad * clamp(dur / 60, 0.5, 2);
  return {
    dur, scale,
    pre: { carbsG: Math.round(totals.carbsG * FLOOR_FRAC.preCarb * scale), proteinG: Math.round(totals.proteinG * FLOOR_FRAC.preProt * scale), fatG: 0 },
    post: { carbsG: Math.round(totals.carbsG * FLOOR_FRAC.postCarb * scale), proteinG: Math.round(totals.proteinG * FLOOR_FRAC.postProt * scale), fatG: Math.round(totals.fatG * FLOOR_FRAC.fat * scale) },
  };
}

// buildTimeline — the whole engine.
//   totals: { carbsG, proteinG, fatG }  (the EXISTING daily target)
//   sessions: [{ id, type, time, durationMin, intensity }]
//   loggedMeals: [{ ts|min, ... }] real meals for the day (minutes-of-day in `min`)
// Returns { slots, tightPairs, neutralOk, floorCount, flexBudget }.
export function buildTimeline({ dayKey, totals, sessions = [], wakeMin = 420, sleepMin = 1380, nowMin = null, loggedMeals = [] }) {
  const T = { carbsG: Math.round(totals.carbsG || 0), proteinG: Math.round(totals.proteinG || 0), fatG: Math.round(totals.fatG || 0) };
  const winStart = wakeMin + 45;
  const winEnd = sleepMin - 90;

  // ── 1. floors (fixed) ──
  const floors = [];
  [...sessions].sort((a, b) => timeToMin(a.time) - timeToMin(b.time)).forEach(s => {
    const start = timeToMin(s.time);
    const fm = floorMacros(T, s);
    floors.push({ id: `pre-${s.id}`, type: "floor", mealName: "Pre-workout", status: "planned", plannedMin: start - 45, loggedMin: null, macros: fm.pre, activityId: s.id, note: "Fuel before training — quick carbs, light protein." });
    floors.push({ id: `post-${s.id}`, type: "floor", mealName: "Post-workout", status: "planned", plannedMin: start + fm.dur + 15, loggedMin: null, macros: fm.post, activityId: s.id, note: "Refuel + repair — carbs and protein after training." });
  });
  // cap floor claims so flexibles never go negative
  const capMacro = (key, cap) => {
    const used = floors.reduce((s, f) => s + f.macros[key], 0);
    const max = Math.floor(T[key] * cap);
    if (used > max && used > 0) { const k = max / used; floors.forEach(f => f.macros[key] = Math.round(f.macros[key] * k)); }
  };
  capMacro("carbsG", FLOOR_CARB_CAP); capMacro("proteinG", FLOOR_PROT_CAP); capMacro("fatG", 0.20);
  const floorSum = key => floors.reduce((s, f) => s + f.macros[key], 0);

  // ── 2. flexible anchors ──
  // Anchor meals to natural CLOCK times (not evenly smeared across the sleep
  // window — that produced a 6pm "Breakfast" when sleep data skewed the window).
  // Each is clamped into the waking window so odd wake/sleep never invert them.
  const names = ["Breakfast", "Lunch", "Dinner"];
  if (winEnd - winStart > 600) names.splice(2, 0, "Snack");
  let prevM = -Infinity;
  const flex = names.map((nm, i) => {
    let m = clamp(MEAL_CLOCK[nm], winStart, winEnd);
    if (m <= prevM) m = Math.min(winEnd, prevM + 60); // keep order if the window is tight
    prevM = m;
    return { id: `flex-${dayKey}-${i}`, type: "flexible", mealName: nm, status: "planned", loggedMin: null, plannedMin: m, macros: { carbsG: 0, proteinG: 0, fatG: 0 }, activityId: null, note: "" };
  });

  // ── 3. mark logged (match real meals to nearest slot). Logged slots lock to
  //       the ACTUAL eaten macros and are excluded from all later recompute. ──
  const all = [...floors, ...flex];
  loggedMeals.forEach(mealRaw => {
    const mm = mealRaw.min != null ? mealRaw.min : timeToMin(mealRaw.time);
    let best = null, bestD = LOG_MATCH_MINUTES;
    all.forEach(sl => { if (sl.status === "logged") return; const d = Math.abs(sl.plannedMin - mm); if (d <= bestD) { best = sl; bestD = d; } });
    if (best) {
      best.status = "logged"; best.loggedMin = mm;
      best.macros = { carbsG: Math.round(mealRaw.carbsG || 0), proteinG: Math.round(mealRaw.proteinG || 0), fatG: Math.round(mealRaw.fatG || 0) };
    }
  });

  // ── 4. reflow ──
  // Meals hold their natural clock times; we do NOT stampede unlogged meals to
  // after "now" (that bunched the whole day into the evening). Reflow here is
  // limited to the MACRO budget in step 5 — logged meals lock, remaining budget
  // flows to the still-planned meals. `nowMin` is used only for display state.

  // ── 5. macro distribution: floors + already-eaten (logged) come off the top;
  //       the REMAINDER is split across PLANNED flexibles only. Logged slots keep
  //       their actual macros (immutable). With no logged slots this reduces to
  //       Σ(all slots) === daily target exactly. ──
  const plannedFlex = flex.filter(s => s.status === "planned");
  const loggedFlex = flex.filter(s => s.status === "logged");
  ["carbsG", "proteinG", "fatG"].forEach(key => {
    const eaten = loggedFlex.reduce((s, sl) => s + sl.macros[key], 0);
    const budget = Math.max(0, T[key] - floorSum(key) - eaten);
    const weights = plannedFlex.map(s => FLEX_WEIGHTS[s.mealName] ?? 0.2);
    const parts = splitInt(budget, weights);
    plannedFlex.forEach((s, i) => { s.macros[key] = parts[i]; });
  });

  // ── 6. tight-gap pairs (floor near flexible) + neutral window ──
  const slots = [...floors, ...flex].sort((a, b) => a.plannedMin - b.plannedMin);
  const tightPairs = [];
  for (let i = 0; i < slots.length - 1; i++) {
    const a = slots[i], b = slots[i + 1];
    if ((a.type === "floor") !== (b.type === "floor") && Math.abs(a.plannedMin - b.plannedMin) <= TIGHT_GAP_THRESHOLD_MINUTES) tightPairs.push([a.id, b.id]);
  }
  // neutral: ≥1 span of NEUTRAL_WINDOW_MINUTES in [winStart,winEnd] with no floor inside
  const floorMins = floors.map(f => f.plannedMin).sort((a, b) => a - b);
  let neutralOk = false; let prev = winStart;
  for (const fm of [...floorMins, winEnd]) { if (fm - prev >= NEUTRAL_WINDOW_MINUTES) { neutralOk = true; break; } prev = Math.max(prev, fm); }
  if (!floorMins.length) neutralOk = true;

  // attach ISO + human note
  slots.forEach(s => {
    s.plannedTime = minToISO(dayKey, s.plannedMin);
    s.loggedTime = s.loggedMin != null ? minToISO(dayKey, s.loggedMin) : null;
    if (s.type === "flexible" && !s.note) s.note = `${s.mealName} — spread your remaining carbs, protein and fat evenly here.`;
  });

  return { slots, tightPairs, neutralOk, floorCount: floors.length, mergeGap: MERGE_GAP_MINUTES };
}

// Sum of a macro across slots — used by callers/tests to assert the invariant.
export const sumMacro = (slots, key) => slots.reduce((s, sl) => s + (sl.macros[key] || 0), 0);
