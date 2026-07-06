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


// ─── GOAL PLAN (Phase 1: goal + reality check + trajectory + constraints) ────
const GOAL_TYPES = [
  { k: "leanbulk", label: "Lean Bulk" }, { k: "cut", label: "Cut" }, { k: "minicut", label: "Mini Cut" },
  { k: "recomp", label: "Recomp" }, { k: "maintenance", label: "Maintenance" }, { k: "strength", label: "Strength" }, { k: "health", label: "Health" },
];
const GP_TABS = [{ k: "overview", label: "Overview" }, { k: "road", label: "Roadmap" }, { k: "traj", label: "Trajectory" }, { k: "fore", label: "Forecast" }, { k: "report", label: "Reports" }, { k: "history", label: "History" }];
const GP_EXP = [{ k: "novice", label: "Novice (<1yr)" }, { k: "intermediate", label: "Intermediate" }, { k: "advanced", label: "Advanced (3yr+)" }];


function GoalForm({ goals, currentWeight, onSave, onCancel, hideImport }) {
  const gp = goals.goalPlan || {};
  const [type, setType] = useState(gp.type || "leanbulk");
  const [startWeight, setSW] = useState(gp.startWeight ?? currentWeight ?? "");
  const [goalWeight, setGW] = useState(gp.goalWeight ?? "");
  const [startDate, setStart] = useState(gp.startDate || getTodayStr());
  const [targetDate, setTarget] = useState(gp.targetDate || "");
  const [experience, setExp] = useState(gp.experience || "intermediate");
  const [freq, setFreq] = useState(gp.freq ?? 4);
  const [importedMacros, setImportedMacros] = useState(null);
  const [importedRoadmap, setImportedRoadmap] = useState(null);
  const [importMsg, setImportMsg] = useState(null);
  const [pasteText, setPasteText] = useState("");
  const [parsePreview, setParsePreview] = useState(null);
  const [fileStatus, setFileStatus] = useState(null);
  const [applied, setApplied] = useState(false);

  const buildGoalPayload = p => {
    const today = getTodayStr();
    const gw = p.goalWeight ?? (p.phases.length ? p.phases[p.phases.length - 1].goalWeight : null);
    const td = p.targetDate ?? (p.phases.length ? p.phases[p.phases.length - 1].endDate : null);
    if (gw == null || !td) return null;
    const payload = { ...goals, goalPlan: { type: p.type || (goals.goalPlan && goals.goalPlan.type) || "leanbulk", startWeight: (p.startWeight ?? currentWeight ?? null), goalWeight: gw, startDate: p.startDate || today, targetDate: td, experience, freq: p.freq || +freq || 4, priorities: (goals.goalPlan && goals.goalPlan.priorities) || [] } };
    if (p.hasRoadmap) {
      payload.goalPlan.phases = buildRoadmapPhases(p, today);
      payload.goalPlan.roadmap = { checkpoints: p.checkpoints, deloads: p.deloads, rules: p.rules, longTerm: p.longTerm, meta: p.meta, strategyNotes: p.strategyNotes || [], sourceMarkdown: p.sourceMarkdown || null, importedAt: today };
    }
    if (p.macros) { if (p.macros.calories) payload.calories = p.macros.calories; if (p.macros.protein) payload.protein = p.macros.protein; if (p.macros.carbs) payload.carbs = p.macros.carbs; if (p.macros.fat) payload.fat = p.macros.fat; }
    // If the plan carries phase-level calories, let the active phase drive Log Meal
    // targets automatically (they re-adjust as you move through phases). Otherwise
    // any flat imported macros are a one-off manual set.
    const hasPhaseCals = p.hasRoadmap && p.phases.some(x => x.calories);
    payload.macroMode = hasPhaseCals ? "auto" : (p.macros ? "manual" : (goals.macroMode || "manual"));
    return payload;
  };

  const commitImport = p => {
    const payload = buildGoalPayload(p);
    if (!payload) { toast("Add a goal weight + target date below first"); return; }
    onSave(payload);
    const bits = [];
    if (p.hasRoadmap) bits.push(`${p.phases.length} phases`);
    if (payload.macroMode === "auto") bits.push("macros now auto from your active phase");
    else if (p.macros && (p.macros.calories || p.macros.protein)) bits.push("macros set");
    toast(bits.length ? `✦ Applied — ${bits.join(", ")}. Open the Roadmap tab.` : "✦ Goal imported");
    haptic(12);
  };

  // Parse text, and if it's a usable plan, APPLY it immediately (build the roadmap)
  // — the preview card then stays up as confirmation of what was applied.
  const handlePlanText = (text, src, autoApply) => {
    let p;
    try { p = parseGoalMarkdown(text || ""); }
    catch (err) { setImportMsg("Couldn't parse that — error: " + (err && err.message)); setParsePreview(null); setFileStatus(`⚠ Error parsing ${src || "text"}`); return; }
    if (!p || !p.anyFound) { setImportMsg(`Read ${src || "the text"} (${(text || "").length} chars) but found no recognisable plan. It needs weights like "74 → 77 kg", dates, calories, or phase headings.`); setParsePreview(null); setFileStatus(`⚠ Read ${(text || "").length} chars — no plan recognised`); return; }
    if (p.type) setType(p.type);
    if (p.startWeight != null) setSW(p.startWeight);
    if (p.goalWeight != null) setGW(p.goalWeight);
    if (p.startDate) setStart(p.startDate);
    if (p.targetDate) setTarget(p.targetDate);
    if (p.freq) setFreq(p.freq);
    setImportedMacros(p.macros || null);
    setImportedRoadmap(p.hasRoadmap ? p : null);
    setParsePreview(p);
    setImportMsg(null);
    if (!autoApply) setApplied(false);
    haptic(8);
    // auto-apply if we can build a full goal payload from it (roadmap or weight+date)
    const payload = buildGoalPayload(p);
    if (autoApply && payload) {
      onSave(payload);
      setApplied(true);
      const bits = [];
      if (p.hasRoadmap) bits.push(`${p.phases.length}-phase roadmap built`);
      if (payload.macroMode === "auto") bits.push("macros auto-set");
      toast(bits.length ? `✦ Applied — ${bits.join(", ")}. See the Roadmap tab.` : "✦ Plan applied");
      setFileStatus(`✓ Applied ${src || "plan"} — ${p.hasRoadmap ? `${p.phases.length} phases` : "goal"} set. Open the Roadmap tab.`);
    } else {
      setFileStatus(`✓ Parsed ${src || "text"} — ${p.hasRoadmap ? `${p.phases.length} phases` : "goal"} recognised${payload ? "" : " (add a goal weight + date below to apply)"}`);
    }
  };

  const onImportFile = e => {
    const f = e.target.files && e.target.files[0];
    if (!f) { setImportMsg("No file received — try again, or paste the text below."); setFileStatus("⚠ No file received"); return; }
    setFileStatus(`Reading "${f.name}"…`);
    const reader = new FileReader();
    reader.onerror = () => { setImportMsg("Couldn't read that file — try pasting the text instead."); setFileStatus(`⚠ Couldn't read "${f.name}"`); };
    reader.onload = () => handlePlanText(String(reader.result || ""), `"${f.name}"`, true); // upload → auto-apply
    reader.readAsText(f);
    e.target.value = "";
  };
  function save() {
    if (!goalWeight || !targetDate) { toast("Add a goal weight and target date"); return; }
    const payload = { ...goals, goalPlan: { type, startWeight: +startWeight || currentWeight || null, goalWeight: +goalWeight, startDate, targetDate, experience, freq: +freq || 4, priorities: gp.priorities || [] } };
    const existing = goals.goalPlan && goals.goalPlan.phases;
    const isImported = existing && existing.some(p => p.origin === "import");
    if (importedRoadmap && importedRoadmap.hasRoadmap) {
      const today = getTodayStr();
      payload.goalPlan.phases = buildRoadmapPhases(importedRoadmap, today);
      payload.goalPlan.roadmap = { checkpoints: importedRoadmap.checkpoints, deloads: importedRoadmap.deloads, rules: importedRoadmap.rules, longTerm: importedRoadmap.longTerm, meta: importedRoadmap.meta, strategyNotes: importedRoadmap.strategyNotes || [], sourceMarkdown: importedRoadmap.sourceMarkdown || null, importedAt: today };
    } else if (isImported) {
      // editing an imported plan — keep its phases + source doc intact
      payload.goalPlan.phases = existing;
      payload.goalPlan.roadmap = goals.goalPlan.roadmap || null;
    } else {
      // Build-Plan path: FitLog generates the phase roadmap automatically
      const gen = generatePhases(payload.goalPlan, getTodayStr());
      if (gen.length) payload.goalPlan.phases = gen;
      payload.goalPlan.roadmap = null;
    }
    if (importedMacros) {
      if (importedMacros.calories) payload.calories = importedMacros.calories;
      if (importedMacros.protein) payload.protein = importedMacros.protein;
      if (importedMacros.carbs) payload.carbs = importedMacros.carbs;
      if (importedMacros.fat) payload.fat = importedMacros.fat;
      payload.macroMode = "manual"; // these came from the imported plan
    }
    onSave(payload);
    toast("◎ Goal saved"); haptic(8);
  }
  return (
    <Card title={gp.goalWeight ? "Edit your goal" : "Set your goal"} sub={hideImport ? "define your plan — FitLog builds the phases" : "build it here, or import a plan from a .md file"}>
      {!hideImport && (<div className="gp-field"><label>Import a plan</label>
        <input type="file" onChange={onImportFile} style={{ fontSize: 13 }} />
        <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="…or paste your plan text here, then tap Parse" rows={3} style={{ width: "100%", marginTop: 8, resize: "vertical", background: "transparent", color: "inherit", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
        <button type="button" className="btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => handlePlanText(pasteText, "pasted text")}>Parse pasted plan</button>
        {fileStatus && <p className="small" style={{ marginTop: 8, lineHeight: 1.4, color: fileStatus.startsWith("✓") ? "#8fd989" : fileStatus.startsWith("⚠") ? "#f47e6e" : "var(--text-2)" }}>{fileStatus}</p>}
        {importMsg && <p className="small" style={{ marginTop: 8, lineHeight: 1.45, color: "#f9c97e" }}>{importMsg}</p>}
        {parsePreview && (
          <div style={{ marginTop: 10, padding: 12, border: "1px solid var(--line)", borderRadius: 10 }}>
            <div className="small" style={{ fontWeight: 600, color: "#8fd989" }}>✓ Found a plan — here's what I read</div>
            {Array.isArray(parsePreview.summary) && parsePreview.summary.length > 0 && (
              <ul style={{ margin: "7px 0 4px", paddingLeft: 18, lineHeight: 1.6 }}>
                {parsePreview.summary.map((s, i) => <li key={i} className="small" style={{ color: "var(--text-2)" }}>{s}</li>)}
              </ul>
            )}
            {parsePreview.phases.length > 0 && (
              <div style={{ marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                {parsePreview.phases.map((p, i) => (
                  <div key={i} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0", color: "var(--text-2)" }}>
                    <span>{p.name || p.type}</span>
                    <span className="muted" style={{ whiteSpace: "nowrap" }}>{p.startDate ? p.startDate.slice(5) : "?"}→{p.endDate ? p.endDate.slice(5) : "?"}{p.calories ? ` · ${p.calories}kcal` : ""}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>{applied ? "Set: your goal weight, dates" : "Applying sets your goal weight, dates"}{parsePreview.hasRoadmap ? ", phases and Roadmap" : ""}{parsePreview.phases.some(p => p.calories) ? ", and switches macros to auto (your active phase drives Log Meal)" : (parsePreview.macros ? ", and your macro targets" : "")}. Recognised: {parsePreview.found.join(", ")}.</p>
            {applied ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <span className="small" style={{ fontWeight: 600, color: "#8fd989" }}>✓ Applied — open the Roadmap tab to see it</span>
                <button type="button" className="btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => { setParsePreview(null); setImportMsg(null); setFileStatus(null); setApplied(false); }}>Dismiss</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button type="button" className="btn-primary btn-sm" onClick={() => { commitImport(parsePreview); setApplied(true); }}>Apply to my goal</button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setParsePreview(null); setImportMsg(null); setFileStatus(null); setApplied(false); }}>Clear</button>
              </div>
            )}
          </div>
        )}
        <p className="muted small" style={{ marginTop: 6, lineHeight: 1.4 }}>Upload or paste a plan written by Claude (or anyone). A multi-phase roadmap imports straight into your goal and Roadmap tab.</p>
      </div>)}
      <div className="gp-field"><label>Goal type</label><div className="gp-chips">{GOAL_TYPES.map(t => <button key={t.k} className={`gp-chip ${type === t.k ? "on" : ""}`} onClick={() => setType(t.k)}>{t.label}</button>)}</div></div>
      <div className="gp-row2">
        <div className="gp-field"><label>Start weight (kg)</label><input type="number" inputMode="decimal" value={startWeight} onChange={e => setSW(e.target.value)} placeholder={currentWeight ? String(currentWeight) : "—"} /></div>
        <div className="gp-field"><label>Goal weight (kg)</label><input type="number" inputMode="decimal" value={goalWeight} onChange={e => setGW(e.target.value)} placeholder="—" /></div>
      </div>
      <div className="gp-row2">
        <div className="gp-field"><label>Start date</label><input type="date" value={startDate} onChange={e => setStart(e.target.value)} /></div>
        <div className="gp-field"><label>Target date</label><input type="date" value={targetDate} onChange={e => setTarget(e.target.value)} /></div>
      </div>
      <div className="gp-field"><label>Training experience</label><div className="gp-chips">{GP_EXP.map(t => <button key={t.k} className={`gp-chip ${experience === t.k ? "on" : ""}`} onClick={() => setExp(t.k)}>{t.label}</button>)}</div></div>
      <div className="gp-field"><label>Training days / week</label><input type="number" inputMode="numeric" value={freq} onChange={e => setFreq(e.target.value)} /></div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button className="btn full" onClick={save}>{hideImport && !gp.goalWeight ? "Generate Plan" : "Save goal"}</button>
        {onCancel && <button className="btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </Card>
  );
}

function TrajectoryChart({ traj, pts }) {
  if (!traj) return null;
  const W = 320, H = 150, pad = { l: 30, r: 12, t: 12, b: 18 };
  const tw = traj.totalWeeks || 1;
  const ys = [traj.startWeight, traj.goalWeight, traj.actualNow, traj.projectedEnd, ...pts.map(p => p.y)].filter(v => v != null);
  let ymin = Math.min(...ys), ymax = Math.max(...ys); if (ymin === ymax) { ymin -= 1; ymax += 1; }
  const padY = (ymax - ymin) * 0.12 || 1; ymin -= padY; ymax += padY;
  const X = x => pad.l + (Math.max(0, Math.min(tw, x)) / tw) * (W - pad.l - pad.r);
  const Y = y => pad.t + (1 - (y - ymin) / (ymax - ymin)) * (H - pad.t - pad.b);
  const expLine = `M ${X(0)} ${Y(traj.startWeight)} L ${X(tw)} ${Y(traj.goalWeight)}`;
  const actLine = pts.length ? "M " + pts.map(p => `${X(p.x)} ${Y(p.y)}`).join(" L ") : "";
  const projLine = (traj.actualNow != null && traj.projectedEnd != null) ? `M ${X(traj.elapsed)} ${Y(traj.actualNow)} L ${X(tw)} ${Y(traj.projectedEnd)}` : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="gp-chart" preserveAspectRatio="none">
      <line x1={X(traj.elapsed)} y1={pad.t} x2={X(traj.elapsed)} y2={H - pad.b} stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3 3" />
      <path d={expLine} stroke="var(--muted)" strokeWidth="1.5" fill="none" strokeDasharray="5 4" />
      {projLine && <path d={projLine} stroke="#f9c97e" strokeWidth="1.5" fill="none" strokeDasharray="2 3" />}
      {actLine && <path d={actLine} stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {pts.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r="2.2" fill="var(--accent)" />)}
      <text x={pad.l - 4} y={Y(ymax) + 4} textAnchor="end" className="gp-axis">{Math.round(ymax)}</text>
      <text x={pad.l - 4} y={Y(ymin)} textAnchor="end" className="gp-axis">{Math.round(ymin)}</text>
    </svg>
  );
}

function GoalRoadmapTab({ goals, currentWeight }) {
  const gp = goals.goalPlan || {};
  const phases = getPhases(goals.goalPlan);
  const rm = gp.roadmap || null;
  const cw = currentWeight ?? (goals.profile && parseFloat(goals.profile.weightKg)) ?? null;
  const analysis = useMemo(() => analyzeRoadmap({ phases, currentWeight: cw, experience: gp.experience || "intermediate" }), [phases, cw, gp.experience]);
  const [showSource, setShowSource] = useState(false);
  if (!phases.length && !rm) return <Card><Empty icon="◎" title="No roadmap yet" hint="Import a .md plan from the Plan tab (Edit your goal → Import a plan). A multi-phase roadmap with checkpoints, deloads and long-term targets will appear here." /></Card>;
  const PHASE_C = { active: "#5cc8df", done: "#8fd989", planned: "#aab2c0" };
  const VC = { realistic: ["Realistic", "#8fd989"], aggressive: ["Aggressive", "#f9c97e"], unrealistic: ["Unrealistic", "#f47e6e"] };
  const aByIdx = i => (analysis && analysis.phases[i]) || null;
  return (
    <>
      {analysis && (
        <Card title="Plan analysis" sub="evidence-based reality check, per phase" action={<span className="gp-verdict" style={{ fontSize: 12, padding: "2px 10px", color: (VC[analysis.planVerdict] || VC.realistic)[1], borderColor: `${(VC[analysis.planVerdict] || VC.realistic)[1]}55` }}>{(VC[analysis.planVerdict] || VC.realistic)[0]}</span>}>
          <div className="gp-stat-row"><span className="muted small">Phases</span><span>{analysis.count} · {Object.entries(analysis.typeCounts).map(([k, n]) => `${n}×${(GOAL_TYPES.find(x => x.k === k) || {}).label || k}`).join(", ")}</span></div>
          {analysis.totalWeeks > 0 && <div className="gp-stat-row"><span className="muted small">Total span</span><span>{Math.round(analysis.totalWeeks)} weeks (~{Math.round(analysis.totalWeeks / 4.345)} mo) <TierBadge tier="calc" /></span></div>}
          {analysis.risks.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <div className="small" style={{ fontWeight: 600, color: "#f9c97e", marginBottom: 4 }}>⚠ {analysis.risks.length} risk{analysis.risks.length > 1 ? "s" : ""} flagged</div>
              {analysis.risks.map((r, i) => <p key={i} className="small" style={{ lineHeight: 1.45, margin: "3px 0", color: "var(--text-2)" }}>• {r}</p>)}
            </div>
          ) : <p className="small" style={{ marginTop: 8, color: "#8fd989" }}>✓ Every phase sits within evidence-based rate ceilings.</p>}
          <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>Verdicts compare each phase's pace to lean-gain / sustainable-loss ceilings for an {gp.experience || "intermediate"} lifter. Muscle/fat splits are modeled ranges, not measured.</p>
        </Card>
      )}
      {phases.length > 0 && (
        <Card title="Phases" sub={rm ? "imported from your plan" : "your roadmap"}>
          {phases.map((p, i) => {
            const an = aByIdx(i);
            return (
              <div key={p.id || i} style={{ padding: "10px 0", borderBottom: i < phases.length - 1 ? "1px solid var(--line)" : "none" }}>
                <div className="gp-stat-row">
                  <span style={{ fontWeight: 600 }}>{p.name || (GOAL_TYPES.find(x => x.k === p.type) || {}).label || p.type}</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {an && an.verdict && an.verdict !== "realistic" && <span className="small" style={{ color: (VC[an.verdict] || VC.realistic)[1] }}>{(VC[an.verdict] || VC.realistic)[0]}</span>}
                    <span className="small" style={{ color: PHASE_C[p.status] || "#aab2c0" }}>{p.status === "active" ? "● now" : p.status === "done" ? "done" : "planned"}</span>
                  </span>
                </div>
                <div className="muted small" style={{ marginTop: 2 }}>{p.startDate || "—"} → {p.endDate || "—"}{p.startWeight != null && p.goalWeight != null ? ` · ${p.startWeight}→${p.goalWeight}kg` : ""}{an && an.targetRate != null ? ` · ${an.targetRate > 0 ? "+" : ""}${an.targetRate}kg/wk` : ""}{p.calories ? ` · ${p.calories} kcal` : ""}{p.protein ? ` · ${p.protein}g P` : ""}</div>
                {p.focus && <div className="small" style={{ marginTop: 3, color: "var(--text-2)" }}>◎ Focus: {p.focus}</div>}
                {an && an.note && <div className="muted small" style={{ marginTop: 3, lineHeight: 1.4 }}>{an.note}</div>}
                {an && an.risks && an.risks.length > 0 && an.risks.map((r, ri) => <div key={ri} className="small" style={{ marginTop: 2, color: "#f9c97e" }}>⚠ {r}</div>)}
              </div>
            );
          })}
        </Card>
      )}
      {rm && rm.checkpoints && rm.checkpoints.length > 0 && (
        <Card title="Monthly checkpoints" sub="weekly-average weight targets">
          {rm.checkpoints.map((c, i) => <div key={i} className="gp-stat-row"><span className="muted small">{c.label || c.date}</span><span>{c.target}kg{c.note ? ` · ${c.note}` : ""}</span></div>)}
          <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>Under target → add ~150–200 cal; over → drop ~150–200. The number serves the rate.</p>
        </Card>
      )}
      {rm && rm.deloads && rm.deloads.length > 0 && (
        <Card title="Deload schedule" sub="plateau insurance — don't skip">
          {rm.deloads.map((d, i) => <div key={i} className="gp-stat-row"><span className="muted small">Deload {i + 1}</span><span>{d}</span></div>)}
        </Card>
      )}
      {rm && rm.rules && rm.rules.length > 0 && (
        <Card title="Decision & tracking rules">
          {rm.rules.map((r, i) => <p key={i} className="small" style={{ lineHeight: 1.5, margin: "6px 0" }}>• {r}</p>)}
        </Card>
      )}
      {rm && rm.longTerm && Object.keys(rm.longTerm).length > 0 && (
        <Card title="Long-term target" sub="where this leg leads">
          {rm.longTerm.currentFFMI && <div className="gp-stat-row"><span className="muted small">FFMI now</span><span>~{rm.longTerm.currentFFMI} <TierBadge tier="estimate" /></span></div>}
          {rm.longTerm.targetFFMI && <div className="gp-stat-row"><span className="muted small">Target FFMI</span><span>{rm.longTerm.targetFFMI}</span></div>}
          {rm.longTerm.targetWeight && <div className="gp-stat-row"><span className="muted small">Target lean weight</span><span>{rm.longTerm.targetWeight} kg</span></div>}
          {rm.longTerm.leanToAdd && <div className="gp-stat-row"><span className="muted small">Lean mass to add</span><span>{rm.longTerm.leanToAdd}</span></div>}
          {rm.longTerm.timeline && <div className="gp-stat-row"><span className="muted small">Realistic timeline</span><span>{rm.longTerm.timeline} <TierBadge tier="forecast" /></span></div>}
          <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>FFMI targets rest on an estimated body-fat %; a DEXA scan would be the Tier-1 anchor.</p>
        </Card>
      )}
      {rm && rm.meta && (rm.meta.heightCm || rm.meta.maintenance || rm.meta.startWeight) && (
        <Card title="Plan baseline">
          {rm.meta.heightCm && <div className="gp-stat-row"><span className="muted small">Height</span><span>{rm.meta.heightCm} cm</span></div>}
          {rm.meta.startWeight && <div className="gp-stat-row"><span className="muted small">Start weight</span><span>{rm.meta.startWeight} kg</span></div>}
          {rm.meta.bodyFatPct && <div className="gp-stat-row"><span className="muted small">Body fat</span><span>~{rm.meta.bodyFatPct}%</span></div>}
          {rm.meta.maintenance && <div className="gp-stat-row"><span className="muted small">Maintenance</span><span>~{rm.meta.maintenance} kcal <TierBadge tier="estimate" /></span></div>}
          {rm.importedAt && <p className="muted small" style={{ marginTop: 8 }}>Imported {rm.importedAt} from your .md plan.</p>}
        </Card>
      )}
      {rm && rm.strategyNotes && rm.strategyNotes.length > 0 && (
        <Card title="Strategy notes" sub="kept from your plan">
          {rm.strategyNotes.map((n, i) => <p key={i} className="small" style={{ lineHeight: 1.5, margin: "6px 0" }}>• {n}</p>)}
        </Card>
      )}
      {rm && rm.sourceMarkdown && (
        <Card title="Original plan" sub="the full document, preserved" action={<button className="btn-ghost btn-sm" onClick={() => setShowSource(s => !s)}>{showSource ? "Hide" : "Show"}</button>}>
          {showSource
            ? <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, lineHeight: 1.5, color: "var(--text-2)", margin: 0, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", maxHeight: 360, overflow: "auto" }}>{rm.sourceMarkdown}</pre>
            : <p className="muted small" style={{ margin: 0 }}>Your imported plan is stored in full ({rm.sourceMarkdown.length} chars){rm.importedAt ? ` · imported ${rm.importedAt}` : ""}. Tap Show to read it.</p>}
        </Card>
      )}
    </>
  );
}

const BAND_COLOR = { "On track": "#8fd989", "Strong": "#8fd989", "Steady": "#5cc8df", "Drifting": "#f9c97e", "Stalling": "#f9c97e", "Off track": "#f47e6e", "Reversing": "#f47e6e", "no-data": "#aab2c0" };
const barColor = s => s == null ? "#aab2c0" : s < 60 ? "#f47e6e" : s < 80 ? "#f9c97e" : "#8fd989";

function GoalStateTab({ data, goals, onSaveGoals, addEntry, deleteEntry }) {
  const today = getTodayStr();
  const state = useMemo(() => computePhysiologyState(data, goals, today), [data, goals, today]);
  const proposal = useMemo(() => proposeAdaptation(state, goals.goalPlan, today, data.completedPhases || []), [state, goals.goalPlan, data.completedPhases, today]);
  const phases = getPhases(goals.goalPlan);

  if (!state.hasGoal) return <Card><Empty icon="◎" title="Set a goal first" hint="Your physiology state reads against an active goal phase — add a goal weight and date in the Plan tab." /></Card>;

  const al = state.alignment, mo = state.momentum, debt = state.recoveryDebt;

  const applyProposal = p => {
    const newPhases = applyPhaseChange(goals.goalPlan, p.change);
    onSaveGoals({ ...goals, goalPlan: { ...goals.goalPlan, phases: newPhases, lastAdaptation: today } });
    const isDebt = p.kind === "insert-deload";
    addEntry("decisionLog")({
      id: Date.now(), date: today, source: "adaptation", rec: { kind: p.kind },
      metric: isDebt ? "recoveryDebt" : "weightRate", expectedDir: -1,
      baselineValue: isDebt ? debt.value : state.actualRate,
      takenInferred: null, followupValue: null, deltaAfter: null, verdict: null,
    });
    haptic(12); toast("✦ Strategy updated — logged for follow-up");
  };

  const logPhaseResult = ph => {
    const res = computePhaseResult(ph, data);
    addEntry("completedPhases")(res); haptic(10); toast("✦ Phase logged to strategy memory");
  };

  const decSummary = summarizeDecisions(evaluateDecisions(data.decisionLog || [], { weightRate: state.actualRate, recoveryDebt: debt.value }, today));
  const donePhases = phases.filter(p => p.status === "done");
  const loggedIds = new Set((data.completedPhases || []).map(r => r.id));

  return (
    <>
      {/* ── ADAPTATION ── */}
      {proposal ? (
        <Card title="Strategic adaptation" className="gp-primary">
          {proposal.actionable ? (
            <>
              <div className="gp-verdict" style={{ color: "#f9c97e", borderColor: "#f9c97e55" }}>Suggested change <TierBadge tier="forecast" /></div>
              <p className="small" style={{ lineHeight: 1.55, marginTop: 8 }}>{proposal.rationale}</p>
              {proposal.memoryNote && <p className="muted small" style={{ marginTop: 6, lineHeight: 1.5 }}>{proposal.memoryNote}</p>}
              {proposal.newRoadmapPreview && (
                <div style={{ marginTop: 10 }}>
                  <div className="muted small" style={{ marginBottom: 4 }}>New roadmap</div>
                  {proposal.newRoadmapPreview.map((ph, i) => <div key={i} className="gp-stat-row"><span className="muted small">{(GOAL_TYPES.find(x => x.k === ph.type) || {}).label || ph.type}{ph.status === "active" ? " · now" : ph.status === "done" ? " · done" : ""}</span><span className="small">{ph.startDate} → {ph.endDate}</span></div>)}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn-primary btn-sm" onClick={() => applyProposal(proposal)}>Apply change</button>
                <button className="btn-ghost btn-sm" onClick={() => { onSaveGoals({ ...goals, goalPlan: { ...goals.goalPlan, lastAdaptation: today } }); toast("Dismissed for now"); }}>Not now</button>
              </div>
              <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>Proposed, not automatic. This is a forecast-grade suggestion from your trend — you decide.</p>
            </>
          ) : (
            <>
              <div className="gp-verdict" style={{ color: "#5cc8df", borderColor: "#5cc8df55" }}>{proposal.kind === "fix-adherence" ? "Fix execution first" : proposal.kind === "wait" ? "Watching" : "Settling"}</div>
              <p className="small" style={{ lineHeight: 1.55, marginTop: 8 }}>{proposal.rationale}</p>
            </>
          )}
        </Card>
      ) : (
        <Card><div className="gp-verdict" style={{ color: "#8fd989", borderColor: "#8fd98955" }}>Hold course</div><p className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>No strategy change recommended — your trend is tracking the plan. Keep going.</p></Card>
      )}

      {/* ── ALIGNMENT (process) ── */}
      <Card title="Goal alignment" sub="are your inputs serving the goal right now">
        <div className="gp-verdict" style={{ color: BAND_COLOR[al.band] || "#aab2c0", borderColor: `${BAND_COLOR[al.band] || "#aab2c0"}55` }}>{al.band === "no-data" ? "Not enough data" : al.band} <TierBadge tier="estimate" /></div>
        <div style={{ marginTop: 10 }}>
          {[["Trajectory", al.components.trajectory], ["Training", al.components.training], ["Nutrition", al.components.nutrition], ["Recovery", al.components.recovery]].map(([label, s]) => (
            <div key={label} className="gp-lever">
              <div className="gp-lever-top"><span className="gp-lever-name">{label}</span><span className="gp-lever-score">{s == null ? "—" : s}</span></div>
              <div className="gp-lever-bar"><div className="gp-lever-fill" style={{ width: `${s || 0}%`, background: barColor(s) }} /></div>
            </div>
          ))}
        </div>
        {al.riskAdj < 0 && <p className="muted small" style={{ marginTop: 8 }}>Risk adjustment: {al.riskAdj} (rate or recovery flag docking the overall)</p>}
        {al.advice && al.advice.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="muted small" style={{ marginBottom: 4 }}>Why it's low, and the highest-leverage fix</div>
            {al.advice.map((ad, i) => (
              <div key={i} style={{ padding: "7px 0", borderTop: "1px solid var(--line)" }}>
                <div className="small" style={{ lineHeight: 1.45 }}><b>{ad.lever}</b>{ad.score != null ? ` · ${ad.score}` : ""} — {ad.why}</div>
                <div className="small" style={{ marginTop: 2, color: "#8fd989", lineHeight: 1.45 }}>→ {ad.fix}</div>
              </div>
            ))}
          </div>
        )}
        <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>Alignment is process quality — the band and the bars matter more than any single number.</p>
      </Card>

      {/* ── MOMENTUM (outcome) ── */}
      <Card title="Strategic momentum" sub="are you actually moving toward the goal">
        <div className="gp-verdict" style={{ color: BAND_COLOR[mo.band] || "#aab2c0", borderColor: `${BAND_COLOR[mo.band] || "#aab2c0"}55` }}>{mo.band === "no-data" ? "Not enough data" : mo.band} <TierBadge tier="estimate" /></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <span className="carb-chip mixed">Gap: {mo.components.gapClosing || "—"}</span>
          <span className="carb-chip mixed">Strength: {mo.components.strength || "—"}</span>
          <span className="carb-chip mixed">Recovery: {mo.components.recovery || "—"}</span>
        </div>
        {mo.divergenceNote && <p className="small" style={{ marginTop: 10, lineHeight: 1.55, color: "#8fd989" }}>✓ {mo.divergenceNote}</p>}
        <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>Momentum reads outcomes, not checkboxes. On-track outcomes outrank a missed target.</p>
      </Card>

      {/* ── RECOVERY DEBT (relative) ── */}
      <Card title="Recovery debt" sub="fatigue accumulating vs clearing">
        {debt.hasData ? (
          <>
            <div className="gp-verdict" style={{ color: debt.trend === "rising" ? "#f47e6e" : debt.trend === "falling" ? "#8fd989" : "#5cc8df", borderColor: "#5cc8df55" }}>{debt.trend === "rising" ? "Rising" : debt.trend === "falling" ? "Clearing" : "Steady"} <TierBadge tier="estimate" /></div>
            <p className="small" style={{ marginTop: 8, lineHeight: 1.55 }}>{debt.relPct > 0 ? `~${debt.relPct}% above` : debt.relPct < 0 ? `~${Math.abs(debt.relPct)}% below` : "right at"} your 4-week baseline.{debt.burnoutDays != null && debt.trend === "rising" ? ` At this rate you'd reach your overreaching zone in ~${debt.burnoutDays} days.` : ""}</p>
            <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>Shown relative to your own baseline — the weights are estimates, so the direction is what matters, not an absolute score.</p>
          </>
        ) : <Empty icon="◐" title="Log a couple of weeks" hint="Sleep + training history wakes up the recovery-debt trend." />}
      </Card>

      {/* ── STATE GRID ── */}
      <Card title="Physiology state" sub="the shared layer every engine reads">
        <div className="gp-stat-row"><span className="muted small">Energy balance</span><span>{state.energyAvailability.value != null ? `${state.energyAvailability.value > 0 ? "+" : ""}${state.energyAvailability.value} kcal/day` : "—"} <TierBadge tier="calc" /></span></div>
        <div className="gp-stat-row"><span className="muted small">Training load (ACWR)</span><span>{state.trainingLoad.acwr ?? "—"} <TierBadge tier="calc" /></span></div>
        <div className="gp-stat-row"><span className="muted small">Stress budget used</span><span>{state.stressBudget.usedPct}% <TierBadge tier="estimate" /></span></div>
        <div className="gp-stat-row"><span className="muted small">Fatigue (acute)</span><span>{state.fatigue.value ?? "—"}{state.fatigue.value != null ? "/100" : ""} <TierBadge tier="estimate" /></span></div>
        <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>Energy balance is a maintenance-relative proxy; true energy availability needs body-fat %.</p>
      </Card>

      {/* ── ROADMAP ── */}
      {phases.length > 0 && (
        <Card title="Roadmap" sub="your phases">
          {phases.map((ph, i) => (
            <div key={ph.id || i} className="gp-stat-row">
              <span className="muted small">{(GOAL_TYPES.find(x => x.k === ph.type) || {}).label || ph.type}{ph.status === "active" ? " · active" : ph.status === "done" ? " · done" : ""}{ph.origin === "adaptation" ? " · adapted" : ""}</span>
              <span className="small">{ph.status === "done" && !loggedIds.has(ph.id) ? <button className="btn-ghost btn-sm" onClick={() => logPhaseResult(ph)}>Log result</button> : `${ph.startDate} → ${ph.endDate}`}</span>
            </div>
          ))}
        </Card>
      )}

      {/* ── STRATEGY MEMORY ── */}
      {(data.completedPhases || []).length > 0 && (
        <Card title="Strategy memory" sub="your phases as experiments — personal priors">
          {(data.completedPhases || []).map((r, i) => (
            <div key={r.id || i} style={{ padding: "8px 0", borderBottom: i < data.completedPhases.length - 1 ? "1px solid var(--line)" : "none" }}>
              <div className="gp-stat-row"><span>{(GOAL_TYPES.find(x => x.k === r.type) || {}).label || r.type} · {r.weeks}wk</span><span className="muted small">{r.success} <TierBadge tier="estimate" /></span></div>
              <div className="muted small" style={{ marginTop: 3 }}>actual {r.actualRateKgWk ?? "—"} kg/wk (planned {r.plannedRateKgWk ?? "—"}) · Δ{r.deltaWeightKg ?? "—"}kg{r.estMuscleKg ? ` · ~${r.estMuscleKg[0]}–${r.estMuscleKg[1]}kg muscle / ${r.estFatKg[0]}–${r.estFatKg[1]}kg fat (modeled)` : ""}</div>
            </div>
          ))}
        </Card>
      )}

      {/* ── DECISION OUTCOMES ── */}
      {decSummary.note && (
        <Card title="Decision outcomes" sub="did suggestions help — correlational">
          <p className="small" style={{ lineHeight: 1.55 }}>{decSummary.note}</p>
        </Card>
      )}
    </>
  );
}

// Build a goal payload from a parsed plan (shared by the import flow). Pure.
function payloadFromParsedPlan(p, goals, today) {
  const lastPhase = p.phases.length ? p.phases[p.phases.length - 1] : null;
  const gw = p.goalWeight ?? (lastPhase ? lastPhase.goalWeight : null);
  const td = p.targetDate ?? (lastPhase ? lastPhase.endDate : null);
  if (gw == null || !td) return null;
  const prev = goals.goalPlan || {};
  const payload = { ...goals, goalPlan: { ...prev,
    type: p.type || prev.type || "leanbulk",
    startWeight: p.startWeight ?? prev.startWeight ?? null,
    goalWeight: gw, startDate: p.startDate || prev.startDate || today, targetDate: td,
    freq: p.freq ?? prev.freq ?? null,
  } };
  if (p.hasRoadmap) {
    payload.goalPlan.phases = buildRoadmapPhases(p, today);
    payload.goalPlan.roadmap = { checkpoints: p.checkpoints, deloads: p.deloads, rules: p.rules, longTerm: p.longTerm, meta: p.meta, strategyNotes: p.strategyNotes || [], sourceMarkdown: p.sourceMarkdown || null, importedAt: today };
  }
  if (p.macros) { if (p.macros.calories) payload.calories = p.macros.calories; if (p.macros.protein) payload.protein = p.macros.protein; if (p.macros.carbs) payload.carbs = p.macros.carbs; if (p.macros.fat) payload.fat = p.macros.fat; }
  const hasPhaseCals = p.hasRoadmap && p.phases.some(x => x.calories);
  payload.macroMode = hasPhaseCals ? "auto" : (p.macros ? "manual" : (goals.macroMode || "manual"));
  return payload;
}

// Issues a parsed plan has — surfaced before applying so the user decides.
function planIssues(p) {
  const out = [];
  if (!p.startDate && !(p.phases[0] && p.phases[0].startDate)) out.push("No start date — phases will be undated");
  if (!p.targetDate && !(p.phases.length && p.phases[p.phases.length - 1].endDate)) out.push("No end / target date");
  if (p.hasRoadmap) {
    const undated = p.phases.filter(x => !x.startDate || !x.endDate).length;
    if (undated) out.push(`${undated} phase${undated > 1 ? "s" : ""} missing dates`);
    const noCal = p.phases.filter(x => x.calories == null).length;
    if (noCal) out.push(`${noCal} phase${noCal > 1 ? "s" : ""} with no calorie target`);
  }
  if (!(p.meta && p.meta.bodyFatPct) && !(p.longTerm && p.longTerm.currentFFMI)) out.push("No body-fat / FFMI target");
  if (p.startWeight == null) out.push("No starting weight");
  return out;
}

// Plain-language recommendations from a parsed plan + its analysis. Honest, evidence-based.
function planRecommendations(parsed, analysis, assess) {
  const recs = [];
  if (assess && assess.verdict === "unrealistic" && assess.realisticWeeks && assess.weeks) {
    const extra = Math.max(0, Math.round(assess.realisticWeeks - assess.weeks));
    if (extra > 0) recs.push(`Stretch the timeline by ~${extra} weeks — your pace is above what's achievable as mostly lean tissue.`);
    recs.push(`Or keep the date and aim for ~${assess.realisticGoalWeight}kg instead of ${assess.goalWeight}kg.`);
  } else if (assess && assess.verdict === "aggressive") {
    recs.push(assess.dir === "gain" ? "Trim the surplus slightly — the pace is a touch fast and will add some extra fat." : "Ease the deficit — keep protein high and keep lifting to protect muscle.");
  }
  if (analysis) {
    analysis.phases.forEach(p => {
      if (p.verdict === "unrealistic") recs.push(`${p.name || p.type}: ${p.dir === "gain" ? "reduce the surplus or lengthen this phase" : "soften this deficit"}.`);
    });
    const bulks = analysis.phases.filter(p => p.dir === "gain");
    const hasCutOrMaint = analysis.phases.some(p => p.dir === "loss" || p.type === "maintenance");
    if (bulks.length >= 2 && !hasCutOrMaint && analysis.totalWeeks >= 20) recs.push("Consider a short mini-cut or maintenance block between bulk phases to keep body-fat in check.");
  }
  if (parsed && parsed.hasRoadmap) {
    const undated = parsed.phases.filter(x => !x.startDate || !x.endDate).length;
    if (undated) recs.push(`Add dates to ${undated} undated phase${undated > 1 ? "s" : ""} so trajectory and forecast can track them.`);
  }
  if (!recs.length) recs.push("Looks solid — every phase sits within evidence-based rate ceilings. Log consistently and let the trend confirm it.");
  return recs;
}

// ── Visual phase timeline (current highlighted, future visible, done faded) ──
function PlanTimeline({ phases }) {
  if (!phases || !phases.length) return null;
  const C = { active: "#5cc8df", done: "#8fd989", planned: "#aab2c0" };
  const fmt = d => (d ? d.slice(5).replace("-", "/") : "—");
  return (
    <div style={{ position: "relative", paddingLeft: 20, marginTop: 4 }}>
      {phases.map((p, i) => {
        const col = C[p.status] || "#aab2c0";
        return (
          <div key={p.id || i} style={{ position: "relative", paddingBottom: i < phases.length - 1 ? 20 : 0, opacity: p.status === "done" ? 0.5 : 1 }}>
            <span style={{ position: "absolute", left: -20, top: 3, width: 12, height: 12, borderRadius: "50%", background: col, boxShadow: p.status === "active" ? `0 0 0 4px ${col}33` : "none" }} />
            {i < phases.length - 1 && <span style={{ position: "absolute", left: -15, top: 16, width: 2, bottom: 0, background: "var(--line)" }} />}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontWeight: 600, color: p.status === "active" ? "var(--text)" : "var(--text-2)" }}>
                {p.name || (GOAL_TYPES.find(x => x.k === p.type) || {}).label || p.type}
                {p.status === "active" && <span className="small" style={{ color: col, marginLeft: 6 }}>● now</span>}
              </span>
              <span className="muted small" style={{ whiteSpace: "nowrap" }}>{fmt(p.startDate)} → {fmt(p.endDate)}</span>
            </div>
            {(p.calories || p.targetRate != null) && <div className="muted small" style={{ marginTop: 2 }}>{p.calories ? `${p.calories} kcal` : ""}{p.calories && p.targetRate != null ? " · " : ""}{p.targetRate != null ? `${p.targetRate > 0 ? "+" : ""}${p.targetRate}kg/wk` : ""}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Create screen: three cards — Build (Card 1), Import (Card 2), Analysis (Card 3) ──
function PlanCreateScreen({ goals, currentWeight, profile, maintenance, onApply, onEdit, onCancel }) {
  return (
    <>
      {onCancel && <button className="btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={onCancel}>← Back to plan</button>}
      <GoalForm goals={goals} currentWeight={currentWeight} hideImport onSave={onApply} onCancel={onCancel} />
      <PlanImportFlow goals={goals} currentWeight={currentWeight} profile={profile} maintenance={maintenance} onApply={onApply} onEdit={onEdit} onDiscard={() => {}} embedded />
    </>
  );
}

// ── Import flow: upload/paste → analyze → Plan Analysis card → apply/edit/discard ──
function PlanImportFlow({ goals, currentWeight, profile, maintenance, onApply, onEdit, onDiscard, embedded }) {
  const [parsed, setParsed] = useState(null);
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState(null);
  const [status, setStatus] = useState(null);
  const today = getTodayStr();

  const analyze = (text, src) => {
    let p;
    try { p = parseGoalMarkdown(text || ""); }
    catch (err) { setMsg("Couldn't parse that — " + (err && err.message)); setParsed(null); setStatus(`⚠ Error reading ${src}`); return; }
    if (!p || !p.anyFound) { setParsed(null); setMsg(`Read ${src} (${(text || "").length} chars) but found no recognisable plan. It needs weights, dates, calories, or phase headings.`); setStatus(`⚠ No plan recognised in ${src}`); return; }
    setParsed(p); setMsg(null); setStatus(`✓ Analyzed ${src}`); haptic(8);
  };
  const onFile = e => {
    const f = e.target.files && e.target.files[0];
    if (!f) { setStatus("⚠ No file received"); return; }
    setStatus(`Reading "${f.name}"…`);
    const r = new FileReader();
    r.onerror = () => { setMsg("Couldn't read that file — paste the text instead."); setStatus(`⚠ Couldn't read "${f.name}"`); };
    r.onload = () => analyze(String(r.result || ""), `"${f.name}"`);
    r.readAsText(f); e.target.value = "";
  };

  const interpreted = parsed ? interpretPlan(parsed, { currentWeight, profile, maintenance, experience: (goals.goalPlan && goals.goalPlan.experience) || "intermediate", today }) : null;
  const igp = interpreted ? interpreted.goalPlan : null;
  const reality = interpreted ? interpreted.reality : null;
  const prov = interpreted ? interpreted.provenance : {};
  const analysis = igp && igp.phases.length ? analyzeRoadmap({ phases: igp.phases, currentWeight, experience: igp.experience }) : null;
  const payload = igp ? (() => {
    const active = igp.phases.find(p => p.status === "active") || igp.phases[0] || null;
    const pl = { ...goals, goalPlan: igp, macroMode: "auto" };
    if (active) { if (active.calories) pl.calories = active.calories; if (active.protein) pl.protein = active.protein; }
    return pl;
  })() : null;
  const VC = { realistic: ["Realistic", "#8fd989"], aggressive: ["Aggressive", "#f9c97e"], unrealistic: ["Unrealistic", "#f47e6e"] };
  const provLabel = { type: "Goal type", goalWeight: "Goal weight", startWeight: "Start weight", startDate: "Start date", targetDate: "End date", phaseDates: "Phase dates", calories: "Calories", macros: "Macros" };
  const provOrder = ["type", "goalWeight", "startWeight", "startDate", "targetDate", "phaseDates", "calories", "macros"];
  const derivedList = ["Phase dates", "Calorie targets", "Macro targets", igp && igp.roadmap && igp.roadmap.checkpoints.length ? "Progress checkpoints" : "Weekly milestones"];
  const confidence = !interpreted ? "—" : (Object.values(prov).filter(v => v === "derived").length >= 4 ? "Medium" : "High");

  return (
    <>
      <Card title="Import a plan" sub="upload or paste — analyzed before anything is applied" action={!embedded && <button className="btn-ghost btn-sm" onClick={onDiscard}>Cancel</button>}>
        <input type="file" onChange={onFile} style={{ display: "block", width: "100%", marginBottom: 10 }} />
        <textarea value={paste} onChange={e => setPaste(e.target.value)} placeholder="…or paste your plan markdown here, then tap Analyze" rows={4} style={{ width: "100%", background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: 10, fontSize: 13, resize: "vertical" }} />
        <button type="button" className="btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => analyze(paste, "pasted text")}>Analyze Plan</button>
        {status && <p className="small" style={{ marginTop: 8, color: status.startsWith("✓") ? "#8fd989" : status.startsWith("⚠") ? "#f47e6e" : "var(--text-2)" }}>{status}</p>}
        {msg && <p className="small" style={{ marginTop: 6, color: "#f9c97e", lineHeight: 1.45 }}>{msg}</p>}
      </Card>

      {interpreted && (
        <Card title="Plan Analysis" sub="FitLog filled in anything your plan didn't specify">
          {/* Plan Summary */}
          <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Plan summary</div>
          <p className="muted small" style={{ margin: "0 0 12px", lineHeight: 1.5 }}>
            {(GOAL_TYPES.find(x => x.k === igp.type) || {}).label || igp.type}{igp.startWeight != null && igp.goalWeight != null ? ` · ${igp.startWeight}kg → ${igp.goalWeight}kg` : ""}{interpreted.durationWeeks ? ` · ${Math.round(interpreted.durationWeeks)} weeks` : ""}{igp.phases.length ? ` · ${igp.phases.length} phase${igp.phases.length > 1 ? "s" : ""}` : ""}
          </p>

          {/* FitLog Interpretation — provenance, not errors */}
          <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>FitLog interpretation</div>
          {provOrder.filter(k => prov[k]).map(k => (
            <div key={k} className="gp-stat-row" style={{ padding: "2px 0" }}>
              <span className="small">{provLabel[k]}</span>
              <span className="small" style={{ color: prov[k] === "plan" ? "#8fd989" : "#5cc8df" }}>{prov[k] === "plan" ? "✓ From plan" : "~ FitLog derived"}</span>
            </div>
          ))}

          {/* Phase breakdown */}
          {igp.phases.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Phase breakdown</div>
              {(analysis ? analysis.phases : igp.phases).map((p, i) => (
                <div key={i} className="gp-stat-row" style={{ padding: "2px 0" }}>
                  <span className="small">{p.name || (GOAL_TYPES.find(x => x.k === p.type) || {}).label || p.type}{p.startWeight != null && p.goalWeight != null ? ` ${p.startWeight}→${p.goalWeight}kg` : ""}</span>
                  <span className="small" style={{ color: (VC[p.verdict] || VC.realistic)[1] }}>{(VC[p.verdict] || VC.realistic)[0]}</span>
                </div>
              ))}
            </div>
          )}

          {/* Reality Check */}
          {reality && (
            <div style={{ marginTop: 10 }}>
              <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Reality check</div>
              <div className="gp-stat-row"><span className="muted small">Required rate</span><span>{reality.reqKgWk > 0 ? "+" : ""}{reality.reqKgWk} kg/wk <TierBadge tier="calc" /></span></div>
              <div className="gp-stat-row"><span className="muted small">Evidence-based range</span><span className="muted small">{reality.dir === "gain" ? "+0.15–0.35" : reality.dir === "loss" ? "−0.5–1.0" : "~0"} kg/wk</span></div>
              <div className="gp-stat-row"><span className="muted small">Status</span><span style={{ color: (VC[reality.verdict] || VC.realistic)[1] }}>{reality.verdict === "realistic" ? "✓ " : "⚠ "}{(VC[reality.verdict] || VC.realistic)[0]}</span></div>
            </div>
          )}

          {/* Expected Outcome */}
          {reality && reality.dir === "gain" && reality.expectedMuscleKg && (
            <div style={{ marginTop: 10 }}>
              <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Expected outcome <TierBadge tier="forecast" /></div>
              <div className="gp-stat-row"><span className="muted small">Weight</span><span>{igp.goalWeight} kg</span></div>
              <div className="gp-stat-row"><span className="muted small">Muscle</span><span>+{reality.expectedMuscleKg[0]} to +{reality.expectedMuscleKg[1]} kg</span></div>
              <div className="gp-stat-row"><span className="muted small">Fat</span><span>+{reality.expectedFatKg[0]} to +{reality.expectedFatKg[1]} kg</span></div>
              <div className="gp-stat-row"><span className="muted small">Confidence</span><span>{confidence}</span></div>
              <p className="muted small" style={{ marginTop: 6, lineHeight: 1.4 }}>Muscle/fat split is a modeled range, not measured.</p>
            </div>
          )}

          {/* Single action — no dead ends */}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={() => { onApply(payload); haptic(12); }}>Apply Plan</button>
            <button className="btn-ghost btn-sm" onClick={() => { setParsed(null); setStatus(null); setMsg(null); if (!embedded && onDiscard) onDiscard(); }}>Discard</button>
          </div>
        </Card>
      )}
    </>
  );
}

// ── History: completed phases + archived plans ──
function GoalHistoryTab({ data, goals }) {
  const completed = data.completedPhases || [];
  const donePhases = getPhases(goals.goalPlan).filter(p => p.status === "done");
  const archived = data.archivedPlans || [];
  if (!completed.length && !donePhases.length && !archived.length) return <Card><Empty icon="◷" title="No history yet" hint="Completed phases and archived plans will collect here as you progress through your roadmap." /></Card>;
  return (
    <>
      {donePhases.length > 0 && (
        <Card title="Completed phases" sub="legs of your current plan already behind you">
          {donePhases.map((p, i) => (
            <div key={i} className="gp-stat-row"><span className="small">{p.name || p.type}</span><span className="muted small">{p.startDate} → {p.endDate}{p.calories ? ` · ${p.calories} kcal` : ""}</span></div>
          ))}
        </Card>
      )}
      {completed.length > 0 && (
        <Card title="Logged results" sub="outcomes you recorded">
          {completed.map((c, i) => <p key={i} className="small" style={{ lineHeight: 1.5, margin: "6px 0" }}>• {c.name || c.type || "Phase"}{c.note ? ` — ${c.note}` : ""}</p>)}
        </Card>
      )}
      {archived.length > 0 && (
        <Card title="Archived plans">
          {archived.map((a, i) => <p key={i} className="small" style={{ margin: "6px 0" }}>• {a.name || `Plan ${i + 1}`} {a.archivedAt ? <span className="muted small">({a.archivedAt})</span> : null}</p>)}
        </Card>
      )}
    </>
  );
}

// ─── STRATEGIC BRAIN CARDS (Goal Plan V2) ───────────────────────────────────
const PHASE_COLOR = { aggressiveDeficit: "#f47e6e", deficit: "#f0a868", maintenance: "#7d8aa0", leanBulk: "#8fd989", aggressiveSurplus: "#5cc8df" };
const fmtRange = (a, b) => `${formatShortDate(a)} → ${formatShortDate(b)}`;

function HistoricalPhasesCard({ data, goals }) {
  const h = useMemo(() => computeHistoricalPhases(data, goals.profile || {}, getTodayStr()), [data, goals]);
  return (
    <Card title="Historical Phases" sub="where you've been — reconstructed from intake + weight" action={h.ready ? <TierBadge tier="estimate" /> : null}>
      {!h.ready ? <Empty icon="◷" title="Not enough history yet" hint={h.reason || "Log nutrition and weight over a few weeks and FitLog will reconstruct your past deficit / maintenance / surplus phases."} /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {h.phases.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "11px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <div style={{ width: 4, borderRadius: 4, background: PHASE_COLOR[p.key] || "var(--line)", alignSelf: "stretch" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 700 }}>{p.label}</span>
                  <span className="muted small" style={{ whiteSpace: "nowrap" }}>{fmtRange(p.start, p.end)}</span>
                </div>
                <div className="muted small" style={{ marginTop: 2 }}>
                  {p.weeks}wk{p.avgRateKgWk != null ? ` · ${p.avgRateKgWk > 0 ? "+" : ""}${p.avgRateKgWk} kg/wk` : ""}{p.avgCalories ? ` · ~${p.avgCalories.toLocaleString()} kcal` : ""}{p.estMaintenance ? ` · TDEE ~${p.estMaintenance.toLocaleString()}` : ""}
                  <span style={{ marginLeft: 6, color: p.tier === "measured" ? "#8fd989" : "#f0a868" }}>· {p.tier === "measured" ? "Measured" : "Estimated"}</span>
                </div>
              </div>
            </div>
          ))}
          <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>Current state: <b style={{ color: "var(--text)" }}>{h.current ? h.current.label : "—"}</b>. Phases backed by logged weight are <span style={{ color: "#8fd989" }}>Measured</span>; intake-only stretches are <span style={{ color: "#f0a868" }}>Estimated</span>.</p>
        </div>
      )}
    </Card>
  );
}

function ScoreBar({ label, value, color }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}><span className="muted">{label}</span><span style={{ color: value == null ? "var(--text-2)" : "var(--text)", fontWeight: 600 }}>{value == null ? "n/a" : value}</span></div>
      <div style={{ height: 6, borderRadius: 6, background: "var(--bg-2)", overflow: "hidden" }}><div style={{ width: `${value == null ? 0 : value}%`, height: "100%", background: value == null ? "transparent" : color, borderRadius: 6, transition: "width .4s ease" }} /></div>
    </div>
  );
}

function RecoveryCapacityCard({ data, goals }) {
  const r = useMemo(() => computeRecoveryCapacity(data, goals, getTodayStr()), [data, goals]);
  return (
    <Card title="Recovery Capacity" sub="how well set up to recover & adapt — not fatigue" action={r.ready ? <TierBadge tier="estimate" /> : null}>
      {!r.ready ? <Empty icon="◌" title="No recovery data yet" hint={r.reason || "Log sleep or nutrition and your recovery capacity will appear here."} /> : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
            <div style={{ position: "relative", width: 76, height: 76, flexShrink: 0 }}>
              <svg viewBox="0 0 36 36" style={{ width: 76, height: 76, transform: "rotate(-90deg)" }}>
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--bg-2)" strokeWidth="3.5" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke={r.bandColor} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(r.score / 100) * 97.4} 97.4`} style={{ transition: "stroke-dasharray .5s ease" }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{r.score}</span>
                <span className="muted" style={{ fontSize: 9 }}>/ 100</span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: r.bandColor }}>{r.band}</div>
              <div className="muted small" style={{ marginTop: 2 }}>{r.confidence} confidence{r.limiter ? ` · limited by ${r.limiter}` : ""}</div>
              {r.eaCapped && <div className="small" style={{ color: "#f47e6e", marginTop: 4 }}>⚠ Capped — energy availability critically low</div>}
            </div>
          </div>
          <ScoreBar label="Sleep (35%)" value={r.components.sleep} color="#5cc8df" />
          <ScoreBar label="Nutrition (30%)" value={r.components.nutrition} color="#8fd989" />
          <ScoreBar label="Stress (20%)" value={r.components.stress} color="#a78bda" />
          <ScoreBar label="Rest (15%)" value={r.components.rest} color="#f0a868" />
          <p className="muted small" style={{ marginTop: 6, lineHeight: 1.45 }}>{r.note}</p>
        </>
      )}
    </Card>
  );
}

const FATIGUE_STATE_COLOR = { Fresh: "#8fd989", Accumulating: "#f9c97e", Overreached: "#f47e6e" };
function FatigueCard({ data, goals }) {
  const [showMuscles, setShowMuscles] = useState(false);
  const f = useMemo(() => computeFatigue(data, goals, getTodayStr()), [data, goals]);
  if (!f.ready) return <Card title="Fatigue" sub="is accumulated stress impairing adaptation?"><Empty icon="◍" title="Not enough training logged" hint={f.reason || "Log a few workouts and your fatigue picture builds here."} /></Card>;
  const trained = f.perMuscle.filter(m => m.recentSets > 0);
  return (
    <Card title="Fatigue" sub="accumulated stress vs adaptation — separate from recovery" action={<TierBadge tier="estimate" />}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: f.bandColor }}>{f.finalFatigue}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: f.bandColor }}>{f.band}</span>
          </div>
          <div className="muted small">{f.confidence} confidence · estimated</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: `${f.readinessColor}22`, border: `2px solid ${f.readinessColor}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: f.readinessColor }}>{f.readiness}</span>
          </div>
          <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>readiness</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[["Performance", f.layers.performance, "50%"], ["Wellness", f.layers.wellness, "30%"], ["Load", f.layers.load, "20%"]].map(([l, v, w]) => (
          <div key={l} style={{ flex: 1, background: "var(--bg-2)", borderRadius: 10, padding: "8px 10px" }}>
            <div className="muted" style={{ fontSize: 10 }}>{l} <span style={{ opacity: .6 }}>{w}</span></div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="gp-stat-row"><span className="muted small">e1RM trend (Epley·Brzycki)</span><span style={{ color: f.performance.e1rmTrendPct == null ? "var(--text-2)" : f.performance.e1rmTrendPct >= 0 ? "#8fd989" : "#f47e6e" }}>{f.performance.e1rmTrendPct == null ? "—" : `${f.performance.e1rmTrendPct > 0 ? "+" : ""}${f.performance.e1rmTrendPct}%`}</span></div>
      <div className="gp-stat-row"><span className="muted small">Load ratio (acute ÷ chronic)</span><span style={{ color: f.load.ratio == null ? "var(--text-2)" : f.load.ratio >= 1.3 ? "#f9c97e" : "var(--text)" }}>{f.load.ratio == null ? "—" : `${f.load.ratio}×`}</span></div>

      {f.deload.recommended ? (
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(244,126,110,0.1)", border: "1px solid rgba(244,126,110,0.35)" }}>
          <div style={{ fontWeight: 700, color: "#f47e6e", fontSize: 13 }}>⚠ Deload recommended</div>
          <p className="small" style={{ margin: "4px 0 0", color: "var(--text-2)", lineHeight: 1.45 }}>Performance is declining and: {f.deload.corroborators.join("; ")}.</p>
        </div>
      ) : (
        <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 10, background: "rgba(143,217,137,0.08)", border: "1px solid rgba(143,217,137,0.25)" }}>
          <span className="small" style={{ color: "#8fd989" }}>✓ No deload indicated — train as planned.</span>
        </div>
      )}

      {f.overreached.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="muted small" style={{ marginBottom: 5 }}>Overreached muscles</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{f.overreached.map(m => <span key={m} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "rgba(244,126,110,0.15)", border: "1px solid rgba(244,126,110,0.35)", color: "#f9b3a8" }}>{m}</span>)}</div>
        </div>
      )}

      <button className="btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setShowMuscles(s => !s)}>{showMuscles ? "Hide per-muscle ▾" : "Per-muscle fatigue ▸"}</button>
      {showMuscles && (
        <div style={{ marginTop: 8 }}>
          {trained.length === 0 && <p className="muted small">Nothing trained in the last 3 days — all muscles Fresh.</p>}
          {trained.sort((a, b) => b.recentSets - a.recentSets).map(m => (
            <div key={m.key} className="gp-stat-row" style={{ padding: "3px 0" }}>
              <span className="small" style={{ flex: 1 }}>{m.label}</span>
              <span className="small muted" style={{ width: 70, textAlign: "right" }}>{m.recentSets} sets</span>
              <span className="small" style={{ width: 96, textAlign: "right", color: FATIGUE_STATE_COLOR[m.state], fontWeight: 600 }}>{m.state}</span>
            </div>
          ))}
        </div>
      )}
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>{f.note}</p>
    </Card>
  );
}

function PhaseTransitionCard({ data, goals }) {
  const h = useMemo(() => computeHistoricalPhases(data, goals.profile || {}, getTodayStr()), [data, goals]);
  const current = h.ready && h.current ? h.current.label : (goals.goal || null);
  const t = useMemo(() => current ? suggestTransitions(current, { weeksInPhase: h.ready && h.current ? h.current.weeks : null }) : null, [current, h]);
  if (!t) return null;
  return (
    <Card title="What's Next" sub="phase transition options — suggestions only">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ padding: "5px 12px", borderRadius: 999, background: "var(--bg-2)", fontWeight: 600, fontSize: 13 }}>{t.fromLabel}</span>
        <span className="muted">→</span>
        <span style={{ padding: "5px 12px", borderRadius: 999, background: "rgba(143,217,137,0.15)", border: "1px solid rgba(143,217,137,0.4)", color: "#8fd989", fontWeight: 700, fontSize: 13 }}>{t.recommendedLabel}</span>
      </div>
      {t.options.map((o, i) => {
        const rec = o.to === t.recommended;
        return (
          <div key={i} style={{ padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{o.label}</span>
              {rec && <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 999, background: "rgba(143,217,137,0.18)", color: "#8fd989", fontWeight: 700 }}>RECOMMENDED</span>}
            </div>
            <p className="small" style={{ margin: "3px 0 0", color: "var(--text-2)", lineHeight: 1.45 }}>{o.why}</p>
          </div>
        );
      })}
      <p className="muted small" style={{ marginTop: 10 }}>{t.note}</p>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// GOAL PLAN V3 — the planning brain. The active phase is the lens through which
// every metric, trajectory, and report is interpreted. Fully replaces the old
// Goal Plan. Phases are dynamic (durationWeeks; dates derived deterministically).
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_DOT = { good: "#8fd989", warn: "#f9c97e", bad: "#f47e6e", unknown: "#5a6472" };
const PHASE_TYPE_COLOR = { leanbulk: "#8fd989", bulk: "#5cc8df", minicut: "#f0a868", cut: "#f47e6e", maintenance: "#7d8aa0", recomp: "#a78bda", strength: "#e0b0ff", hypertrophy: "#8fd989" };
const ptColor = t => PHASE_TYPE_COLOR[t] || "var(--accent)";

// Current behaviour, measured from logs — handed to the lens for interpretation.
function useCurrentMetrics(data, goals, activeP) {
  return useMemo(() => {
    const today = getTodayStr();
    const m = { actualRateKgWk: null, proteinGkg: null, recovery: null, fatigue: null, readiness: null, weightNow: null };
    const bw = (goals.profile && goals.profile.weightKg) ? parseFloat(goals.profile.weightKg) : null;
    // actual weight rate within the active phase window
    const ws = (data.weight || []).filter(w => w && w.date && (w.kg != null || w.weight != null)).map(w => ({ date: w.date, kg: w.kg != null ? w.kg : w.weight })).sort((a, b) => a.date.localeCompare(b.date));
    if (ws.length) m.weightNow = ws[ws.length - 1].kg;
    if (activeP && ws.length >= 2) {
      const inPhase = ws.filter(w => w.date >= activeP.start && w.date <= today);
      const span = inPhase.length >= 2 ? inPhase : ws.slice(-4);
      if (span.length >= 2) { const wks = Math.max(0.5, (new Date(span[span.length - 1].date) - new Date(span[0].date)) / 6048e5); m.actualRateKgWk = +(((span[span.length - 1].kg - span[0].kg) / wks)).toFixed(2); }
    }
    // protein g/kg over last 7d
    const wkAgo = (() => { const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() - 6); return localDateStr(d); })();
    const diet = (data.diet || []).filter(d => d && d.date && d.date >= wkAgo);
    if (diet.length && (m.weightNow || bw)) { const byDay = {}; diet.forEach(e => (byDay[e.date] = (byDay[e.date] || 0) + (e.protein || 0))); const days = Object.values(byDay); const avgP = days.reduce((s, x) => s + x, 0) / days.length; m.proteinGkg = +(avgP / (m.weightNow || bw)).toFixed(1); }
    const rec = computeRecoveryCapacity(data, goals, today); if (rec.ready) m.recovery = rec.score;
    const fat = computeFatigue(data, goals, today); if (fat.ready) { m.fatigue = fat.finalFatigue; m.readiness = fat.readiness; }
    return m;
  }, [data, goals, activeP]);
}

function GoalPlanV3({ data, goals, onSaveGoals, addEntry, deleteEntry }) {
  const gp = goals.goalPlanV3 || null;
  const hasPlan = !!(gp && gp.active && gp.phases && gp.phases.length);
  const [screen, setScreen] = useState(hasPlan ? "plan" : "entry");
  const [tab, setTab] = useState("overview");

  const apply = (plan) => { onSaveGoals({ ...goals, goalPlanV3: { ...plan, active: true } }); setScreen("plan"); setTab("overview"); toast("✦ Plan applied"); haptic(12); };
  const replace = () => { setScreen("entry"); };

  if (screen === "entry") return <V3Entry onBuild={() => setScreen("build")} onImport={() => setScreen("import")} hasPlan={hasPlan} onBack={hasPlan ? () => setScreen("plan") : null} />;
  if (screen === "build") return <V3Build goals={goals} onApply={apply} onCancel={() => setScreen(hasPlan ? "plan" : "entry")} />;
  if (screen === "import") return <V3Import goals={goals} onApply={apply} onCancel={() => setScreen(hasPlan ? "plan" : "entry")} />;
  if (screen === "phases") return <V3PhaseManager gp={gp} goals={goals} onSave={p => { onSaveGoals({ ...goals, goalPlanV3: { ...gp, ...p } }); setScreen("plan"); }} onCancel={() => setScreen("plan")} />;

  const derived = derivedPhases(gp, goals.profile || {}, getTodayStr());
  const activeP = activePhaseV3(derived, getTodayStr());

  return (
    <div className="gp-scope stack">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div className="gp-brand"><span className="gp-mark" />Goal Plan</div>
        <span style={{ display: "flex", gap: 14 }}>
          <button onClick={() => setScreen("phases")} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}>Edit phases</button>
          <button onClick={replace} style={{ background: "none", border: "none", color: "var(--text-2)", fontSize: 13, cursor: "pointer", padding: 0 }}>Replace</button>
        </span>
      </div>

      <div className="skin-tabs" style={{ marginBottom: 4 }}>
        {[["overview", "Goal Overview"], ["trajectory", "Trajectory"], ["report", "Report"]].map(([k, l]) => (
          <button key={k} className={`skin-tab ${tab === k ? "on" : ""}`} onClick={() => { setTab(k); haptic(6); }}>{l}</button>
        ))}
      </div>

      {tab === "overview" && <V3Overview gp={gp} derived={derived} activeP={activeP} data={data} goals={goals} onSaveGoals={onSaveGoals} />}
      {tab === "trajectory" && <V3Trajectory gp={gp} derived={derived} activeP={activeP} data={data} goals={goals} />}
      {tab === "report" && <V3Report gp={gp} derived={derived} activeP={activeP} data={data} goals={goals} />}
    </div>
  );
}

// ── ENTRY — exactly two cards, zero analytics ──
function V3Entry({ onBuild, onImport, hasPlan, onBack }) {
  return (
    <div className="gp-scope stack">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="gp-brand"><span className="gp-mark" />Goal Plan</div>
        {onBack && <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--text-2)", fontSize: 13, cursor: "pointer" }}>Cancel</button>}
      </div>
      <Card title="Build Plan On Website" sub="Define your goal and FitLog builds the phase structure">
        <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>Set your start and goal weight and a target date. FitLog creates a starting phase you can shape in the Phase Manager — add, insert, reorder, and tune every phase.</p>
        <button className="btn-primary" style={{ width: "100%" }} onClick={onBuild}>Build a plan →</button>
      </Card>
      <Card title="Import Markdown Plan" sub="Already have a plan written up? Bring it in">
        <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>Upload or paste a markdown plan. FitLog parses the phases, dates, calories, macros, and targets, shows you an analysis, and only applies it when you say so.</p>
        <button className="btn-primary" style={{ width: "100%" }} onClick={onImport}>Import markdown →</button>
      </Card>
    </div>
  );
}

// ── BUILD — minimal: start/goal/target → seed phase(s) → refine in Phase Manager ──
function V3Build({ goals, onApply, onCancel }) {
  const prof = goals.profile || {};
  const [sw, setSw] = useState(prof.weightKg || "");
  const [gw, setGw] = useState("");
  const [date, setDate] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() + 4); return localDateStr(d); });
  const today = getTodayStr();
  const valid = sw && gw && date && date > today;
  const build = () => {
    const start = parseFloat(sw), goal = parseFloat(gw);
    const weeks = Math.max(1, Math.round((new Date(date) - new Date(today)) / 6048e5));
    const dir = Math.abs(goal - start) < 0.5 ? "maintain" : goal > start ? "gain" : "loss";
    const type = dir === "gain" ? "leanbulk" : dir === "loss" ? "cut" : "maintenance";
    const phases = [{ ...newPhase(type), durationWeeks: weeks }];
    onApply({ source: "build", goalType: type, startDate: today, startWeight: start, goalWeight: goal, phases });
  };
  return (
    <div className="gp-scope stack">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div className="gp-brand"><span className="gp-mark" />Build Plan</div><button onClick={onCancel} style={{ background: "none", border: "none", color: "var(--text-2)", fontSize: 13, cursor: "pointer" }}>Cancel</button></div>
      <Card title="Your goal" sub="the starting point — refine phases after">
        <div className="field-grid three">
          <label>Start weight (kg)<input type="number" inputMode="decimal" value={sw} onChange={e => setSw(e.target.value)} placeholder="80" /></label>
          <label>Goal weight (kg)<input type="number" inputMode="decimal" value={gw} onChange={e => setGw(e.target.value)} placeholder="85" /></label>
          <label>Target date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        </div>
        <button className="btn-primary" style={{ width: "100%", marginTop: 12, opacity: valid ? 1 : 0.5 }} disabled={!valid} onClick={build}>Create plan & open phases →</button>
        <p className="muted small" style={{ marginTop: 8 }}>This seeds one phase. You'll shape the full roadmap (add a cut, mini-cut, maintenance, etc.) in the Phase Manager.</p>
      </Card>
    </div>
  );
}

// ── IMPORT — parse → Plan Analysis → Apply ──
function mdToV3Phases(parsed, today) {
  const phs = (parsed && parsed.phases) || [];
  return phs.map(p => {
    let weeks = p.weeks || null;
    if (!weeks && p.startDate && p.endDate) weeks = Math.max(1, Math.round((new Date(p.endDate) - new Date(p.startDate)) / 6048e5));
    const tpl = templateFor(p.type);
    return { ...newPhase(p.type || "leanbulk"), name: p.name || tpl.label, durationWeeks: weeks || tpl.weeks, calories: p.calories != null ? p.calories : null };
  });
}
function V3Import({ goals, onApply, onCancel }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const today = getTodayStr();
  const analyze = () => { const p = parseGoalMarkdown(text); setParsed(p); haptic(8); };
  const onFile = e => { const f = e.target.files && e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => setText(String(r.result || "")); r.readAsText(f); };
  const phases = parsed ? mdToV3Phases(parsed, today) : [];
  const startW = (parsed && parsed.meta && parsed.meta.startWeight) || (goals.profile && goals.profile.weightKg ? parseFloat(goals.profile.weightKg) : null);
  const gpPreview = { startDate: today, startWeight: startW, phases };
  const derived = derivedPhases(gpPreview, goals.profile || {}, today);
  const totalWeeks = phases.reduce((s, p) => s + p.durationWeeks, 0);
  const endW = derived.length ? derived[derived.length - 1].endWeight : null;
  const apply = () => onApply({ source: "import", goalType: phases[0] ? phases[0].type : "leanbulk", startDate: today, startWeight: startW, goalWeight: endW, phases });
  return (
    <div className="gp-scope stack">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div className="gp-brand"><span className="gp-mark" />Import Plan</div><button onClick={onCancel} style={{ background: "none", border: "none", color: "var(--text-2)", fontSize: 13, cursor: "pointer" }}>Cancel</button></div>
      <Card title="Paste or upload markdown" sub="phases, dates, calories, macros, targets">
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="# My Plan&#10;## Phase 1 — Lean Bulk (12 weeks)&#10;Calories: 3000 ..." style={{ width: "100%", minHeight: 130, background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: 10, fontSize: 13, fontFamily: "monospace" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <label className="btn-ghost btn-sm" style={{ cursor: "pointer" }}>Upload .md<input type="file" accept=".md,.markdown,.txt" onChange={onFile} style={{ display: "none" }} /></label>
          <button className="btn-primary btn-sm" style={{ flex: 1, opacity: text.trim() ? 1 : 0.5 }} disabled={!text.trim()} onClick={analyze}>Analyze plan</button>
        </div>
      </Card>
      {parsed && (
        <Card title="Plan Analysis" sub="review before applying" action={<TierBadge tier="estimate" />}>
          {phases.length === 0 ? <Empty icon="⚠" title="No phases detected" hint="Couldn't find a phase table. Make sure phases have names and durations/dates, then re-analyze." /> : (
            <>
              <div className="gp-stat-row"><span className="muted small">Phases detected</span><span>{phases.length}</span></div>
              <div className="gp-stat-row"><span className="muted small">Total duration</span><span>{totalWeeks} weeks (~{Math.round(totalWeeks / 4.345)} mo)</span></div>
              <div className="gp-stat-row"><span className="muted small">Start → end weight</span><span>{startW ?? "?"} → {endW ?? "?"} kg</span></div>
              <div className="gp-stat-row"><span className="muted small">Expected change</span><span>{startW != null && endW != null ? `${endW - startW > 0 ? "+" : ""}${(endW - startW).toFixed(1)} kg` : "—"}</span></div>
              <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Phase breakdown</div>
                {derived.map((p, i) => (
                  <div key={i} className="gp-stat-row" style={{ padding: "3px 0" }}><span className="small">{i + 1}. {p.name}</span><span className="small muted">{p.durationWeeks}wk · {p.calories ?? "?"} kcal · {p.targetRateKgWk > 0 ? "+" : ""}{p.targetRateKgWk}kg/wk</span></div>
                ))}
              </div>
              {!startW && <p className="small" style={{ color: "#f9c97e", marginTop: 8 }}>⚠ No starting weight found — add your weight in profile for accurate macros.</p>}
              <button className="btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={apply}>Apply plan</button>
              <p className="muted small" style={{ marginTop: 8 }}>Once applied, this behaves exactly like a plan built on the website — roadmap, macros, and trajectory all update.</p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

// ── PHASE MANAGER — add/insert/delete/reorder/duplicate + live derived preview ──
function V3PhaseManager({ gp, goals, onSave, onCancel }) {
  const [phases, setPhases] = useState(() => (gp && gp.phases ? gp.phases.map(p => ({ ...p })) : []));
  const [adding, setAdding] = useState(false);
  const [dragI, setDragI] = useState(null);
  const profile = goals.profile || {};
  const startDate = (gp && gp.startDate) || getTodayStr();
  const startWeight = (gp && gp.startWeight != null) ? gp.startWeight : (profile.weightKg ? parseFloat(profile.weightKg) : 80);
  const derived = derivedPhases({ startDate, startWeight, phases }, profile, getTodayStr());

  const addType = type => { setPhases(p => addPhaseOp(p, type)); setAdding(false); haptic(8); };
  const del = id => { setPhases(p => deletePhaseOp(p, id)); haptic(6); };
  const dup = id => { setPhases(p => duplicatePhaseOp(p, id)); haptic(6); };
  const move = (from, to) => { if (to < 0 || to >= phases.length) return; setPhases(p => movePhaseOp(p, from, to)); haptic(6); };
  const patch = (id, k, v) => setPhases(p => updatePhaseOp(p, id, { [k]: v }));
  const onDrop = to => { if (dragI != null && dragI !== to) move(dragI, to); setDragI(null); };

  return (
    <div className="gp-scope stack">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div className="gp-brand"><span className="gp-mark" />Phase Manager</div><button onClick={onCancel} style={{ background: "none", border: "none", color: "var(--text-2)", fontSize: 13, cursor: "pointer" }}>Cancel</button></div>

      <Card title="Roadmap preview" sub="dates & macros recalculate live as you edit">
        {derived.length === 0 ? <Empty icon="◷" title="No phases yet" hint="Add your first phase below." /> : derived.map((p, i) => (
          <div key={p.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <div style={{ width: 3, borderRadius: 3, background: (ptColor(p.type)), alignSelf: "stretch" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600, fontSize: 13 }}>{i + 1}. {p.name}</span><span className="muted small">{formatShortDate(p.start)} → {formatShortDate(p.end)}</span></div>
              <div className="muted small">{p.startWeight}→{p.endWeight}kg · {p.calories ?? "?"}kcal · P{p.protein}/C{p.carbs}/F{p.fat} · {p.targetRateKgWk > 0 ? "+" : ""}{p.targetRateKgWk}kg/wk</div>
            </div>
          </div>
        ))}
        <p className="muted small" style={{ marginTop: 8 }}>Plan length: {phases.reduce((s, p) => s + (p.durationWeeks || 0), 0)} weeks · ends {derived.length ? formatShortDate(derived[derived.length - 1].end) : "—"}</p>
      </Card>

      <Card title="Phases" sub="drag to reorder (desktop) or use the arrows">
        {phases.map((p, i) => {
          const tpl = templateFor(p.type);
          return (
            <div key={p.id} draggable onDragStart={() => setDragI(i)} onDragOver={e => e.preventDefault()} onDrop={() => onDrop(i)}
              style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginBottom: 10, background: dragI === i ? "var(--bg-2)" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ cursor: "grab", color: "var(--text-2)", fontSize: 16 }}>⋮⋮</span>
                <select value={p.type} onChange={e => { const t = e.target.value; setPhases(ps => updatePhaseOp(ps, p.id, { type: t, name: templateFor(t).label })); }} style={{ flex: 1, background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 9px", fontSize: 14, fontWeight: 600 }}>
                  {TEMPLATE_LIST.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
                </select>
                <button onClick={() => move(i, i - 1)} className="btn-ghost btn-sm" style={{ padding: "4px 8px" }}>↑</button>
                <button onClick={() => move(i, i + 1)} className="btn-ghost btn-sm" style={{ padding: "4px 8px" }}>↓</button>
              </div>
              <div className="field-grid three">
                <label style={{ fontSize: 11 }}>Weeks<input type="number" inputMode="numeric" value={p.durationWeeks} onChange={e => patch(p.id, "durationWeeks", Math.max(1, +e.target.value || 1))} /></label>
                <label style={{ fontSize: 11 }}>Rate kg/wk<input type="number" inputMode="decimal" step="0.05" value={p.targetRateKgWk ?? ""} placeholder={`${tpl.rateDefault}`} onChange={e => patch(p.id, "targetRateKgWk", e.target.value === "" ? null : parseFloat(e.target.value))} /></label>
                <label style={{ fontSize: 11 }}>Calories<input type="number" inputMode="numeric" value={p.calories ?? ""} placeholder="auto" onChange={e => patch(p.id, "calories", e.target.value === "" ? null : +e.target.value)} /></label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => dup(p.id)} className="btn-ghost btn-sm" style={{ flex: 1 }}>Duplicate</button>
                <button onClick={() => setPhases(ps => { const a = [...ps]; a.splice(i + 1, 0, newPhase("maintenance")); return a; })} className="btn-ghost btn-sm" style={{ flex: 1 }}>Insert after</button>
                <button onClick={() => del(p.id)} className="btn-ghost btn-sm" style={{ color: "#f47e6e" }}>Delete</button>
              </div>
              <p className="muted small" style={{ marginTop: 6 }}>Template defaults: {tpl.rateDefault > 0 ? "+" : ""}{tpl.rateDefault}kg/wk · protein {tpl.proteinDefault}g/kg · recovery floor {tpl.recoveryFloor} · fatigue ceiling {tpl.fatigueCeiling}. Override anything above.</p>
            </div>
          );
        })}

        {adding ? (
          <div style={{ border: "1px dashed var(--line)", borderRadius: 12, padding: 12 }}>
            <div className="muted small" style={{ marginBottom: 8 }}>Pick a template</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {TEMPLATE_LIST.map(t => <button key={t.type} onClick={() => addType(t.type)} className="btn-ghost btn-sm">{t.label}</button>)}
            </div>
            <button onClick={() => setAdding(false)} className="btn-ghost btn-sm" style={{ marginTop: 8 }}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="btn-primary" style={{ width: "100%" }}>+ Add phase</button>
        )}
      </Card>

      <button className="btn-primary" style={{ width: "100%", opacity: phases.length ? 1 : 0.5 }} disabled={!phases.length} onClick={() => onSave({ phases })}>Save roadmap</button>
    </div>
  );
}

// ── OVERVIEW ──
function V3Overview({ gp, derived, activeP, data, goals, onSaveGoals }) {
  const override = !!goals.nutritionOverride;
  const lastW = (data.weight || []).filter(w => w && (w.kg != null || w.weight != null)).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  const currentWeight = lastW ? (lastW.kg != null ? lastW.kg : lastW.weight) : (gp.startWeight ?? null);
  const today = getTodayStr();
  const endDate = planEndDate(derived);
  const daysRemaining = endDate ? Math.max(0, Math.round((new Date(endDate) - new Date(today)) / 864e5)) : null;
  const goalW = derived.length ? derived[derived.length - 1].endWeight : gp.goalWeight;
  const rate = activeP ? activeP.targetRateKgWk : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card title="Primary Goal" sub={gp.source === "import" ? "imported plan" : "your plan"}>
        <div className="gp-stat-row"><span className="muted small">Goal</span><span>{gp.startWeight ?? "?"}kg → {goalW ?? "?"}kg</span></div>
        <div className="gp-stat-row"><span className="muted small">Current weight</span><span>{currentWeight ?? "—"} kg <TierBadge tier="measured" /></span></div>
        <div className="gp-stat-row"><span className="muted small">Current phase</span><span style={{ color: activeP ? (ptColor(activeP.type)) : "var(--text-2)", fontWeight: 600 }}>{activeP ? activeP.name : "—"}</span></div>
        <div className="gp-stat-row"><span className="muted small">Weekly target rate</span><span>{rate != null ? `${rate > 0 ? "+" : ""}${rate} kg/wk` : "—"}</span></div>
        <div className="gp-stat-row"><span className="muted small">Monthly target rate</span><span>{rate != null ? `${rate > 0 ? "+" : ""}${(rate * 4.345).toFixed(1)} kg/mo` : "—"}</span></div>
        <div className="gp-stat-row"><span className="muted small">Days remaining</span><span>{daysRemaining != null ? `${daysRemaining} days` : "—"}</span></div>
      </Card>

      <Card title="Current Phase Nutrition" sub={activeP ? `${activeP.name} — auto-selected for today` : "no active phase"} action={activeP ? <TierBadge tier="calc" /> : null}>
        {!activeP ? <Empty icon="◷" title="No active phase" hint="Your plan's dates don't cover today. Open Edit phases to adjust." /> : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              {[["Calories", activeP.calories, ""], ["Protein", activeP.protein, "g"], ["Carbs", activeP.carbs, "g"], ["Fat", activeP.fat, "g"]].map(([l, v, u]) => (
                <div key={l} style={{ flex: 1, background: "var(--bg-2)", borderRadius: 10, padding: "9px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{v ?? "—"}<span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>{u}</span></div>
                  <div className="muted" style={{ fontSize: 10 }}>{l}</div>
                </div>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: 4 }}>Targets for the <b style={{ color: "var(--text)" }}>{activeP.name}</b> phase{activeP.maintenance ? `, vs ~${activeP.maintenance} kcal maintenance` : ""}. Updates automatically when the active phase changes.</p>
            <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: override ? "rgba(249,201,126,0.08)" : "rgba(143,217,137,0.08)", border: `1px solid ${override ? "rgba(249,201,126,0.3)" : "rgba(143,217,137,0.3)"}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div className="small" style={{ fontWeight: 700 }}>Custom Nutrition Override</div>
                  <div className="muted small" style={{ marginTop: 2, lineHeight: 1.4 }}>{override ? "On — your Meal Log uses your own custom targets; this plan won't change them." : "Off — this phase controls your Meal Log targets automatically."}</div>
                </div>
                <button onClick={() => { onSaveGoals({ ...goals, nutritionOverride: !override }); haptic(8); }}
                  style={{ flexShrink: 0, width: 46, height: 26, borderRadius: 999, border: "none", cursor: "pointer", background: override ? "#f9c97e" : "var(--bg-2)", position: "relative", transition: "background .2s" }}>
                  <span style={{ position: "absolute", top: 3, left: override ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: override ? "#1a1d24" : "var(--text-2)", transition: "left .2s" }} />
                </button>
              </div>
              {!override && <div className="muted small" style={{ marginTop: 6 }}>✓ Synced to Meal Log: {activeP.calories ?? "—"} kcal · {activeP.protein ?? "—"}g P · {activeP.carbs ?? "—"}g C · {activeP.fat ?? "—"}g F</div>}
            </div>
          </>
        )}
      </Card>

      <Card title="Roadmap Timeline" sub="the single source of truth — every phase, derived">
        {derived.length === 0 ? <Empty icon="◷" title="No phases" hint="Open Edit phases to build your roadmap." /> : derived.map((p, i) => (
          <div key={p.id} style={{ display: "flex", gap: 12, padding: "11px 0", borderTop: i ? "1px solid var(--line)" : "none", opacity: p.status === "done" ? 0.6 : 1 }}>
            <div style={{ width: 4, borderRadius: 4, background: ptColor(p.type), alignSelf: "stretch" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontWeight: 700 }}>{p.name}{p.status === "active" && <span style={{ fontSize: 10, marginLeft: 7, padding: "1px 7px", borderRadius: 999, background: "rgba(143,217,137,0.18)", color: "#8fd989", fontWeight: 700 }}>ACTIVE</span>}</span>
                <span className="muted small" style={{ whiteSpace: "nowrap" }}>{formatShortDate(p.start)} → {formatShortDate(p.end)}</span>
              </div>
              <div className="muted small" style={{ marginTop: 2 }}>{p.calories ?? "?"} kcal · {p.targetRateKgWk > 0 ? "+" : ""}{p.targetRateKgWk} kg/wk · expected {p.expectedChangeKg > 0 ? "+" : ""}{p.expectedChangeKg} kg → {p.endWeight}kg</div>
            </div>
          </div>
        ))}
      </Card>

      <V3MusclePrioCard data={data} goals={goals} onSaveGoals={onSaveGoals} />
    </div>
  );
}

