import assert from "node:assert";
import { buildTimeline, sumMacro, suggestGymWindow, gymSleepProximity, timeToMin, TIGHT_GAP_THRESHOLD_MINUTES, MIN_VIABLE_FLEXIBLE_SLOT_GAP_MINUTES, SLEEP_PROXIMITY_MINUTES } from "../src/lib/partitioning.js";
import { POST_WORKOUT_PRESET, computeTotals, toLineItems, inRange } from "../src/lib/postWorkoutPreset.js";

let pass = 0, fail = 0; const log = [];
const t = (name, fn) => { try { fn(); pass++; log.push("PASS " + name); } catch (e) { fail++; log.push("FAIL " + name + " → " + e.message); } };

const T = { carbsG: 300, proteinG: 180, fatG: 70 };
const DAY = "2026-07-20";
// Gym·16:00 canonical setup (wake 7am, sleep 11pm)
const GYM16 = () => buildTimeline({ dayKey: DAY, totals: T, wakeMin: 420, sleepMin: 1380, nowMin: null, loggedMeals: [], sessions: [{ id: "g", type: "gym", time: "16:00", durationMin: 60, intensity: "hard" }] });

// ══ ROUND 1 — known bugs ══
t("R1.1 pre carbs within 20–40", () => { const p = GYM16().slots.find(s => s.mealName === "Pre-workout"); assert.ok(p.macros.carbsG >= 20 && p.macros.carbsG <= 40, `pre ${p.macros.carbsG}`); });
t("R1.2 post floor protein == target chip (50)", () => { const p = GYM16().slots.find(s => s.mealName === "Post-workout"); assert.equal(p.macros.proteinG, POST_WORKOUT_PRESET.targets.proteinG.min); });
t("R1.3 no snack in <MIN_GAP of a floor/activity", () => { const sn = GYM16().slots.find(s => s.mealName === "Snack"); assert.equal(sn, undefined, "snack should be absorbed, not crammed"); });
t("R1.4 sum == daily target", () => { const s = GYM16().slots; ["carbsG", "proteinG", "fatG"].forEach(k => assert.equal(sumMacro(s, k), T[k], k)); });

// ══ ROUND 2 — reflow / immutability (+ R1 regression 1,3) ══
t("R2.1 logged slot immutable on retro activity add", () => {
  const base = o => buildTimeline({ dayKey: DAY, totals: T, wakeMin: 420, sleepMin: 1380, nowMin: 60, loggedMeals: [], ...o });
  const bk = base({}).slots.find(s => s.mealName === "Breakfast");
  const logged = [{ min: bk.plannedMin, carbsG: 50, proteinG: 30, fatG: 12 }];
  const before = base({ loggedMeals: logged }).slots.find(s => s.status === "logged");
  const after = base({ loggedMeals: logged, sessions: [{ id: "r", type: "other", time: "19:00", durationMin: 45, intensity: "hard" }] }).slots.find(s => s.loggedMin === before.loggedMin);
  assert.deepEqual(after.macros, before.macros); assert.equal(after.plannedMin, before.plannedMin);
});
t("R2.2 logging marks nearest slot; others keep clock", () => {
  const S = [{ id: "g", type: "gym", time: "17:00", durationMin: 60, intensity: "hard" }];
  const b = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 420, sleepMin: 1380, nowMin: 420, sessions: S });
  const lunch0 = b.slots.find(s => s.mealName === "Lunch").plannedMin, dinner0 = b.slots.find(s => s.mealName === "Dinner").plannedMin;
  const a = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 420, sleepMin: 1380, nowMin: 420, sessions: S, loggedMeals: [{ min: lunch0, carbsG: 80, proteinG: 45, fatG: 18 }] });
  assert.equal(a.slots.find(s => s.mealName === "Lunch").status, "logged");
  assert.equal(a.slots.find(s => s.mealName === "Dinner").plannedMin, dinner0);
});
t("R2.3 floors never merge under two tight activities", () => { const tl = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 420, sleepMin: 1380, sessions: [{ id: "a", type: "other", time: "16:00", durationMin: 45, intensity: "hard" }, { id: "b", type: "gym", time: "17:00", durationMin: 60, intensity: "hard" }] }); assert.equal(tl.slots.filter(s => s.type === "floor").length, 4); });
t("R2.4 tight-gap detector matches manual", () => { const tl = GYM16(); const s = [...tl.slots].sort((a, b) => a.plannedMin - b.plannedMin); let m = false; for (let i = 0; i < s.length - 1; i++) if ((s[i].type === "floor") !== (s[i + 1].type === "floor") && Math.abs(s[i].plannedMin - s[i + 1].plannedMin) <= TIGHT_GAP_THRESHOLD_MINUTES) m = true; assert.equal(tl.tightPairs.length > 0, m); });
t("R2.5 sum consistency with activity", () => { const s = GYM16().slots; ["carbsG", "proteinG", "fatG"].forEach(k => assert.equal(sumMacro(s, k), T[k])); });
t("R2.6 neutral window graceful when packed", () => { const tl = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 420, sleepMin: 1380, sessions: [{ id: "a", type: "gym", time: "08:00", durationMin: 90, intensity: "hard" }, { id: "b", type: "gym", time: "13:00", durationMin: 90, intensity: "hard" }, { id: "c", type: "gym", time: "18:00", durationMin: 90, intensity: "hard" }] }); assert.equal(typeof tl.neutralOk, "boolean"); });
t("R2.7 session removed → no floors, budget returns, sum ok", () => { const w = GYM16(); const wo = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 420, sleepMin: 1380, sessions: [] }); assert.equal(wo.slots.filter(s => s.type === "floor").length, 0); assert.ok(sumMacro(wo.slots.filter(s => s.type === "flexible"), "carbsG") > sumMacro(w.slots.filter(s => s.type === "flexible"), "carbsG")); assert.equal(sumMacro(wo.slots, "carbsG"), T.carbsG); });
// R2 regression: R1.1 + R1.3
t("R2·reg R1.1 pre carbs 20–40", () => { const p = GYM16().slots.find(s => s.mealName === "Pre-workout"); assert.ok(p.macros.carbsG <= 40 && p.macros.carbsG >= 20); });
t("R2·reg R1.3 no crammed snack", () => { assert.equal(GYM16().slots.find(s => s.mealName === "Snack"), undefined); });

