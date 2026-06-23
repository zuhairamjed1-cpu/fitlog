// FitLog engine test suite — run with:  node tests/engines.test.mjs
// Pure deterministic checks on every intelligence engine. These catch the class
// of bug that a build does NOT (missing imports, dangling helpers, broken math),
// so run this before every deploy after touching engines/ or brain/.

import { daysAgo } from "../src/lib/dates.js";
import { computeWeightTrend } from "../src/engines/weight.js";
import { computeEnergyBalance } from "../src/engines/energy.js";
import { computeTraining, mapMuscles } from "../src/engines/training.js";
import { computeSleep, estimateSleepNeed, sleepTST } from "../src/engines/sleep.js";
import { computeRecovery } from "../src/engines/recovery.js";
import { computeNicotineStats } from "../src/engines/nicotine.js";
import { assessGoal, buildTrajectory, analyzeConstraints } from "../src/engines/goalplan.js";
import { computeProteinDistribution } from "../src/engines/protein.js";
import { computeSkin, detectRoutineConflicts } from "../src/engines/skin.js";
import { estimateGlycemicLoad, dayGlycemicLoad } from "../src/engines/glycemic.js";
import { lookupGI } from "../src/engines/gi-database.js";
import { computeCarbTiming } from "../src/engines/carbtiming.js";
import { planFueling, reconcileFueling, sleepWindow } from "../src/engines/fueling.js";
import { buildBrain, formatBrainText } from "../src/brain/brain.js";

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log("  ✗", name, "—", JSON.stringify(got)); } };

// ── shared synthetic dataset (cutting, ~25 days) ──
const sleep = [], diet = [], weight = [], exercise = [], nicotine = [], journal = [], water = [], skin = [];
for (let a = 0; a < 25; a++) {
  const d = daysAgo(a);
  sleep.push({ id: a, date: d, duration: a % 3 ? 7.5 : 5.5, quality: a % 3 ? "Good" : "Fair", bedtime: "23:00", wakeTime: a % 3 ? "06:30" : "04:30", latencyMin: 10, wakeMin: 10 });
  diet.push({ date: d, time: "08:00", calories: 700, protein: 50, carbs: 60, name: "oats and milk" }, { date: d, time: "13:00", calories: 800, protein: 55, carbs: 80, name: "chicken rice" }, { date: d, time: "19:30", calories: 700, protein: 50, carbs: 70, name: "steak" });
  weight.push({ id: a, date: d, kg: +(80 - (24 - a) * 0.05).toFixed(2), ts: new Date(d + "T07:00:00").getTime() });
  if (a % 2) exercise.push({ id: `e${a}`, date: d, text: `Bench Press\n${80 + (12 - Math.floor(a / 2))}kg x 5\n${80 + (12 - Math.floor(a / 2))}kg x 5\nSquat\n140kg x 5\n140kg x 5` });
  if (a % 4 === 0) nicotine.push({ date: d, time: "20:00", type: "pouch", amount: 1, mg: 6 });
  if (a % 5 === 0) journal.push({ date: d, text: "felt stressed and tired" });
  water.push({ date: d, ml: 2000 });
  skin.push({ id: `s${a}`, date: d, condition: a % 4 < 2 ? 2 : 4, breakouts: a % 4 < 2 ? 4 : 1, concern: "jaw" });
}
const goals = { profile: { sex: "male", age: 25, heightCm: 178, weightKg: 80, sleepNeedH: "" }, strategy: { phase: "cut" }, goal: "Lose Fat", calories: 2000, protein: 180, waterGoalMl: 2500, plan: { trainingDays: ["Mon", "Wed", "Fri"] }, skinRoutine: { am: [{ product: "Vitamin C" }], pm: [{ product: "Retinol" }, { product: "Salicylic acid" }] } };
const data = { sleep, diet, weight, exercise, nicotine, journal, water, skin, sports: [], supplements: [], nicotinePlans: [], ejac: [], skinResearch: [] };

console.log("Running FitLog engine tests…\n");

// ── weight (A1) ──
const wt = computeWeightTrend(data);
ok("weight: trend computed", wt && wt.direction === "losing", wt && wt.direction);
ok("weight: confidence present", wt && ["Low", "Moderate", "High"].includes(wt.confidence), wt && wt.confidence);

// ── energy / TDEE ──
const en = computeEnergyBalance(data, goals);
ok("energy: ready", en.ready === true, en.ready);
ok("energy: TDEE plausible (>maintenance of intake)", en.tdee > en.meanIntake, { tdee: en.tdee, intake: en.meanIntake });

// ── training ──
const tr = computeTraining(data, goals);
ok("training: lifts tracked", tr.progression.lifts.length >= 1, tr.progression.lifts.length);
ok("training: volume mapped", tr.week.perMuscle.find(m => m.muscle === "chest").sets > 0, 1);
ok("mapMuscles: RDL→hamstrings", mapMuscles("Romanian Deadlift").primary[0] === "hamstrings", 1);