// ── TRAJECTORY ──
function V3PhaseProgress({ activeP, metrics }) {
  if (!activeP) return <Card title="Phase Progress"><Empty icon="◷" title="No active phase" hint="Your plan doesn't cover today." /></Card>;
  const today = getTodayStr();
  const totalDays = Math.max(1, Math.round((new Date(activeP.end) - new Date(activeP.start)) / 864e5));
  const elapsed = Math.max(0, Math.min(totalDays, Math.round((new Date(today) - new Date(activeP.start)) / 864e5)));
  const remaining = totalDays - elapsed;
  const pct = Math.round((elapsed / totalDays) * 100);
  const L = activeP.lens;
  const actual = metrics.actualRateKgWk;
  let verdict = "On Track", vColor = "#8fd989";
  if (actual != null) {
    const tol = 0.1, band = [L.rateBand[0] - tol, L.rateBand[1] + tol];
    if (actual < band[0]) { verdict = L.dir === "gain" ? "Behind" : "Ahead"; vColor = L.dir === "gain" ? "#f9c97e" : "#5cc8df"; }
    else if (actual > band[1]) { verdict = L.dir === "gain" ? "Ahead" : "Behind"; vColor = L.dir === "gain" ? "#5cc8df" : "#f9c97e"; }
  } else verdict = "—", vColor = "var(--text-2)";
  return (
    <Card title="Phase Progress" sub={`${activeP.name} — judged against this phase`} action={<TierBadge tier="calc" />}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 20, fontWeight: 800 }}>{activeP.name}</span>
        <span style={{ fontWeight: 800, color: vColor }}>{verdict}</span>
      </div>
      <div style={{ height: 8, borderRadius: 8, background: "var(--bg-2)", overflow: "hidden", marginBottom: 4 }}><div style={{ width: `${pct}%`, height: "100%", background: ptColor(activeP.type), borderRadius: 8 }} /></div>
      <div style={{ display: "flex", justifyContent: "space-between" }} className="muted small"><span>{formatShortDate(activeP.start)}</span><span>{pct}%</span><span>{formatShortDate(activeP.end)}</span></div>
      <div style={{ marginTop: 12 }}>
        <div className="gp-stat-row"><span className="muted small">Days elapsed / remaining</span><span>{elapsed} / {remaining}</span></div>
        <div className="gp-stat-row"><span className="muted small">Planned rate</span><span>{activeP.targetRateKgWk > 0 ? "+" : ""}{activeP.targetRateKgWk} kg/wk</span></div>
        <div className="gp-stat-row"><span className="muted small">Actual rate (this phase)</span><span style={{ color: vColor }}>{actual != null ? `${actual > 0 ? "+" : ""}${actual} kg/wk` : "— need 2+ weigh-ins"}</span></div>
        <div className="gp-stat-row"><span className="muted small">Phase target band</span><span>{L.rateBand[0]} … {L.rateBand[1]} kg/wk</span></div>
      </div>
    </Card>
  );
}

