// ─── HIERARCHICAL MUSCLE TAXONOMY (group → subgroup) ─────────────────────────
// A DISPLAY/CLASSIFICATION layer for the Exercise Mapping card + the new-exercise
// popup. It does NOT replace the volume engine. Every subgroup resolves down to
// one existing volume.js muscle key (`muscle`), so all downstream math
// (computeVolume, Weak Points, Muscle Map, Progression) keeps reading the same
// 27-group model unchanged.
//
// Storage contract:
//   goals.exerciseMap[norm]       → engine muscle key   (unchanged, engines read this)
//   goals.exerciseSubgroup[norm]  → subgroup id         (new, fine label for the card)
// Saving a subgroup writes BOTH: exerciseMap = subgroup.muscle, exerciseSubgroup = id.

import { normExercise, resolveMuscle, mapExercise } from "./volume";

// Ordered groups. Each subgroup: { id, label, muscle }. `muscle` = volume.js key.
// The first subgroup that maps to a given muscle key is its canonical default,
// so folded subgroups (e.g. pec-minor, rotator-cuff) come after the primary one.
export const MUSCLE_GROUPS = [
  { id: "chest", label: "Chest", subs: [
    { id: "upper-chest", label: "Upper chest — clavicular", muscle: "upperChest" },
    { id: "mid-chest", label: "Mid chest — sternal", muscle: "midChest" },
    { id: "lower-chest", label: "Lower chest — costal", muscle: "lowerChest" },
    { id: "pec-minor", label: "Pec minor", muscle: "midChest" },
  ]},
  { id: "shoulders", label: "Shoulders", subs: [
    { id: "front-delt", label: "Front delt — anterior", muscle: "frontDelts" },
    { id: "side-delt", label: "Side delt — lateral", muscle: "sideDelts" },
    { id: "rear-delt", label: "Rear delt — posterior", muscle: "rearDelts" },
    { id: "rotator-cuff", label: "Rotator cuff", muscle: "rearDelts" },
  ]},
  { id: "back", label: "Back", subs: [
    { id: "lats", label: "Lats", muscle: "lats" },
    { id: "upper-back", label: "Upper back", muscle: "upperBack" },
    { id: "mid-back", label: "Mid back", muscle: "midBack" },
    { id: "traps", label: "Traps", muscle: "traps" },
    { id: "rhomboids", label: "Rhomboids", muscle: "midBack" },
    { id: "teres-major", label: "Teres major", muscle: "lats" },
    { id: "erector-spinae", label: "Erector spinae — lower back", muscle: "lowerBack" },
    { id: "serratus-posterior", label: "Serratus posterior", muscle: "midBack" },
    { id: "neck", label: "Neck", muscle: "neck" },
  ]},
  { id: "arms", label: "Arms", subs: [
    { id: "biceps", label: "Biceps", muscle: "biceps" },
    { id: "brachialis", label: "Brachialis", muscle: "brachialis" },
    { id: "triceps", label: "Triceps", muscle: "triceps" },
    { id: "forearms", label: "Forearms", muscle: "forearms" },
  ]},
  { id: "core", label: "Core", subs: [
    { id: "abs-upper", label: "Abs — upper", muscle: "upperAbs" },
    { id: "abs-lower", label: "Abs — lower", muscle: "lowerAbs" },
    { id: "obliques", label: "Obliques", muscle: "obliques" },
    { id: "tva", label: "Transverse abdominis", muscle: "upperAbs" },
    { id: "serratus-anterior", label: "Serratus anterior", muscle: "serratus" },
  ]},
  { id: "legs-front", label: "Legs — Front", subs: [
    { id: "quads", label: "Quads", muscle: "quads" },
    { id: "hip-flexors", label: "Hip flexors", muscle: "hipFlexors" },
    { id: "tibialis", label: "Tibialis anterior", muscle: "tibialis" },
  ]},
  { id: "legs-back", label: "Legs — Back", subs: [
    { id: "hamstrings", label: "Hamstrings", muscle: "hamstrings" },
    { id: "glutes", label: "Glutes", muscle: "glutes" },
    { id: "calves", label: "Calves", muscle: "calves" },
  ]},
  { id: "legs-inner-outer", label: "Legs — Inner/Outer", subs: [
    { id: "adductors", label: "Adductors", muscle: "adductors" },
    { id: "abductors", label: "Abductors", muscle: "abductors" },
  ]},
];

// Flat lookups.
export const SUBGROUP_BY_ID = {};
export const GROUP_BY_ID = {};
const MUSCLE_DEFAULT_SUB = {}; // muscle key → canonical subgroup id (first wins)
MUSCLE_GROUPS.forEach(g => {
  GROUP_BY_ID[g.id] = g;
  g.subs.forEach(s => {
    SUBGROUP_BY_ID[s.id] = { ...s, groupId: g.id, groupLabel: g.label };
    if (MUSCLE_DEFAULT_SUB[s.muscle] == null) MUSCLE_DEFAULT_SUB[s.muscle] = s.id;
  });
});

export const groupOfSub = (subId) => SUBGROUP_BY_ID[subId]?.groupId || null;
export const defaultSubForMuscle = (muscleKey) => (muscleKey ? MUSCLE_DEFAULT_SUB[muscleKey] || null : null);

// Resolve an exercise to its { groupId, groupLabel, subId, subLabel, muscle } or
// null when it can't be placed (no override + auto-map returns nothing).
// Precedence: explicit subgroup override → subgroup implied by the muscle override
// / auto-map.
export function categoryForExercise(name, goals) {
  const norm = normExercise(name);
  const subMap = (goals && goals.exerciseSubgroup) || {};
  let subId = subMap[norm];
  if (!subId || !SUBGROUP_BY_ID[subId]) {
    const muscle = resolveMuscle(name, (goals && goals.exerciseMap) || {});
    subId = defaultSubForMuscle(muscle);
  }
  if (!subId || !SUBGROUP_BY_ID[subId]) return null;
  const s = SUBGROUP_BY_ID[subId];
  return { groupId: s.groupId, groupLabel: s.groupLabel, subId: s.id, subLabel: s.label, muscle: s.muscle };
}

// Best-guess subgroup for a brand-new exercise (used to pre-select the popup).
export function guessSubForExercise(name) {
  return defaultSubForMuscle(mapExercise(name));
}

// Write a subgroup choice into goals: sets BOTH the engine muscle key and the
// fine subgroup id. Returns a new goals object (does not mutate).
export function assignSubgroup(goals, name, subId) {
  const norm = normExercise(name);
  const s = SUBGROUP_BY_ID[subId];
  if (!s || !norm) return goals;
  return {
    ...goals,
    exerciseMap: { ...(goals.exerciseMap || {}), [norm]: s.muscle },
    exerciseSubgroup: { ...(goals.exerciseSubgroup || {}), [norm]: subId },
  };
}

// Clear a mapping override (back to auto-guess).
export function clearSubgroup(goals, name) {
  const norm = normExercise(name);
  const em = { ...(goals.exerciseMap || {}) }; delete em[norm];
  const es = { ...(goals.exerciseSubgroup || {}) }; delete es[norm];
  return { ...goals, exerciseMap: em, exerciseSubgroup: es };
}
