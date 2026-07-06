import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { supabase, hasSupabase } from "./supabase";
import { ErrorBoundary } from "./ui/ErrorBoundary";
const CoachTab = lazy(() => import("./views/CoachTab"));
const HistoryTab = lazy(() => import("./views/HistoryTab"));
const SettingsTab = lazy(() => import("./views/SettingsTab"));
import { EjacTab } from "./views/EjacTab";
import { NicotineTab } from "./views/NicotineTab";
import { JournalTab } from "./views/JournalTab";
import { IntakeTab, WaterForm, SupplementForm, WeightForm } from "./views/IntakeTab";
import { SleepForm, SleepSection } from "./views/SleepSection";
import { WorkoutScreen, WorkoutAnalysis, V3MusclePrioCard, ExerciseForm, SportsForm } from "./views/WorkoutScreen";
import { PlanTab } from "./views/PlanTab";
import { DietForm } from "./views/DietForm";
import { SkinSection } from "./views/skin/SkinSection";
import { GoalPlanV3 } from "./views/goal/GoalPlan";
import { STORAGE_KEY } from "./lib/keys";
import { TABS, defaultData, defaultProfile, defaultStrategy, defaultGoals, fitnessGoals, mealTypes, sportsOptions, sleepQuality, intensityLevels, NIC_TYPES, NIC_CONTEXTS, NIC_QUICK, SPLIT_TYPES, defaultPlan, TYPE_DOT, TYPE_ICON, MODELS, loadModelPref, saveModelPref, currentModelId } from "./config";
import { loadData, loadGoals, saveData, saveGoals, setCurrentUser, cloudSync, cloudPull, cloudPushNow } from "./state/store";
import { fileToResizedBase64, COACH_PRINCIPLES, callClaude, WEB_SEARCH_TOOL, extractJSON, estimateSportsCalories, lookupBarcode, barcodeScanSupported, analyzeFoodAI, analyzeAllData, suggestSplitSchedule, buildPlanFromPrompt, recommendRest, analyzePhysique, renderMarkdown } from "./api/client";
import { haptic, SFX, soundEnabled, setSoundPref } from "./lib/fx";
import { Ring, MacroDonut, MiniChart, Card, Empty, toast, ToastHost, ConfirmModal, useConfirm } from "./components/primitives";
import { StatusPill } from "./components/StatusPill";
import { RecentList } from "./components/RecentList";
import { TierBadge } from "./components/TierBadge";
import { styles } from "./styles";
import { localDateStr, getTodayStr, formatDate, formatShortDate, daysAgo, daysAgoFrom, WEEKDAYS } from "./lib/dates";
import { computeWeightTrend } from "./engines/weight";
import { avgTimeMins, avgTimeHHMM, minsOfTime } from "./lib/time";
import { parseWorkout, bestSet, e1rm, detectPRs } from "./engines/workout";
import { clusterFeedings, computeProteinDistribution } from "./engines/protein";
import { computeEnergyBalance, mifflinBMR } from "./engines/energy";
import { computeTraining, mapMuscles, MUSCLE_LABELS } from "./engines/training";
import { computeNicotineStats, computeNicotineCorrelations, computeNicotineTiming, NIC_MG } from "./engines/nicotine";
import { computeSkin, detectRoutineConflicts } from "./engines/skin";
import { estimateGlycemicLoad, dayGlycemicLoad } from "./engines/glycemic";
import { planFueling, reconcileFueling, sleepWindow, SESSION_TYPES } from "./engines/fueling";
import { computeGoalPlan, formatGoalText, simulateGoal, analyzeRoadmap, assessGoal, interpretPlan } from "./engines/goalplan";
import { computePhysiologyState } from "./engines/physiology";
import { getPhases, activePhase, applyPhaseChange, generatePhases } from "./engines/phases";
import { computeCircadian, todaysBioNutrition } from "./engines/circadian";
import { computeVolume, STATUS_LEGEND, MUSCLES, MUSCLE_KEYS, MUSCLE_RANGE, REGION_LABEL, resolveMuscle, listExerciseMappings } from "./engines/volume";
import { computeHistoricalPhases } from "./engines/historyPhases";
import { suggestTransitions } from "./engines/transitions";
import { computeRecoveryCapacity } from "./engines/recoveryCapacity";
import { computeFatigue } from "./engines/fatigue";
import { PHASE_TEMPLATES, TEMPLATE_LIST, templateFor, newPhase, derivedPhases, activePhase as activePhaseV3, lensFor, alignmentFor, planSpanWeeks, planEndDate, addPhaseOp, insertPhaseOp, deletePhaseOp, duplicatePhaseOp, movePhaseOp, updatePhaseOp } from "./engines/phaseV3";
import { ANTERIOR_POLY, POSTERIOR_POLY } from "./anatomyData";
import { proposeAdaptation } from "./engines/adaptation";
import { computePhaseResult, summarizeDecisions, evaluateDecisions, logDecision } from "./engines/strategy";
import { computeMacroTargets, macrosDiffer } from "./engines/macros";
import { parseGoalMarkdown, buildRoadmapPhases } from "./engines/goalmd";
import { PRIO_TARGETS, targetById, resolvePriorities, prioritizedCount, computeMusclePrio, rpeToRIR, PRIO_DEFAULT_SETS, PRIO_MIN, PRIO_MAX, PRIO_MAX_COUNT, RIR_TARGET } from "./engines/musclePrio";
import { buildBrain, formatBrainText, prioritizeInsights } from "./brain/brain";
import { sleepTST, estimateSleepNeed, computeSleep } from "./engines/sleep";
import { computeRecovery } from "./engines/recovery";
import { computeCorrelations as computeCorrelationsV2 } from "./engines/correlations";
import { getDayContext } from "./engines/dayContext";