function V3Trajectory({ gp, derived, activeP, data, goals }) {
  const metrics = useCurrentMetrics(data, goals, activeP);
  const rec = useMemo(() => computeRecoveryCapacity(data, goals, getTodayStr()), [data, goals]);
  const fat = useMemo(() => computeFatigue(data, goals, getTodayStr()), [data, goals]);
  const hist = useMemo(() => computeHistoricalPhases(data, goals.profile || {}, getTodayStr()), [data, goals]);
  const trans = activeP ? suggestTransitions(activeP.name, {}) : (hist.ready && hist.current ? suggestTransitions(hist.current.label, {}) : null);
  const L = activeP ? activeP.lens : null;
  // weight trajectory: planned from active phase, actual points
  const wpts = (data.weight || []).filter(w => w && (w.kg != null || w.weight != null)).map(w => ({ date: w.date, kg: w.kg != null ? w.kg : w.weight }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <V3PhaseProgress activeP={activeP} metrics={metrics} />

      <Card title="Weight Trajectory" sub={activeP ? `planned vs actual vs forecast — ${activeP.name} target` : "planned vs actual"} action={<TierBadge tier="forecast" />}>
        {!activeP || wpts.length < 1 ? <Empty icon="◷" title="Not enough weight data" hint="Log your weight to see planned vs actual vs forecast against this phase." /> : (
          <V3WeightChart phase={activeP} pts={wpts} />
        )}
      </Card>

      <Card title="Recovery & Fatigue" sub={activeP ? `evaluated against ${activeP.name} requirements` : "two sides of one decision"} action={<TierBadge tier="estimate" />}>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, background: "var(--bg-2)", borderRadius: 12, padding: "12px 10px", textAlign: "center" }}>
            <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>Recovery</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: rec.ready ? rec.bandColor : "var(--text-2)" }}>{rec.ready ? rec.score : "—"}</div>
            <div className="small" style={{ color: rec.ready ? rec.bandColor : "var(--text-2)" }}>{rec.ready ? rec.band : "no data"}</div>
            {rec.ready && L && <div className="small" style={{ marginTop: 3, color: rec.score >= L.recoveryFloor ? "#8fd989" : "#f47e6e" }}>{rec.score >= L.recoveryFloor ? "✓ meets" : "below"} floor {L.recoveryFloor}</div>}
          </div>
          <div style={{ flex: 1, background: "var(--bg-2)", borderRadius: 12, padding: "12px 10px", textAlign: "center" }}>
            <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>Fatigue</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: fat.ready ? fat.bandColor : "var(--text-2)" }}>{fat.ready ? fat.finalFatigue : "—"}</div>
            <div className="small" style={{ color: fat.ready ? fat.bandColor : "var(--text-2)" }}>{fat.ready ? fat.band : "no data"}</div>
            {fat.ready && L && <div className="small" style={{ marginTop: 3, color: fat.finalFatigue <= L.fatigueCeiling ? "#8fd989" : "#f47e6e" }}>{fat.finalFatigue <= L.fatigueCeiling ? "✓ under" : "over"} ceiling {L.fatigueCeiling}</div>}
          </div>
        </div>
        {fat.ready && (
          <>
            <div className="gp-stat-row"><span className="muted small">Acute readiness</span><span style={{ color: fat.readinessColor, fontWeight: 700 }}>{fat.readiness}</span></div>
            <div className="gp-stat-row"><span className="muted small">Recovery formula</span><span className="small muted">0.35 Sleep · 0.30 Nutr · 0.20 Stress · 0.15 Rest</span></div>
            <div className="gp-stat-row"><span className="muted small">Fatigue layers</span><span className="small muted">Perf {fat.layers.performance} · Well {fat.layers.wellness} · Load {fat.layers.load}</span></div>
            {fat.deload.recommended ? (
              <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(244,126,110,0.1)", border: "1px solid rgba(244,126,110,0.35)" }}>
                <div style={{ fontWeight: 700, color: "#f47e6e", fontSize: 13 }}>⚠ Deload recommended</div>
                <p className="small" style={{ margin: "4px 0 0", color: "var(--text-2)", lineHeight: 1.45 }}>{fat.deload.corroborators.join("; ")}.</p>
              </div>
            ) : <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 10, background: "rgba(143,217,137,0.08)", border: "1px solid rgba(143,217,137,0.25)" }}><span className="small" style={{ color: "#8fd989" }}>✓ No deload indicated.</span></div>}
          </>
        )}
        <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>Recovery and fatigue are separate models shown together. {rec.note}</p>
      </Card>

      <Card title="Historical Context" sub="what you're coming out of — calories classify, weight validates" action={hist.ready ? <TierBadge tier="estimate" /> : null}>
        {!hist.ready ? <Empty icon="◷" title="Not enough history" hint={hist.reason} /> : (
          <>
            <V3HistoryChart hist={hist} />
            <V3AdaptChart hist={hist} />
            <p className="small" style={{ lineHeight: 1.5, margin: "10px 0 10px" }}>You're currently coming out of a <b style={{ color: HIST_COLOR[hist.current && hist.current.key] || "var(--text)" }}>{hist.current && hist.current.label}</b> phase. Maintenance, adaptation, and classification recalculate <b style={{ color: "var(--text)" }}>weekly</b> from the prior 7 days; a phase change must hold 2 weeks before it's confirmed, so refeeds don't create false phases.</p>
            {hist.phases.slice(-5).map((p, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                <div style={{ width: 3, borderRadius: 3, background: HIST_COLOR[p.key] || "var(--line)", alignSelf: "stretch" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}><span className="small" style={{ fontWeight: 700 }}>{p.label}</span><span className="muted small" style={{ whiteSpace: "nowrap" }}>{formatShortDate(p.start)} → {formatShortDate(p.end)}</span></div>
                  <div className="muted small" style={{ marginTop: 1 }}>{p.avgCalories} kcal · maint {p.maintenanceStart}→{p.maintenanceEnd} · balance {p.delta > 0 ? "+" : ""}{p.delta}{p.weightChange != null ? ` · ${p.weightStart}→${p.weightEnd}kg` : ""} · <span style={{ color: HIST_BAND_COLOR[p.confidenceBand] }}>{p.confidence}% {p.confidenceBand}</span></div>
                </div>
              </div>
            ))}
            {trans && trans.recommended && (
              <div style={{ marginTop: 12, padding: "11px 12px", borderRadius: 10, background: "var(--bg-2)" }}>
                <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>What would make sense next</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><span className="small muted">{trans.fromLabel}</span><span className="muted">→</span><span style={{ fontSize: 13, fontWeight: 700, color: "#8fd989" }}>{trans.recommendedLabel}</span></div>
                <p className="small" style={{ color: "var(--text-2)", lineHeight: 1.45, margin: 0 }}>{(trans.options.find(o => o.to === trans.recommended) || {}).why}</p>
                <p className="muted small" style={{ marginTop: 6 }}>{trans.note}</p>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

const HIST_COLOR = { aggressiveCut: "#f47e6e", cut: "#f0a868", maintenance: "#7d8aa0", leanBulk: "#8fd989", bulk: "#4a9d5f" };
const HIST_BAND_COLOR = { High: "#8fd989", Medium: "#f9c97e", Low: "#f0a868" };

function V3HistoryChart({ hist }) {
  const [hover, setHover] = useState(null);
  const trend = hist.calorieTrend.filter(p => p.rolling != null);
  if (trend.length < 2) return null;
  const mAt = {}; hist.maintenanceTrend.forEach(p => (mAt[p.date] = p.maintenance));
  const wAt = {}; hist.weightTrend.forEach(p => (wAt[p.date] = p.kg));
  const W = 340, H = 176, padL = 38, padR = 30, padT = 12, padB = 22;
  const d0 = new Date(trend[0].date), d1 = new Date(trend[trend.length - 1].date);
  const span = (d1 - d0) || 1;
  const x = iso => padL + ((new Date(iso) - d0) / span) * (W - padL - padR);
  const cals = trend.map(p => p.rolling).concat(hist.maintenanceTrend.map(p => p.maintenance));
  const lo = Math.min(...cals) - 120, hi = Math.max(...cals) + 120;
  const y = c => padT + (1 - (c - lo) / (hi - lo || 1)) * (H - padT - padB);
  const wkg = hist.weightTrend.filter(p => p.kg != null).map(p => p.kg);
  const hasW = wkg.length >= 2;
  const wLo = hasW ? Math.min(...wkg) - 0.5 : 0, wHi = hasW ? Math.max(...wkg) + 0.5 : 1;
  const wy = kg => padT + (1 - (kg - wLo) / (wHi - wLo || 1)) * (H - padT - padB);
  const calLine = "M " + trend.map(p => `${x(p.date).toFixed(1)} ${y(p.rolling).toFixed(1)}`).join(" L ");
  const maintLine = "M " + hist.maintenanceTrend.map(p => `${x(p.date).toFixed(1)} ${y(p.maintenance).toFixed(1)}`).join(" L ");
  const wPts = hist.weightTrend.filter(p => p.kg != null);
  const wLine = hasW ? "M " + wPts.map(p => `${x(p.date).toFixed(1)} ${wy(p.kg).toFixed(1)}`).join(" L ") : null;
  const yTicks = [lo, (lo + hi) / 2, hi].map(Math.round);
  return (
    <div style={{ position: "relative", marginBottom: 12 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }} onMouseLeave={() => setHover(null)}>
        {hist.phases.map((p, i) => { const x0 = x(p.start), x1 = x(p.end); return (
          <rect key={i} x={x0} y={padT} width={Math.max(1, x1 - x0)} height={H - padT - padB} fill={HIST_COLOR[p.key] || "#7d8aa0"} opacity={hover === i ? 0.3 : 0.14} onMouseEnter={() => setHover(i)} style={{ cursor: "pointer" }} />
        ); })}
        {yTicks.map((c, i) => <g key={i}><line x1={padL} y1={y(c)} x2={W - padR} y2={y(c)} stroke="var(--line)" strokeWidth="0.5" opacity="0.5" /><text x={4} y={y(c) + 3} fill="var(--text-2)" fontSize="8">{c}</text></g>)}
        {hist.detectedTransitions.map((tr, i) => <line key={i} x1={x(tr.date)} y1={padT} x2={x(tr.date)} y2={H - padB} stroke="var(--text)" strokeWidth="0.6" strokeDasharray="2 2" opacity="0.4" />)}
        <path d={maintLine} fill="none" stroke="#cbd3e1" strokeWidth="1.6" strokeDasharray="5 3" />
        {wLine && <path d={wLine} fill="none" stroke="#a78bda" strokeWidth="1.6" opacity="0.85" />}
        <path d={calLine} fill="none" stroke="var(--accent)" strokeWidth="2" />
        {hasW && [wLo + 0.5, wHi - 0.5].map((kg, i) => <text key={i} x={W - padR + 3} y={wy(kg) + 3} fill="#a78bda" fontSize="8">{kg.toFixed(0)}</text>)}
      </svg>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 2 }}>
        <span className="small" style={{ color: "var(--accent)" }}>— calories</span>
        <span className="small" style={{ color: "#cbd3e1" }}>— — dynamic maintenance</span>
        {hasW && <span className="small" style={{ color: "#a78bda" }}>— weight</span>}
      </div>
      {hover != null && hist.phases[hover] && (() => { const p = hist.phases[hover]; return (
        <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10, background: "var(--bg-2)", border: `1px solid ${HIST_COLOR[p.key]}55` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontWeight: 700, color: HIST_COLOR[p.key] }}>{p.label}</span><span className="muted small">{formatShortDate(p.start)} → {formatShortDate(p.end)}</span></div>
          <div className="muted small" style={{ marginTop: 3, lineHeight: 1.5 }}>{p.avgCalories} kcal · balance {p.delta > 0 ? "+" : ""}{p.delta}<br />maintenance {p.maintenanceStart}→{p.maintenanceEnd} · adaptation {p.adaptationStart}→{p.adaptationEnd}{p.weightChange != null ? ` · weight ${p.weightStart}→${p.weightEnd}kg` : ""}<br /><span style={{ color: HIST_BAND_COLOR[p.confidenceBand] }}>{p.confidence}% {p.confidenceBand}</span></div>
        </div>
      ); })()}
    </div>
  );
}

function V3AdaptChart({ hist }) {
  const at = hist.adaptationTrend;
  if (!at || at.length < 2) return null;
  const W = 340, H = 70, padL = 38, padR = 30, padT = 8, padB = 14;
  const d0 = new Date(at[0].date), d1 = new Date(at[at.length - 1].date);
  const span = (d1 - d0) || 1;
  const x = iso => padL + ((new Date(iso) - d0) / span) * (W - padL - padR);
  const lo = -250, hi = 20;
  const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const line = "M " + at.map(p => `${x(p.date).toFixed(1)} ${y(p.adaptation).toFixed(1)}`).join(" L ");
  return (
    <div style={{ marginTop: 6 }}>
      <div className="muted small" style={{ fontWeight: 600, marginBottom: 2 }}>Adaptive thermogenesis over time</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
        {[0, -100, -200].map((v, i) => <g key={i}><line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="var(--line)" strokeWidth="0.5" opacity="0.5" /><text x={4} y={y(v) + 3} fill="var(--text-2)" fontSize="8">{v}</text></g>)}
        <path d={`${line} L ${x(at[at.length - 1].date)} ${y(0)} L ${x(at[0].date)} ${y(0)} Z`} fill="#f0a868" opacity="0.12" />
        <path d={line} fill="none" stroke="#f0a868" strokeWidth="1.8" />
      </svg>
      <p className="muted small" style={{ margin: "2px 0 0" }}>Metabolic adaptation accumulates during cuts (toward −250) and recovers toward 0 at maintenance/surplus.</p>
    </div>
  );
}

const PHASE_COLOR2 = key => ({ aggressiveDeficit: "#f47e6e", deficit: "#f0a868", maintenance: "#7d8aa0", leanBulk: "#8fd989", aggressiveSurplus: "#5cc8df" }[key] || "var(--line)");

function V3WeightChart({ phase, pts }) {
  const w = 320, h = 150, pad = 28;
  const start = new Date(phase.start), end = new Date(phase.end), today = new Date(getTodayStr());
  const x = d => pad + ((new Date(d) - start) / (end - start)) * (w - pad * 2);
  const inPhase = pts.filter(p => p.date >= phase.start).sort((a, b) => a.date.localeCompare(b.date));
  const allKg = [phase.startWeight, phase.endWeight, ...inPhase.map(p => p.kg)];
  const minW = Math.min(...allKg) - 0.5, maxW = Math.max(...allKg) + 0.5;
  const y = kg => h - pad - ((kg - minW) / (maxW - minW || 1)) * (h - pad * 2);
  const plannedPath = `M ${x(phase.start)} ${y(phase.startWeight)} L ${x(phase.end)} ${y(phase.endWeight)}`;
  const actualPath = inPhase.length >= 2 ? "M " + inPhase.map(p => `${x(p.date)} ${y(p.kg)}`).join(" L ") : null;
  // forecast: from last actual at current trend to end
  let forecastPath = null;
  if (inPhase.length >= 2) { const first = inPhase[0], last = inPhase[inPhase.length - 1]; const wks = Math.max(0.5, (new Date(last.date) - new Date(first.date)) / 6048e5); const rate = (last.kg - first.kg) / wks; const endKg = last.kg + rate * ((end - new Date(last.date)) / 6048e5); forecastPath = `M ${x(last.date)} ${y(last.kg)} L ${x(phase.end)} ${y(endKg)}`; }
  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%" }}>
        <line x1={x(getTodayStr())} y1={pad} x2={x(getTodayStr())} y2={h - pad} stroke="var(--line)" strokeDasharray="3 3" />
        <path d={plannedPath} fill="none" stroke="#7d8aa0" strokeWidth="2" strokeDasharray="5 4" />
        {forecastPath && <path d={forecastPath} fill="none" stroke="#f9c97e" strokeWidth="2" strokeDasharray="2 3" />}
        {actualPath && <path d={actualPath} fill="none" stroke={ptColor(phase.type)} strokeWidth="2.5" />}
        {inPhase.map((p, i) => <circle key={i} cx={x(p.date)} cy={y(p.kg)} r="2.5" fill={ptColor(phase.type)} />)}
      </svg>
      <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginTop: 4 }}>
        <span className="small muted">— — Planned</span><span className="small" style={{ color: ptColor(phase.type) }}>— Actual</span><span className="small" style={{ color: "#f9c97e" }}>·· Forecast</span>
      </div>
    </>
  );
}

