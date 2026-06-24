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
import { assessGoal, buildTrajectory, analyzeConstraints, analyzeRoadmap, interpretPlan } from "../src/engines/goalplan.js";
import { computeProteinDistribution } from "../src/engines/protein.js";
import { computeSkin, detectRoutineConflicts } from "../src/engines/skin.js";
import { estimateGlycemicLoad, dayGlycemicLoad } from "../src/engines/glycemic.js";
import { lookupGI } from "../src/engines/gi-database.js";
import { computeCarbTiming } from "../src/engines/carbtiming.js";
import { planFueling, reconcileFueling, sleepWindow } from "../src/engines/fueling.js";
import { buildBrain, formatBrainText } from "../src/brain/brain.js";
import { getPhases, activePhase, phaseReqRate, generatePhases } from "../src/engines/phases.js";
import { computePhysiologyState, computeRecoveryDebt } from "../src/engines/physiology.js";
import { proposeAdaptation } from "../src/engines/adaptation.js";
import { computePhaseResult, blendRate, logDecision, evaluateDecisions } from "../src/engines/strategy.js";
import { computeMacroTargets, macrosDiffer } from "../src/engines/macros.js";
import { parseGoalMarkdown, buildRoadmapPhases } from "../src/engines/goalmd.js";
import { computeCircadian, bioDayKey, bioDayNutrition } from "../src/engines/circadian.js";
import { computeVolume, mapExercise, classifyVolume, volumeTrend, MUSCLE_KEYS, listExerciseMappings } from "../src/engines/volume.js";

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