// ══ ROUND 3 — quick-log (+ regression R1.2, R2.5) ══
t("R3.8 checklist math on uncheck + qty", () => { const r = POST_WORKOUT_PRESET.items.map(i => ({ ...i, qty: i.defaultQty })); r.find(x => x.id === "yogurt").checked = false; r.find(x => x.id === "whey").qty = 1; const tot = computeTotals(r); assert.equal(tot.proteinG, 25); assert.equal(tot.glucoseG, 14); assert.equal(tot.fructoseG, 16); });
t("R3.9 submission reflects adjusted config", () => { const r = POST_WORKOUT_PRESET.items.map(i => ({ ...i, qty: i.defaultQty })); r.find(x => x.id === "bread").checked = true; r.find(x => x.id === "whey").qty = 3; const items = toLineItems(r); const micros = computeTotals(r); const p = items.reduce((a, it) => a + it.protein, 0); assert.equal(micros.proteinG, 90); assert.equal(p, 90); });
t("R3.10 chip inRange color logic", () => { const T2 = POST_WORKOUT_PRESET.targets; assert.equal(inRange(60, T2.proteinG), true); assert.equal(inRange(16, T2.fructoseG), true); assert.equal(inRange(14, T2.glucoseG), false); });
t("R3·reg R1.2 header source == chip target", () => { const p = GYM16().slots.find(s => s.mealName === "Post-workout"); assert.equal(p.macros.proteinG, POST_WORKOUT_PRESET.targets.proteinG.min); });
t("R3·reg R2.5 sum consistency", () => { ["carbsG", "proteinG", "fatG"].forEach(k => assert.equal(sumMacro(GYM16().slots, k), T[k])); });

// ══ ROUND 4 — scheduling engine ══
t("R4.a wake6 gym14: ≥2 meals before pre-floor, no sleep flag on them", () => {
  const tl = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 360, sleepMin: 1320, sessions: [{ id: "g", type: "gym", time: "14:00", durationMin: 60, intensity: "moderate" }] });
  const pre = tl.slots.find(s => s.mealName === "Pre-workout").plannedMin;
  const before = tl.slots.filter(s => s.type === "flexible" && s.plannedMin < pre);
  assert.ok(before.length >= 2, `only ${before.length} meals before pre`);
  assert.ok(!before.some(s => s.nearBedtime), "morning meals shouldn't be sleep-flagged");
});
t("R4.b wake15 no gym: suggested window is a range, confirm re-validates", () => {
  const w = suggestGymWindow({ wakeMin: 900, sleepMin: 900 + 8 * 60 });
  assert.ok(w && w.hiMin > w.loMin, "range expected");
  const prox = gymSleepProximity({ startMin: w.suggestMin, durationMin: 60, sleepMin: 900 + 8 * 60 });
  assert.equal(typeof prox, "boolean");
});
t("R4.c wake2 gym21 (user-chosen): proximity fires + trailing meal compresses", () => {
  const sleepMin = 120 + 20 * 60; // up 2am, ~16h day → bed ~18:00? use explicit
  const bed = 120 + 21 * 60; // very late bed
  const prox = gymSleepProximity({ startMin: 21 * 60, durationMin: 60, sleepMin: bed });
  assert.equal(prox, true, "user-chosen late gym must trip proximity");
  const tl = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 120, sleepMin: bed, sessions: [{ id: "g", type: "gym", time: "21:00", durationMin: 60, intensity: "hard" }] });
  const lastFlex = [...tl.slots].reverse().find(s => s.type === "flexible");
  assert.ok(lastFlex && (lastFlex.compressed || lastFlex.nearBedtime), "trailing meal should compress near bed");
});
t("R4.d short window → isCompressed", () => { const tl = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 600, sleepMin: 600 + 9 * 60, sessions: [] }); assert.equal(tl.isCompressed, true); });
t("R4.e training day no time → suggested-window flow, no implicit default", () => {
  // engine builds meal-only (no floors) when no session; suggestGymWindow supplies the range.
  const tl = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 420, sleepMin: 1380, sessions: [] });
  assert.equal(tl.slots.filter(s => s.type === "floor").length, 0, "no floors invented without a time");
  assert.ok(suggestGymWindow({ wakeMin: 420, sleepMin: 1380 }), "a window is offered");
});
// R4 regression: full R1 + R2.6
t("R4·reg R1 all", () => { const s = GYM16().slots; const p = s.find(x => x.mealName === "Pre-workout"), po = s.find(x => x.mealName === "Post-workout"); assert.ok(p.macros.carbsG <= 40); assert.equal(po.macros.proteinG, 50); assert.equal(s.find(x => x.mealName === "Snack"), undefined); ["carbsG", "proteinG", "fatG"].forEach(k => assert.equal(sumMacro(s, k), T[k])); });
t("R4·reg R2.6 neutral graceful", () => { const tl = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 420, sleepMin: 1380, sessions: [{ id: "a", type: "gym", time: "08:00", durationMin: 90, intensity: "hard" }, { id: "b", type: "gym", time: "13:00", durationMin: 90, intensity: "hard" }, { id: "c", type: "gym", time: "18:00", durationMin: 90, intensity: "hard" }] }); assert.equal(typeof tl.neutralOk, "boolean"); });