// ── REPORT ──
function V3Report({ gp, derived, activeP, data, goals }) {
  const metrics = useCurrentMetrics(data, goals, activeP);
  const align = useMemo(() => alignmentFor(activeP, metrics), [activeP, metrics]);
  const fat = useMemo(() => computeFatigue(data, goals, getTodayStr()), [data, goals]);
  const corr = useMemo(() => computeCorrelations(data), [data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* GOAL ALIGNMENT — the hero card */}
      <div style={{ borderRadius: 18, padding: 2, background: activeP ? `linear-gradient(135deg, ${align.color}55, transparent)` : "transparent" }}>
        <Card title="Goal Alignment" sub={activeP ? `are you doing what ${activeP.name} needs?` : "no active phase"}>
          {!activeP || !align.ready ? <Empty icon="◎" title="Need an active phase + data" hint="Once a phase is active and you've logged weight, nutrition, sleep and training, this becomes your executive summary." /> : (
            <>
              <div style={{ textAlign: "center", padding: "8px 0 14px" }}>
                <div style={{ fontSize: 34, fontWeight: 900, color: align.color, letterSpacing: "-0.02em" }}>{align.verdict}</div>
                <div className="muted small">{activeP.name} · {align.confidence} confidence</div>
              </div>
              {align.criteria.map(c => (
                <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: STATUS_DOT[c.status], flexShrink: 0 }} />
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{c.label}</span>
                  <span className="small" style={{ color: "var(--text)" }}>{c.actual}</span>
                  <span className="small muted" style={{ width: 90, textAlign: "right" }}>need {c.target}</span>
                </div>
              ))}
              <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>Every line is judged against what a <b style={{ color: "var(--text)" }}>{activeP.name}</b> phase expects. Change the active phase and these verdicts change with it.</p>
            </>
          )}
        </Card>
      </div>

      <Card title="Correlations" sub="what moves with what — meaningful links only" action={corr.ready ? <TierBadge tier="calc" /> : null}>
        {!corr.ready ? <Empty icon="◷" title="Not enough data yet" hint={corr.reason || "A few weeks of overlapping sleep, nutrition, and training logs are needed to find real relationships."} /> : (
          corr.links.length === 0 ? <p className="muted small">No statistically meaningful relationships stand out yet — keep logging.</p> : corr.links.map((l, i) => (
            <div key={i} style={{ padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span className="small" style={{ fontWeight: 600 }}>{l.a} ↔ {l.b}</span><span className="small" style={{ color: l.dir > 0 ? "#8fd989" : "#f47e6e" }}>{l.dir > 0 ? "+" : ""}{l.r}</span></div>
              <p className="muted small" style={{ margin: "2px 0 0" }}>{l.text}</p>
            </div>
          ))
        )}
      </Card>

      <Card title="AI Coach Report" sub="weekly · specific to your phase & data">
        <V3CoachReport activeP={activeP} metrics={metrics} align={align} fat={fat} data={data} goals={goals} />
      </Card>
    </div>
  );
}