// ── Strategic OS layer (phases / physiology / adaptation / strategy) ──
{
  const legacy = { type: "leanbulk", startWeight: 80, goalWeight: 84, startDate: daysAgo(28), targetDate: daysAgo(-90), freq: 4 };
  ok("phases: legacy migrates to one active phase", getPhases(legacy).length === 1 && getPhases(legacy)[0].status === "active", 1);
  ok("phases: active phase req rate is a gain", phaseReqRate(activePhase(legacy, daysAgo(0))) > 0, phaseReqRate(activePhase(legacy, daysAgo(0))));

  const sleep = [], exercise = [], sports = [], weight = [], diet = [];
  for (let i = 27; i >= 0; i--) {
    const bad = i < 3;
    sleep.push({ date: daysAgo(i), bedtime: "23:30", wakeTime: bad ? "05:30" : "07:30", duration: bad ? 6 : 7.6, quality: bad ? "Poor" : "Good", latencyMin: 10, wakeMin: 10, id: i });
    if (i % 2 === 0) exercise.push({ date: daysAgo(i), raw: "Squat 100x5x5\nBench 80x5x5", id: "e" + i });
    if (i % 7 === 0) sports.push({ date: daysAgo(i), sport: "Football", duration: "70", intensity: "Moderate", id: "s" + i });
    for (let m = 0; m < 3; m++) diet.push({ date: daysAgo(i), protein: 55, calories: 950, carbs: 110, fat: 30, id: `d${i}-${m}` });
  }
  for (let k = 0; k < 14; k++) { const day = 27 - k * 2; weight.push({ date: daysAgo(day), kg: +(80 + (27 - day) / 28 * 1.1).toFixed(1), id: "w" + k }); }
  const d2 = { sleep, exercise, sports, weight, diet, nicotine: [], journal: [], water: [] };
  const g2 = { protein: 160, calories: 2800, profile: { sex: "male", age: 25, heightCm: 178, weightKg: 80, sleepNeedH: 8 }, goalPlan: legacy };

  const debt = computeRecoveryDebt(d2, g2);
  ok("physiology: recovery debt series + relative framing", debt.series.length === 28 && Number.isFinite(debt.relPct) && ["rising", "falling", "steady"].includes(debt.trend), debt.trend);
  const st = computePhysiologyState(d2, g2);
  ok("physiology: alignment is banded + tiered", ["On track", "Drifting", "Off track"].includes(st.alignment.band) && st.alignment.tier === "estimate", st.alignment.band);
  ok("physiology: momentum banded with components", ["Strong", "Steady", "Stalling", "Reversing"].includes(st.momentum.band) && !!st.momentum.components.gapClosing, st.momentum.band);
  ok("physiology: every soft field carries a tier", !!(st.recoveryDebt.tier && st.alignment.tier && st.momentum.tier && st.stressBudget.tier), 1);

  const sparse = diet.filter((_, idx) => idx % 6 === 0).map(x => ({ ...x, protein: 20 }));
  const st2 = computePhysiologyState({ ...d2, diet: sparse }, g2);
  ok("physiology: divergence note fires when inputs low but outcomes ok", st2.adherence.overall < 70 && ["Strong", "Steady"].includes(st2.momentum.band) ? !!st2.momentum.divergenceNote : true, st2.momentum.divergenceNote ? "fired" : "n/a");

  const base = { hasGoal: true, currentWeight: 80, trend: { confidence: "Moderate", spanDays: 28 }, recoveryDebt: { relPct: 10, trend: "steady" }, adherence: { overall: 85 }, phase: { type: "leanbulk" } };
  ok("adaptation: gain-too-fast → reduce-surplus", (proposeAdaptation({ ...base, reqRate: 0.24, actualRate: 0.55 }, {}, daysAgo(0), []) || {}).kind === "reduce-surplus", 1);
  ok("adaptation: low adherence → fix-adherence not a plan change", (() => { const p = proposeAdaptation({ ...base, reqRate: 0.24, actualRate: 0.55, adherence: { overall: 45 } }, {}, daysAgo(0), []); return !!p && p.kind === "fix-adherence" && p.change === null; })(), 1);
  ok("adaptation: immature data → wait (hysteresis)", (proposeAdaptation({ ...base, reqRate: 0.24, actualRate: 0.55, trend: { confidence: "Low", spanDays: 9 } }, {}, daysAgo(0), []) || {}).kind === "wait", 1);
  ok("adaptation: high recovery debt → deload", (proposeAdaptation({ ...base, reqRate: 0.24, actualRate: 0.26, recoveryDebt: { relPct: 55, trend: "rising" } }, {}, daysAgo(0), []) || {}).kind === "insert-deload", 1);
  ok("adaptation: on-track → no proposal", proposeAdaptation({ ...base, reqRate: 0.24, actualRate: 0.26 }, {}, daysAgo(0), []) === null, 1);

  const ph = { id: 7, type: "leanbulk", startDate: daysAgo(84), endDate: daysAgo(0), startWeight: 78, goalWeight: 80.5 };
  const w2 = []; for (let k = 0; k < 10; k++) { const day = 84 - k * 9; w2.push({ date: daysAgo(day), kg: +(78 + (84 - day) / 84 * 3).toFixed(1) }); }
  const res = computePhaseResult(ph, { weight: w2, diet: [] });
  ok("strategy: phase result gives MODELED muscle/fat ranges", Array.isArray(res.estMuscleKg) && res.estMuscleKg.length === 2 && res.tier === "estimate", JSON.stringify(res.estMuscleKg));
  const bl = blendRate([0.5, 0.55], 0.3);
  ok("strategy: personal rate is a weak prior blended with evidence", bl.source === "blended" && bl.weight < 0.5 && bl.rate > 0.3 && bl.rate < 0.5, bl.rate);
  let log = logDecision([], { date: daysAgo(30), rec: { kind: "reduce-surplus" }, metric: "weightRate", expectedDir: -1, baselineValue: 0.55 });
  log = evaluateDecisions(log, { weightRate: 0.30 }, daysAgo(0), 21);
  ok("strategy: decision evaluated correlationally", log[0].verdict === "improved" && log[0].correlational === true, log[0].verdict);
}

