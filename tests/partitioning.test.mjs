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

// ── 2. meals hold clock times; logging marks nearest slot, others unchanged ──
t("logging a meal marks nearest slot; other meals keep clock times", () => {
  const noLog = base({ sessions: [], nowMin: 420 });
  const dinnerBefore = noLog.slots.find(s => s.mealName === "Dinner").plannedMin;
  const breakfast = noLog.slots.find(s => s.mealName === "Breakfast");
  const withLog = base({ sessions: [], nowMin: 420, loggedMeals: [{ min: breakfast.plannedMin, carbsG: 60, proteinG: 40, fatG: 15 }] });
  assert.equal(withLog.slots.find(s => s.mealName === "Breakfast").status, "logged", "breakfast logged");
  assert.equal(withLog.slots.find(s => s.mealName === "Dinner").plannedMin, dinnerBefore, "dinner keeps its clock time");
});

// pre-workout carbs stay within the 20–40g ceiling regardless of intensity
t("pre-workout carbs never exceed 40g", () => {
  for (const intensity of ["light", "moderate", "hard"]) {
    const { slots } = base({ sessions: [{ id: "g", type: "gym", time: "16:00", durationMin: 90, intensity }] });
    const pre = slots.find(s => s.mealName === "Pre-workout");
    assert.ok(pre.macros.carbsG >= 20 && pre.macros.carbsG <= 40, `${intensity} pre carbs ${pre.macros.carbsG} out of 20–40`);
  }
});

// post-workout floor header macros == the recovery targets (header/chip sync)
t("post-workout floor macros hit the §5.1 protein target", () => {
  const { slots } = base({ sessions: [{ id: "g", type: "gym", time: "16:00", durationMin: 60, intensity: "moderate" }] });
  const post = slots.find(s => s.mealName === "Post-workout");
  assert.equal(post.macros.proteinG, 50, "post protein must equal the 50g floor target shown by the chip");
});

// no snack crammed next to a floor
t("no snack generated within the min-viable gap of a floor", () => {
  const { slots } = base({ sessions: [{ id: "g", type: "gym", time: "16:00", durationMin: 60, intensity: "hard" }] });
  const snack = slots.find(s => s.mealName === "Snack");
  const floors = slots.filter(s => s.type === "floor");
  if (snack) floors.forEach(f => assert.ok(Math.abs(f.plannedMin - snack.plannedMin) >= 90, "snack too close to a floor"));
  assert.ok(true);
});

// no flexible slot inside a training window (between pre- and post-workout floor)
t("no snack generated inside the pre→post training window", () => {
  const { slots } = buildTimeline({ dayKey: "2026-07-20", totals: TOTALS, wakeMin: 510, sleepMin: 1380, sessions: [{ id: 1, type: "gym", time: "16:00", durationMin: 60, intensity: "moderate" }] });
  const pre = slots.find(s => s.id === "pre-1").plannedMin, post = slots.find(s => s.id === "post-1").plannedMin;
  slots.filter(s => s.type === "flexible").forEach(f => assert.ok(f.plannedMin < pre - 1 || f.plannedMin > post + 1, `flexible ${f.mealName} inside training window`));
});

console.log(`partitioning: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