// lightweight correlation pass over daily series (Pearson), meaningful pairs only
function computeCorrelations(data) {
  const days = {};
  const put = (date, k, v) => { if (v == null) return; (days[date] = days[date] || {})[k] = (days[date][k] || 0) + v; };
  (data.sleep || []).forEach(s => { if (s && s.date && s.duration != null) (days[s.date] = days[s.date] || {}).sleep = s.duration; });
  (data.diet || []).forEach(e => { if (e && e.date) { put(e.date, "cal", e.calories || 0); put(e.date, "protein", e.protein || 0); } });
  const dates = Object.keys(days).sort();
  if (dates.length < 14) return { ready: false, reason: "Need ~2 weeks of overlapping logs." };
  const pearson = (xs, ys) => { const n = xs.length; if (n < 8) return null; const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n; let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; } return dx && dy ? num / Math.sqrt(dx * dy) : null; };
  const series = k => dates.map(d => days[d][k]).map(v => (v == null ? NaN : v));
  const pairs = [[["sleep", "Sleep"], ["cal", "Calories"]], [["sleep", "Sleep"], ["protein", "Protein"]], [["protein", "Protein"], ["cal", "Calories"]]];
  const links = [];
  pairs.forEach(([[ka, la], [kb, lb]]) => {
    const A = [], B = []; dates.forEach(d => { if (days[d][ka] != null && days[d][kb] != null) { A.push(days[d][ka]); B.push(days[d][kb]); } });
    const r = pearson(A, B);
    if (r != null && Math.abs(r) >= 0.35) links.push({ a: la, b: lb, r: +r.toFixed(2), dir: r > 0 ? 1 : -1, text: `${Math.abs(r) >= 0.6 ? "Strong" : "Moderate"} ${r > 0 ? "positive" : "negative"} link in your logs.` });
  });
  return { ready: true, links };
}