// ── sleep ──
ok("sleep: TST math", Math.abs(sleepTST({ duration: 8, latencyMin: 20, wakeMin: 40 }) - 7) < 1e-9, 1);
ok("sleep: need learned/default", typeof estimateSleepNeed(data, goals).hours === "number", 1);
const sl = computeSleep(data, goals);
ok("sleep: 3 axes present", sl && sl.quantity && sl.regularity && sl.continuity, Object.keys(sl || {}));

// ── recovery (depends on sleep+nicotine+protein+weight) ──
const rec = computeRecovery(data, goals);
ok("recovery: readiness 0-100", rec && rec.readiness >= 0 && rec.readiness <= 100, rec && rec.readiness);

// ── nicotine ──
ok("nicotine: stats run (nicMg+NIC_MG)", !!computeNicotineStats(data), 1);

// ── protein ──
ok("protein: runs", computeProteinDistribution(data, goals) !== undefined, 1);

// ── skin ──
const sk = computeSkin(data, goals);
ok("skin: runs + correlations array", sk && Array.isArray(sk.correlations), Object.keys(sk || {}));
ok("skin: routine conflict detected", detectRoutineConflicts(goals.skinRoutine).length >= 1, detectRoutineConflicts(goals.skinRoutine));

// ── glycemic load ──
ok("glycemic: high-carb low-protein = high band", estimateGlycemicLoad({ food: "white rice", carbs: 80, protein: 5, fat: 1 }).band === "high", 1);
ok("glycemic: protein/fat blunts the same carbs", estimateGlycemicLoad({ food: "chicken and rice", carbs: 60, protein: 45, fat: 12 }).gl < estimateGlycemicLoad({ food: "white rice", carbs: 60, protein: 2, fat: 0 }).gl, 1);
ok("glycemic: no carb data → no estimate", estimateGlycemicLoad({ food: "steak", carbs: 0 }).hasCarbs === false, 1);
ok("glycemic: day aggregates", dayGlycemicLoad([{ food: "rice", carbs: 80 }, { food: "oats", carbs: 40 }]).total > 0, 1);
ok("GI db: specific beats generic (brown rice 68 ≠ rice 73)", lookupGI("brown rice").gi === 68 && lookupGI("white rice").gi === 73, 1);
ok("GI db: sweet potato 63 ≠ potato 78", lookupGI("sweet potato").gi === 63 && lookupGI("potato").gi === 78, 1);
ok("GI db: unknown food falls back to null", lookupGI("zorblax stew") === null, 1);
ok("GI db: known food flagged source=database", estimateGlycemicLoad({ food: "oatmeal", carbs: 40 }).source === "database", 1);

// ── carb timing (diet × training) ──
{
  const cdiet = [], cex = [];
  for (let a = 0; a < 12; a++) { const dd = daysAgo(a); if (a % 2 === 0) cex.push({ id: a, date: dd, time: "06:00", label: "Lift" }); cdiet.push({ date: dd, time: "13:00", carbs: 80, calories: 700 }, { date: dd, time: "19:00", carbs: 70, calories: 700 }); }
  const ct = computeCarbTiming({ exercise: cex, sports: [], diet: cdiet }, {});
  ok("carb timing: flags fasted morning training", ct && /under-fueled/i.test(ct.status), ct && ct.status);
  ok("carb timing: no training → null", computeCarbTiming({ exercise: [], sports: [], diet: [] }, {}) === null, 1);
}