// ─── CONFIG / STORAGE / CLOUD SYNC ──────────────────────────────────────────────
// Constants moved to ./config.js; persistence + cloud sync moved to ./state/store.js
// (imported above) so lazily-loaded view modules can use them without importing App.jsx.

// Format a Date as YYYY-MM-DD using the user's LOCAL timezone (not UTC).
// `toISOString()` returns UTC, which is off-by-one for any user not in UTC.
// Haptics + sound moved to ./lib/fx.js (imported above).


// ─── WORKOUT PARSING (Strong app format) ──────────────────────────────────────
// Parses pasted Strong-style text into structured exercises + sets.
// Handles formats like:
//   Bench Press (Barbell)
//   Set 1: 60 kg × 10   |   60 kg x 10   |   60kg × 10 @ RPE 8
//   Bodyweight: × 12     |   Incline Run: 5 km in 30 min (ignored gracefully)

// Best set for an exercise = highest weight; tie-break on reps. Returns {weight, unit, reps} or null.

// Estimated 1-rep max (Epley formula) in kg, for comparing PRs fairly across rep ranges.

// Given a new parsed workout and all prior exercise entries, detect PRs.
// Returns array of { name, weight, unit, reps } for exercises that beat all-time e1RM.

// ─── ACHIEVEMENTS ─────────────────────────────────────────────────────────────
function computeAchievements(data, goals, streak) {
  const a = [];
  const totalLogs = (data.diet.length + data.sleep.length + data.exercise.length + data.sports.length + data.water.length);
  const maxProtein = data.diet.length ? (() => {
    const byDay = {};
    data.diet.forEach(d => { byDay[d.date] = (byDay[d.date] || 0) + (d.protein || 0); });
    return Math.max(0, ...Object.values(byDay));
  })() : 0;
  const workoutCount = data.exercise.length + data.sports.length;
  const prCount = data.exercise.reduce((n, e) => n + (e.prs?.length || 0), 0);
  const goodSleepNights = data.sleep.filter(s => s.duration >= 7).length;

  a.push({ id: "first", icon: "🌱", title: "First log", got: totalLogs >= 1 });
  a.push({ id: "streak3", icon: "🔥", title: "3-day streak", got: streak >= 3 });
  a.push({ id: "streak7", icon: "⚡", title: "7-day streak", got: streak >= 7 });
  a.push({ id: "streak30", icon: "👑", title: "30-day streak", got: streak >= 30 });
  a.push({ id: "protein", icon: "🥩", title: "Protein goal", got: goals.protein > 0 && maxProtein >= goals.protein });
  a.push({ id: "protein200", icon: "💪", title: "200g protein", got: maxProtein >= 200 });
  a.push({ id: "w10", icon: "🏋️", title: "10 workouts", got: workoutCount >= 10 });
  a.push({ id: "w50", icon: "🦾", title: "50 workouts", got: workoutCount >= 50 });
  a.push({ id: "pr", icon: "🏆", title: "First PR", got: prCount >= 1 });
  a.push({ id: "sleep7", icon: "😴", title: "Well rested", got: goodSleepNights >= 7 });
  a.push({ id: "logs100", icon: "📈", title: "100 entries", got: totalLogs >= 100 });
  return a;
}

// ─── NICOTINE ANALYTICS ───────────────────────────────────────────────────────
// Computes totals, rolling averages, and honest correlations from the user's own data.
// Returns null-ish fields gracefully when there isn't enough data yet.

// Honest, data-gated correlations. Only returns a finding when there's enough signal.
// Compares "higher intake" vs "lower intake" days/weeks within the user's OWN data.

// ─── NICOTINE TIMING ENGINE ───────────────────────────────────────────────────
// Reads the user's CURRENT state and counts recovery factors stacked against them
// right now. Each factor ties to a real mechanism — that's its only justification.
// Returns a band (lower | moderate | higher) + plain-language reasons from real logs.
//
// HARD RULES baked in:
// - This is harm-context ("IF you use nicotine, here's how today stacks"), never a
//   recommendation or green light. Lowest band = "Lower-impact", never "good time".
// - NO numbers/scores/percentages — bands + named reasons only.
// - Degrades gracefully: a missing metric is reported as "unknown", never guessed.

// Average a list of "HH:MM" times into minutes-since-midnight.
// wrapPM: treat after-midnight times (before 5am) as the prior night (+24h) for bedtime math.
// Average a list of "HH:MM" clock times correctly using a CIRCULAR mean.
// Linear averaging of clock times is wrong when they straddle midnight
// (e.g. 23:00 and 01:00 should average to 00:00, not 12:00). We treat each
// time as an angle on a 24h clock, average the unit vectors, convert back.

// ─── RECOVERY ENGINE ──────────────────────────────────────────────────────────
// Instant, rule-based "should I train today?" read from real data. Mirrors the
// nicotine-timing pattern: counts recovery signals, rolls into a verdict, lists reasons.
// Verdict: "go" (train as planned) | "caution" (train lighter / listen to your body) | "rest".

// ─── SLEEP INTELLIGENCE ENGINE ──────────────────────────────────────────────
// The smartest section in the tracker. Models sleep as THREE loosely-coupled
// problems (Borbély / sleep-medicine consensus): quantity (vs the user's OWN
// learned need, never an 8h dogma), timing/regularity (circadian), and
// continuity/quality. Then — the part no standalone sleep tracker can do — it
// couples sleep to the rest of the user's physiology (weight partitioning, RPE
// inflation, appetite, mood) using their own logged data. Deterministic.
//
// Guardrails baked in: NO fabricated sleep-stage / deep-sleep data (consumer
// estimates are unreliable; chasing them causes orthosomnia); need is
// individualised; three axis reads, never one gamified score; disorder
// screening language stays non-diagnostic; coupling = correlation, not proof.

// True sleep time = time-in-bed − latency − wake-after-sleep-onset (when logged).

// Individual sleep need. Override wins; otherwise learn from the user's own
// well-rated, unrestricted nights (median TST). Never assumes 8h as fact.