function V3CoachReport({ activeP, metrics, align, fat, data, goals }) {
  const recs = [];
  if (!activeP) return <Empty icon="◎" title="No active phase" hint="Apply a plan to get phase-specific coaching." />;
  const L = activeP.lens;
  if (align.ready) {
    align.criteria.forEach(c => {
      if (c.status === "bad" || c.status === "warn") {
        if (c.key === "rate") recs.push(`Your weight rate (${c.actual}) is off the ${activeP.name} target of ${c.target}. ${L.dir === "gain" ? "Add ~150–200 kcal/day if you're under." : L.dir === "loss" ? "Tighten the deficit ~150–200 kcal/day if you're not losing fast enough." : "Adjust intake toward maintenance."}`);
        if (c.key === "protein") recs.push(`Protein is ${c.actual} vs a ${c.target} target for this phase — add a ~40g serving/day.`);
        if (c.key === "recovery") recs.push(`Recovery (${c.actual}) is below the floor (${c.target}) a ${activeP.name} needs — prioritise sleep duration and consistency this week.`);
        if (c.key === "fatigue") recs.push(`Fatigue (${c.actual}) is over the ceiling (${c.target}) for this phase.${fat.ready && fat.deload.recommended ? " A deload is indicated." : " Pull back volume slightly."}`);
      }
    });
  }
  if (fat.ready && fat.deload.recommended && !recs.some(r => /deload/i.test(r))) recs.push(`Deload recommended: ${fat.deload.corroborators.join("; ")}.`);
  if (!recs.length) recs.push(`You're aligned with the ${activeP.name} phase across the metrics FitLog can see. Keep the current approach and keep logging weight, food, sleep, and training.`);
  return (
    <>
      <p className="small" style={{ lineHeight: 1.5, marginBottom: 8 }}>For your active <b style={{ color: "var(--text)" }}>{activeP.name}</b> phase, here's what your data says to do:</p>
      {recs.map((r, i) => <p key={i} className="small" style={{ margin: "6px 0", paddingLeft: 14, position: "relative", lineHeight: 1.5 }}><span style={{ position: "absolute", left: 0, color: "var(--accent)" }}>›</span>{r}</p>)}
      <p className="muted small" style={{ marginTop: 8 }}>Generated from your goal, active phase, nutrition, recovery, fatigue, sleep and weight trend. Not generic advice — it changes with your phase and your numbers.</p>
    </>
  );
}