// ── macros engine + markdown import + alignment advice ──
{
  const wt = []; for (let k = 0; k < 8; k++) wt.push({ date: daysAgo(16 - k * 2), kg: 74.2 });
  const g = { profile: { sex: "male", age: 25, heightCm: 178, weightKg: 74.2 }, calories: 2000, protein: 120, carbs: 200, fat: 60, goalPlan: { type: "leanbulk", startWeight: 74.2, goalWeight: 77, startDate: daysAgo(20), targetDate: daysAgo(-160), freq: 4 } };
  const mt = computeMacroTargets({ weight: wt }, g);
  ok("macros: bulk gives a surplus + remainder carbs that sum to calories", mt.ready && mt.dailyDelta > 0 && mt.carbs > 0 && Math.abs(mt.protein * 4 + mt.carbs * 4 + mt.fat * 9 - mt.calories) < 12, mt.calories);
  ok("macros: aggressive goal clamps to a safe pace", computeMacroTargets({ weight: wt }, { ...g, goalPlan: { ...g.goalPlan, goalWeight: 95, targetDate: daysAgo(-20) } }).clampedToCeiling === true, 1);
  ok("macros: cut respects the safety floor", computeMacroTargets({ weight: wt }, { ...g, goalPlan: { type: "cut", startWeight: 74.2, goalWeight: 68, startDate: daysAgo(20), targetDate: daysAgo(-30), freq: 4 } }).calories >= 1500, 1);
  ok("macros: macrosDiffer flags stale targets", macrosDiffer(mt, g) === true, 1);

  // estimate-only path is tiered honestly (no false "calculated" confidence) and runs lower than the old 1.7–1.8× multipliers
  ok("macros: estimated TDEE is tiered as estimate + low confidence", mt.estimateOnly === true && mt.tier === "estimate" && mt.confidence === "low", { t: mt.tier, c: mt.confidence, e: mt.estimateOnly });
  ok("macros: conservative activity factor keeps estimated maintenance sane", mt.tdee < mt.currentWeight * 42, mt.tdee);
  // imported-plan calories override the estimate and are NOT flagged estimate-only
  const mtPlan = computeMacroTargets({ weight: wt }, { ...g, goalPlan: { ...g.goalPlan, roadmap: { meta: { maintenance: 2650 } } } });
  ok("macros: plan maintenance overrides the formula estimate", mtPlan.tdeeSource === "plan" && mtPlan.estimateOnly !== true, { s: mtPlan.tdeeSource, e: mtPlan.estimateOnly });

  const parsed = parseGoalMarkdown("Lean bulk from 74kg → 77kg. Target date: 2026-12-01. Protein: 165g. Train 5x/week.");
  ok("goalmd: extracts type+weights+date+freq+macros", parsed.type === "leanbulk" && parsed.startWeight === 74 && parsed.goalWeight === 77 && parsed.targetDate === "2026-12-01" && parsed.freq === 5 && parsed.macros.protein === 165, JSON.stringify(parsed.found));
  ok("goalmd: gibberish recognises nothing", parseGoalMarkdown("hello world, no plan here").anyFound === false, 1);

  const stA = computePhysiologyState({ weight: wt, sleep: [], exercise: [], sports: [], diet: [], nicotine: [], journal: [] }, g);
  ok("physiology: alignment carries why+fix advice array", Array.isArray(stA.alignment.advice), stA.alignment.advice.length);

  // rich markdown roadmap import
  const rmd = "# Plan\n### June 23, 2026 → December 23, 2026\n\n## Phase overview\n| Phase | Dates | Calories | Protein | Weight goal |\n|---|---|---|---|---|\n| **0 · Reverse & confirm** | Jun 23 – Jul 6 (2 wks) | ramp 2,300 to 2,650 | 160 g | 74.2 to ~75.0 kg |\n| **1 · Lean Bulk I** | Jul 7 – Sep 7 (9 wks) | ~2,900 (calibrate) | 165 g | ~75.0 to ~76.0 kg |\n\n## Monthly weight checkpoints\n| Date | Target | Note |\n|---|---|---|\n| Jul 23 | ~75.0 kg | start |\n\n## Deload schedule\n- ~Aug 25-31 and Oct 27-Nov 2\n\n## Decision & tracking rules\n- **Scale flat 3 weeks** then eat more.\n- **Gaining too fast** then trim 150 cal.\n";
  const rp = parseGoalMarkdown(rmd);
  ok("goalmd: parses multi-phase roadmap from tables", rp.hasRoadmap && rp.phases.length === 2 && rp.phases[0].type === "maintenance" && rp.phases[1].calories === 2900 && rp.phases[1].protein === 165, rp.phases.length);
  ok("goalmd: phase dates → ISO", rp.phases[0].startDate === "2026-06-23" && rp.phases[1].endDate === "2026-09-07", [rp.phases[0].startDate, rp.phases[1].endDate]);
  ok("goalmd: extracts checkpoints + rules", rp.checkpoints.length >= 1 && rp.rules.length >= 2, { c: rp.checkpoints.length, r: rp.rules.length });

  // robustness: alternative table headers (Block / Window / kcal) + "D Mon" date order
  const rv = parseGoalMarkdown("# P\n| Block | Window | kcal | Pro | Target |\n|---|---|---|---|---|\n| Bulk I | 7 Jul 2026 – 7 Sep 2026 | 2900 | 165 g | 75 → 76 kg |\n| Bulk II | 8 Sep – 9 Nov | 2950 | 170 g | 76 → 77 kg |\n");
  ok("goalmd: parses Block/Window/kcal headers + D-Mon dates", rv.hasRoadmap && rv.phases.length === 2 && rv.phases[0].startDate === "2026-07-07" && rv.phases[0].calories === 2900, [rv.phases.length, rv.phases[0].startDate]);

  // robustness: phases as headed sections (no table)
  const rs = parseGoalMarkdown("# Roadmap 2026\n## Phase 1: Lean Bulk\n- Dates: Jul 7 – Sep 7\n- Calories: ~2900\n- Protein: 165 g\n- Weight: 75 → 76 kg\n## Phase 2: Mini-cut\n- Dates: Sep 8 – Oct 5\n- Calories: 2200\n- Protein: 180 g\n- Weight: 76 → 74 kg\n");
  ok("goalmd: section-fallback parses phases without a table", rs.hasRoadmap && rs.phases.length === 2 && rs.phases[0].calories === 2900 && rs.phases[1].type === "minicut", [rs.phases.length, rs.phases[0].calories]);

  // robustness: numbered headings, "2900 kcal" (number before unit), prose protein
  const rn = parseGoalMarkdown("# Plan\n## 1. Lean Bulk (Weeks 1-8)\nTarget around 2900 kcal with 165g protein. Move from 75 to 76 kg.\n## 2. Mini-cut (Weeks 9-12)\nDrop to 2200 calories, keep protein at 180g. 76 to 74 kg.\n");
  ok("goalmd: numbered headings + cal-before-unit + prose protein", rn.phases.length === 2 && rn.phases[0].calories === 2900 && rn.phases[0].protein === 165 && rn.phases[1].calories === 2200 && rn.phases[1].protein === 180, rn.phases.map(p => [p.calories, p.protein]));

  // robustness: Month headings still recognised as phases
  const rmth = parseGoalMarkdown("# Roadmap\n## Month 1: Reverse diet\nRamp to 2650 kcal. 74 to 75 kg.\n## Month 2-3: Bulk\n2900 kcal, 165g protein. 75 to 77 kg.\n");
  ok("goalmd: Month headings parse as phases", rmth.phases.length === 2 && rmth.phases[0].type === "maintenance" && rmth.phases[1].calories === 2900, rmth.phases.map(p => p.type));

  // summary is a non-empty human-readable analysis for the preview
  ok("goalmd: produces a summary array", Array.isArray(rp.summary) && rp.summary.length >= 2, rp.summary && rp.summary.length);

  // active-phase macro selection: prefer a non-maintenance phase over the ramp/maintenance one
  const ap = parseGoalMarkdown("# P\n| Phase | Dates | Calories | Protein | Weight |\n|---|---|---|---|---|\n| Confirm maintenance | — | 2400 | 150 g | 80 → 80 kg |\n| Lean bulk | — | 2900 | 165 g | 80 → 83 kg |\n");
  ok("goalmd: macros prefer the working phase, not the maintenance ramp", ap.macros && ap.macros.calories === 2900, ap.macros && ap.macros.calories);

  // active-phase macro selection: a phase whose window covers today wins
  const Y = new Date().getFullYear();
  const apW = parseGoalMarkdown(`# P ${Y}\n| Phase | Dates | Calories | Protein | Weight |\n|---|---|---|---|---|\n| This year | Jan 1 – Dec 31 | 3100 | 170 g | 78 → 82 kg |\n`);
  ok("goalmd: macros come from the phase active today", apW.macros && apW.macros.calories === 3100, apW.macros && apW.macros.calories);

  const planGoals = { profile: { sex: "male", age: 25, heightCm: 182, weightKg: 74.2 }, goalPlan: { phases: [{ type: "leanbulk", name: "Lean Bulk I", startDate: daysAgo(2), endDate: daysAgo(-60), startWeight: 75, goalWeight: 76, calories: 2900, protein: 165, status: "active" }] } };
  const mp = computeMacroTargets({ weight: wt }, planGoals);
  ok("macros: honour imported phase calories/protein", mp.fromPlan === true && mp.calories === 2900 && mp.protein === 165, { cal: mp.calories, p: mp.protein });

  // ── END-TO-END: any document → goalPlan.phases → getPhases → roadmap renders them ──
  // Uses a plan whose phases are nothing like the default lean-bulk, to prove the
  // roadmap reflects whatever phases the document actually contains.
  const diffDoc = "# Cut then recomp 2026\n\n| Phase | Dates | Calories | Protein | Weight |\n|---|---|---|---|---|\n| **Aggressive cut** | Jan 5 – Mar 1 | 1800 | 200 g | 90 → 84 kg |\n| **Recomp** | Mar 2 – Jun 1 | 2400 | 190 g | 84 → 84 kg |\n| **Maintain & assess** | Jun 2 – Aug 1 | 2600 | 170 g | 84 → 85 kg |\n";
  const dp = parseGoalMarkdown(diffDoc);
  ok("e2e: parser recognises the document's own 3 phases", dp.hasRoadmap && dp.phases.length === 3 && dp.phases[0].type === "cut" && dp.phases[1].type === "recomp" && dp.phases[2].type === "maintenance", dp.phases.map(p => p.type));
  const builtPhases = buildRoadmapPhases(dp, "2026-04-15");        // a date inside the Recomp window
  const gpRoadmap = { goalPlan: { type: dp.type, goalWeight: 85, startDate: "2026-01-05", targetDate: "2026-08-01", phases: builtPhases } };
  const shown = getPhases(gpRoadmap.goalPlan);
  ok("e2e: roadmap shows all 3 imported phases (not the migrated single one)", shown.length === 3 && shown[0].name === "Aggressive cut" && shown[0].calories === 1800, shown.length);
  ok("e2e: status is computed per phase (done / active / planned)", shown[0].status === "done" && shown[1].status === "active" && shown[2].status === "planned", shown.map(s => s.status));
  ok("e2e: active phase = the one whose window covers the date", activePhase(gpRoadmap.goalPlan, "2026-04-15").name === "Recomp", activePhase(gpRoadmap.goalPlan, "2026-04-15").name);

  // ── strategy-document import: plain "Month block" format + preservation + per-phase analysis ──
  const blockDoc = "Month 1-2:\nLean bulk\nCalories: 2900\nTarget: +0.25kg/week\nFocus: Improve bench press\n\nMonth 3:\nMini cut\nCalories: 2400\nTarget: -0.7kg/week\n\nMonth 4-6:\nLean bulk\nCalories: 3000\nTarget: +0.9kg/week\nFocus: Add back width\n";
  const bd = parseGoalMarkdown(blockDoc);
  ok("goalmd: plain Month-block format parses 3 phases", bd.hasRoadmap && bd.phases.length === 3 && bd.phases[0].type === "leanbulk" && bd.phases[1].type === "minicut", bd.phases.map(p => p.type));
  ok("goalmd: captures per-phase target rate + focus", bd.phases[0].targetRate === 0.25 && bd.phases[0].focus === "Improve bench press" && bd.phases[1].targetRate === -0.7, [bd.phases[0].targetRate, bd.phases[0].focus]);
  ok("goalmd: preserves source markdown + strategy notes", bd.sourceMarkdown.length > 50 && bd.strategyNotes.length >= 2, { src: bd.sourceMarkdown.length, notes: bd.strategyNotes.length });

  // per-phase reality check: each leg judged on its own pace
  const ar = analyzeRoadmap({ phases: bd.phases, currentWeight: 75, experience: "intermediate" });
  ok("analyzeRoadmap: per-phase verdicts + plan verdict", ar.phases.length === 3 && ar.phases[0].verdict === "realistic" && ar.phases[2].verdict === "unrealistic" && ar.planVerdict === "unrealistic", ar.phases.map(p => p.verdict));
  ok("analyzeRoadmap: flags the over-fast bulk as a risk", ar.risks.some(r => /surplus|fat/i.test(r)), ar.risks);
  ok("analyzeRoadmap: counts phase types", ar.typeCounts.leanbulk === 2 && ar.typeCounts.minicut === 1, ar.typeCounts);
  ok("analyzeRoadmap: weight-anchored phase reuses assessGoal ranges", (() => { const w = analyzeRoadmap({ phases: [{ id: 1, type: "leanbulk", name: "B", startWeight: 75, goalWeight: 90, startDate: daysAgo(0), endDate: daysAgo(-60) }], currentWeight: 75 }); return w.phases[0].verdict === "unrealistic" && Array.isArray(w.phases[0].expectedFatKg); })(), 1);

  // generatePhases — Build-Plan path auto-creates a multi-phase roadmap
  const gP = generatePhases({ type: "leanbulk", startWeight: 74, goalWeight: 80, startDate: "2026-06-23", targetDate: "2026-12-08", experience: "intermediate" }, "2026-06-23");
  ok("generatePhases: 74→80/24wk → bulk, bulk, maintenance", gP.length === 3 && gP[0].type === "leanbulk" && gP[1].type === "leanbulk" && gP[2].type === "maintenance" && gP[0].startWeight === 74 && gP[1].goalWeight === 80, gP.map(p => p.type));
  ok("generatePhases: phases chain weights + carry a target rate", gP[0].goalWeight === gP[1].startWeight && gP[0].targetRate > 0, [gP[0].goalWeight, gP[1].startWeight]);
  ok("generatePhases: short cut → single cut phase", (() => { const c = generatePhases({ type: "cut", startWeight: 80, goalWeight: 76, startDate: "2026-06-23", targetDate: "2026-09-01", experience: "intermediate" }, "2026-06-23"); return c.length === 1 && c[0].type === "cut"; })(), 1);
  ok("generatePhases: maintain → single maintenance phase", (() => { const m = generatePhases({ type: "maintenance", startWeight: 80, goalWeight: 80, startDate: "2026-06-23", targetDate: "2026-12-01", experience: "intermediate" }, "2026-06-23"); return m.length === 1 && m[0].type === "maintenance"; })(), 1);

  // duration parsing + interpretPlan (fill missing data instead of erroring)
  const partial = parseGoalMarkdown("Goal: Lean Bulk\n\nPhase 1:\n74kg → 77kg\n\nPhase 2:\n77kg → 80kg\n\nDuration: 6 months\n");
  ok("goalmd: parses 'Duration: 6 months' → ~26 weeks", partial.durationWeeks === 26 && partial.startWeight === 74 && partial.goalWeight === 80, partial.durationWeeks);
  const interp = interpretPlan(partial, { currentWeight: 74, profile: { sex: "male", age: 22, heightCm: 178 }, today: "2026-06-23" });
  ok("interpretPlan: derives start + end dates from duration", interp.goalPlan.startDate === "2026-06-23" && interp.goalPlan.targetDate > "2026-12-01" && interp.provenance.targetDate === "derived", [interp.goalPlan.targetDate, interp.provenance.targetDate]);
  ok("interpretPlan: fills phase dates + calories + protein for every phase", interp.goalPlan.phases.length === 2 && interp.goalPlan.phases.every(p => p.startDate && p.endDate && p.calories > 0 && p.protein > 0), interp.goalPlan.phases.map(p => [p.startDate, p.calories, p.protein]));
  ok("interpretPlan: provenance marks plan vs derived", interp.provenance.goalWeight === "plan" && interp.provenance.startDate === "derived" && interp.provenance.calories === "derived", interp.provenance);
  ok("interpretPlan: produces a reality check (never a dead end)", interp.reality && interp.reality.verdict === "realistic" && interp.reality.reqKgWk > 0, interp.reality && interp.reality.verdict);
  ok("interpretPlan: a goal-only plan still completes", (() => { const g = interpretPlan(parseGoalMarkdown("Goal: lean bulk from 74kg to 80kg"), { currentWeight: 74, profile: { sex: "male", age: 22, heightCm: 178 }, today: "2026-06-23" }); return g.goalPlan.targetDate != null && g.goalPlan.phases.length >= 1; })(), 1);

  // ── Circadian Engine ──
  {
    const sleep = [];
    for (let i = 0; i < 20; i++) sleep.push({ date: `2026-06-${String(i + 1).padStart(2, "0")}`, bedtime: i % 2 ? "03:10" : "03:20", wakeTime: "11:00", quality: "Good" });
    const c = computeCircadian({ sleep }, "2026-06-23");
    ok("circadian: derives a ~3:15 AM biological-day end from sleep onset", c.ready && c.biologicalDayEnd === "3:15 AM" && c.biologicalDayStart === "11:00 AM", [c.biologicalDayEnd, c.biologicalDayStart]);
    ok("circadian: boundary is calculated + confidence high on consistent data", c.tier === "calc" && c.confidence === "high" && c.sleepConsistency > 90, [c.confidence, c.sleepConsistency]);
    const t = (d, h, m) => new Date(`2026-06-${d}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).getTime();
    ok("circadian: 11PM, 1AM, 2:30AM all map to the SAME biological day", bioDayKey(t("01", 23, 0), c) === "2026-06-01" && bioDayKey(t("02", 1, 0), c) === "2026-06-01" && bioDayKey(t("02", 2, 30), c) === "2026-06-01", "grouped");
    ok("circadian: after the boundary it's a new biological day", bioDayKey(t("02", 4, 0), c) === "2026-06-02", bioDayKey(t("02", 4, 0), c));
    const diet = [{ date: "2026-06-01", time: "23:00", calories: 1000, protein: 80 }, { date: "2026-06-02", time: "01:00", calories: 1100, protein: 70 }, { date: "2026-06-02", time: "02:30", calories: 900, protein: 0 }];
    const bn = bioDayNutrition(diet, c);
    ok("circadian: nutrition sums across the wrap → 3000 kcal / 150g protein in one bio-day", bn["2026-06-01"] && bn["2026-06-01"].calories === 3000 && bn["2026-06-01"].protein === 150, bn["2026-06-01"]);
    const none = computeCircadian({ sleep: [] }, "2026-06-23");
    ok("circadian: no sleep data → not ready, low confidence, never hardcodes midnight", none.ready === false && none.confidence === "low" && none.boundaryMin == null, none.ready);
  }

  // ── Weekly Volume Engine ──
  // ── Weekly Muscle Volume Engine ──
  {
    ok("volume: one exercise → one primary muscle (no secondary)", mapExercise("Bench Press") === "chest" && mapExercise("Barbell Row") === "upperBack" && mapExercise("Romanian Deadlift") === "hamstrings" && mapExercise("Face Pull") === "rearDelts", "single");
    ok("volume: plural names map (Pull Ups→lats, Curls→biceps, Lateral Raise→side delts)", mapExercise("Pull Ups") === "lats" && mapExercise("Barbell Curls") === "biceps" && mapExercise("Lateral Raise") === "sideDelts", 1);
    ok("volume: classification bands", classifyVolume(3).label === "Very Low" && classifyVolume(8).label === "Maintenance" && classifyVolume(12).label === "Productive" && classifyVolume(18).label === "High" && classifyVolume(24).label === "Extremely High", 1);
    const today = "2026-06-24";
    const data = { exercise: [
      { date: "2026-06-22", text: "Bench Press\n100x5\n100x5\n100x5\n100x5" },     // chest +4, tri/fdelt +2 each
      { date: "2026-06-23", text: "Squat\n140x5\n140x5\n140x5" },                  // quads +3
      { date: "2026-06-24", text: "Lateral Raise\n12x15\n12x15\n12x15\n12x15" },    // sideDelts +4
      { date: "2026-06-16", text: "Bench Press\n100x5\n100x5" },                    // last week chest +2
    ] };
    const v = computeVolume(data, { goalPlan: { volumeTargets: { chest: 18 } } }, today);
    ok("volume: each working set → exactly one muscle (full credit, no secondary)", v.weeklyVolume.chest === 4 && v.weeklyVolume.quads === 3 && v.weeklyVolume.sideDelts === 4 && v.weeklyVolume.triceps === 0 && v.weeklyVolume.frontDelts === 0, v.weeklyVolume);
    ok("volume: change vs last week + goal target/progress", (() => { const c = v.muscles.find(m => m.key === "chest"); return c.lastWeek === 2 && c.change === 2 && c.target === 18 && c.progress === 22; })(), 1);
    ok("volume: summary highest/lowest/total/trained", v.summary.highest.label === "Chest" || v.summary.highest.label === "Side Delts" ? v.summary.totalSets > 0 && v.summary.musclesTrained >= 3 : false, v.summary);
    ok("volume: raw volume balance totals (no symmetry score)", typeof v.balance.push === "number" && typeof v.balance.pull === "number" && v.balance.lower >= 3 && v.symmetry === undefined, v.balance);
    ok("volume: per-muscle recommended range + range-based status", (() => { const c = v.muscles.find(m => m.key === "chest"); return Array.isArray(c.range) && c.recommended === "10-20" && c.status.label === "Undertrained"; })(), 1);
    ok("volume: 18 muscle groups incl. adductors", MUSCLE_KEYS.length === 18 && MUSCLE_KEYS.includes("adductors"), MUSCLE_KEYS.length);
    ok("volume: weekOffset=1 selects the previous Mon–Sun week", (() => { const pv = computeVolume(data, {}, today, 1); return pv.weekStart === "2026-06-15" && pv.weeklyVolume.chest === 2; })(), 1);
    ok("volume: weak points carry suggested target + exercises", (() => { const w = v.weakPoints.find(x => x.key === "lats"); return w && w.suggestedTarget === "10-20" && w.exercises.includes("Lat Pulldown"); })(), 1);
    ok("volume: weak points list muscles under their recommended minimum", Array.isArray(v.weakPoints) && v.weakPoints.every(w => w.sets < w.range[0]), 1);
    ok("volume: warmup sets (RPE<5) are excluded", (() => { const d = { exercise: [{ date: "2026-06-22", text: "Bench Press\n60x10 @3\n60x10 @4\n100x5 @8\n100x5 @9" }] }; const r = computeVolume(d, {}, today); return r.weeklyVolume.chest === 2; })(), 1);
    ok("volume: trend returns N weekly buckets oldest→newest", (() => { const tr = volumeTrend(data, "chest", 4, today); return tr.length === 4 && tr[3].sets === 4 && tr[2].sets === 2; })(), 1);
    ok("volume: user override re-routes an exercise's sets", (() => { const o = computeVolume(data, { exerciseMap: { "bench press": "triceps" } }, today); return o.weeklyVolume.chest === 0 && o.weeklyVolume.triceps === 4; })(), 1);
    ok("volume: exercise mapping list (catalog + logged), one muscle each", (() => { const list = listExerciseMappings(data, {}); const bench = list.find(x => x.norm === "bench press"); return list.length > 30 && bench && bench.muscle === "chest"; })(), 1);
    ok("volume: mapping list reflects overrides", (() => { const list = listExerciseMappings(data, { exerciseMap: { "bench press": "triceps" } }); const bench = list.find(x => x.norm === "bench press"); return bench.muscle === "triceps" && bench.overridden === true; })(), 1);
    ok("volume: no workouts → not ready (honest empty state)", computeVolume({ exercise: [] }, {}, today).ready === false, 1);
}
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