// Add/subtract days from a YYYY-MM-DD string (delta in days; negative = future).

// ─── ADAPTIVE TDEE / ENERGY-BALANCE + PLATEAU ENGINE ────────────────────────
// Back-calculates the user's REAL maintenance from logged intake + the A1 weight
// trend — no Mifflin guesswork: TDEE = mean daily intake − (Δtrend-weight × ~7700
// ÷ days). Because it measures actual energy flux, it captures adaptive
// thermogenesis automatically. Honesty gates are the whole game: it refuses a
// confident number when food logging is sparse, and flags the under-logging
// signature (an implausibly low measured maintenance) instead of trusting it.



// ─── TRAINING INTELLIGENCE ENGINE ───────────────────────────────────────────
// Two evidence-graded jobs. (1) Per-lift PROGRESSION: track estimated 1RM per
// exercise over 8 weeks, flag stalls/regressions vs progress (progressive
// overload is the strongest strength driver — Strong evidence). (2) Per-muscle
// weekly VOLUME: map lifts → muscles, count working sets/muscle/week (weekly
// hard sets is the strongest hypertrophy driver — Strong/Very Strong). The
// MEV/MAV/MRV landmark NUMBERS are heuristics (Weak evidence) so they're shown
// as soft bands, never hard verdicts. Name→muscle mapping is fuzzy by nature;
// unmapped lifts are surfaced rather than silently dropped.




// ─── IMAGE RESIZE ────────────────────────────────────────────────────────────
// Phone cameras produce huge images. Resize before sending to API for speed + reliability.
// Returns { base64, mediaType }.
// ─── AI / API CLIENT ────────────────────────────────────────────────────────────
// callClaude + all AI helpers (food/physique/plan analysis), JSON extraction,
// barcode lookup, markdown rendering, image resize moved to ./api/client.jsx
// (imported above) so view modules can share one client without importing App.jsx.

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────
// Shared UI primitives (Ring, MacroDonut, MiniChart, Card, Empty), the global
// toast + ConfirmModal/useConfirm helpers, and ToastHost moved to
// ./components/primitives.jsx (imported above).