function GoalPlanSection({ data, goals, onSaveGoals, addEntry, deleteEntry }) {
  const [tab, setTab] = useState("traj");
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState(null); // null | "build" | "import"
  const gp = useMemo(() => computeGoalPlan(data, goals), [data, goals]);
  const lastW = (data.weight || []).filter(w => w && w.kg > 0).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  const currentWeight = (gp && gp.currentWeight) || (lastW && lastW.kg) || (goals.profile && goals.profile.weightKg) || null;
  const macros = useMemo(() => computeMacroTargets(data, goals), [data, goals]);

  // Feature 4: when Goal Plan drives macros, keep goals' targets in sync as pace/weight change
  useEffect(() => {
    if (goals.macroMode !== "auto") return;
    if (macros && macros.ready && macrosDiffer(macros, goals)) {
      onSaveGoals({ ...goals, calories: macros.calories, protein: macros.protein, carbs: macros.carbs, fat: macros.fat });
    }
    // eslint-disable-next-line
  }, [goals.macroMode, macros && macros.calories, macros && macros.protein, macros && macros.carbs, macros && macros.fat]);

  // Feature 3: snapshot constraint lever scores weekly so limiting-progress shows movement
  useEffect(() => {
    const c = gp && gp.constraints;
    if (!c || !c.levers || !c.levers.length) return;
    const today = getTodayStr();
    const snaps = data.constraintSnapshots || [];
    const last = snaps[0];
    const gap = last ? (new Date(today) - new Date(last.date)) / 86400000 : 999;
    if (gap >= 7) { const scores = {}; c.levers.forEach(l => { scores[l.key] = l.score; }); addEntry("constraintSnapshots")({ id: Date.now(), date: today, scores }); }
    // eslint-disable-next-line
  }, [gp && gp.constraints && gp.constraints.levers && gp.constraints.levers.length]);

  const consPrev = useMemo(() => {
    const snaps = (data.constraintSnapshots || []).filter(s => (new Date(getTodayStr()) - new Date(s.date)) / 86400000 >= 6);
    return snaps.length ? snaps[0].scores : null;
  }, [data.constraintSnapshots]);

  const hasGoal = goals.goalPlan && goals.goalPlan.goalWeight != null;
  const brand = <div className="gp-brand"><span className="gp-mark" />Goal Plan</div>;
  const applyPlan = g => { onSaveGoals(g); setMode(null); setEditing(false); setTab("overview"); toast("✦ Plan applied"); haptic(12); };
  const editPlan = g => { onSaveGoals(g); setMode(null); setEditing(true); };

  // No active plan, or user chose "New plan" → the three-card create screen
  if ((!hasGoal && !mode) || mode === "create") {
    const maintenance = macros && macros.ready ? macros.tdee : null;
    return <div className="gp-scope stack">{brand}<PlanCreateScreen goals={goals} currentWeight={currentWeight} profile={goals.profile} maintenance={maintenance} onApply={applyPlan} onEdit={editPlan} onCancel={hasGoal ? () => setMode(null) : null} /></div>;
  }
  // Edit the existing plan (the builder form; imported phases are preserved)
  if (editing) {
    return <div className="gp-scope stack">{brand}<GoalForm goals={goals} currentWeight={currentWeight} hideImport onSave={g => { onSaveGoals(g); setEditing(false); }} onCancel={() => setEditing(false)} /></div>;
  }

  const a = gp && gp.assess, t = gp && gp.trajectory, c = gp && gp.constraints;
  const typeLabel = (GOAL_TYPES.find(x => x.k === goals.goalPlan.type) || {}).label || "Goal";
  const VERDICT = { realistic: ["Realistic", "#8fd989"], aggressive: ["Aggressive", "#f9c97e"], unrealistic: ["Unrealistic", "#f47e6e"] };
  const STATUS = { "on-track": ["On track", "#8fd989"], ahead: ["Ahead", "#5cc8df"], behind: ["Behind", "#f9c97e"], "no-data": ["Not enough data", "#aab2c0"] };
  const sw = goals.goalPlan.startWeight, gw = goals.goalPlan.goalWeight;
  const phases = getPhases(goals.goalPlan);
  const curPhase = activePhase(goals.goalPlan, getTodayStr());
  const nextPhase = phases.filter(p => p.status === "planned")[0] || null;
  const planAnalysis = phases.length ? analyzeRoadmap({ phases, currentWeight, experience: goals.goalPlan.experience || "intermediate" }) : null;
  const phaseName = p => (p ? (p.name || (GOAL_TYPES.find(x => x.k === p.type) || {}).label || p.type) : null);
  const sumBits = [];
  if (a) sumBits.push(a.verdict === "realistic" ? "Your timeline is realistic." : a.verdict === "aggressive" ? "Your pace is a little aggressive — expect some extra fat." : "Your timeline looks unrealistic — consider stretching it.");
  if (t && t.status && t.status !== "no-data") sumBits.push(t.status === "on-track" ? "You're tracking on plan." : t.status === "ahead" ? "You're ahead of plan." : "You're behind plan right now.");
  if (c && c.primary) sumBits.push(`Biggest lever to fix: ${c.primary.label}.`);

  return (
    <div className="gp-scope stack">
      {tab === "overview" && (
        <>
          <Card title={typeLabel} sub={`${sw ?? "?"}kg → ${gw}kg`} action={<span style={{ display: "flex", gap: 6 }}><button className="btn-ghost btn-sm" onClick={() => setMode("create")}>New plan</button><button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button></span>}>
            <div className="gp-stat-row"><span className="muted small">Current weight</span><span>{currentWeight ?? "—"} kg <TierBadge tier="measured" /></span></div>
            <div className="gp-stat-row"><span className="muted small">Required pace</span><span>{a && a.reqKgWk != null ? `${a.reqKgWk > 0 ? "+" : ""}${a.reqKgWk} kg/wk` : "—"} <TierBadge tier="calc" /></span></div>
            <div className="gp-stat-row"><span className="muted small">Timeline</span><span>{a ? `${Math.round(a.weeks)} weeks` : "—"}</span></div>
            {curPhase && phases.length > 1 && <div className="gp-stat-row"><span className="muted small">Current phase</span><span style={{ color: "#5cc8df" }}>{phaseName(curPhase)} ● now</span></div>}
            {nextPhase && <div className="gp-stat-row"><span className="muted small">Up next</span><span>{phaseName(nextPhase)}{nextPhase.startDate ? ` · ${nextPhase.startDate.slice(5)}` : ""}</span></div>}
          </Card>

          {sumBits.length > 0 && (
            <Card title="Summary" sub="where this plan stands">
              <p className="small" style={{ lineHeight: 1.6, margin: 0 }}>{sumBits.join(" ")}</p>
            </Card>
          )}

          {(() => {
            const circ = computeCircadian(data, getTodayStr());
            const confColor = { high: "#8fd989", moderate: "#f9c97e", low: "#f47e6e" };
            if (!circ.ready) return (
              <Card title="Biological day" sub="your day, by sleep — not midnight" action={<TierBadge tier="calc" />}>
                <Empty icon="◐" title="Learning your rhythm" hint={circ.reason} />
              </Card>
            );
            const bio = todaysBioNutrition(data.diet, circ);
            const calToday = (data.diet || []).filter(d => d.date === getTodayStr()).reduce((a, d) => a + (d.calories || 0), 0);
            return (
              <Card title="Biological day" sub="your day runs wake → sleep, not midnight" action={<span style={{ display: "flex", gap: 6, alignItems: "center" }}><span className="small" style={{ color: confColor[circ.confidence] }}>{circ.confidence}</span><TierBadge tier="calc" /></span>}>
                <div className="gp-stat-row"><span className="muted small">Day window</span><span>{circ.biologicalDayStart} → {circ.biologicalDayEnd}</span></div>
                <div className="gp-stat-row"><span className="muted small">Avg sleep / wake</span><span>{circ.avgSleepTime} / {circ.avgWakeTime}</span></div>
                <div className="gp-stat-row"><span className="muted small">Sleep consistency</span><span>{circ.sleepConsistency}/100</span></div>
                <div style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 8 }}>
                  <div className="gp-stat-row"><span className="muted small">This biological day</span><span>{bio.calories} kcal · {bio.protein}g P <TierBadge tier="measured" /></span></div>
                  {Math.abs(bio.calories - calToday) > 50 && <p className="muted small" style={{ marginTop: 4, lineHeight: 1.45 }}>Calendar-day total is {calToday} kcal — the difference is late-night meals grouped into the right biological day (anything before {circ.biologicalDayEnd} counts toward the previous day).</p>}
                </div>
                <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>Boundary is derived from your last {circ.windowDays} days of sleep logs and shifts as your schedule changes — it's calculated, not exact.</p>
              </Card>
            );
          })()}

          {t && (
            <Card title="Goal trajectory" sub="expected path vs your actual trend" action={<span className="gp-verdict" style={{ fontSize: 12, padding: "2px 10px", color: (STATUS[t.status] || STATUS["no-data"])[1], borderColor: `${(STATUS[t.status] || STATUS["no-data"])[1]}55` }}>{(STATUS[t.status] || STATUS["no-data"])[0]}</span>}>
              <div style={{ marginTop: 4 }}><TrajectoryChart traj={t} pts={gp.actualPts} /></div>
              <div className="gp-legend"><span><i style={{ background: "var(--accent)" }} />Actual</span><span><i className="dash" style={{ background: "var(--muted)" }} />Expected</span><span><i className="dash" style={{ background: "#f9c97e" }} />Projected</span></div>
              <div className="gp-stat-row" style={{ marginTop: 6 }}><span className="muted small">Off plan by</span><span>{t.deviation != null ? `${t.deviation > 0 ? "+" : ""}${t.deviation} kg` : "—"}</span></div>
            </Card>
          )}

          {a ? (
            <Card title="Biological reality check">
              <div className="gp-verdict" style={{ color: (VERDICT[a.verdict] || VERDICT.realistic)[1], borderColor: `${(VERDICT[a.verdict] || VERDICT.realistic)[1]}55` }}>{(VERDICT[a.verdict] || VERDICT.realistic)[0]}</div>
              <p className="muted small" style={{ lineHeight: 1.55, marginTop: 8 }}>{a.note}</p>
              {a.verdict !== "realistic" && a.realisticWeeks && (
                <p className="small" style={{ lineHeight: 1.55, marginTop: 8, color: "var(--text-2)" }}>A realistic version: reach {gw}kg in <b>~{a.realisticWeeks} weeks</b>, or keep your date and target <b>~{a.realisticGoalWeight}kg</b>.</p>
              )}
            </Card>
          ) : <Card><Empty icon="◎" title="Add a goal weight + dates" hint="Once your goal has a target weight and date, the reality check appears here." /></Card>}

          {c && c.primary && (
            <Card title="Key bottleneck" className="gp-primary">
              <div className="gp-primary-name">{c.primary.label} <span className="muted small">{c.primary.score}/100</span></div>
              <p className="small" style={{ lineHeight: 1.55, marginTop: 6 }}>{c.primary.rec}</p>
              <p className="muted small" style={{ marginTop: 6 }}>Your lowest-scoring lever — the highest-ROI fix. Full breakdown in Reports.</p>
            </Card>
          )}

          <Card title="Macros" sub="targets driven by your goal" action={<button className="btn-ghost btn-sm" onClick={() => { onSaveGoals({ ...goals, macroMode: goals.macroMode === "auto" ? "manual" : "auto" }); haptic(6); }}>{goals.macroMode === "auto" ? "Auto · on" : "Auto · off"}</button>}>
            {macros && macros.ready ? (
              <>
                <div className="gp-stat-row"><span className="muted small">Calories</span><span>{macros.calories} kcal <TierBadge tier={macros.tier || "calc"} /></span></div>
                <div className="gp-stat-row"><span className="muted small">Protein</span><span>{macros.protein} g <span className="muted small">({macros.proteinGkg}g/kg)</span></span></div>
                <div className="gp-stat-row"><span className="muted small">Carbs</span><span>{macros.carbs} g</span></div>
                <div className="gp-stat-row"><span className="muted small">Fat</span><span>{macros.fat} g</span></div>
                <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>{macros.note}</p>
                {goals.macroMode === "auto"
                  ? <p className="small" style={{ marginTop: 8, color: "#8fd989", lineHeight: 1.5 }}>✓ Your Log Meal targets are set by Goal Plan and re-adjust as your weight and pace change.</p>
                  : <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button className="btn-primary btn-sm" onClick={() => { onSaveGoals({ ...goals, calories: macros.calories, protein: macros.protein, carbs: macros.carbs, fat: macros.fat }); toast("✦ Macros applied to Log Meal"); haptic(10); }}>Apply once</button>
                      <button className="btn-ghost btn-sm" onClick={() => { onSaveGoals({ ...goals, macroMode: "auto", calories: macros.calories, protein: macros.protein, carbs: macros.carbs, fat: macros.fat }); toast("✦ Goal Plan now drives your macros"); haptic(10); }}>Keep auto-updated</button>
                    </div>}
              </>
            ) : <Empty icon="◎" title="Need weight + profile" hint={macros ? macros.reason : "Add your current weight and profile to compute targets."} />}
          </Card>
        </>
      )}

      {tab === "road" && (
        <>
          {phases.length > 0 && <Card title="Timeline" sub="your roadmap at a glance"><PlanTimeline phases={phases} /></Card>}
          <GoalRoadmapTab goals={goals} currentWeight={currentWeight} />
        </>
      )}

      {tab === "traj" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <FatigueCard data={data} goals={goals} />
          <RecoveryCapacityCard data={data} goals={goals} />
          <HistoricalPhasesCard data={data} goals={goals} />
          <PhaseTransitionCard data={data} goals={goals} />
        </div>
      )}

      {tab === "fore" && (
        <>
          {planAnalysis && planAnalysis.risks.length > 0 && (
            <Card title="Risk & feasibility" sub="across every phase" action={<span className="gp-verdict" style={{ fontSize: 12, padding: "2px 10px", color: (VERDICT[planAnalysis.planVerdict] || VERDICT.realistic)[1], borderColor: `${(VERDICT[planAnalysis.planVerdict] || VERDICT.realistic)[1]}55` }}>{(VERDICT[planAnalysis.planVerdict] || VERDICT.realistic)[0]}</span>}>
              {planAnalysis.risks.map((r, i) => <p key={i} className="small" style={{ margin: "3px 0", color: "var(--text-2)", lineHeight: 1.45 }}>⚠ {r}</p>)}
            </Card>
          )}
          <GoalForecastTab gp={gp} data={data} addEntry={addEntry} />
          <GoalSimulateTab gp={gp} goals={goals} />
        </>
      )}

      {tab === "report" && (
        <>
          <GoalReportTab gp={gp} data={data} addEntry={addEntry} deleteEntry={deleteEntry} />
          <GoalStateTab data={data} goals={goals} onSaveGoals={onSaveGoals} addEntry={addEntry} deleteEntry={deleteEntry} />
        </>
      )}

      {tab === "history" && <GoalHistoryTab data={data} goals={goals} />}
    </div>
  );
}