// ══ ROUND 5 — combos ══
t("R5·A wake2 gym21 + modified quick-log + retro add", () => {
  const bed = 120 + 21 * 60;
  const sessions = [{ id: "g", type: "gym", time: "21:00", durationMin: 60, intensity: "hard" }];
  // modified quick-log micros → logged post meal
  const rows = POST_WORKOUT_PRESET.items.map(i => ({ ...i, qty: i.defaultQty })); rows.find(x => x.id === "whey").qty = 1;
  const micros = computeTotals(rows); // protein 24+11+1=36
  assert.equal(micros.proteinG, 36);
  const postMin = 21 * 60 + 75;
  const logged = [{ min: postMin, carbsG: 40, proteinG: micros.proteinG, fatG: 5 }];
  const before = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 120, sleepMin: bed, sessions, loggedMeals: logged });
  const loggedSlot = before.slots.find(s => s.status === "logged");
  // retro add earlier activity
  const after = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 120, sleepMin: bed, sessions: [...sessions, { id: "am", type: "other", time: "10:00", durationMin: 45, intensity: "moderate" }], loggedMeals: logged });
  const loggedAfter = after.slots.find(s => s.loggedMin === loggedSlot.loggedMin);
  assert.deepEqual(loggedAfter.macros, loggedSlot.macros, "logged post untouched by retro add");
  assert.equal(gymSleepProximity({ startMin: 21 * 60, sleepMin: bed }), true, "proximity still fires");
});
t("R5·B drift log near pre-floor doesn't manufacture an orphan slot", () => {
  const S = [{ id: "g", type: "gym", time: "16:00", durationMin: 60, intensity: "hard" }];
  const pre = GYM16().slots.find(s => s.mealName === "Pre-workout").plannedMin;
  const tl = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 420, sleepMin: 1380, sessions: S, loggedMeals: [{ min: pre - 20, carbsG: 60, proteinG: 30, fatG: 10 }] });
  // logging near the pre-floor marks a slot logged; no NEW flexible appears crammed there
  const crammed = tl.slots.filter(s => s.type === "flexible" && s.status === "planned").filter(s => Math.abs(s.plannedMin - pre) < MIN_VIABLE_FLEXIBLE_SLOT_GAP_MINUTES);
  assert.equal(crammed.length, 0, "no orphan slot near the pre-floor");
});
t("R5·C tight-gap + sleep-proximity coexist", () => {
  // gym late so post-floor is near bed AND a flex lands tight to a floor
  const bed = 1380; // 23:00
  const tl = buildTimeline({ dayKey: DAY, totals: T, wakeMin: 420, sleepMin: bed, sessions: [{ id: "g", type: "gym", time: "20:00", durationMin: 60, intensity: "hard" }] });
  const post = tl.slots.find(s => s.mealName === "Post-workout");
  assert.ok(tl.sleepProximityIds.includes(post.id), "post floor near bed flagged");
  // both systems independent: tightPairs is an array, sleepProximityIds is an array; neither nulls the other
  assert.ok(Array.isArray(tl.tightPairs) && Array.isArray(tl.sleepProximityIds));
});

console.log(log.join("\n"));
console.log(`\nnutrition_eval: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
