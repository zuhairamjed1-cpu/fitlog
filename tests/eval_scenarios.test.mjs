import assert from "node:assert";
import { buildTimeline, timeToMin, sumMacro, TIGHT_GAP_THRESHOLD_MINUTES } from "../src/lib/partitioning.js";
import { POST_WORKOUT_PRESET, computeTotals, toLineItems, inRange } from "../src/lib/postWorkoutPreset.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.error("FAIL", name, "→", e.message); } };
const TOT = { carbsG: 300, proteinG: 180, fatG: 70 };
const DAY = "2026-07-20";
const mk = o => buildTimeline({ dayKey: DAY, totals: TOT, wakeMin: 420, sleepMin: 1380, ...o });

// S1 — logged immutability under retroactive activity add
t("S1 logged slots byte-identical after activity add", () => {
  const first = mk({ nowMin: 60 });
  const bk = first.slots.find(s => s.mealName === "Breakfast");
  const ln = first.slots.find(s => s.mealName === "Lunch");
  const logged = [
    { min: bk.plannedMin, carbsG: 50, proteinG: 30, fatG: 12 },
    { min: ln.plannedMin, carbsG: 80, proteinG: 45, fatG: 18 },
  ];
  const before = mk({ nowMin: 60, loggedMeals: logged });
  const after = mk({ nowMin: 60, loggedMeals: logged, sessions: [{ id: "run", type: "other", time: "19:00", durationMin: 45, intensity: "hard" }] });
  const pick = tl => tl.slots.filter(s => s.status === "logged").map(s => ({ min: s.plannedMin, m: s.macros })).sort((a, b) => a.min - b.min);
  assert.deepEqual(pick(after), pick(before), "logged slots changed");
});

// S2 — drift shifts only forward slots; floors stay anchored to the session
t("S2 drift reflows forward flexibles only, floors anchored", () => {
  const noLog = mk({ nowMin: 420, sessions: [{ id: "gym", type: "gym", time: "17:00", durationMin: 60, intensity: "hard" }] });
  const dinner0 = noLog.slots.find(s => s.mealName === "Dinner").plannedMin;
  const preFloor0 = noLog.slots.find(s => s.id === "pre-gym").plannedMin;
  const lunch = noLog.slots.find(s => s.mealName === "Lunch");
  const driftMin = 14 * 60 + 30; // logged lunch at 2:30pm
  const drift = mk({ nowMin: 420, sessions: [{ id: "gym", type: "gym", time: "17:00", durationMin: 60, intensity: "hard" }], loggedMeals: [{ min: driftMin, carbsG: 80, proteinG: 45, fatG: 18 }] });
  const preFloor1 = drift.slots.find(s => s.id === "pre-gym").plannedMin;
  const dinner1 = drift.slots.find(s => s.mealName === "Dinner" && s.status === "planned").plannedMin;
  assert.equal(preFloor1, preFloor0, "pre-floor must stay anchored to the 5pm session");
  assert.ok(dinner1 >= driftMin, "dinner must reflow after the 2:30 log");
});

// S3 — floors never merge regardless of compression
t("S3 floors all render distinct under tight activities", () => {
  const sessions = [
    { id: "a", type: "other", time: "16:00", durationMin: 45, intensity: "hard" },
    { id: "b", type: "gym", time: "17:00", durationMin: 60, intensity: "hard" },
  ];
  const tl = mk({ sessions, nowMin: 60 });
  const floors = tl.slots.filter(s => s.type === "floor");
  assert.equal(floors.length, 2 * sessions.length, "floor count must be 2×activities");
  ["pre-a", "post-a", "pre-b", "post-b"].forEach(id => assert.ok(floors.find(f => f.id === id), `${id} missing`));
});

// S4 — tight-gap flag when flexible lands within threshold of a floor
t("S4 tight-gap pair detected (no merge)", () => {
  // craft a session whose post-floor lands ~ a flexible slot; just assert the
  // detector fires when a floor and flex are within threshold.
  const sessions = [{ id: "gym", type: "gym", time: "12:00", durationMin: 60, intensity: "moderate" }];
  const tl = mk({ sessions, nowMin: 60 });
  // find any floor/flex pair within threshold in the sorted slots
  const sorted = [...tl.slots].sort((a, b) => a.plannedMin - b.plannedMin);
  let anyTight = false;
  for (let i = 0; i < sorted.length - 1; i++) {
    if ((sorted[i].type === "floor") !== (sorted[i + 1].type === "floor") && Math.abs(sorted[i].plannedMin - sorted[i + 1].plannedMin) <= TIGHT_GAP_THRESHOLD_MINUTES) anyTight = true;
  }
  assert.equal(tl.tightPairs.length > 0, anyTight, "tightPairs must match manual detection");
  // floors still all present (no merge)
  assert.equal(tl.slots.filter(s => s.type === "floor").length, 2);
});