// ─── HOME TAB ─────────────────────────────────────────────────────────────────
function HomeTab({ data, goals, onAddWater, onAddNicotine, onNav }) {
  const today = getTodayStr();
  const now = new Date();
  const hr = now.getHours();
  const greeting = hr < 5 ? "Late night" : hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : hr < 21 ? "Good evening" : "Good night";

  // Nutrition rings use the ACTIVE day (biological or calendar) via the gateway.
  const dayCtx = getDayContext(data, goals);
  const nutriDay = dayCtx.currentDayKey();
  const bioActive = dayCtx.mode === "biological";
  const todayDiet = dayCtx.meals(nutriDay);
  const todayCal = todayDiet.reduce((a, m) => a + (m.calories || 0), 0);
  const todayProtein = todayDiet.reduce((a, m) => a + (m.protein || 0), 0);
  const todayWaterMl = data.water.filter(w => w.date === today).reduce((a, w) => a + w.ml, 0);
  const todaySleep = data.sleep.find(s => s.date === today);
  const todayWorkout = data.exercise.find(e => e.date === today);
  const todaySport = data.sports.find(s => s.date === today);
  const todaySupps = data.supplements.filter(s => s.date === today);

  const calPct = Math.min(100, Math.round((todayCal / goals.calories) * 100));
  const prtPct = Math.min(100, Math.round((todayProtein / goals.protein) * 100));
  const waterPct = Math.min(100, Math.round((todayWaterMl / goals.waterGoalMl) * 100));

  const nothingToday = !todaySleep && todayDiet.length === 0 && !todayWorkout && !todaySport && todaySupps.length === 0;
  const ringsEmpty = todayCal === 0 && todayProtein === 0 && todayWaterMl === 0;

  // Daily completion — how many of the 3 core rings are at goal
  const ringsHit = [calPct >= 100, prtPct >= 100, waterPct >= 100].filter(Boolean).length;
  const dayPct = Math.round((calPct + prtPct + waterPct) / 3);

  // Logging streak — consecutive days (ending today or yesterday) with any entry
  const streak = useMemo(() => {
    const dayHas = {};
    [...data.diet, ...data.sleep, ...data.exercise, ...data.sports, ...data.water, ...data.supplements]
      .forEach(e => { if (e.date) dayHas[e.date] = true; });
    let count = 0;
    let cursor = new Date();
    // allow streak to count from today or yesterday (grace if today not logged yet)
    if (!dayHas[getTodayStr()]) cursor.setDate(cursor.getDate() - 1);
    for (;;) {
      const ds = localDateStr(cursor);
      if (dayHas[ds]) { count++; cursor.setDate(cursor.getDate() - 1); }
      else break;
    }
    return count;
  }, [data]);

  function addWater() {
    onAddWater({ id: Date.now(), date: today, ml: 250, ts: Date.now() });
    SFX.water();
    toast("💧 +250ml water logged", { silent: true });
  }

  function quickNicotine() {
    // Logs the user's primary quick entry (first in NIC_QUICK). Long-press not available on web,
    // so for other types they use the Nicotine tab; this covers the most common one-tap case.
    const q = NIC_QUICK[0];
    onAddNicotine({ id: Date.now(), date: today, ts: Date.now(), type: q.type, amount: q.amount, mg: q.mg, contexts: [] });
    haptic(12); SFX.tap();
    toast(`🚬 ${q.label} logged`, { silent: true });
  }

  // F1 — ranked top insights for the "Focus now" card
  const focus = useMemo(() => {
    try { return buildBrain(data, goals).topInsights || []; } catch { return []; }
  }, [data, goals]);

  return (
    <div className="stack">
      {/* GREETING */}
      <div className="greeting">
        <p className="greeting-date">{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 className="greeting-h">{greeting}</h1>
        <div className="greeting-row">
          <span className="greeting-goal">{goals.goal}</span>
          {streak > 0 && <span className="streak-chip" title="Consecutive days logged">🔥 {streak} day{streak === 1 ? "" : "s"}</span>}
        </div>
      </div>

      {/* PRIMARY RINGS */}
      <Card>
        {bioActive && <div className="bioday-tag" title="Calories &amp; protein are grouped by your biological day (resets at your sleep time, not midnight)">◐ Current biological day</div>}
        <div className="rings-row">
          <Ring pct={calPct} label="Calories" value={todayCal || "0"} unit="" big />
          <Ring pct={prtPct} label="Protein" value={todayProtein || "0"} unit="g" big />
          <Ring pct={waterPct} label="Water" value={todayWaterMl ? (todayWaterMl >= 1000 ? (todayWaterMl/1000).toFixed(1) : todayWaterMl) : "0"} unit={todayWaterMl >= 1000 ? "L" : "ml"} big />
        </div>
        {ringsEmpty ? (
          <p className="rings-zero">Your day's a clean slate — log a meal or some water to start filling these. 💪</p>
        ) : (
          <>
            <div className="ring-targets">
              <span>{todayCal}/{goals.calories} kcal</span>
              <span>{todayProtein}/{goals.protein}g protein</span>
              <span>{todayWaterMl}/{goals.waterGoalMl}ml</span>
            </div>
            <div className="day-progress">
              <div className="day-progress-bar"><div className="day-progress-fill" style={{ width: `${dayPct}%` }} /></div>
              <span className="day-progress-label">
                {ringsHit === 3 ? "🎉 All goals hit — crushed it!" : ringsHit > 0 ? `${ringsHit}/3 goals hit · ${dayPct}% of the way` : `${dayPct}% of the way there`}
              </span>
            </div>
          </>
        )}
      </Card>

      {/* FOCUS NOW — ranked highest-leverage signals (F1) */}
      {focus.length > 0 && (
        <Card title="Focus now" sub="Your highest-leverage signals, ranked">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {focus.slice(0, 3).map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontWeight: 700, color: "var(--accent)", minWidth: 16, lineHeight: 1.5 }}>{i + 1}</span>
                <span className="small" style={{ lineHeight: 1.5 }}>{f.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* QUICK ACTIONS */}
      <div className="quick-actions">
        <button className="qa qa-primary" onClick={() => onNav("Log", "diet")}>
          <span className="qa-icon">◉</span><span>Log meal</span>
        </button>
        <button className="qa" onClick={addWater}>
          <span className="qa-icon">◊</span><span>+ 250ml water</span>
        </button>
        <button className="qa" onClick={() => onNav("Log", "exercise")}>
          <span className="qa-icon">◆</span><span>Log workout</span>
        </button>
        <button className="qa" onClick={quickNicotine} onContextMenu={e => { e.preventDefault(); onNav("Log", "nicotine"); }}>
          <span className="qa-icon">🚬</span><span>Log {NIC_QUICK[0].label}</span>
        </button>
      </div>
      <button className="qa-wide" onClick={() => onNav("Coach")}>
        <span className="qa-icon">✦</span><span>Ask coach</span>
      </button>

      {/* TODAY LOGGED */}
      <Card title="Today">
        {nothingToday ? (
          <Empty title="Nothing logged yet" hint="Tap a quick action above to get started" />
        ) : (
          <div className="today-items">
            {todaySleep && <div className="today-item"><span className="today-dot" style={{ background: TYPE_DOT.sleep }} /><span className="today-text">{todaySleep.duration}h sleep · {todaySleep.quality.toLowerCase()}</span></div>}
            {todayDiet.map(m => <div key={m.id} className="today-item"><span className="today-dot" style={{ background: TYPE_DOT.diet }} /><span className="today-text">{m.time ? `${m.time} · ` : ""}{m.meal} · {m.calories} kcal · {m.food.slice(0, 28)}{m.food.length > 28 ? "…" : ""}</span></div>)}
            {todayWorkout && <div className="today-item"><span className="today-dot" style={{ background: TYPE_DOT.exercise }} /><span className="today-text">Workout · {todayWorkout.label}</span></div>}
            {todaySport && <div className="today-item"><span className="today-dot" style={{ background: TYPE_DOT.sports }} /><span className="today-text">{todaySport.sport} · {todaySport.duration}min</span></div>}
            {todaySupps.length > 0 && <div className="today-item"><span className="today-dot" style={{ background: TYPE_DOT.supplements }} /><span className="today-text">{todaySupps.length} supplement{todaySupps.length === 1 ? "" : "s"} · {todaySupps.map(s => s.name).join(", ")}</span></div>}
          </div>
        )}
      </Card>

      {/* ACHIEVEMENTS */}
      {(() => {
        const achievements = computeAchievements(data, goals, streak);
        const got = achievements.filter(x => x.got);
        const next = achievements.filter(x => !x.got).slice(0, 3);
        if (got.length === 0) return null;
        return (
          <Card title="Achievements" sub={`${got.length} of ${achievements.length} unlocked`}>
            <div className="ach-grid">
              {got.map(x => (
                <div key={x.id} className="ach got" title={x.title}>
                  <span className="ach-icon">{x.icon}</span>
                  <span className="ach-title">{x.title}</span>
                </div>
              ))}
              {next.map(x => (
                <div key={x.id} className="ach locked" title={x.title}>
                  <span className="ach-icon">{x.icon}</span>
                  <span className="ach-title">{x.title}</span>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}
    </div>
  );
}
const LOG_SUBTABS = [
  { key: "plan", label: "Plan" },
  { key: "diet", label: "Meal" },
  { key: "sleep", label: "Sleep" },
  { key: "exercise", label: "Workout" },
  { key: "sports", label: "Sport" },
  { key: "intake", label: "Intake" },
  { key: "nicotine", label: "Nicotine" },
];


function LogTab({ data, goals, addEntry, deleteEntry, initialSub, onSaveGoals, setData }) {
  const [sub, setSub] = useState(initialSub || "plan");
  useEffect(() => { if (initialSub) setSub(initialSub); }, [initialSub]);

  return (
    <div className="stack">
      <div className="subtabs">
        {LOG_SUBTABS.map(t => (
          <button key={t.key} className={`subtab ${sub === t.key ? "active" : ""}`} onClick={() => setSub(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {sub === "plan" && <PlanTab data={data} goals={goals} onSaveGoals={onSaveGoals} />}
      {sub === "diet" && <DietForm onAdd={addEntry("diet")} recent={data.diet} goals={goals} data={data} todayDiet={data.diet.filter(d => d.date === getTodayStr())} addEntry={addEntry} deleteEntry={deleteEntry} />}
      {sub === "sleep" && <SleepForm onAdd={addEntry("sleep")} recent={data.sleep} />}
      {sub === "exercise" && <><ExerciseForm onAdd={addEntry("exercise")} recent={data.exercise} /><WorkoutAnalysis data={data} goals={goals} /></>}
      {sub === "sports" && <SportsForm onAdd={addEntry("sports")} recent={data.sports} />}
      {sub === "intake" && <IntakeTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} />}
      {sub === "nicotine" && <NicotineTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} />}
    </div>
  );
}





// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function FitnessTracker() {
  // ─── Auth & sync state ──
  const [authChecked, setAuthChecked] = useState(false);
  const [session, setSession] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [bootKey, setBootKey] = useState(0); // bumped after cloud pull to reload local state

  // Check auth on mount + subscribe to changes
  useEffect(() => {
    if (!hasSupabase) { setAuthChecked(true); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // When a session appears, pull cloud data (or push local up if cloud is empty)
  useEffect(() => {
    if (!session?.user?.id) { setCurrentUser(null); return; }
    const uid = session.user.id;
    setCurrentUser(uid);
    (async () => {
      setSyncing(true);
      try {
        const pulled = await cloudPull(uid);
        if (!pulled) {
          // First time on this account → push whatever's in this browser up
          await cloudPushNow(uid);
        }
        setBootKey(k => k + 1); // reload local-derived state
      } catch (e) {}
      setSyncing(false);
    })();
  }, [session?.user?.id]);

  if (!authChecked) {
    return <><style>{styles}</style><div className="boot"><span className="spinner" /></div></>;
  }

  // If Supabase is configured but no session, show login
  if (hasSupabase && !session) {
    return <><style>{styles}</style><AuthScreen /></>;
  }

  return <AppShell key={bootKey} session={session} syncing={syncing} />;
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
function AuthScreen() {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (e) {
      setError(e.message || "Something went wrong. Try again.");
    }
    setBusy(false);
  }

  return (
    <div className="auth">
      <div className="auth-box">
        <h1 className="auth-brand">FitLog</h1>
        <p className="auth-sub">{mode === "signup" ? "Create your account" : "Welcome back"}</p>
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" autoComplete="email" /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} placeholder="••••••••" autoComplete={mode === "signup" ? "new-password" : "current-password"} /></label>
        {error && <div className="err">{error}</div>}
        <button className="btn full" onClick={submit} disabled={busy} style={{ marginTop: 14 }}>
          {busy ? <span className="spinner" /> : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <p className="auth-switch">
          {mode === "signup" ? "Already have an account?" : "New here?"}
          <button className="link-btn" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); }}>
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}

// ─── APP SHELL (the actual app once authed) ───────────────────────────────────
function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState("Build Muscle");
  const [calories, setCalories] = useState(2500);
  const [split, setSplit] = useState("Push / Pull / Legs");
  const [trainingDays, setTrainingDays] = useState(["Mon", "Tue", "Thu", "Fri", "Sat"]);
  const todayName = WEEKDAYS[(new Date().getDay() + 6) % 7];

  const macros = (() => {
    const c = calories;
    if (goal === "Build Muscle") return { protein: Math.round(c*.30/4), carbs: Math.round(c*.45/4), fat: Math.round(c*.25/9) };
    if (goal === "Lose Fat") return { protein: Math.round(c*.35/4), carbs: Math.round(c*.35/4), fat: Math.round(c*.30/9) };
    if (goal === "Improve Endurance") return { protein: Math.round(c*.20/4), carbs: Math.round(c*.55/4), fat: Math.round(c*.25/9) };
    if (goal === "Athletic Performance") return { protein: Math.round(c*.25/4), carbs: Math.round(c*.50/4), fat: Math.round(c*.25/9) };
    return { protein: Math.round(c*.25/4), carbs: Math.round(c*.45/4), fat: Math.round(c*.30/9) };
  })();

  function finish() {
    haptic([12, 30, 12]);
    SFX.success();
    onDone({ goal, calories, ...macros, plan: { split, trainingDays, assignments: {}, notes: "" } });
  }

  function toggleDay(d) {
    haptic(10);
    setTrainingDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)));
  }

  const steps = [
    // 0 — welcome
    <div key="w" className="ob-step">
      <div className="ob-logo">FitLog</div>
      <h2 className="ob-h">Welcome 👋</h2>
      <p className="ob-p">Your personal AI fitness tracker. Let's set you up in 30 seconds — you can change anything later.</p>
      <button className="btn full" onClick={() => setStep(1)}>Get started</button>
    </div>,
    // 1 — goal
    <div key="g" className="ob-step">
      <h2 className="ob-h">What's your main goal?</h2>
      <div className="ob-choices">
        {fitnessGoals.map(g => (
          <button key={g} className={`ob-choice ${goal === g ? "on" : ""}`} onClick={() => { setGoal(g); haptic(10); }}>{g}</button>
        ))}
      </div>
      <button className="btn full" onClick={() => setStep(2)}>Next</button>
    </div>,
    // 2 — calories
    <div key="c" className="ob-step">
      <h2 className="ob-h">Daily calorie target</h2>
      <p className="ob-p">A rough number is fine — your coach can help you dial it in later.</p>
      <div className="ob-cal">
        <button className="ob-step-btn" onClick={() => { setCalories(c => Math.max(1000, c - 100)); haptic(8); }}>−</button>
        <div className="ob-cal-val">{calories}<span>kcal</span></div>
        <button className="ob-step-btn" onClick={() => { setCalories(c => c + 100); haptic(8); }}>+</button>
      </div>
      <div className="ob-macros">Suggested: {macros.protein}g protein · {macros.carbs}g carbs · {macros.fat}g fat</div>
      <button className="btn full" onClick={() => setStep(3)}>Next</button>
    </div>,
    // 3 — split + days
    <div key="s" className="ob-step">
      <h2 className="ob-h">Your training week</h2>
      <label>Split<select value={split} onChange={e => setSplit(e.target.value)}>{SPLIT_TYPES.map(s => <option key={s}>{s}</option>)}</select></label>
      <div className="weekgrid-label">Which days can you train?</div>
      <div className="weekgrid">
        {WEEKDAYS.map(d => (
          <button key={d} className={`weekday ${trainingDays.includes(d) ? "on" : ""} ${d === todayName ? "today" : ""}`} onClick={() => toggleDay(d)}>{d}</button>
        ))}
      </div>
      <button className="btn full" style={{ marginTop: 16 }} onClick={finish}>Start tracking 🎉</button>
    </div>,
  ];

  return (
    <div className="ob">
      <div className="ob-box">
        {step > 0 && <div className="ob-progress">{[1,2,3].map(i => <span key={i} className={`ob-dot ${i <= step ? "on" : ""}`} />)}</div>}
        {steps[step]}
        {step > 0 && step < 3 && <button className="link-btn ob-back" onClick={() => setStep(step - 1)}>← Back</button>}
      </div>
    </div>
  );
}




// Brief welcome shown on every app entry. Auto-dismisses; tap to skip.
function WelcomeSplash({ session, goals, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const close = () => { if (leaving) return; setLeaving(true); setTimeout(onDone, 480); };
  useEffect(() => {
    const t = setTimeout(close, 2000);
    return () => clearTimeout(t);
  }, []);
  const h = new Date().getHours();
  const part = h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Late night grind";
  const raw = (session?.user?.email || "").split("@")[0] || "";
  const name = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "";
  const sub = goals?.goal || "Let's make today count";
  return (
    <div className={`welcome-splash${leaving ? " leaving" : ""}`} onClick={close}>
      <div className="welcome-inner">
        <div className="welcome-logo">FitLog</div>
        <div className="welcome-greet">{part}{name ? `, ${name}` : ""} 👋</div>
        <div className="welcome-sub">{sub}</div>
      </div>
    </div>
  );
}

// Full-screen sheet launched by the raised ＋. Shows logging options grouped by
// intent; tapping one opens that existing form. Reuses every form component.
function LogOverlay({ data, goals, addEntry, deleteEntry, onSaveGoals, setData, initial, onClose }) {
  const updateEntry = type => (id, patch) => setData(d => ({ ...d, [type]: (d[type] || []).map(e => e.id === id ? { ...e, ...patch } : e) }));
  const [view, setView] = useState(initial || null);
  const today = getTodayStr();
  const groups = [
    { title: "Goal", items: [
      { key: "goalplan", label: "Goal Plan", icon: "◎", color: "#7cc4a0" },
      { key: "plan", label: "Plan", icon: "▦", color: "#6ee7f7" },
    ] },
    { title: "Nutrition", items: [
      { key: "diet", label: "Meal", icon: "◉", color: "#f9c97e" },
      { key: "water", label: "Water", icon: "◊", color: "#5cc8df" },
      { key: "supps", label: "Supps", icon: "⊕", color: "#b4a8e8" },
    ] },
    { title: "Training", items: [
      { key: "exercise", label: "Workout", icon: "◆", color: "#f47e6e" },
      { key: "sports", label: "Sport", icon: "◇", color: "#8fd989" },
      { key: "weight", label: "Weight", icon: "◈", color: "#e8c97e" },
    ] },
    { title: "Wellness", items: [
      { key: "sleep", label: "Sleep", icon: "◐", color: "#6ee7f7" },
      { key: "nicotine", label: "Nicotine", icon: "●", color: "#d98fa8" },
      { key: "skin", label: "Skin", icon: "✦", color: "#e89ab0" },
      { key: "journal", label: "Journal", icon: "✎", color: "#9aa8e8" },
      { key: "ejac", label: "Private", icon: "◯", color: "#c9a2e8" },
    ] },
  ];
  const labelFor = k => { for (const g of groups) for (const it of g.items) if (it.key === k) return it.label; return "Log"; };

  const renderForm = () => {
    switch (view) {
      case "diet": return <DietForm onAdd={addEntry("diet")} recent={data.diet} goals={goals} data={data} todayDiet={data.diet.filter(d => d.date === today)} addEntry={addEntry} deleteEntry={deleteEntry} />;
      case "water": return <WaterForm data={data} goals={goals} onAdd={addEntry("water")} onDelete={deleteEntry("water")} />;
      case "supps": return <SupplementForm data={data} onAdd={addEntry("supplements")} onDelete={deleteEntry("supplements")} />;
      case "weight": return <WeightForm data={data} goals={goals} onAdd={addEntry("weight")} onDelete={deleteEntry("weight")} />;
      case "exercise": return <WorkoutScreen data={data} goals={goals} addEntry={addEntry} onSaveGoals={onSaveGoals} />;
      case "sports": return <SportsForm onAdd={addEntry("sports")} recent={data.sports} />;
      case "plan": return <PlanTab data={data} goals={goals} onSaveGoals={onSaveGoals} />;
      case "sleep": return <SleepSection data={data} goals={goals} addEntry={addEntry} onSaveGoals={onSaveGoals} />;
      case "nicotine": return <NicotineTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} />;
      case "journal": return <JournalTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} setData={setData} />;
      case "skin": return <SkinSection data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} updateEntry={updateEntry} onSaveGoals={onSaveGoals} />;
      case "goalplan": return <GoalPlanV3 data={data} goals={goals} onSaveGoals={onSaveGoals} addEntry={addEntry} deleteEntry={deleteEntry} />;
      case "ejac": return <EjacTab data={data} addEntry={addEntry} deleteEntry={deleteEntry} />;
      default: return null;
    }
  };

  return (
    <div className={`log-overlay${view === "skin" ? " skinlog-active" : ""}`}>
      <div className="log-overlay-head">
        <div className="log-overlay-head-inner">
          {view
            ? <button className="log-back" onClick={() => setView(null)}>‹ All</button>
            : <span className="log-overlay-title">Log anything</span>}
          <span className="log-overlay-mid">{view ? labelFor(view) : ""}</span>
          <button className="log-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>
      <div className="log-overlay-body">
        <div className="log-overlay-inner">
        {view ? renderForm() : (
          <div className="stack">
            <div className="muted small" style={{ marginBottom: 2 }}>Pick what you want to record</div>
            {groups.map(g => (
              <div key={g.title}>
                <div className="log-group-title">{g.title}</div>
                <div className="log-grid">
                  {g.items.map(it => (
                    <button key={it.key} className="log-tile" onClick={() => { SFX.tap(); haptic(8); setView(it.key); }}>
                      <span className="log-tile-icon" style={{ color: it.color }}>{it.icon}</span>
                      <span className="log-tile-label">{it.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

// ─── ME (profile + everything secondary, incl. the private tracker) ─────────
function MeTab({ data, goals, onSaveGoals, onClearAll, onImport, session, onSignOut, addEntry, deleteEntry }) {
  const [view, setView] = useState("menu"); // menu | settings | ejac
  const [section, setSection] = useState("goals");
  const open = (v, s) => { if (s) setSection(s); setView(v); window.scrollTo({ top: 0, behavior: "smooth" }); };

  if (view === "settings") {
    return (
      <div className="stack">
        <button className="log-back" onClick={() => setView("menu")}>‹ Me</button>
        <Suspense fallback={<div className="muted-center" style={{ padding: 40 }}><span className="spinner" /></div>}><SettingsTab data={data} goals={goals} onSaveGoals={onSaveGoals} onClearAll={onClearAll} onImport={onImport} session={session} onSignOut={onSignOut} initialSection={section} /></Suspense>
      </div>
    );
  }
  if (view === "ejac") {
    return (
      <div className="stack">
        <button className="log-back" onClick={() => setView("menu")}>‹ Me</button>
        <EjacTab data={data} addEntry={addEntry} deleteEntry={deleteEntry} />
      </div>
    );
  }

  const initial = (session?.user?.email || goals.goal || "•").trim()[0]?.toUpperCase() || "•";
  const strat = goals.strategy || {};
  const sub = [goals.goal, strat.phase || strat.focus].filter(Boolean).join(" · ");
  const Row = ({ icon, label, onClick }) => (
    <button className="me-row" onClick={onClick}>
      <span className="me-row-icon">{icon}</span>
      <span className="me-row-label">{label}</span>
      <span className="me-row-chev">›</span>
    </button>
  );

  return (
    <div className="stack">
      <div className="me-profile">
        <div className="me-avatar">{initial}</div>
        <div>
          <div className="me-name">{session?.user?.email || "Your profile"}</div>
          {sub && <div className="muted small" style={{ marginTop: 3 }}>{sub}</div>}
        </div>
      </div>

      <div>
        <div className="me-group-title">Setup</div>
        <div className="me-rows">
          <Row icon="⊙" label="Goals & targets" onClick={() => open("settings", "goals")} />
          <Row icon="◔" label="About me & strategy" onClick={() => open("settings", "goals")} />
        </div>
      </div>

      <div>
        <div className="me-group-title">Preferences</div>
        <div className="me-rows">
          <Row icon="✦" label="AI model & sound" onClick={() => open("settings", "goals")} />
        </div>
      </div>

      <div>
        <div className="me-group-title">Data &amp; private</div>
        <div className="me-rows">
          <Row icon="⬇" label="Export & backup" onClick={() => open("settings", "export")} />
          <Row icon="⌗" label="Manage data" onClick={() => open("settings", "data")} />
          <Row icon="◯" label="Private tracker" onClick={() => open("ejac")} />
        </div>
      </div>
    </div>
  );
}

function AppShell({ session, syncing }) {
  const [activeTab, setActiveTab] = useState("Home");
  const [logOpen, setLogOpen] = useState(false);
  const [logInitial, setLogInitial] = useState(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [data, setData] = useState(loadData);
  const [goals, setGoals] = useState(loadGoals);
  const firstData = useRef(true);
  const firstGoals = useRef(true);

  useEffect(() => {
    saveData(data);
    if (firstData.current) { firstData.current = false; return; }
    cloudSync();
  }, [data]);
  useEffect(() => {
    saveGoals(goals);
    if (firstGoals.current) { firstGoals.current = false; return; }
    cloudSync();
  }, [goals]);

  // Goal Plan → Meal Log: the active phase is the single source of truth for
  // nutrition targets. Sync calories/protein/carbs/fat into goals (which every
  // Meal Log reader uses) whenever the active phase changes — unless the user has
  // turned on Custom Nutrition Override.
  useEffect(() => {
    const gp = goals.goalPlanV3;
    if (!gp || !gp.active || !gp.phases || !gp.phases.length || goals.nutritionOverride) return;
    const ap = activePhaseV3(derivedPhases(gp, goals.profile || {}, getTodayStr()), getTodayStr());
    if (!ap || ap.calories == null) return;
    if (goals.calories === ap.calories && goals.protein === ap.protein && goals.carbs === ap.carbs && goals.fat === ap.fat) return;
    setGoals(g => ({ ...g, calories: ap.calories, protein: ap.protein, carbs: ap.carbs, fat: ap.fat }));
  }, [goals.goalPlanV3, goals.nutritionOverride, goals.profile]);

  const addEntry = type => entry => setData(d => ({ ...d, [type]: [entry, ...(d[type] || [])] }));
  const deleteEntry = type => id => setData(d => ({ ...d, [type]: (d[type] || []).filter(e => e.id !== id) }));
  const clearAll = () => {
    setData(defaultData);
    localStorage.removeItem(STORAGE_KEY + "_chat");
    cloudSync();
    setTimeout(() => window.location.reload(), 200);
  };
  const importData = backup => {
    if (backup.data) setData({ ...defaultData, ...backup.data });
    if (backup.goals) setGoals({ ...defaultGoals, ...backup.goals });
    if (backup.chat) localStorage.setItem(STORAGE_KEY + "_chat", JSON.stringify(backup.chat));
    cloudSync();
    setTimeout(() => window.location.reload(), 300);
  };

  async function signOut() {
    if (hasSupabase) await supabase.auth.signOut();
    window.location.reload();
  }

  function navTo(tab, sub) {
    if (tab === "Log") { setLogInitial(sub || null); setLogOpen(true); SFX.tap(); return; }
    setActiveTab(tab === "History" ? "Insights" : tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function openLog(view) { setLogInitial(view || null); setLogOpen(true); SFX.tap(); }
  function closeLog() { setLogOpen(false); setLogInitial(null); }
  function go(tab) { SFX.tap(); setActiveTab(tab); window.scrollTo({ top: 0, behavior: "smooth" }); }

  // First-run onboarding — show until the user completes it
  if (!goals.onboarded) {
    return (
      <>
        <style>{styles}</style>
        <ToastHost />
        <Onboarding onDone={(g) => setGoals(prev => ({ ...prev, ...g, onboarded: true }))} />
      </>
    );
  }

  return (
    <>
      <style>{styles}</style>
      <ToastHost />
      {showWelcome && <WelcomeSplash session={session} goals={goals} onDone={() => setShowWelcome(false)} />}
      <div className="app">
        <header className="topbar">
          <h1 className="brand">FitLog</h1>
          {syncing && <span className="sync-badge"><span className="spinner" />syncing</span>}
        </header>

        <main className="main">
          {activeTab === "Home" && <ErrorBoundary compact label="Home"><HomeTab data={data} goals={goals} onAddWater={addEntry("water")} onAddNicotine={addEntry("nicotine")} onNav={navTo} /></ErrorBoundary>}
          {activeTab === "Insights" && <ErrorBoundary compact label="Insights"><Suspense fallback={<div className="muted-center" style={{ padding: 40 }}><span className="spinner" /></div>}><HistoryTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} /></Suspense></ErrorBoundary>}
          {activeTab === "Coach" && <ErrorBoundary compact label="Coach"><Suspense fallback={<div className="muted-center" style={{ padding: 40 }}><span className="spinner" /></div>}><CoachTab data={data} goals={goals} /></Suspense></ErrorBoundary>}
          {activeTab === "Me" && <ErrorBoundary compact label="Me"><MeTab data={data} goals={goals} onSaveGoals={setGoals} onClearAll={clearAll} onImport={importData} session={session} onSignOut={signOut} addEntry={addEntry} deleteEntry={deleteEntry} /></ErrorBoundary>}
        </main>

        {logOpen && (
          <ErrorBoundary compact label="Log"><LogOverlay data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} onSaveGoals={setGoals} setData={setData} initial={logInitial} onClose={closeLog} /></ErrorBoundary>
        )}

        <nav className="tabbar tabbar-5">
          {["Home", "Insights"].map(tab => (
            <button key={tab} className={`tabbtn ${activeTab === tab ? "active" : ""}`} onClick={() => go(tab)}>
              <TabIcon name={tab} active={activeTab === tab} />
              <span className="tabbtn-label">{tab}</span>
            </button>
          ))}
          <button className="tab-plus" onClick={() => openLog(null)} aria-label="Log"><span className="tab-plus-glyph">＋</span></button>
          {["Coach", "Me"].map(tab => (
            <button key={tab} className={`tabbtn ${activeTab === tab ? "active" : ""}`} onClick={() => go(tab)}>
              <TabIcon name={tab} active={activeTab === tab} />
              <span className="tabbtn-label">{tab}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}

// ─── TAB ICONS (inline SVG, consistent across devices) ───────────────────────

function TabIcon({ name, active }) {
  const s = active ? "var(--accent)" : "var(--muted)";
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: s, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "Home") return <svg {...common}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" /></svg>;
  if (name === "Log") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>;
  if (name === "History") return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 4v4h4" /><path d="M12 8v4l3 2" /></svg>;
  if (name === "Coach") return <svg {...common}><path d="M12 3l2.1 5.4L19.5 9l-4 3.6 1.2 5.4L12 15.8 7.3 18l1.2-5.4L4.5 9l5.4-.6L12 3z" /></svg>;
  if (name === "Journal") return <svg {...common}><path d="M12 6.5C10.5 5 8 4.5 4 4.8v13c4-.3 6.5.2 8 1.7 1.5-1.5 4-2 8-1.7v-13c-4-.3-6.5.2-8 1.7z" /><path d="M12 6.5V19" /></svg>;
  if (name === "Settings") return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>;
  if (name === "Insights") return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 4v4h4" /><path d="M12 8v4l3 2" /></svg>;
  if (name === "Me") return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" /></svg>;
  if (name === "Ejac") return <svg {...common}><path d="M12 3c4 5 6.5 8.5 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 11.5 8 8 12 3z" /></svg>;
  return null;
}

