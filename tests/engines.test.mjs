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
import { computeProteinDistribution } from "../src/engines/protein.js";
import { computeSkin, detectRoutineConflicts } from "../src/engines/skin.js";
import { estimateGlycemicLoad, dayGlycemicLoad } from "../src/engines/glycemic.js";
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

// ── brain (wires everything) ──
const brain = buildBrain(data, goals);
ok("brain: builds with all engines", !!(brain.weight && brain.recovery && brain.sleepIntel && brain.energy && brain.training && brain.skin), 1);
const txt = formatBrainText(brain);
ok("brain: text has all sections", /== SLEEP/.test(txt) && /TDEE|ENERGY BALANCE/.test(txt) && /== TRAINING/.test(txt) && /== SKIN/.test(txt), 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