// S5 — daily macro total consistency (with an activity)
t("S5 sum of all slots == daily target (with activity)", () => {
  const tl = mk({ sessions: [{ id: "gym", type: "gym", time: "17:00", durationMin: 60, intensity: "hard" }], nowMin: null });
  ["carbsG", "proteinG", "fatG"].forEach(k => assert.equal(sumMacro(tl.slots, k), TOT[k], `${k} drift`));
});

// S6 — neutral window: exists moderately packed; graceful (no crash) maximally packed
t("S6 neutral window present (moderate) + graceful (packed)", () => {
  const moderate = mk({ sessions: [{ id: "gym", type: "gym", time: "17:00", durationMin: 60, intensity: "moderate" }], nowMin: null });
  assert.equal(moderate.neutralOk, true, "moderate day should keep a neutral window");
  const packed = mk({ sessions: [
    { id: "a", type: "gym", time: "08:00", durationMin: 90, intensity: "hard" },
    { id: "b", type: "gym", time: "13:00", durationMin: 90, intensity: "hard" },
    { id: "c", type: "gym", time: "18:00", durationMin: 90, intensity: "hard" },
  ], nowMin: null });
  assert.ok(typeof packed.neutralOk === "boolean", "packed must not crash");
  ["carbsG", "proteinG", "fatG"].forEach(k => assert.ok(sumMacro(packed.slots, k) >= 0));
});

// S7 — session removed → floors gone, budget returns to flexibles
t("S7 removing a session frees floor budget to flexibles", () => {
  const withS = mk({ sessions: [{ id: "gym", type: "gym", time: "17:00", durationMin: 60, intensity: "hard" }], nowMin: null });
  const without = mk({ sessions: [], nowMin: null });
  assert.equal(without.slots.filter(s => s.type === "floor").length, 0, "no floors after removal");
  const flexCarbWith = withS.slots.filter(s => s.type === "flexible").reduce((a, s) => a + s.macros.carbsG, 0);
  const flexCarbWithout = without.slots.filter(s => s.type === "flexible").reduce((a, s) => a + s.macros.carbsG, 0);
  assert.ok(flexCarbWithout > flexCarbWith, "flex carbs must increase when floors removed");
  assert.equal(sumMacro(without.slots, "carbsG"), TOT.carbsG, "sum still == target");
});

// S8 — quick-log checklist math (uncheck yogurt, whey 2→1)
t("S8 checklist totals recompute on uncheck + qty change", () => {
  const rows = POST_WORKOUT_PRESET.items.map(it => ({ ...it, qty: it.defaultQty }));
  rows.find(r => r.id === "yogurt").checked = false;
  rows.find(r => r.id === "whey").qty = 1;
  const tot = computeTotals(rows);
  // protein: whey 24×1 + banana 1 + salt_honey 0 + fish 0 (yogurt off) = 25
  assert.equal(tot.proteinG, 25, "protein");
  // glucose: banana 7 + salt_honey 7 = 14 ; fructose: 8 + 8 = 16 (yogurt/whey contribute 0)
  assert.equal(tot.glucoseG, 14, "glucose");
  assert.equal(tot.fructoseG, 16, "fructose");
});

// S9 — submission reflects adjusted state, not raw defaults
t("S9 line-items + macros match adjusted config, not preset defaults", () => {
  const rows = POST_WORKOUT_PRESET.items.map(it => ({ ...it, qty: it.defaultQty }));
  rows.find(r => r.id === "bread").checked = true;   // enable a default-off item
  rows.find(r => r.id === "whey").qty = 3;            // 3 scoops
  const items = toLineItems(rows);
  const micros = computeTotals(rows);
  const macroSum = items.reduce((a, it) => ({ p: a.p + it.protein, c: a.c + it.carbs }), { p: 0, c: 0 });
  // protein: whey 72 + yogurt 11 + banana 1 + bread 6 = 90
  assert.equal(micros.proteinG, 90, "micros protein");
  assert.equal(macroSum.p, 90, "line-item protein sum");
  // carbs (glu+fru): banana15 + bread(11+1=12×2=24) + salt_honey15 = 54
  assert.equal(macroSum.c, 54, "line-item carbs sum");
  assert.ok(!items.find(i => i.food.startsWith("Whey") && !i.food.includes("×3")), "whey qty reflected in label");
});

// S10 — chip color logic (protein/fructose hit, glucose short)
t("S10 chip inRange: protein+fructose met, glucose short", () => {
  const T = POST_WORKOUT_PRESET.targets;
  const logged = { proteinG: 60, glucoseG: 14, fructoseG: 16, saltTsp: 0.5, omega3Mg: 400 };
  assert.equal(inRange(logged.proteinG, T.proteinG), true, "protein green");
  assert.equal(inRange(logged.fructoseG, T.fructoseG), true, "fructose green");
  assert.equal(inRange(logged.glucoseG, T.glucoseG), false, "glucose neutral (14<30)");
  assert.equal(inRange(logged.saltTsp, T.saltTsp), true);
  assert.equal(inRange(logged.omega3Mg, T.omega3Mg), true);
});

console.log(`\neval: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
