import assert from "node:assert";
import { buildTimeline, timeToMin, sumMacro } from "../src/lib/partitioning.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error("✖", name, "—", e.message); } };

const TOTALS = { carbsG: 300, proteinG: 180, fatG: 70 };
const DAY = "2026-07-20";
const base = extra => buildTimeline({ dayKey: DAY, totals: TOTALS, wakeMin: 420, sleepMin: 1380, ...extra });

// ── 4. sum invariant (no logged) ──
t("sum of all slots == daily target (planned only)", () => {
  const { slots } = base({ sessions: [], nowMin: null });
  assert.equal(sumMacro(slots, "carbsG"), TOTALS.carbsG, "carbs");
  assert.equal(sumMacro(slots, "proteinG"), TOTALS.proteinG, "protein");
  assert.equal(sumMacro(slots, "fatG"), TOTALS.fatG, "fat");
});

t("sum invariant holds with an activity's floors present", () => {
  const { slots } = base({ sessions: [{ id: "s1", type: "gym", time: "17:00", durationMin: 60, intensity: "hard" }], nowMin: null });
  assert.equal(sumMacro(slots, "carbsG"), TOTALS.carbsG);
  assert.equal(sumMacro(slots, "proteinG"), TOTALS.proteinG);
  assert.equal(sumMacro(slots, "fatG"), TOTALS.fatG);
});

// ── 3. floors never disappear or merge, even squeezed by two adjacent activities ──
t("floors survive two tightly-packed activities", () => {
  const sessions = [
    { id: "a", type: "gym", time: "12:00", durationMin: 60, intensity: "hard" },
    { id: "b", type: "gym", time: "13:30", durationMin: 60, intensity: "hard" },
  ];
  const { slots, floorCount } = base({ sessions, nowMin: null });
  const floors = slots.filter(s => s.type === "floor");
  assert.equal(floorCount, 4, "4 floors expected (pre/post × 2)");
  assert.equal(floors.length, 4, "all 4 floors rendered");
  // each activity keeps its own pre+post — none merged away
  ["pre-a", "post-a", "pre-b", "post-b"].forEach(id => assert.ok(floors.find(f => f.id === id), `${id} present`));
});

// ── 1. reflow skips logged when an activity is added retroactively ──
t("adding an activity does not touch a logged slot", () => {
  // log a meal near the lunch slot (~midday). First build to find that slot's time.
  const first = base({ sessions: [], nowMin: 60 });
  const lunch = first.slots.find(s => s.mealName === "Lunch");
  const loggedMeals = [{ min: lunch.plannedMin, carbsG: 90, proteinG: 60, fatG: 20 }];
  const before = base({ sessions: [], nowMin: 60, loggedMeals });
  const loggedBefore = before.slots.find(s => s.status === "logged");
  assert.ok(loggedBefore, "a slot is marked logged");
  // now add an activity retroactively
  const after = base({ sessions: [{ id: "s1", type: "gym", time: "18:00", durationMin: 60, intensity: "moderate" }], nowMin: 60, loggedMeals });
  const loggedAfter = after.slots.find(s => s.loggedMin === loggedBefore.loggedMin);
  assert.equal(loggedAfter.status, "logged");
  assert.equal(loggedAfter.plannedMin, loggedBefore.plannedMin, "logged slot time unchanged");
  assert.deepEqual(loggedAfter.macros, loggedBefore.macros, "logged slot macros unchanged (immutable)");
});

// ── 2. drift shifts only slots AFTER the logged meal's actual timestamp ──
t("drift reflows only slots after the logged timestamp", () => {
  // no reflow anchor from now (nowMin early). Log breakfast LATE (drift).
  const noLog = base({ sessions: [], nowMin: 420 });
  const dinnerBefore = noLog.slots.find(s => s.mealName === "Dinner").plannedMin;
  const breakfast = noLog.slots.find(s => s.mealName === "Breakfast");
  // eat "breakfast" 3h later than planned → drift anchor moves forward
  const driftMin = breakfast.plannedMin + 180;
  const withDrift = base({ sessions: [], nowMin: 420, loggedMeals: [{ min: driftMin, carbsG: 60, proteinG: 40, fatG: 15 }] });
  const dinnerAfter = withDrift.slots.find(s => s.mealName === "Dinner" && s.status === "planned");
  assert.ok(dinnerAfter, "dinner still planned");
  assert.ok(dinnerAfter.plannedMin >= driftMin, "remaining planned slots pushed after the drifted log");
});

console.log(`partitioning: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
