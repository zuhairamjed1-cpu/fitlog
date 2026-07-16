import assert from "node:assert";
import { predictBedtime, planRemainingIntake, hoursDeviation, PREFERRED_LAST_MEAL_KCAL } from "../src/lib/prebedTaper.js";
import { buildTimeline } from "../src/lib/partitioning.js";

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log("PASS", n); } catch (e) { fail++; console.error("FAIL", n, "→", e.message); } };

// predicted bedtime 23:00 (1380). "now" as "HH:MM".
const BED = "23:00";

// 1 — normal day: last meal ~800 ~3h before bed, no taper
t("1 normal: last meal ~800, not tapered", () => {
  const r = planRemainingIntake("20:00", BED, 780); // 3h to bed, on track
  assert.equal(r.tapered, false);
  assert.equal(r.form, "full-meal");
  assert.ok(r.suggestKcal <= PREFERRED_LAST_MEAL_KCAL && r.suggestKcal >= 700);
});

// 2 — behind but before 3h line: consolidates, may exceed 800
t("2 behind before 3h line: exceeds 800 allowed", () => {
  const r = planRemainingIntake("20:00", BED, 1000); // 3h, but 1000 remaining
  assert.equal(r.tapered, false);
  assert.equal(r.suggestKcal, 1000, "consolidates full remaining");
  assert.ok(r.exceeded, "allowed to exceed 800");
});

// 3 — crossed into 2h window: ≤400, lighter/liquid
t("3 2h window: ceiling 400, lighter/shake", () => {
  const r = planRemainingIntake("21:30", BED, 900); // 1.5h? no — 21:30→23:00 = 1.5h => 1h tier
  const r2 = planRemainingIntake("21:00", BED, 900); // 2h to bed
  assert.equal(r2.ceilingKcal, 400);
  assert.equal(r2.form, "lighter-solid-or-shake");
  assert.ok(r2.suggestKcal <= 400);
});

// 4 — 1h window: ≤150, liquid-preferred
t("4 1h window: ceiling 150, liquid", () => {
  const r = planRemainingIntake("22:00", BED, 900); // 1h to bed
  assert.equal(r.ceilingKcal, 150);
  assert.equal(r.form, "liquid-preferred");
  assert.ok(r.suggestKcal <= 150);
});
t("4b <30min: ceiling 100, casein/skip", () => {
  const r = planRemainingIntake("22:45", BED, 900); // 15min
  assert.equal(r.ceilingKcal, 100);
  assert.equal(r.skipIfPossible, true);
});

// 5 — sleep anomaly filter
t("5 anomaly: 2.5h off → ignore yesterday, use prior", () => {
  // yesterday 01:30, prior two 23:00 & 23:00 → deviation ~2.5h ≥ 2 → prior
  const p = predictBedtime(["01:30", "23:00", "23:00"]);
  assert.equal(p.anomaly, true);
  assert.equal(p.bedtime, 23 * 60, "uses prior 23:00");
});
t("5b <2h deviation does NOT trigger anomaly", () => {
  const p = predictBedtime(["23:45", "23:00", "23:00"]); // 0.75h off
  assert.equal(p.anomaly, false);
  assert.equal(p.bedtime, 23 * 60 + 45);
});
t("5c sparse history flagged low confidence", () => {
  assert.equal(predictBedtime(["23:00"]).confidence, "low");
  assert.equal(predictBedtime([]).reason, "no-history");
});

// 6 — late training: sleep-proximity fires for a normal-bed user (post floor near bed)
t("6 post floor near a 22:00 bedtime → sleep-proximity flag", () => {
  // gym 20:15, 60min → post floor 21:30. bedtime 22:00 (1320). gap 30min.
  const tl = buildTimeline({ dayKey: "2026-07-20", totals: { carbsG: 300, proteinG: 180, fatG: 70 }, sessions: [{ id: "g", type: "gym", time: "20:15", durationMin: 60, intensity: "hard" }], wakeMin: 420, sleepMin: 22 * 60, nowMin: null });
  const post = tl.slots.find(s => s.mealName === "Post-workout");
  assert.ok(tl.sleepProximityIds.includes(post.id), "post floor flagged near bedtime");
  assert.equal(post.macros.proteinG, 50, "floor still full-spec (not tapered)");
});

// 7 — late sleeper, late workout: NO warning (~8h buffer)
t("7 wake 3pm / sleep 5am, 9pm gym → no sleep-proximity", () => {
  // sleepMin on night scale: 5am = 5*60 + 1440 = 1740. gym 21:00 → post 22:15 (1335). gap ~6.75h.
  const tl = buildTimeline({ dayKey: "2026-07-20", totals: { carbsG: 300, proteinG: 180, fatG: 70 }, sessions: [{ id: "g", type: "gym", time: "21:00", durationMin: 60, intensity: "hard" }], wakeMin: 15 * 60, sleepMin: 1740, nowMin: null });
  const post = tl.slots.find(s => s.mealName === "Post-workout");
  assert.ok(!tl.sleepProximityIds.includes(post.id), "no warning with comfortable buffer");
});

console.log(`\nprebed_taper: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