const RISK_COLOR = { high: "#f47e6e", moderate: "#f9c97e", low: "#8fd989" };
function GoalForecastTab({ gp, data, addEntry }) {
  const p = gp && gp.probability, f = gp && gp.forecasts, risks = (gp && gp.risks) || [];
  // snapshot today's probability once/day so a real trend builds over time
  useEffect(() => {
    if (!p) return;
    const today = getTodayStr();
    const snaps = data.goalSnapshots || [];
    if (!snaps.some(s => s.date === today)) addEntry("goalSnapshots")({ id: Date.now(), date: today, pct: p.pct });
    // eslint-disable-next-line
  }, [p && p.pct]);
  if (!p) return <Card><Empty icon="◎" title="Need a weight trend first" hint="Log your weight for a week or two — the probability and forecasts build on your real trend." /></Card>;
  const snaps = (data.goalSnapshots || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const past = snaps.filter(s => s.date <= daysAgo(21))[0] || snaps[0];
  const delta = past && past.pct != null ? p.pct - past.pct : null;
  return (
    <>
      <Card title="Goal probability" sub="a transparent heuristic — not a trained model, not a guarantee">
        <div className="gp-prob"><span className="gp-prob-num">{p.pct}%</span><span className="muted small">{delta != null ? `${delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} ${delta > 0 ? "+" : ""}${delta}% vs ${formatShortDate(past.date)}` : "tracking starts now"} · confidence {p.confidence} <TierBadge tier="forecast" /></span></div>
        <div className="gp-prob-bar"><div className="gp-prob-fill" style={{ width: `${p.pct}%` }} /></div>
        <div style={{ marginTop: 10 }}>{p.inputs.map((i, k) => <div key={k} className="gp-stat-row"><span className="muted small">{i.label} <span style={{ opacity: .6 }}>({i.w})</span></span><span>{i.val}</span></div>)}</div>
        <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>Blends how your current trend projects onto the goal, your adherence, and whether the goal is biologically realistic. It moves as your data does.</p>
      </Card>
      {f && (
        <Card title="Forecast" sub="if your current trend holds">
          <div className="gp-stat-row"><span className="muted small">In 30 days</span><span>~{f.d30} kg <TierBadge tier="forecast" /></span></div>
          <div className="gp-stat-row"><span className="muted small">In 90 days</span><span>~{f.d90} kg <TierBadge tier="forecast" /></span></div>
          <div className="gp-stat-row"><span className="muted small">At target date</span><span>~{f.atGoalDate} kg vs {f.goalWeight} goal <TierBadge tier="forecast" /></span></div>
          <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>Straight projection of your ~{f.rate} kg/wk trend. Real trajectories curve — treat these as directional.</p>
        </Card>
      )}
      <Card title="Risks" sub="flagged from your current data">
        {risks.length ? risks.map(r => (
          <div key={r.key} className="gp-risk">
            <div className="gp-risk-top"><span className="gp-risk-name"><span className="gp-risk-dot" style={{ background: RISK_COLOR[r.level] }} />{r.label}</span><span className="gp-risk-level" style={{ color: RISK_COLOR[r.level] }}>{r.level}<TierBadge tier={r.tier} /></span></div>
            <p className="muted small" style={{ lineHeight: 1.5, marginTop: 3 }}>{r.why}</p>
          </div>
        )) : <p className="muted small" style={{ lineHeight: 1.5 }}>No notable risks flagged right now — trajectory, recovery and pace all look within range. ✓</p>}
      </Card>
    </>
  );
}

function GpStepper({ label, value, set, min, max, step, fmt, unit }) {
  const dec = () => set(Math.max(min, +(value - step).toFixed(2)));
  const inc = () => set(Math.min(max, +(value + step).toFixed(2)));
  return (
    <div className="gp-sim-row">
      <span className="gp-sim-label">{label}</span>
      <div className="gp-stepper">
        <button onClick={dec} disabled={value <= min}>−</button>
        <span className="gp-sim-val">{fmt ? fmt(value) : value}{unit || ""}</span>
        <button onClick={inc} disabled={value >= max}>+</button>
      </div>
    </div>
  );
}

function GoalSimulateTab({ gp, goals }) {
  const cw = (gp && gp.currentWeight) || 75;
  const baseProt = Math.min(2.4, Math.max(1.4, Math.round((((goals && goals.protein) || 1.8 * cw) / cw) * 5) / 5));
  const baseSleep = Math.min(9, Math.max(5, Math.round(((goals && goals.profile && goals.profile.sleepNeedH) || 8) * 2) / 2));
  const [cal, setCal] = useState(0);
  const [cardio, setCardio] = useState(0);
  const [prot, setProt] = useState(baseProt);
  const [sleep, setSleep] = useState(baseSleep);
  const sim = useMemo(() => simulateGoal({ gp, calDelta: cal, cardioPerWk: cardio, proteinGkg: prot, sleepH: sleep }), [gp, cal, cardio, prot, sleep]);
  if (!gp || !gp.trajectory || gp.trajectory.projectedEnd == null) return <Card><Empty icon="◎" title="Need a weight trend first" hint="Log your weight for a week or two — the simulator projects changes onto your real trend." /></Card>;
  return (
    <>
      <Card title="Simulate a change" sub="shift an input — see where you'd land at your goal date">
        <GpStepper label="Calories / day" value={cal} set={setCal} min={-500} max={500} step={100} fmt={v => `${v > 0 ? "+" : ""}${v}`} />
        <GpStepper label="Cardio sessions / wk" value={cardio} set={setCardio} min={0} max={7} step={1} fmt={v => `+${v}`} />
        <GpStepper label="Protein" value={prot} set={setProt} min={1.4} max={2.4} step={0.2} unit=" g/kg" />
        <GpStepper label="Sleep" value={sleep} set={setSleep} min={5} max={9} step={0.5} unit=" h" />
        <button className="btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => { setCal(0); setCardio(0); setProt(baseProt); setSleep(baseSleep); }}>Reset</button>
      </Card>
      {sim && (
        <Card title="Projected outcome" sub="current trend vs these changes">
          <div className="gp-sim-out">
            <div className="gp-sim-col"><span className="muted small">Current trend</span><div className="gp-sim-big">{sim.baseProjected}<small> kg</small></div></div>
            <span className="gp-sim-arrow">→</span>
            <div className="gp-sim-col"><span className="muted small">With changes</span><div className="gp-sim-big" style={{ color: "var(--accent)" }}>{sim.simProjected}<small> kg</small></div></div>
          </div>
          <div style={{ marginTop: 6 }}>
            <div className="gp-stat-row"><span className="muted small">Net energy shift</span><span>{sim.netDailyKcal > 0 ? "+" : ""}{sim.netDailyKcal} kcal/day</span></div>
            <div className="gp-stat-row"><span className="muted small">Weight effect over {sim.weeksLeft} wks</span><span>{sim.deltaKg > 0 ? "+" : ""}{sim.deltaKg} kg <TierBadge tier="forecast" /></span></div>
            <div className="gp-stat-row"><span className="muted small">vs {sim.goalWeight}kg goal</span><span>{sim.simGap > 0 ? "+" : ""}{sim.simGap} kg · {sim.closer}</span></div>
          </div>
          <div className="gp-sim-env"><b>{sim.env} environment</b> — {sim.envNote}</div>
          {sim.changes.length > 0 && <p className="muted small" style={{ marginTop: 8 }}>Changing: {sim.changes.join(" · ")}.</p>}
          <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>Energy math is ~7700 kcal/kg over your time left; protein & sleep effects are directional, not precise. Confidence {sim.confidence}. A forecast, not a promise.</p>
        </Card>
      )}
    </>
  );
}

function GoalReportTab({ gp, data, addEntry, deleteEntry }) {
  const [busy, setBusy] = useState(false);
  const reports = (data.goalReports || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);
  async function generate() {
    if (!gp || busy) return;
    setBusy(true);
    try {
      const sys = "You are an elite, evidence-based physique coach writing a short weekly check-in from this athlete's computed data. Be specific and cite their actual numbers. Structure: 1) where they are vs plan, 2) adherence, 3) recovery, 4) their primary constraint, 5) the 30/90-day outlook, 6) then 2–4 recommended actions ranked highest-ROI first. Label estimates/forecasts as such; never present a projection as a fact. Keep it tight — no fluff, no markdown headers, short paragraphs.";
      const text = await callClaude({ system: sys, conversationMessages: [{ role: "user", content: `Here is my data:\n${formatGoalText(gp)}\n\nWrite my weekly report.` }], maxTokens: 900 });
      addEntry("goalReports")({ id: Date.now(), date: getTodayStr(), text: text || "Couldn't generate — try again." });
      toast("◎ Report saved"); haptic(8);
    } catch { toast("Couldn't generate — try again"); }
    setBusy(false);
  }
  return (
    <>
      <Card title="Weekly coach report" sub="an AI read of your numbers + ranked next actions">
        <button className="btn full" onClick={generate} disabled={busy || !gp}>{busy ? "Writing your report…" : "Generate this week's report"}</button>
        <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>Built from your trajectory, adherence, recovery, constraints and forecast. Educational coaching, not medical advice.</p>
      </Card>
      {reports.map(r => (
        <Card key={r.id} action={<button className="btn-ghost btn-sm" onClick={() => deleteEntry("goalReports")(r.id)}>×</button>}>
          <div className="muted small" style={{ marginBottom: 6, fontWeight: 600 }}>{formatShortDate(r.date)}</div>
          <div className="gp-report-body">{r.text}</div>
        </Card>
      ))}
    </>
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