// ── fuel planner ──
{
  ok("fuel: no weight → needWeight", planFueling({ sessions: [{ type: "gym", time: "17:00" }] }).needWeight === true, 1);
  const single = planFueling({ sessions: [{ type: "gym", time: "17:00", durationMin: 60, intensity: "moderate" }], weightKg: 80, goals: { protein: 160 } });
  ok("fuel: protein hits goal exactly", single.planProtein === 160, single.planProtein);
  ok("fuel: carbs scale to load + weight", single.dailyCarbs > 0 && single.gPerKg >= 3, single.gPerKg);
  const both = planFueling({ sessions: [{ type: "gym", time: "08:00", durationMin: 60, intensity: "moderate" }, { type: "basketball", time: "13:00", durationMin: 75, intensity: "hard" }], weightKg: 80 });
  ok("fuel: two sessions → higher load + refuel note", both.sessions.length === 2 && both.blocks.some(b => /Rapid refuel/.test(b.note || "")), both.loadLevel);
  const longGame = planFueling({ sessions: [{ type: "football", time: "18:00", durationMin: 90, intensity: "hard" }], weightKg: 80 });
  ok("fuel: long sport gets during-fuel block", longGame.blocks.some(b => b.kind === "during"), 1);

  // adaptive reconcile
  const rplan = planFueling({ sessions: [{ type: "basketball", time: "18:00", durationMin: 75, intensity: "hard" }], weightKg: 80, goals: { protein: 160 } });
  const rec = reconcileFueling({ plan: rplan, meals: [{ time: "08:00", carbs: 60, protein: 30 }, { time: "12:00", carbs: 80, protein: 40 }], nowMin: 13 * 60 });
  ok("reconcile: sums consumed carbs", rec.consumedCarbs === 140, rec.consumedCarbs);
  ok("reconcile: flags upcoming pre-session fuel", /Fuel up for Basketball/.test(rec.status), rec.status);
  ok("reconcile: computes carbs left + add suggestion", rec.carbsLeft > 0 && rec.addPhrase.length > 0, rec.addPhrase);
  ok("reconcile: topped up when target met", reconcileFueling({ plan: rplan, meals: [{ time: "08:00", carbs: rplan.dailyCarbs, protein: rplan.dailyProtein }], nowMin: 23 * 60 }).status === "Topped up", 1);

  // sleep-aware scheduling
  const sw = sleepWindow({ sleep: [{ wakeTime: "06:30", bedtime: "23:30" }, { wakeTime: "06:30", bedtime: "23:30" }] });
  ok("sleepWindow: averages wake", sw.wakeMin === 390, sw.wakeMin);
  ok("sleepWindow: handles after-midnight-ish bedtime", sw.sleepMin === 1410 && sw.hasData, sw.sleepMin);
  ok("sleepWindow: defaults when empty", (() => { const d = sleepWindow({ sleep: [] }); return d.wakeMin === 420 && d.sleepMin === 1380 && !d.hasData; })(), 1);
  const early = planFueling({ sessions: [{ type: "gym", time: "17:00", durationMin: 60, intensity: "moderate" }], weightKg: 80, goals: { protein: 160 }, wakeMin: 390, sleepMin: 1410 });
  const firstMeal = early.blocks.find(b => b.kind === "meal");
  const mins = t => +t.split(":")[0] * 60 + +t.split(":")[1];
  ok("fuel: first meal lands just after wake", firstMeal && Math.abs(mins(firstMeal.time) - (390 + 45)) < 30, firstMeal && firstMeal.time);
  ok("fuel: plan returns wake/sleep window", early.wakeMin === 390 && early.sleepMin === 1410, `${early.wakeMin}/${early.sleepMin}`);
  const lateWake = planFueling({ sessions: [{ type: "gym", time: "17:00", durationMin: 60, intensity: "moderate" }], weightKg: 80, goals: { protein: 160 }, wakeMin: 600, sleepMin: 1440 });
  const lwFirst = lateWake.blocks.find(b => b.kind === "meal");
  ok("fuel: meal schedule shifts with later wake", lwFirst && mins(lwFirst.time) > (firstMeal ? mins(firstMeal.time) : 0), lwFirst && lwFirst.time);
}

// ── brain (wires everything) ──
const brain = buildBrain(data, goals);
ok("brain: builds with all engines", !!(brain.weight && brain.recovery && brain.sleepIntel && brain.energy && brain.training && brain.skin), 1);
const txt = formatBrainText(brain);
ok("brain: text has all sections", /== SLEEP/.test(txt) && /TDEE|ENERGY BALANCE/.test(txt) && /== TRAINING/.test(txt) && /== SKIN/.test(txt), 1);

// ── goal plan ──
const gpUnreal = assessGoal({ goalPlan: { startDate: "2026-03-01", targetDate: "2026-07-01", startWeight: 75, goalWeight: 85, experience: "intermediate" }, currentWeight: 75 });
ok("goalplan: flags unrealistic bulk", gpUnreal.verdict === "unrealistic", gpUnreal.verdict);
ok("goalplan: excess fat dominates unrealistic gain", gpUnreal.expectedFatKg[1] > gpUnreal.expectedMuscleKg[1], JSON.stringify(gpUnreal.expectedFatKg));
ok("goalplan: suggests a realistic timeline", gpUnreal.realisticWeeks > 17, gpUnreal.realisticWeeks);
const gpReal = assessGoal({ goalPlan: { startDate: "2026-03-01", targetDate: "2026-06-21", startWeight: 75, goalWeight: 78, experience: "intermediate" }, currentWeight: 75 });
ok("goalplan: passes a sane lean bulk", gpReal.verdict === "realistic", gpReal.verdict);
const gpLoss = assessGoal({ goalPlan: { startDate: "2026-03-01", targetDate: "2026-05-10", startWeight: 90, goalWeight: 82, experience: "intermediate" }, currentWeight: 90 });
ok("goalplan: sustainable cut is realistic", gpLoss.verdict === "realistic" && gpLoss.dir === "loss", gpLoss.verdict);
const traj = buildTrajectory({ goalPlan: { startDate: "2026-03-01", targetDate: "2026-06-21", startWeight: 75, goalWeight: 78 }, weightTrend: { current: 76.2, ratePerWeekKg: 0.15 }, today: "2026-04-05" });
ok("goalplan: trajectory computes status + projection", ["on-track", "ahead", "behind"].includes(traj.status) && traj.projectedEnd != null, traj.status);
const cons = analyzeConstraints({ data, goals, goalPlan: { freq: 4 }, recovery: { readiness: 70 } });
ok("goalplan: constraints rank a primary lever", !!cons.primary && cons.levers.length >= 1, cons.levers.length);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
