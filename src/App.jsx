import { useState, useEffect, useRef, useMemo } from "react";
import { supabase, hasSupabase } from "./supabase";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { STORAGE_KEY } from "./lib/keys";
import { haptic, SFX, soundEnabled, setSoundPref } from "./lib/fx";
import { Ring, MacroDonut, MiniChart, Card, Empty, toast, ToastHost, ConfirmModal, useConfirm } from "./components/primitives";
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

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TABS = ["Home", "Log", "History", "Coach", "Journal", "Settings", "Ejac"];
const defaultData = { sleep: [], diet: [], exercise: [], sports: [], water: [], supplements: [], nicotine: [], nicotinePlans: [], journal: [], weight: [], ejac: [], skin: [], skinResearch: [], skinProcedures: [], plannedSessions: [], skinRoutineLogs: [], skinProductIntros: [], skinRoutineChanges: [], skinCoachPlans: [], goalSnapshots: [], goalReports: [], completedPhases: [], decisionLog: [], constraintSnapshots: [] };
const defaultProfile = {
  // Body
  sex: "", age: "", heightCm: "", weightKg: "",
  // Background
  trainingExp: "", // beginner | intermediate | advanced
  liftingBackground: "", // free text — historical PRs, years lifting, lifetime context (not strategy)
  // Constraints
  injuries: "", // free text
  allergies: "", // free text
  equipment: "", // gym | home | minimal | other
  // Preferences and short-term life context
  preferences: "", // free text
  lifeContext: "", // free text - "stressful work month", "sister's wedding in 8wks", etc
  // Sleep
  sleepNeedH: "", // optional override of learned individual sleep need (hours)
};

const defaultStrategy = {
  phase: "", // bulk | cut | maintenance | recomp | performance | (empty)
  focus: "", // strength | hypertrophy | conditioning | fat loss | general
  blockStarted: "", // YYYY-MM-DD when current block started
  blockWeeks: "", // target length of current block, e.g. "6"
  notes: "", // free text — anything else the AI should know about strategy right now
};

const defaultGoals = { calories: 2500, protein: 180, carbs: 250, fat: 80, goal: "Build Muscle", waterGoalMl: 2500, profile: defaultProfile, strategy: defaultStrategy, sleepScreen: null, sleepExperiment: null, skinRoutine: { am: [], pm: [] }, skinExperiment: null, goalPlan: null, macroMode: "manual" };
const fitnessGoals = ["Build Muscle", "Lose Fat", "Improve Endurance", "Maintain Weight", "Athletic Performance"];
const mealTypes = ["Breakfast", "Lunch", "Dinner", "Snack"];
const sportsOptions = ["Running","Football","Basketball","Tennis","Swimming","Cycling","Yoga","Boxing","Soccer","Volleyball","Badminton","Table Tennis","Golf","Martial Arts","Hiking","Walking","Rowing","Climbing","Other"];
const sleepQuality = ["Poor", "Fair", "Good", "Great", "Excellent"];
const intensityLevels = ["Light", "Moderate", "Intense", "All-out"];

// ─── NICOTINE ─────────────────────────────────────────────────────────────────
const NIC_TYPES = [
  { key: "cigarette", label: "Cigarette", icon: "🚬", unit: "cigarettes", combustion: true },
  { key: "vape", label: "Vape", icon: "💨", unit: "puffs", combustion: false },
  { key: "pouch", label: "Pouch", icon: "⬜", unit: "pouches", combustion: false },
];
const NIC_CONTEXTS = ["craving", "stress", "social", "post-meal", "post-workout", "boredom", "drinking", "after waking"];
// One-tap defaults shown as quick-add chips. User's common entries.
const NIC_QUICK = [
  { type: "cigarette", amount: 1, label: "1 cig" },
  { type: "vape", amount: 10, label: "Vape (10 puffs)" },
  { type: "vape", amount: 1, label: "1 puff" },
  { type: "pouch", amount: 1, mg: 6, label: "Pouch 6mg" },
];
// Approx nicotine mg per unit, for a rough combined "nicotine load" estimate.

// ─── WORKOUT PLANNING ─────────────────────────────────────────────────────────
const SPLIT_TYPES = [
  "Push / Pull / Legs",
  "Upper / Lower",
  "Full Body",
  "Bro Split (1 muscle/day)",
  "Arnold Split",
  "Custom",
];
const defaultPlan = { split: "Push / Pull / Legs", trainingDays: ["Mon", "Tue", "Thu", "Fri", "Sat"], assignments: {}, notes: "" };

const TYPE_DOT = { sleep: "#6ee7f7", diet: "#f9c97e", exercise: "#f47e6e", sports: "#8fd989", water: "#5cc8df", supplements: "#b4a8e8", nicotine: "#d98fa8", weight: "#e8c97e", ejac: "#9aa8e8" };
const TYPE_ICON = { sleep: "◐", diet: "◉", exercise: "◆", sports: "◇", water: "◊", supplements: "⊕" };

// ─── AI MODEL PREFERENCE ──────────────────────────────────────────────────────
const MODELS = {
  haiku: { id: "claude-haiku-4-5", label: "Haiku", desc: "Fast & cheap — great for everyday logging" },
  sonnet: { id: "claude-sonnet-4-20250514", label: "Sonnet", desc: "Smartest — best accuracy, costs ~12x more" },
};
function loadModelPref() {
  try { return localStorage.getItem(STORAGE_KEY + "_model") === "sonnet" ? "sonnet" : "haiku"; } catch { return "haiku"; }
}
function saveModelPref(key) { localStorage.setItem(STORAGE_KEY + "_model", key); _currentModel = key; }
let _currentModel = (() => { try { return localStorage.getItem(STORAGE_KEY + "_model") === "sonnet" ? "sonnet" : "haiku"; } catch { return "haiku"; } })();
function currentModelId() { return MODELS[_currentModel]?.id || MODELS.haiku.id; }

// ─── STORAGE ──────────────────────────────────────────────────────────────────
function loadData() {
  try { const r = localStorage.getItem(STORAGE_KEY); const p = r ? JSON.parse(r) : defaultData; return { ...defaultData, ...p }; }
  catch { return defaultData; }
}
function loadGoals() {
  try {
    const r = localStorage.getItem(STORAGE_KEY + "_goals");
    const p = r ? JSON.parse(r) : defaultGoals;
    const merged = { ...defaultGoals, ...p };
    // Deep-merge nested objects so existing users get any new fields we add later.
    merged.profile = { ...defaultProfile, ...(p.profile || {}) };
    merged.strategy = { ...defaultStrategy, ...(p.strategy || {}) };
    // Existing users (who already saved goals before onboarding existed) skip the intro.
    if (r && merged.onboarded === undefined) merged.onboarded = true;
    return merged;
  } catch { return defaultGoals; }
}
const saveData = d => localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
const saveGoals = g => localStorage.setItem(STORAGE_KEY + "_goals", JSON.stringify(g));

// ─── CLOUD SYNC ───────────────────────────────────────────────────────────────
// Tracks the currently signed-in user so any localStorage write can trigger a sync.
let _currentUserId = null;
function setCurrentUser(id) { _currentUserId = id; }

// Pushes the full {data, goals, chat} bundle to Supabase for the logged-in user.
// Debounced so rapid edits don't spam the server.
let _syncTimer = null;
function cloudSync(userId) {
  const uid = userId || _currentUserId;
  if (!hasSupabase || !uid) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(async () => {
    try {
      const payload = {
        user_id: uid,
        data: loadData(),
        goals: loadGoals(),
        chat: JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]"),
        updated_at: new Date().toISOString(),
      };
      await supabase.from("fitlog_data").upsert(payload, { onConflict: "user_id" });
    } catch (e) { /* offline — will retry on next change */ }
  }, 1200);
}

// Pulls cloud data into localStorage. Returns true if cloud had data.
async function cloudPull(userId) {
  if (!hasSupabase || !userId) return false;
  const { data: row, error } = await supabase.from("fitlog_data").select("*").eq("user_id", userId).maybeSingle();
  if (error || !row) return false;
  const cloudData = row.data || {};
  const hasAny = Object.values(cloudData).some(arr => Array.isArray(arr) && arr.length > 0);
  if (!hasAny && (!row.chat || row.chat.length <= 1)) return false; // cloud effectively empty
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultData, ...cloudData }));
  localStorage.setItem(STORAGE_KEY + "_goals", JSON.stringify({ ...defaultGoals, ...(row.goals || {}) }));
  if (row.chat) localStorage.setItem(STORAGE_KEY + "_chat", JSON.stringify(row.chat));
  return true;
}

// Pushes current local data up immediately (used on first sign-in when cloud is empty).
async function cloudPushNow(userId) {
  if (!hasSupabase || !userId) return;
  try {
    await supabase.from("fitlog_data").upsert({
      user_id: userId,
      data: loadData(),
      goals: loadGoals(),
      chat: JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]"),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  } catch (e) {}
}

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
async function fileToResizedBase64(file, maxDim = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        // Use JPEG for photos — much smaller than PNG
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg", preview: dataUrl });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ─── THE BRAIN ────────────────────────────────────────────────────────────────
// Single source of truth for every AI call. Pre-computes the patterns and insights
// the model would otherwise have to derive from raw data — so every feature gets
// the same sharp understanding of where the user is right now.
// ─── WEIGHT TREND ENGINE (A1) ───────────────────────────────────────────────
// Deterministic. Smooths raw scale weight with an EWMA to strip out daily
// water / glycogen / gut noise, then reports rate of change (g/wk and %BW/wk),
// direction, and a raw-vs-trend divergence note. Returns null when there's no
// weight data so the brain and UI can skip the section entirely.

// ─── PROTEIN DISTRIBUTION / MPS ENGINE (B1) ─────────────────────────────────
// Deterministic, needs NO new data — runs on the per-meal protein + timestamps
// already logged. Muscle protein synthesis is maximized per eating-occasion by
// crossing a ~0.4 g/kg leucine-trigger dose, and total daily MPS is higher with
// 3–5 such feedings spread out than with the same protein crammed into 1–2 big
// meals. Counts "effective feedings", skew, the largest protein gap, and
// pre-sleep coverage, then feeds the brain + a UI card.

// Cluster a day's diet entries into feedings: timed entries within 45 min chain
// into one feeding (protein summed); untimed entries group by meal label so
// itemized logging (chicken + rice at lunch) counts as ONE feeding, not two.


// ─── INSIGHT PRIORITIZATION ENGINE (F1) ─────────────────────────────────────
// The engines (A1/B1/D1 + the pattern detectors) each push insights with a
// priority tier, and they already gate out anything below Moderate confidence —
// so confidence is handled upstream. This layer scores the remaining insights by
// IMPACT (priority) × ACTIONABILITY (does it embed a concrete next step?), ranks
// them, and dedupes by topic into a single headline focus list. Nothing is
// dropped from the full list; dedupe only shapes the top-N.



// Helpers for time math. avgTimeHHMM averages a list of "HH:MM" strings.
// `wrapPM` handles bedtime (treating 00:00–05:00 as the same night, after midnight, by adding 24h).

// Turns the brain object into a tight text block every AI prompt gets.
// Pre-digested signals at the top so the model immediately knows what matters.

// Compute hours between two HH:MM times (last minus first), wrapping over midnight is not an issue here
// since first/last meal of a day are by definition same-day.

// ─── COACHING PRINCIPLES ──────────────────────────────────────────────────────
// The opinionated philosophy injected into every AI system prompt. This is what
// separates a "smart calculator" from a coach with a point of view.
const COACH_PRINCIPLES = `COACHING PRINCIPLES — apply consistently:
- Recovery is the LEADING indicator of progress. Sleep and food fuel adaptation; training without them is just damage.
- Consistency beats intensity. 80% effort sustained beats occasional 100%.
- Protein consistency > calorie exactness. Hit protein every day; calories average out across a week.
- Compound lifts and progressive overload over isolation and novelty.
- Sleep debt is non-negotiable. If sleep is broken, fix it before adding training volume.
- Respect deload signals. Pushing through warnings shortens the runway.
- The body adapts to specific stimulus over time, not in a single workout.

LANGUAGE — coach like a coach, not a chatbot:
- Give CONCRETE actions with numbers. "Eat 6 extra eggs tomorrow" not "consider adding more protein."
- Never use "consider", "you might", "aim for" — say what to do.
- Reference the user's ACTUAL numbers from the data block in every recommendation.
- Lead with the ONE thing that matters most right now. Resist listing everything.
- Use the user's profile and strategy (if provided). Respect their injuries, allergies, equipment, and current life context.
- Honor the WINS — acknowledge what's working when it fits naturally. Don't only point at problems.`;

// ─── CLAUDE API ───────────────────────────────────────────────────────────────
async function callClaude({ system, userText, imageBase64, imageMediaType, maxTokens = 1000, conversationMessages, tools, model }) {
  const useModel = model || currentModelId();
  const apiMessages = conversationMessages || [{
    role: "user",
    content: imageBase64
      ? [{ type: "image", source: { type: "base64", media_type: imageMediaType, data: imageBase64 } }, { type: "text", text: userText }]
      : userText
  }];
  const body = { model: useModel, max_tokens: maxTokens, system, messages: apiMessages };
  if (tools) body.tools = tools;
  const headers = { "Content-Type": "application/json" };
  if (hasSupabase) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    } catch { /* anonymous — proceed without token */ }
  }
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  // Concatenate all text blocks (web search adds extra block types we ignore here)
  return data.content?.filter(b => b.type === "text").map(b => b.text || "").join("") || "";
}

// The web search tool — lets Claude look up real nutrition data for branded/restaurant foods.
const WEB_SEARCH_TOOL = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];

// Robustly pull a JSON object out of a response that may contain prose around it,
// markdown fences, trailing commas, or smart quotes.
function extractJSON(raw) {
  if (!raw || typeof raw !== "string") throw new Error("Empty AI response");
  let s = raw.replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  s = s.replace(/,\s*([}\]])/g, "$1"); // remove trailing commas
  try {
    return JSON.parse(s);
  } catch {
    const s2 = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
    return JSON.parse(s2);
  }
}

async function estimateSportsCalories(sport, duration, intensity, weight) {
  try {
    const raw = await callClaude({
      model: currentModelId(),
      maxTokens: 600,
      system: "You are a sports physiologist. Calculate calories burned using the correct MET (metabolic equivalent) value for the given sport and intensity. Formula: calories = MET × weight(kg) × hours. Use standard Compendium of Physical Activities MET values. Be accurate, not generous. Reply with ONLY the JSON object.",
      userText: `Calculate calories burned: sport="${sport}", duration=${duration} min, intensity="${intensity}", bodyweight=${weight}kg. Return JSON: {"calories":<number>,"met":<number>,"note":"<the MET used, 1 sentence>"}`,
    });
    return extractJSON(raw);
  } catch { return { calories: 0, note: "Could not estimate." }; }
}

// useWeb = true only when the user opts in (branded/restaurant foods). Keeps cost low by default.
// ─── BARCODE LOOKUP (Open Food Facts) ────────────────────────────────────────
// Free, no API key. Returns normalized nutrition or null if not found.
async function lookupBarcode(code) {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments,serving_size,quantity`;
    const resp = await fetch(url, { headers: { "User-Agent": "FitLog/1.0 (personal fitness tracker)" } });
    const data = await resp.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const n = p.nutriments || {};
    const name = [p.brands, p.product_name].filter(Boolean).join(" ").trim() || p.product_name || "Unknown product";
    // Per-100g values (most reliable, always present if any nutrition data exists)
    const per100 = {
      cal: Math.round(n["energy-kcal_100g"] ?? (n["energy_100g"] ? n["energy_100g"] / 4.184 : 0)),
      protein: Math.round((n["proteins_100g"] ?? 0)),
      carbs: Math.round((n["carbohydrates_100g"] ?? 0)),
      fat: Math.round((n["fat_100g"] ?? 0)),
    };
    // Per-serving if available
    const hasServing = n["energy-kcal_serving"] != null || n["proteins_serving"] != null;
    const perServing = hasServing ? {
      cal: Math.round(n["energy-kcal_serving"] ?? (n["energy_serving"] ? n["energy_serving"] / 4.184 : 0)),
      protein: Math.round((n["proteins_serving"] ?? 0)),
      carbs: Math.round((n["carbohydrates_serving"] ?? 0)),
      fat: Math.round((n["fat_serving"] ?? 0)),
    } : null;
    if (!per100.cal && !perServing?.cal) return null; // no usable nutrition data
    return { name, per100, perServing, servingSize: p.serving_size || null, quantity: p.quantity || null, code };
  } catch {
    return null;
  }
}

// Is live barcode scanning supported on this device? (Chrome/Android yes, iOS Safari no)
function barcodeScanSupported() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

async function analyzeFoodAI(description, imageBase64, imageMediaType, useWeb = false, brain = null) {
  const isImage = !!imageBase64;
  const brainText = brain ? formatBrainText(brain) : "";
  const todayPart = brain ? `\n\nFor context, the user's current day so far (don't waste tokens repeating these unless commenting on fit):\n${brainText}` : "";
  try {
    const raw = await callClaude({
      model: currentModelId(),
      maxTokens: useWeb ? 1500 : 1100,
      tools: useWeb ? WEB_SEARCH_TOOL : undefined,
      system: `You are a meticulous nutritionist analyzing real meals. Estimate nutrition as ACCURATELY as possible.

${isImage ? `STEP 1 — LOOK CAREFULLY AT THE PHOTO. Before estimating, identify:
- Every food item you can see (don't miss sides, drinks, condiments, garnishes)
- The cooking method (fried/grilled/baked/raw — affects calories a lot)
- Portion size (compare to plate/utensils/hand in frame)
- Visible ingredients like oil, butter, sauce, cheese, dressing
STEP 2 — Combine everything into total numbers for the whole meal shown.` : ""}

RULES:
- ${useWeb ? "For branded/restaurant/packaged foods, search the web for the official published nutrition facts and use those exact numbers." : "Use precise USDA-style values from your knowledge of real foods."}
- Account for cooking method, oil/butter, sauces, and realistic portion sizes.
- Be realistic — restaurant and fried foods are calorie-dense.
- If multiple items are visible, SUM them all.
- The "notes" field MUST comment on how this meal fits the user's remaining day using SPECIFIC numbers from the context (e.g. "puts you at 1850/2500 cal with 65g protein left", "uses most of today's fat budget — go lean at dinner"). Reference the CURRENT STRATEGY if it provides direction (cut → call out high-calorie hits; bulk → call out under-eating).
- If the meal contains anything in the user's allergies/restrictions, mention it in notes — but still return the estimate.

Reply with ONLY this JSON object (no prose before or after, no markdown fence):
{"food":"<concise meal name>","calories":<integer>,"protein":<integer grams>,"carbs":<integer grams>,"fat":<integer grams>,"confidence":"high|medium|low","notes":"<fit-to-day comment with concrete numbers, 1-2 sentences>"}${todayPart}`,
      userText: description
        ? `Analyze the nutrition of: "${description}".${useWeb ? " Search for official data if this is a branded or restaurant item." : ""}`
        : `Identify EVERY food item in this image and analyze the total nutrition for the whole meal shown.${useWeb ? " If you recognize a branded or restaurant dish, search for its official nutrition facts." : ""}`,
      imageBase64, imageMediaType,
    });
    if (!raw || !raw.trim()) return null;
    return extractJSON(raw);
  } catch (e) { return null; }
}

async function analyzeAllData(data, goals) {
  const brain = buildBrain(data, goals);
  const system = `You are this user's coach reviewing the last 14 days. Score them honestly and surface the ONE thing that will move them the most. Goal: ${goals.goal}.

Use the KEY SIGNALS (ranked by priority) and the ABOUT THE USER + CURRENT STRATEGY sections if provided. Respect their constraints (injuries, allergies). Evaluate progress against their stated strategy.

${COACH_PRINCIPLES}

Return ONLY JSON:
{"overallScore":<1-10>,"summary":"<2-3 sentences referencing specific numbers and their strategy if relevant>","sections":[{"category":"Sleep & Recovery","score":<1-10>,"status":"good|warning|critical","insight":"<specific with their numbers>","tips":["<concrete action with numbers>","<tip>","<tip>"]},{"category":"Nutrition","score":<1-10>,"status":"good|warning|critical","insight":"<specific>","tips":["<tip>","<tip>","<tip>"]},{"category":"Training","score":<1-10>,"status":"good|warning|critical","insight":"<specific>","tips":["<tip>","<tip>","<tip>"]},{"category":"Calorie Balance","score":<1-10>,"status":"good|warning|critical","insight":"<specific>","tips":["<tip>","<tip>","<tip>"]}],"priorityAction":"<the SINGLE most impactful action this week — concrete and specific>"}`;
  const raw = await callClaude({ system, maxTokens: 2200, userText: formatBrainText(brain) });
  return extractJSON(raw);
}

// Suggests which split day goes on each chosen training day.
async function suggestSplitSchedule(plan, goals) {
  const sys = `You are a strength coach. The user follows a "${plan.split}" split and can train on these days: ${plan.trainingDays.join(", ")}. Goal: ${goals.goal}.
Assign a specific workout to each available training day, optimizing recovery (don't put two heavy overlapping sessions back-to-back; space out muscle groups). Days NOT in their available list are rest days.
Return ONLY JSON mapping each available day to a short workout label:
{"assignments":{${plan.trainingDays.map(d => `"${d}":"<label>"`).join(",")}},"rationale":"<1-2 sentence explanation of the arrangement>"}`;
  const raw = await callClaude({ system: sys, maxTokens: 700, userText: `Arrange my ${plan.split} across: ${plan.trainingDays.join(", ")}.` });
  return extractJSON(raw);
}

// Conversational plan builder — the user describes what they want in plain English,
// and the AI designs the entire week: which days to train, the split, day-by-day workouts, and why.
async function buildPlanFromPrompt(prompt, goals, current, data) {
  const brain = data ? buildBrain(data, goals) : null;
  const brainText = brain ? `\n\n=== USER'S CURRENT STATE (factor in: recovery, experience, injuries, strategy) ===\n${formatBrainText(brain)}` : "";

  // Auto-detect sports the user actually logs, and which weekday they fall on.
  let sportsPattern = "";
  if (data?.sports?.length) {
    const byDay = {};
    data.sports.filter(s => s.date >= daysAgo(60)).forEach(s => {
      const wd = WEEKDAYS[(new Date(s.date + "T00:00:00").getDay() + 6) % 7];
      byDay[wd] = byDay[wd] || {};
      byDay[wd][s.sport] = (byDay[wd][s.sport] || 0) + 1;
    });
    const patterns = [];
    Object.entries(byDay).forEach(([wd, sports]) => {
      Object.entries(sports).forEach(([sport, n]) => { if (n >= 2) patterns.push(`${sport} on ${wd} (logged ${n}× recently)`); });
    });
    if (patterns.length) sportsPattern = `\n\n=== SPORTS THE USER REGULARLY PLAYS (auto-detected from their logs — protect related muscles around these days; e.g. don't put heavy legs the day before/after football) ===\n${patterns.join("\n")}`;
  }

  const sys = `You are this user's elite strength coach. They've described, in their own words, how they want their training week. Turn that into a concrete weekly split.

Their stated fitness goal: ${goals.goal}.
${current?.trainingDays?.length ? `Their current plan: split="${current.split}", training days=${current.trainingDays.join(", ")}. They may want to keep or change it.` : ""}

=== HARD RULES (follow exactly) ===
1. PARSE MESSY INPUT CHARITABLY. The user may have typos, slang, shorthand, no punctuation ("futbol", "trian", "shldrs", "chest n arms", "anteriro posteriro", "fridyas"). Always interpret their intent — NEVER return a generic template that ignores what they said, and never reply that you didn't understand. Extract: how many days, which specific days (if named, including misspelled weekdays like "fridyas"=Friday, "tuseday"=Tuesday), muscle/movement priorities, sports, time limits, injuries, and the SPLIT TYPE they named.
   - Recognize any named split even if misspelled or uncommon: Push/Pull/Legs, Upper/Lower, Full Body, Bro Split, Arnold, and ANTERIOR/POSTERIOR (front-chain vs back-chain: anterior = quads, chest, front delts, biceps; posterior = hamstrings, glutes, back, rear delts, triceps). If they name a split, BUILD THAT SPLIT — do not substitute a different one.
   - If they give a clear instruction like "6 days, anterior/posterior, rest on Friday", that is fully specified — build it directly. Six days with Friday rest means train Mon-Thu + Sat-Sun, alternating anterior/posterior.
2. HONOR THE LITERAL REQUEST. If they said a number of days, a specific day, or a focus — that is non-negotiable unless it's clearly unsafe.
3. SUGGEST BETTER, BUT THEY OVERRULE. If their request is suboptimal (e.g. legs the day before their football, or 6 hard days while showing sleep debt), build the SAFER version as your primary plan AND set "alternativeNote" explaining what you changed and why. But if their request is explicit and they'd clearly insist, still respect it — put your concern in "alternativeNote", don't silently override a clear instruction.
4. YOU PICK THE NUMBER OF TRAINING DAYS when the user doesn't specify — based on their goal, experience level, and current recovery (don't prescribe 6 days to someone with sleep debt or a beginner).
5. PROPOSE rest-day placement, but the user makes the final call — so place rest days sensibly and explain the placement; they'll adjust if they want.
6. PROTECT SPORTS: auto-detected sports (below) are real recurring commitments. Keep heavy related muscles away from the day before AND after (football/soccer/running → no heavy legs adjacent).
7. NO ORPHAN MUSCLES: every major muscle group gets trained across the week unless the user explicitly wants a focus/specialization.
8. SENSIBLE SPACING: never the same muscle hard on consecutive days; place rest where fatigue is highest.
9. RESPECT injuries/equipment/life-context from ABOUT THE USER. Honor CURRENT STRATEGY (e.g. deload if late in a block).
10. EXPLAIN EVERY TRAINING DAY with a one-line "why" in dayReasons.

Use the 7 day keys EXACTLY: Mon, Tue, Wed, Thu, Fri, Sat, Sun.
Omit rest days from "assignments" (only include training days). Keep labels short ("Push", "Upper A", "Legs + Core").

${COACH_PRINCIPLES}

Return ONLY valid JSON, no markdown:
{
  "split": "<chosen split name>",
  "trainingDays": ["Mon","Wed",...],
  "assignments": {"Mon":"Push","Wed":"Pull",...},
  "dayReasons": {"Mon":"<one-line why this day is what it is>","Wed":"...","Tue":"Rest — <why>",...},
  "summary": "<2-3 sentences explaining the plan and why it fits THEIR words + data>",
  "alternativeNote": "<if you adjusted or have a concern about their request, explain here — else empty string>",
  "tips": ["<concrete actionable tip>","<tip>"]
}${sportsPattern}${brainText}`;

  const raw = await callClaude({
    model: currentModelId(),
    system: sys,
    maxTokens: 1500,
    userText: `Here's what I want for my training week, in my own words:\n\n"${prompt}"\n\nParse it carefully (typos and all) and design my week.`,
  });
  return extractJSON(raw);
}

// Looks at recent training + sleep to recommend whether to train, go light, or rest/deload today.
async function recommendRest(data, goals) {
  const brain = buildBrain(data, goals);
  const sys = `You are this user's coach deciding TODAY'S call: "train" (go as planned), "light" (active recovery / reduce volume), or "rest" (full rest or deload). Goal: ${goals.goal}.

Decision rules:
- If their plan says rest day → default rest unless data clearly says train.
- Under-eating + heavy recent training → lean toward light/rest.
- Sleep debt + consecutive training days → lean toward rest.
- Well-fed + slept well + on a training day per plan → train.
- Respect injuries/limitations from the ABOUT THE USER section.
- Evaluate against CURRENT STRATEGY if provided (e.g. week 5 of 6 in a strength block likely warrants a deload soon).
- Reference the user's ACTUAL numbers in your reason.

${COACH_PRINCIPLES}

Return ONLY JSON: {"recommendation":"train|light|rest","reason":"<2-3 sentences with concrete numbers>","tip":"<one CONCRETE action — specific, not vague>"}`;
  const raw = await callClaude({
    system: sys,
    maxTokens: 700,
    userText: `${formatBrainText(brain)}\n\nWhat should I do today?`,
  });
  return extractJSON(raw);
}

// Analyzes a physique photo and recommends specific actions toward the user's goal.
async function analyzePhysique(imageBase64, imageMediaType, goals, brain = null) {
  const brainText = brain ? formatBrainText(brain) : "";
  const sys = `You are this user's physique coach. They've shared a photo and want honest, grounded feedback toward their goal: ${goals.goal}.

You have their actual training and nutrition data. USE it. If they've been undereating for weeks, mention how that affects what you see. If training volume is low, factor that in. If protein has been on point, acknowledge it. Tie everything back to their actual numbers and strategy.

Use the ABOUT THE USER section if provided — respect injuries, allergies, equipment access. Use CURRENT STRATEGY to align advice with their current phase.

Be respectful but honest. Avoid generic flattery. Avoid generic advice when their data tells part of the story.

If you can't clearly see the body or the photo isn't appropriate for physique analysis, say so politely and ask for a better photo (relaxed front-facing in good light, fitted clothing or shirtless if comfortable).

${COACH_PRINCIPLES}

Reply with ONLY this JSON, no markdown fence:
{
  "observations": ["<short specific visual observation>", "<observation>", "<observation>"],
  "strengths": ["<what's already developed/looking good>", "<...>"],
  "focusAreas": ["<specific muscle group or aspect to prioritize>", "<...>"],
  "nutritionAdvice": "<2-3 sentences with CONCRETE diet direction, referencing their actual numbers>",
  "trainingAdvice": "<2-3 sentences with CONCRETE training priorities, referencing their actual current week/volume>",
  "summary": "<1 sentence honest overall take + an encouraging closer>"
}${brainText ? `\n\nUser's current state:\n${brainText}` : ""}`;
  const raw = await callClaude({
    model: currentModelId(),
    maxTokens: 1600,
    system: sys,
    userText: `My goal is ${goals.goal}. Give me your honest physique analysis grounded in my actual training and nutrition data.`,
    imageBase64, imageMediaType,
  });
  return extractJSON(raw);
}

// ─── MARKDOWN ─────────────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split("\n");
  const blocks = [];
  let buf = null;
  const flush = () => { if (buf) { blocks.push({ type: buf.type, items: buf.items }); buf = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const b = line.match(/^[-•]\s+(.+)$/);
    const n = line.match(/^\d+\.\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const h1 = line.match(/^#\s+(.+)$/);
    if (b) { if (!buf || buf.type !== "ul") { flush(); buf = { type: "ul", items: [] }; } buf.items.push(b[1]); }
    else if (n) { if (!buf || buf.type !== "ol") { flush(); buf = { type: "ol", items: [] }; } buf.items.push(n[1]); }
    else if (h1) { flush(); blocks.push({ type: "h1", text: h1[1] }); }
    else if (h2) { flush(); blocks.push({ type: "h2", text: h2[1] }); }
    else { flush(); blocks.push({ type: "p", text: line }); }
  }
  flush();
  const inline = (s, key) => {
    const parts = []; let last = 0; const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g; let m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) parts.push({ t: "text", v: s.slice(last, m.index) });
      const tok = m[0];
      if (tok.startsWith("**")) parts.push({ t: "b", v: tok.slice(2, -2) });
      else if (tok.startsWith("`")) parts.push({ t: "code", v: tok.slice(1, -1) });
      else parts.push({ t: "i", v: tok.slice(1, -1) });
      last = m.index + tok.length;
    }
    if (last < s.length) parts.push({ t: "text", v: s.slice(last) });
    return parts.map((p, i) => {
      const k = `${key}-${i}`;
      if (p.t === "b") return <strong key={k}>{p.v}</strong>;
      if (p.t === "i") return <em key={k}>{p.v}</em>;
      if (p.t === "code") return <code key={k} className="md-code">{p.v}</code>;
      return <span key={k}>{p.v}</span>;
    });
  };
  return blocks.map((b, i) => {
    if (b.type === "h1") return <h4 key={i} className="md-h1">{inline(b.text, `h1${i}`)}</h4>;
    if (b.type === "h2") return <h5 key={i} className="md-h2">{inline(b.text, `h2${i}`)}</h5>;
    if (b.type === "p") return <p key={i} className="md-p">{inline(b.text, `p${i}`)}</p>;
    if (b.type === "ul") return <ul key={i} className="md-ul">{b.items.map((it, j) => <li key={j}>{inline(it, `ul${i}${j}`)}</li>)}</ul>;
    if (b.type === "ol") return <ol key={i} className="md-ol">{b.items.map((it, j) => <li key={j}>{inline(it, `ol${i}${j}`)}</li>)}</ol>;
    return null;
  });
}

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

  const todayDiet = data.diet.filter(d => d.date === today);
  const todayCal = todayDiet.reduce((a, m) => a + m.calories, 0);
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

function RecentList({ entries, render }) {
  if (!entries || entries.length === 0) return null;
  return (
    <div className="recent-after">
      <div className="recent-after-label">Recent</div>
      <div className="recent-after-list">
        {entries.slice(0, 3).map(e => (
          <div key={e.id} className="recent-after-item">{render(e)}</div>
        ))}
      </div>
    </div>
  );
}

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

// ─── PLAN TAB ──
function PlanTab({ data, goals, onSaveGoals }) {
  const plan = goals.plan || defaultPlan;
  const [split, setSplit] = useState(plan.split);
  const [trainingDays, setTrainingDays] = useState(plan.trainingDays);
  const [assignments, setAssignments] = useState(plan.assignments || {});
  const [dayReasons, setDayReasons] = useState(plan.dayReasons || {});

  // AI plan builder
  const [prompt, setPrompt] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState(null);
  const [buildErr, setBuildErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [openDay, setOpenDay] = useState(null); // which day's "why" is expanded

  // Recovery card — instant rule-based + optional AI elaboration
  const recovery = useMemo(() => computeRecovery(data, goals), [data, goals]);
  const [aiTake, setAiTake] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  const todayName = WEEKDAYS[(new Date().getDay() + 6) % 7];
  const hasPlan = trainingDays.length > 0 && Object.keys(assignments).length > 0;

  async function buildPlan() {
    if (!prompt.trim() || building) return;
    setBuilding(true); setBuildErr(""); setBuildResult(null);
    let lastErr = null;
    // Try up to twice — models occasionally return malformed JSON; a retry usually fixes it.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await buildPlanFromPrompt(prompt, goals, { split, trainingDays }, data);
        if (!r || !Array.isArray(r.trainingDays) || r.trainingDays.length === 0) {
          throw new Error("no-days");
        }
        // Validate day keys
        r.trainingDays = r.trainingDays.filter(d => WEEKDAYS.includes(d));
        if (r.trainingDays.length === 0) throw new Error("bad-days");
        setBuildResult(r);
        setBuilding(false);
        return;
      } catch (e) { lastErr = e; }
    }
    setBuildErr("The AI's response didn't come back cleanly. Tap the button once more — it usually works on the next try.");
    setBuilding(false);
  }

  function applyBuiltPlan() {
    if (!buildResult) return;
    setSplit(buildResult.split || split);
    setTrainingDays(buildResult.trainingDays);
    setAssignments(buildResult.assignments || {});
    setDayReasons(buildResult.dayReasons || {});
    onSaveGoals({ ...goals, plan: { split: buildResult.split || split, trainingDays: buildResult.trainingDays, assignments: buildResult.assignments || {}, dayReasons: buildResult.dayReasons || {}, notes: "" } });
    setBuildResult(null); setPrompt("");
    toast("✓ Plan saved"); haptic([12, 30, 12]);
  }

  function editDay(day, value) {
    const next = { ...assignments };
    const nextDays = [...trainingDays];
    if (value.trim()) {
      next[day] = value;
      if (!nextDays.includes(day)) nextDays.push(day);
    } else {
      delete next[day];
      const idx = nextDays.indexOf(day);
      if (idx >= 0) nextDays.splice(idx, 1);
    }
    nextDays.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
    setAssignments(next);
    setTrainingDays(nextDays);
  }

  function saveEdits() {
    onSaveGoals({ ...goals, plan: { split, trainingDays, assignments, dayReasons, notes: "" } });
    setEditing(false);
    toast("✓ Plan saved");
  }

  async function askCoachElaborate() {
    setAiLoading(true);
    try { setAiTake(await recommendRest(data, goals)); }
    catch { toast("Couldn't reach the coach"); }
    setAiLoading(false);
  }

  const verdictMeta = {
    go:      { label: "Good to train", cls: "go",      dot: "var(--good)" },
    caution: { label: "Train with caution", cls: "caution", dot: "#f9c97e" },
    rest:    { label: "Rest today", cls: "rest",    dot: "var(--bad)" },
  };
  const vm = verdictMeta[recovery.verdict];

  // Recovery-aware flag for the week view (consecutive-day warning)
  const consecWarning = recovery.reasons.find(r => /days straight|in a row/i.test(r.text));

  return (
    <div className="stack">
      {/* ── CARD 1: RECOVERY READOUT ── */}
      <Card title="Should I train today?" sub="Reads your sleep, load, fuelling & more — instantly">
        <div className={`rec-band rec-band-${vm.cls}`}>
          <span className="rec-band-dot" style={{ background: vm.dot }} />
          <div className="rec-band-body">
            <div className="rec-band-label">{vm.label}</div>
            <div className="rec-band-ctx">{recovery.plannedToday ? `Plan: ${recovery.todayLabel}` : "Plan: rest day"} · {todayName}</div>
          </div>
        </div>

        {recovery.reconcile && <p className="rec-reconcile">{recovery.reconcile}</p>}

        {recovery.readiness != null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "10px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="muted small">Recovery readiness</span>
              <strong style={{ fontSize: 18 }}>{recovery.readiness}<span className="muted" style={{ fontSize: 13 }}>/100</span></strong>
            </div>
            <div className="rt-bar" style={{ margin: 0 }}>
              <div className="rt-bar-fill" style={{ width: `${recovery.readiness}%`, background: recovery.readiness >= 70 ? "var(--good)" : recovery.readiness >= 50 ? "#f9c97e" : "var(--bad)" }} />
            </div>
            {recovery.limiter && (
              <div className="small" style={{ marginTop: 2 }}>
                <span style={{ fontWeight: 600 }}>Limiter — {recovery.limiter.label}:</span> <span className="muted">{recovery.limiter.topReason}</span>
              </div>
            )}
          </div>
        )}

        {(recovery.sleepTiming?.hoursAwake != null || recovery.sleepTiming?.hoursToBed != null) && (
          <div className="rec-sleep-timing">
            {recovery.sleepTiming.hoursAwake != null && (
              <div className="rec-st-item">
                <span className="rec-st-icon">☀</span>
                <span>Awake <strong>{recovery.sleepTiming.hoursAwake}h</strong>{recovery.sleepTiming.lastWake ? ` (since ${recovery.sleepTiming.lastWake})` : ""}</span>
              </div>
            )}
            {recovery.sleepTiming.hoursToBed != null && recovery.sleepTiming.hoursToBed >= 0 && (
              <div className="rec-st-item">
                <span className="rec-st-icon">☾</span>
                <span>~<strong>{recovery.sleepTiming.hoursToBed}h</strong> till usual bedtime ({recovery.sleepTiming.nextBedLabel})</span>
              </div>
            )}
          </div>
        )}

        <div className="rec-reasons">
          {recovery.reasons.length === 0 && recovery.unknown.length === 0 && (
            <p className="muted small">Log some sleep and training and this will read your recovery automatically.</p>
          )}
          {recovery.reasons.map((r, i) => (
            <div key={i} className={`rec-reason-row ${r.dir}`}>
              <span className="rec-reason-mark">{r.dir === "neg" ? "▲" : "•"}</span>
              <span>{r.text}</span>
            </div>
          ))}
          {recovery.unknown.length > 0 && (
            <p className="muted small" style={{ marginTop: 8 }}>
              Not logged, so left out: {recovery.unknown.join(", ")}.{recovery.lowData ? " (Verdict softened to caution without it.)" : ""}
            </p>
          )}
        </div>

        {!aiTake && (
          <button className="btn-ghost full" style={{ marginTop: 12 }} onClick={askCoachElaborate} disabled={aiLoading}>
            {aiLoading ? <><span className="spinner" />Asking your coach…</> : "✦ Ask coach to elaborate"}
          </button>
        )}
        {aiTake && (
          <div className="rec-ai">
            <div className="rec-ai-h">✦ Coach's take</div>
            <p className="rec-ai-reason">{aiTake.reason}</p>
            {aiTake.tip && <p className="rec-ai-tip">→ {aiTake.tip}</p>}
            <button className="link-btn" onClick={() => setAiTake(null)}>Hide</button>
          </div>
        )}
      </Card>

      {/* ── CARD 2: AI PLAN BUILDER ── */}
      <Card title="✦ Build my week" sub="Tell the AI what you want — typos and all — it designs your week">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={3}
          placeholder={'e.g. "i can trian 4 days, chest n arms focus, play futbol sundays so keep legs away from then"'}
        />
        <div className="prompt-chips">
          {[
            "5 days, push/pull/legs, weekends off",
            "4 days, focus on arms & shoulders",
            "3 full-body days, max recovery",
            "let the AI decide what's best for me",
          ].map((p, i) => (
            <button key={i} className="prompt-chip" onClick={() => setPrompt(p)}>{p}</button>
          ))}
        </div>
        <button className="btn full" style={{ marginTop: 10 }} onClick={buildPlan} disabled={building || !prompt.trim()}>
          {building ? <><span className="spinner" />Designing your week…</> : (hasPlan ? "✦ Rebuild my week" : "✦ Design my week")}
        </button>
        {buildErr && <div className="err">{buildErr}</div>}

        {buildResult && (
          <div className="build-result">
            <div className="build-split-tag">{buildResult.split}</div>
            <div className="build-week">
              {WEEKDAYS.map(d => {
                const w = buildResult.assignments?.[d];
                const training = buildResult.trainingDays.includes(d);
                const why = buildResult.dayReasons?.[d];
                return (
                  <div key={d}
                    className={`build-day ${training ? "on" : ""} ${d === todayName ? "today" : ""} ${why ? "has-why" : ""}`}
                    onClick={() => why && setOpenDay(openDay === "b" + d ? null : "b" + d)}>
                    <span className="build-day-name">{d}</span>
                    <span className="build-day-w">{training ? (w || "Train") : "Rest"}</span>
                    {why && <span className="build-day-why-chev">{openDay === "b" + d ? "▲" : "ⓘ"}</span>}
                    {openDay === "b" + d && why && <div className="build-day-why">{why}</div>}
                  </div>
                );
              })}
            </div>
            {buildResult.alternativeNote && (
              <div className="build-alt"><strong>Coach's note:</strong> {buildResult.alternativeNote}</div>
            )}
            {buildResult.summary && <p className="build-summary">{buildResult.summary}</p>}
            {buildResult.tips?.length > 0 && (
              <ul className="build-tips">{buildResult.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            )}
            <p className="muted small" style={{ marginTop: 8 }}>Tap any day to see why it's set that way. You can fine-tune rest days after applying.</p>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn flex" onClick={applyBuiltPlan}>✓ Use this plan</button>
              <button className="btn-ghost" onClick={() => setBuildResult(null)}>Discard</button>
            </div>
          </div>
        )}
      </Card>

      {/* ── CARD 3: EDITABLE, RECOVERY-AWARE WEEK VIEW ── */}
      {hasPlan && !buildResult && (
        <Card title="Your week" sub={split} action={<button className="link-btn" onClick={() => editing ? saveEdits() : setEditing(true)}>{editing ? "Done" : "Edit"}</button>}>
          {consecWarning && !editing && (
            <div className="week-flag">⚠ {consecWarning.text}. Consider making today or tomorrow a rest day.</div>
          )}
          <div className="build-week">
            {WEEKDAYS.map(d => {
              const training = trainingDays.includes(d);
              const why = dayReasons[d];
              if (editing) {
                return (
                  <div key={d} className={`build-day ${d === todayName ? "today" : ""}`}>
                    <span className="build-day-name">{d}</span>
                    <input className="wo-input" value={assignments[d] || ""} placeholder="Rest — type to add"
                      onChange={e => editDay(d, e.target.value)} />
                  </div>
                );
              }
              return (
                <div key={d}
                  className={`build-day ${training ? "on" : ""} ${d === todayName ? "today" : ""} ${why ? "has-why" : ""}`}
                  onClick={() => why && setOpenDay(openDay === d ? null : d)}>
                  <span className="build-day-name">{d}</span>
                  <span className="build-day-w">{training ? (assignments[d] || "Train") : "Rest"}</span>
                  {d === todayName && <span className="wo-today-tag">today</span>}
                  {why && <span className="build-day-why-chev">{openDay === d ? "▲" : "ⓘ"}</span>}
                  {openDay === d && why && <div className="build-day-why">{why}</div>}
                </div>
              );
            })}
          </div>
          {editing && <p className="muted small" style={{ marginTop: 10 }}>Type a workout to make it a training day, or clear it for a rest day.</p>}
        </Card>
      )}
    </div>
  );
}


// ─── SLEEP FORM ──
function SleepForm({ onAdd, recent }) {
  const [form, setForm] = useState({ date: getTodayStr(), bedtime: "22:30", wakeTime: "06:30", quality: "Good", latencyMin: "", wakeMin: "", notes: "" });
  const [showDetail, setShowDetail] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const tibH = (() => {
    const [bh, bm] = form.bedtime.split(":").map(Number), [wh, wm] = form.wakeTime.split(":").map(Number);
    let m = (wh * 60 + wm) - (bh * 60 + bm); if (m < 0) m += 1440; return m / 60;
  })();
  const lat = parseFloat(form.latencyMin) || 0;
  const waso = parseFloat(form.wakeMin) || 0;
  const tstH = Math.max(0, tibH - lat / 60 - waso / 60);
  const hasDetail = lat > 0 || waso > 0;
  const eff = tibH > 0 ? Math.round((tstH / tibH) * 100) : 0;
  const fmt12 = t => { const [h, m] = t.split(":").map(Number); const ap = h < 12 ? "AM" : "PM"; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`; };
  const isToday = form.date === getTodayStr();
  function save() {
    const entry = { date: form.date, bedtime: form.bedtime, wakeTime: form.wakeTime, quality: form.quality, notes: form.notes, duration: +tibH.toFixed(1), id: Date.now() };
    if (form.latencyMin !== "") entry.latencyMin = Math.max(0, Math.round(parseFloat(form.latencyMin)) || 0);
    if (form.wakeMin !== "") entry.wakeMin = Math.max(0, Math.round(parseFloat(form.wakeMin)) || 0);
    onAdd(entry);
    toast("◐ Sleep logged");
    setForm(f => ({ ...f, latencyMin: "", wakeMin: "", notes: "" }));
    setShowDetail(false);
  }
  return (
    <>
      <Card title="Log sleep" action={
        <input type="date" className="sleep-date" value={form.date} onChange={e => set("date", e.target.value)} />
      }>
        {/* Hero — live duration readout */}
        <div className="sleep-hero">
          <div className="sleep-hero-moon">☾</div>
          <div className="sleep-hero-dur">{tibH.toFixed(1)}<span>h{hasDetail ? " in bed" : ""}</span></div>
          <div className="sleep-hero-range">
            {fmt12(form.bedtime)} → {fmt12(form.wakeTime)}
            {hasDetail && <> · <strong>{tstH.toFixed(1)}h asleep</strong> · {eff}%</>}
          </div>
        </div>

        {/* Times */}
        <div className="field-grid" style={{ marginTop: 4 }}>
          <label>Got in bed<input type="time" value={form.bedtime} onChange={e => set("bedtime", e.target.value)} /></label>
          <label>Got up<input type="time" value={form.wakeTime} onChange={e => set("wakeTime", e.target.value)} /></label>
        </div>

        {/* Quality — tappable */}
        <div className="sleep-field-label">How did you sleep?</div>
        <div className="sleep-q-chips">
          {sleepQuality.map(q => (
            <button key={q} className={`sleep-q-chip ${form.quality === q ? "on" : ""}`} onClick={() => { set("quality", q); haptic(8); }}>{q}</button>
          ))}
        </div>

        {/* Optional depth — tucked away */}
        <button className="sleep-detail-toggle" onClick={() => setShowDetail(s => !s)}>
          {showDetail ? "− Hide detail" : "+ Add fall-asleep time, wake-ups & notes"}
        </button>
        {showDetail && (
          <div className="sleep-detail">
            <div className="field-grid">
              <label>Mins to fall asleep<input type="number" inputMode="numeric" value={form.latencyMin} onChange={e => set("latencyMin", e.target.value)} placeholder="e.g. 15" /></label>
              <label>Mins awake in night<input type="number" inputMode="numeric" value={form.wakeMin} onChange={e => set("wakeMin", e.target.value)} placeholder="e.g. 0" /></label>
            </div>
            <label>Notes<textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Anything worth remembering about last night?" rows={2} /></label>
            <p className="muted small" style={{ lineHeight: 1.45 }}>These two numbers unlock your sleep-efficiency reading — add them when you have them, skip when you don't.</p>
          </div>
        )}

        <button className="btn full" style={{ marginTop: 14 }} onClick={save}>Save {isToday ? "last night" : "sleep"}</button>
      </Card>
      <RecentList entries={recent} render={s => <><span className="ra-main">{s.duration}h · {s.quality}</span><span className="ra-date">{formatShortDate(s.date)}</span></>} />
    </>
  );
}

// ─── SLEEP SECTION (the smartest section: log + full intelligence dashboard) ──
const SLEEP_STATUS = { good: { c: "var(--good)", w: "Good" }, warn: { c: "#f9c97e", w: "Watch" }, bad: { c: "var(--bad)", w: "Fix" } };

function StatusPill({ status, label }) {
  if (!status) return <span className="sleep-pill" style={{ color: "var(--muted)", borderColor: "var(--border)" }}>Need data</span>;
  const m = SLEEP_STATUS[status];
  return <span className="sleep-pill" style={{ color: m.c, borderColor: m.c }}>{label || m.w}</span>;
}

// Disorder-screening risk from the occasional check-in (non-diagnostic).
function computeScreenRisk(items, profile) {
  const it = items || {};
  let positives = 0;
  Object.values(it).forEach(v => { if (v) positives++; });
  const bmi = (() => { const h = parseFloat(profile?.heightCm), w = parseFloat(profile?.weightKg); return (h > 0 && w > 0) ? w / ((h / 100) ** 2) : null; })();
  const osaCluster = it.gasp || (it.snore && it.sleepy) || (it.snore && bmi != null && bmi >= 30);
  const insomniaCluster = it.onset && it.maintain;
  if (osaCluster || positives >= 4) return { band: "elevated", osaCluster: !!osaCluster, insomniaCluster: !!insomniaCluster, rls: !!it.legs };
  if (positives >= 2) return { band: "some", osaCluster: false, insomniaCluster: !!insomniaCluster, rls: !!it.legs };
  return { band: "low", osaCluster: false, insomniaCluster: false, rls: false };
}

const SCREEN_ITEMS = [
  { key: "snore", label: "I snore loudly (or I've been told I do)" },
  { key: "gasp", label: "I've been seen gasping / stopping breathing in sleep" },
  { key: "sleepy", label: "I'm very sleepy in the day even after enough hours" },
  { key: "headache", label: "I often wake with a headache or dry mouth" },
  { key: "onset", label: "I regularly take >30 min to fall asleep" },
  { key: "maintain", label: "I wake in the night and struggle to get back to sleep" },
  { key: "legs", label: "I get an urge to move my legs that delays sleep" },
];

function SleepScreenModal({ goals, onSave, onClose }) {
  const prev = goals.sleepScreen?.items || {};
  const [items, setItems] = useState(() => SCREEN_ITEMS.reduce((a, x) => ({ ...a, [x.key]: !!prev[x.key] }), {}));
  const toggle = k => { setItems(i => ({ ...i, [k]: !i[k] })); haptic(8); };
  const p = goals.profile || {};
  const bmi = (() => { const h = parseFloat(p.heightCm), w = parseFloat(p.weightKg); return (h > 0 && w > 0) ? +(w / ((h / 100) ** 2)).toFixed(1) : null; })();
  function save() {
    const risk = computeScreenRisk(items, p);
    onSave({ ts: Date.now(), items, risk });
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxHeight: "82vh", overflowY: "auto" }}>
        <h3 className="modal-title">Quick sleep check</h3>
        <p className="muted small" style={{ lineHeight: 1.5, marginTop: -4 }}>
          Tick anything that's been true lately. This is a screen, not a diagnosis — it just tells you whether it's worth raising with a clinician.
        </p>
        {(p.age || p.sex || bmi) && (
          <p className="muted small" style={{ marginTop: 6 }}>Using from your profile: {[p.sex, p.age && `${p.age}y`, bmi && `BMI ${bmi}`].filter(Boolean).join(" · ") || "—"}</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "12px 0" }}>
          {SCREEN_ITEMS.map(x => (
            <button key={x.key} className={`screen-item ${items[x.key] ? "on" : ""}`} onClick={() => toggle(x.key)}>
              <span className="screen-check">{items[x.key] ? "✓" : ""}</span>
              <span>{x.label}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn-ghost flex" onClick={onClose}>Cancel</button>
          <button className="btn flex" onClick={save}>Save check</button>
        </div>
      </div>
    </div>
  );
}

function SleepBlockCard({ data, goals, onSaveGoals, sleep }) {
  const exp = goals.sleepExperiment;
  const [open, setOpen] = useState(false);

  // Snapshot of the trailing 14 days, used as baseline and for live comparison.
  function snapshot() {
    const s = computeSleep(data, goals);
    const wt = computeWeightTrend(data);
    const rpeVals = (data.exercise || []).filter(e => e.date >= daysAgo(13)).map(e => (e._parsed || parseWorkout(e.text || "")).avgRPE).filter(v => v != null);
    const prCount = (data.exercise || []).filter(e => e.date >= daysAgo(13)).reduce((n, e) => n + (e.prs?.length || 0), 0);
    return {
      avgTST: s?.quantity.avgTST14 ?? null,
      avgRPE: rpeVals.length ? +(rpeVals.reduce((a, b) => a + b, 0) / rpeVals.length).toFixed(1) : null,
      weightRate: wt?.pctBWPerWeek ?? null,
      prCount,
    };
  }

  function start() {
    const need = estimateSleepNeed(data, goals);
    const target = Math.min(9.5, +(need.hours + 0.75).toFixed(1));
    onSaveGoals({ ...goals, sleepExperiment: { startDate: getTodayStr(), targetH: target, baseline: snapshot(), status: "active" } });
    toast("🌙 Sleep block started");
  }
  function end() {
    onSaveGoals({ ...goals, sleepExperiment: null });
    toast("Sleep block ended");
  }

  if (!exp || exp.status !== "active") {
    return (
      <Card title="🌙 Run a Sleep Block" sub="A 2-week experiment — extend sleep, measure what changes in your own data">
        <button className="link-btn" onClick={() => setOpen(o => !o)}>{open ? "Hide" : "What is this?"}</button>
        {open && (
          <p className="muted small" style={{ lineHeight: 1.55, marginTop: 8 }}>
            FitLog snapshots your last 14 days (sleep, training RPE, weight-trend rate, PRs), then sets a nightly sleep target a bit above your need. After two weeks you'll see whether extending sleep actually moved your numbers — partitioning, perceived effort, performance. Evidence says banking sleep helps most if you're carrying debt.
          </p>
        )}
        <button className="btn full" style={{ marginTop: 10 }} onClick={start}>Start a 2-week sleep block</button>
      </Card>
    );
  }

  const daysIn = Math.max(0, Math.round((Date.now() - new Date(exp.startDate + "T00:00:00").getTime()) / 86400000));
  const now = snapshot();
  const b = exp.baseline || {};
  const delta = (cur, base, dp = 1) => (cur != null && base != null) ? +(cur - base).toFixed(dp) : null;
  const dTST = delta(now.avgTST, b.avgTST);
  const dRPE = delta(now.avgRPE, b.avgRPE);
  const dRate = delta(now.weightRate, b.weightRate, 2);

  return (
    <Card title="🌙 Sleep Block — active" sub={`Day ${daysIn} of ~14 · target ${exp.targetH}h/night`}>
      <div className="rt-bar" style={{ margin: "4px 0 14px" }}>
        <div className="rt-bar-fill" style={{ width: `${Math.min(100, (daysIn / 14) * 100)}%` }} />
      </div>
      <div className="sleep-block-grid">
        <div className="sbg-item"><span className="sbg-l">Sleep</span><span className="sbg-v">{now.avgTST ?? "—"}h{dTST != null ? <span className={dTST >= 0 ? "good" : "bad"}> {dTST >= 0 ? "+" : ""}{dTST}</span> : ""}</span></div>
        <div className="sbg-item"><span className="sbg-l">Avg RPE</span><span className="sbg-v">{now.avgRPE ?? "—"}{dRPE != null ? <span className={dRPE <= 0 ? "good" : "bad"}> {dRPE >= 0 ? "+" : ""}{dRPE}</span> : ""}</span></div>
        <div className="sbg-item"><span className="sbg-l">Wt trend</span><span className="sbg-v">{now.weightRate != null ? `${now.weightRate > 0 ? "+" : ""}${now.weightRate}%` : "—"}{dRate != null ? <span className="muted"> ({dRate >= 0 ? "+" : ""}{dRate})</span> : ""}</span></div>
        <div className="sbg-item"><span className="sbg-l">PRs</span><span className="sbg-v">{now.prCount}{b.prCount != null ? <span className="muted"> vs {b.prCount}</span> : ""}</span></div>
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>
        Deltas compare the block so far against your 14 days before it. {daysIn >= 12 ? "You've got enough data to judge it." : "Give it the full two weeks before drawing conclusions."}
      </p>
      <button className="btn-ghost full" style={{ marginTop: 10 }} onClick={end}>End block</button>
    </Card>
  );
}

function SleepSection({ data, goals, addEntry, onSaveGoals }) {
  const sleep = useMemo(() => computeSleep(data, goals), [data, goals]);
  const [screenOpen, setScreenOpen] = useState(false);
  const [editNeed, setEditNeed] = useState(false);
  const [needVal, setNeedVal] = useState(goals.profile?.sleepNeedH || "");

  function saveNeed() {
    const v = parseFloat(needVal);
    onSaveGoals({ ...goals, profile: { ...goals.profile, sleepNeedH: v > 0 ? v : "" } });
    setEditNeed(false);
    toast(v > 0 ? `Sleep need set to ${v}h` : "Back to auto-learned need");
  }
  function saveScreen(payload) {
    onSaveGoals({ ...goals, sleepScreen: payload });
    setScreenOpen(false);
    haptic([12, 30, 12]);
    toast("✓ Sleep check saved");
  }

  const log = <SleepForm onAdd={addEntry("sleep")} recent={data.sleep} />;

  if (!sleep) {
    return (
      <div className="stack">
        {log}
        <Card title="Sleep intelligence">
          <Empty icon="◐" title="Log a few nights to wake this up" hint="Once you've logged sleep for several nights, this section learns your personal sleep need and starts reading how sleep is shaping your training, weight, and mood." />
        </Card>
      </div>
    );
  }

  const q = sleep.quantity, r = sleep.regularity, c = sleep.continuity;
  const needSrc = sleep.need.source === "override" ? "you set this" : sleep.need.source === "learned" ? `learned from ${sleep.need.nGood} of your best nights` : "provisional default — log more good nights to personalize";
  const screen = goals.sleepScreen;
  const screenStale = !screen || (Date.now() - screen.ts) > 90 * 86400000;

  return (
    <div className="stack">
      {log}

      {/* NEED + CONFIDENCE */}
      <Card>
        <div className="sleep-need-row">
          <div>
            <div className="muted small">Your sleep need</div>
            <div className="sleep-need-v">{sleep.need.hours}<span>h</span></div>
            <div className="muted small" style={{ marginTop: 2 }}>{needSrc}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted small">Confidence</div>
            <div style={{ fontWeight: 600 }}>{sleep.confidence}</div>
            <button className="link-btn" style={{ marginTop: 4 }} onClick={() => { setNeedVal(goals.profile?.sleepNeedH || ""); setEditNeed(e => !e); }}>{editNeed ? "Cancel" : "Set manually"}</button>
          </div>
        </div>
        {editNeed && (
          <div className="row" style={{ marginTop: 10 }}>
            <input type="number" step="0.5" inputMode="decimal" value={needVal} onChange={e => setNeedVal(e.target.value)} placeholder="e.g. 8" />
            <span className="muted">h</span>
            <button className="btn" onClick={saveNeed}>Save</button>
          </div>
        )}
      </Card>

      {/* BIGGEST LEVER */}
      {sleep.topLever && (
        <Card title="Your biggest sleep lever" className="sleep-lever-card">
          <p className="sleep-lever-text">{sleep.topLever.text}</p>
        </Card>
      )}

      {/* CIRCADIAN ANCHOR */}
      {r.anchorWake && (
        <Card title="Circadian anchor" sub="The single most stabilizing habit is a fixed wake time">
          <div className="sleep-anchor">
            <div className="sleep-anchor-item"><span className="muted small">Anchor wake</span><span className="sleep-anchor-v">{r.anchorWake}</span></div>
            <div className="sleep-anchor-arrow">←</div>
            <div className="sleep-anchor-item"><span className="muted small">Target in bed by</span><span className="sleep-anchor-v">{r.bedTarget || "—"}</span></div>
          </div>
          <p className="muted small" style={{ marginTop: 4, lineHeight: 1.5 }}>Holding wake time within ~30 min every day — weekends included — anchors your body clock, which then pulls bedtime and sleep quality into line.</p>
        </Card>
      )}

      {/* THREE AXES */}
      <Card title="Duration" sub="vs your personal need" action={<StatusPill status={q.status} label={q.label} />}>
        <div className="center-stack" style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{q.avgTST7 ?? "—"}<span className="muted" style={{ fontSize: 15, marginLeft: 4 }}>h avg asleep (7d)</span></div>
          <div className="muted small">{q.debt7 > 0.5 ? `~${q.debt7}h short of your need this week` : q.debt7 < -0.5 ? `~${Math.abs(q.debt7)}h above need this week` : "On target this week"}</div>
        </div>
        <MiniChart points={sleep.series.tst} showGoal={q.need} rollingAvg unit="h" />
      </Card>

      <Card title="Regularity" sub="timing consistency & social jetlag" action={<StatusPill status={r.status} label={r.label} />}>
        <div className="sleep-axis-stats">
          <div className="ts"><span className="ts-l">Mid-sleep swing</span><span className="ts-v">{r.midSD != null ? `±${Math.round(r.midSD)}min` : "—"}</span></div>
          <div className="ts"><span className="ts-l">Social jetlag</span><span className={`ts-v ${r.socialJetlag != null && r.socialJetlag >= 1.5 ? "warn" : ""}`}>{r.socialJetlag != null ? `${r.socialJetlag}h` : "—"}</span></div>
        </div>
        <p className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>{r.status === "good" ? "Your timing is consistent — keep it." : "Variable timing is one of the highest-leverage things to tighten; the research ranks it alongside total hours."}</p>
      </Card>

      <Card title="Continuity & quality" sub="how consolidated your sleep is" action={<StatusPill status={c.status} label={c.label} />}>
        <div className="sleep-axis-stats">
          {c.hasEffData && <div className="ts"><span className="ts-l">Efficiency</span><span className={`ts-v ${c.avgEff != null && c.avgEff < 85 ? "warn" : ""}`}>{c.avgEff != null ? `${c.avgEff}%` : "—"}</span></div>}
          {c.avgLatency != null && <div className="ts"><span className="ts-l">Fall-asleep</span><span className="ts-v">{c.avgLatency}min</span></div>}
          {c.avgWaso != null && <div className="ts"><span className="ts-l">Awake/night</span><span className="ts-v">{c.avgWaso}min</span></div>}
          {!c.hasEffData && c.avgLatency == null && <div className="ts"><span className="ts-l">Quality trend</span><span className="ts-v">{c.qualityTrend != null ? (c.qualityTrend > 0 ? "↑ improving" : c.qualityTrend < 0 ? "↓ slipping" : "→ flat") : "—"}</span></div>}
        </div>
        {c.unrefreshing && (
          <div className="sleep-flag">
            ⚠ Unrefreshing sleep: enough hours but poor quality on {c.unrefreshCount} of {c.recentNights} recent nights. This is the top pattern worth raising with a clinician — it can't be fixed by routine alone.
          </div>
        )}
        {!c.hasEffData && <p className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>Add "mins to fall asleep" and "mins awake" when logging to unlock efficiency — the real continuity metric.</p>}
      </Card>

      {/* COUPLING */}
      {sleep.coupling.length > 0 && (
        <Card title="How sleep is affecting you" sub="patterns from your own data — correlation, not proof">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {sleep.coupling.map((co, i) => (
              <div key={i} className="sleep-couple-row">
                <span className="sleep-couple-dot" style={{ background: co.severity === "critical" ? "var(--bad)" : co.severity === "important" ? "#f9c97e" : "var(--accent)" }} />
                <span className="small" style={{ lineHeight: 1.5 }}>{co.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* DISORDER SCREEN */}
      <Card title="Sleep health check" sub="a quick, non-diagnostic screen">
        {screen && screen.risk ? (
          <>
            <div className={`sleep-screen-band ${screen.risk.band}`}>
              {screen.risk.band === "elevated" ? "Some answers are worth following up" : screen.risk.band === "some" ? "A couple of things to keep an eye on" : "Nothing flagged"}
            </div>
            {screen.risk.band !== "low" && (
              <p className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>
                {screen.risk.osaCluster && "Your answers point toward possible obstructive sleep apnea — the highest-leverage treatable sleep disorder. "}
                {screen.risk.insomniaCluster && "There's an insomnia pattern (onset + maintenance) that CBT-I treats well. "}
                {screen.risk.rls && "Leg-urge symptoms can point to restless legs. "}
                This isn't a diagnosis — it means it's worth a conversation with a doctor.
              </p>
            )}
            <button className="btn-ghost full" style={{ marginTop: 10 }} onClick={() => setScreenOpen(true)}>Retake check</button>
          </>
        ) : (
          <>
            <p className="muted small" style={{ lineHeight: 1.5 }}>{screenStale && screen ? "It's been a while — worth retaking." : "Diagnosis, not optimization, is the biggest population-level sleep win. Two minutes here screens for the disorders routine can't fix."}</p>
            <button className="btn full" style={{ marginTop: 10 }} onClick={() => setScreenOpen(true)}>Take the 2-min check</button>
          </>
        )}
      </Card>

      {/* EXPERIMENT */}
      <SleepBlockCard data={data} goals={goals} onSaveGoals={onSaveGoals} sleep={sleep} />

      {screenOpen && <SleepScreenModal goals={goals} onSave={saveScreen} onClose={() => setScreenOpen(false)} />}
    </div>
  );
}

// ─── BARCODE SCANNER ──
function BarcodeScanner({ onResult, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const [status, setStatus] = useState("starting"); // starting | scanning | error | unsupported
  const [manual, setManual] = useState("");
  const supported = barcodeScanSupported();

  useEffect(() => {
    if (!supported) { setStatus("unsupported"); return; }
    let detector;
    let cancelled = false;
    (async () => {
      try {
        detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("scanning");
        const scan = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              const code = codes[0].rawValue;
              haptic([12, 30, 12]); SFX.success();
              cleanup();
              onResult(code);
              return;
            }
          } catch {}
          rafRef.current = requestAnimationFrame(scan);
        };
        rafRef.current = requestAnimationFrame(scan);
      } catch (e) {
        setStatus("error");
      }
    })();
    function cleanup() {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    }
    return cleanup;
    // eslint-disable-next-line
  }, []);

  function submitManual() {
    const code = manual.trim();
    if (code) onResult(code);
  }

  return (
    <div className="scan-overlay" onClick={onClose}>
      <div className="scan-modal" onClick={e => e.stopPropagation()}>
        <div className="scan-head">
          <span>Scan barcode</span>
          <button className="scan-x" onClick={onClose}>×</button>
        </div>

        {(status === "starting" || status === "scanning") && supported && (
          <div className="scan-view">
            <video ref={videoRef} className="scan-video" playsInline muted />
            <div className="scan-frame"><div className="scan-line" /></div>
            <p className="scan-hint">{status === "starting" ? "Starting camera…" : "Point at the barcode"}</p>
          </div>
        )}

        {status === "error" && (
          <div className="scan-fallback">
            <p className="scan-err">Couldn't access the camera. Check permissions, or type the barcode number below.</p>
          </div>
        )}

        {status === "unsupported" && (
          <div className="scan-fallback">
            <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
              Live scanning isn't supported on this browser (common on iPhone). Type the barcode number printed under the bars instead:
            </p>
          </div>
        )}

        {(status === "unsupported" || status === "error") && (
          <div className="scan-manual">
            <input
              type="number"
              inputMode="numeric"
              value={manual}
              onChange={e => setManual(e.target.value)}
              placeholder="e.g. 5449000000996"
              onKeyDown={e => { if (e.key === "Enter") submitManual(); }}
            />
            <button className="btn" onClick={submitManual} disabled={!manual.trim()}>Look up</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DIET FORM ──
// Protein timing card (B1) — shows today's feedings vs the MPS threshold.
function ProteinTimingCard({ data, goals, todayDiet = [] }) {
  const pd = computeProteinDistribution(data, goals);
  const gl = dayGlycemicLoad(todayDiet);
  if (!pd && !gl.hasData) return null;
  const t = pd?.today;
  const target = pd?.perMeal;
  return (
    <Card title="Today's protein & glycemic load" sub={pd ? `MPS-effective feedings · ~${target}g per-meal threshold${pd.bw ? "" : " (set your weight to personalize)"}` : "estimated load from today's meals"}>
      {pd && (
        <>
          <div className="center-stack">
            <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>
              {t.effective}<span className="muted" style={{ fontSize: 15, marginLeft: 6 }}>of 3–5 target</span>
            </div>
            <div className="muted small">{t.dayProtein}g protein logged today</div>
          </div>
          {t.feedings.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              {t.feedings.map((f, i) => {
                const pct = Math.min(100, Math.round((f.proteinG / Math.max(target, 1)) * 100));
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="muted small" style={{ width: 40, textAlign: "right" }}>{f.time || "—"}</span>
                    <div className="rt-bar" style={{ margin: 0, flex: 1 }}>
                      <div className="rt-bar-fill" style={{ width: `${pct}%`, ...(f.effective ? {} : { background: "var(--muted)" }) }} />
                    </div>
                    <span className="small" style={{ width: 50 }}>{f.proteinG}g {f.effective ? "✓" : ""}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="muted small" style={{ marginTop: 8 }}>No meals logged today yet.</div>
          )}
          {t.effective < 3 && t.feedings.length > 0 && (
            <div className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>
              Aim for 3–5 meals that each clear ~{target}g. Spreading protein across the day raises total muscle-building stimulus vs. one big hit — even at the same daily total.
            </div>
          )}
        </>
      )}
      {gl.hasData && (
        <div className="pt-gl">
          {pd && <div className="pt-divider" />}
          <div className="pt-gl-row">
            <span className="pt-gl-label">Glycemic load today</span>
            <span><span className="gl-pill" data-band={gl.band}>{gl.band}</span> <span className="muted small">~{gl.total}</span></span>
          </div>
          <div className="muted small" style={{ marginTop: 6, lineHeight: 1.45 }}>
            {gl.band === "high" ? "Carb-heavy day — pairing carbs with protein, fat or fibre flattens the spike." : gl.band === "low" ? "Gentle on blood sugar so far today." : "Moderate — fairly steady blood sugar."} Estimate from logged carbs + food type, not a lab value.
          </div>
        </div>
      )}
    </Card>
  );
}

// Estimated glycemic-load pill — appears on meals that have carb data.
function GLPill({ meal, showValue = true }) {
  const r = estimateGlycemicLoad(meal);
  if (!r.hasCarbs) return null;
  const src = r.source === "database" ? "matched to known GI data" : "rough estimate (food not in GI table)";
  const title = `Estimated glycemic load ~${r.gl} (${r.band})${r.blunted ? " — softened by the protein/fat in this meal" : ""}. ${src}. Not a blood-glucose measurement.`;
  return <span className="gl-pill" data-band={r.band} title={title}>GL {r.band}{showValue ? `\u00a0·\u00a0${r.gl}` : ""}</span>;
}

// Carbs-around-training card — only renders when you've trained recently and have
// timed meals to analyze. Honest: pre-fuel is a performance lever, daily total rules.
// ─── FUEL CARD (planner + adaptive energy check, sleep-aware) ───────────────
function FuelCard({ data, goals, addEntry, deleteEntry }) {
  const today = getTodayStr();
  const tomorrow = localDateStr(new Date(Date.now() + 86400000));
  const [planDate, setPlanDate] = useState(today);
  const [addType, setAddType] = useState(null);
  const [form, setForm] = useState({ time: "17:00", durationMin: "", intensity: "moderate" });
  const weightKg = goals?.profile?.weightKg;
  const sw = useMemo(() => sleepWindow(data), [data]);
  const sessions = (data.plannedSessions || []).filter(s => s.date === planDate).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const plan = useMemo(() => planFueling({ sessions, weightKg, goals, wakeMin: sw.wakeMin, sleepMin: sw.sleepMin }), [sessions, weightKg, goals, sw]);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isToday = planDate === today;
  const meals = (data.diet || []).filter(d => d.date === planDate);
  const rec = useMemo(() => (plan && plan.blocks) ? reconcileFueling({ plan, meals, nowMin: isToday ? nowMin : -1 }) : null, [plan, meals, nowMin, isToday]);

  const fmtH = m => `${Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, "0")}`;
  const timeToMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : 0; };

  function addSession() {
    if (!addType) return;
    addEntry("plannedSessions")({ id: Date.now(), date: planDate, type: addType, time: form.time, durationMin: +form.durationMin || SESSION_TYPES[addType].defMin, intensity: form.intensity });
    setAddType(null); setForm({ time: "17:00", durationMin: "", intensity: "moderate" }); haptic(8); toast("✦ Session added");
  }

  return (
    <Card title="Fuel" sub="meals & carbs timed to your sessions and sleep">
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={`seg-btn ${planDate === today ? "active" : ""}`} onClick={() => setPlanDate(today)}>Today</button>
        <button className={`seg-btn ${planDate === tomorrow ? "active" : ""}`} onClick={() => setPlanDate(tomorrow)}>Tomorrow</button>
      </div>

      {!weightKg && <div className="sleep-flag" style={{ marginBottom: 10 }}>⚠ Set your bodyweight in your profile — fuel targets scale with it.</div>}

      {sessions.length > 0 && (
        <div className="fuel-sessions">
          {sessions.map(s => (
            <div key={s.id} className="fuel-sess">
              <span>{(SESSION_TYPES[s.type] || {}).label || s.type} · {s.time} · {s.durationMin || (SESSION_TYPES[s.type] || {}).defMin}min · {s.intensity}</span>
              <button className="skin-x" onClick={() => deleteEntry("plannedSessions")(s.id)}>×</button>
            </div>
          ))}
        </div>
      )}

      {addType ? (
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="muted small">{SESSION_TYPES[addType].label} — when & how hard?</div>
          <div className="field-grid three">
            <label>Time<input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} /></label>
            <label>Mins<input type="number" inputMode="numeric" value={form.durationMin} onChange={e => setForm(f => ({ ...f, durationMin: e.target.value }))} placeholder={`${SESSION_TYPES[addType].defMin}`} /></label>
            <label>Intensity<select value={form.intensity} onChange={e => setForm(f => ({ ...f, intensity: e.target.value }))}><option value="light">Light</option><option value="moderate">Moderate</option><option value="hard">Hard</option></select></label>
          </div>
          <div className="row"><button className="btn-ghost flex" onClick={() => setAddType(null)}>Cancel</button><button className="btn flex" onClick={addSession}>Add session</button></div>
        </div>
      ) : (
        <div className="fuel-type-chips">
          {Object.entries(SESSION_TYPES).map(([k, v]) => <button key={k} className="fuel-type-chip" onClick={() => { setAddType(k); haptic(8); }}>+ {v.label}</button>)}
        </div>
      )}

      {plan && plan.blocks && (
        <div className="fuel-plan">
          <div className="fuel-totals">
            <div className="fuel-tot"><span className="fuel-tot-v">{plan.dailyCarbs}g</span><span className="fuel-tot-l">carbs · {plan.gPerKg} g/kg</span></div>
            <div className="fuel-tot"><span className="fuel-tot-v">{plan.dailyProtein}g</span><span className="fuel-tot-l">protein</span></div>
            <div className="fuel-tot"><span className="fuel-tot-v">{plan.loadLevel}</span><span className="fuel-tot-l">load</span></div>
          </div>

          {sw.hasData && <p className="muted small" style={{ margin: "0 0 12px" }}>Timed around your ~{fmtH(sw.wakeMin)} wake and ~{fmtH(sw.sleepMin)} sleep.</p>}

          {isToday && rec && (
            <div className="es-embed">
              <div className="es-bars">
                <div className="es-bar-row"><span className="es-bar-lab">Eaten</span><div className="rt-bar" style={{ margin: 0, flex: 1 }}><div className="rt-bar-fill" style={{ width: `${rec.carbPct}%` }} /></div><span className="es-bar-v">{rec.consumedCarbs}/{rec.dailyCarbs}g C</span></div>
                <div className="es-bar-row"><span className="es-bar-lab">Protein</span><div className="rt-bar" style={{ margin: 0, flex: 1 }}><div className="rt-bar-fill" style={{ width: `${rec.proteinPct}%`, background: "#b4a8e8" }} /></div><span className="es-bar-v">{rec.consumedProtein}/{rec.dailyProtein}g P</span></div>
              </div>
              <p className="es-status" data-tone={rec.tone}>{rec.status}</p>
              <p className="muted small" style={{ lineHeight: 1.5, marginTop: 4 }}>{rec.advice}</p>
              {rec.addPhrase && <p className="muted small" style={{ lineHeight: 1.5, marginTop: 6 }}>Roughly that's: <b>{rec.addPhrase}</b>.</p>}
            </div>
          )}

          <div className="fuel-timeline">
            {(rec ? rec.timeline : plan.blocks).map((b, i) => (
              b.kind === "session" ? (
                <div key={i} className="fuel-block fuel-session-row" data-kind="session">
                  <span className="fuel-time">{b.time}</span>
                  <div className="fuel-bd"><div className="fuel-label">🏋 {b.label}</div></div>
                </div>
              ) : (
                <div key={i} className={`fuel-block${b.done ? " done" : ""}${b.isNext ? " next" : ""}`} data-kind={b.kind}>
                  <span className="fuel-time">{b.time}</span>
                  <div className="fuel-bd">
                    <div className="fuel-label">{b.isNext ? "→ " : ""}{b.label} <span className="fuel-macros">{b.carbsG}g C{b.proteinG ? ` · ${b.proteinG}g P` : ""}</span>{b.carbType ? <span className={`carb-chip ${b.carbType}`}>{b.carbType}</span> : null}</div>
                    <div className="muted small" style={{ lineHeight: 1.4, marginTop: 2 }}>{b.done ? (b.foodsLine || "Logged.") : `${b.typeNote || b.baseNote || b.note || ""}${b.foodIdea ? ` — e.g. ${b.foodIdea}.` : ""}`}</div>
                  </div>
                </div>
              )
            ))}
          </div>
          {plan.notes.map((n, i) => <p key={i} className="muted small" style={{ lineHeight: 1.45, marginTop: 8 }}>{n}</p>)}
        </div>
      )}

      {sessions.length === 0 && !addType && (
        <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>Add your gym session or sport for {planDate === today ? "today" : "tomorrow"} and FitLog builds a carb-and-protein timeline around it — fitted to your sleep, with live tracking of what you've eaten and what to add.</p>
      )}
    </Card>
  );
}

function DietForm({ onAdd, recent, goals, data, todayDiet = [], addEntry, deleteEntry }) {
  const [date, setDate] = useState(getTodayStr());
  const [time, setTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [meal, setMeal] = useState("Breakfast");
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState("text");
  const [useWeb, setUseWeb] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const fileRef = useRef();
  const cameraRef = useRef();

  // Barcode
  const [scanning, setScanning] = useState(false);
  const [bcLoading, setBcLoading] = useState(false);
  const [bcProduct, setBcProduct] = useState(null); // normalized OFF result
  const [grams, setGrams] = useState(100); // for per-100g scaling
  const [useServing, setUseServing] = useState(false);

  function handleFile(f) {
    if (!f) return;
    setFile(f); setResult(null); setError("");
    const r = new FileReader();
    r.onload = ev => setPreview(ev.target.result);
    r.readAsDataURL(f);
  }

  async function onBarcode(code) {
    setScanning(false);
    setBcLoading(true); setError(""); setBcProduct(null); setResult(null);
    try {
      const prod = await lookupBarcode(code);
      if (!prod) { setError(`No product found for barcode ${code}. Try the photo or describe it instead.`); }
      else {
        setBcProduct(prod);
        setUseServing(!!prod.perServing);
        setGrams(100);
      }
    } catch { setError("Lookup failed. Check your connection and try again."); }
    setBcLoading(false);
  }

  // Compute scaled macros from the barcode product
  function bcMacros() {
    if (!bcProduct) return null;
    if (useServing && bcProduct.perServing) return bcProduct.perServing;
    const f = grams / 100;
    return {
      cal: Math.round(bcProduct.per100.cal * f),
      protein: Math.round(bcProduct.per100.protein * f),
      carbs: Math.round(bcProduct.per100.carbs * f),
      fat: Math.round(bcProduct.per100.fat * f),
    };
  }

  function saveBarcode() {
    const m = bcMacros();
    if (!m || !bcProduct) return;
    const ts = (() => { try { return new Date(`${date}T${time}:00`).getTime(); } catch { return Date.now(); } })();
    const portionNote = useServing && bcProduct.perServing ? `1 serving${bcProduct.servingSize ? ` (${bcProduct.servingSize})` : ""}` : `${grams}g`;
    onAdd({ date, time, ts, meal, food: bcProduct.name, calories: m.cal, protein: m.protein, carbs: m.carbs, fat: m.fat, notes: `Barcode ${bcProduct.code} · ${portionNote}`, id: Date.now() });
    toast("◉ " + bcProduct.name.slice(0, 24) + " added");
    setBcProduct(null); setError("");
  }

  async function analyze() {
    if (mode === "text" && !text.trim()) return;
    if (mode === "image" && !file) return;
    setAnalyzing(true); setError(""); setResult(null);
    try {
      let b64 = null, mt = null;
      if (mode === "image" && file) {
        // Resize before sending — phone photos are huge and the API chokes on them.
        const resized = await fileToResizedBase64(file, 1280, 0.85);
        b64 = resized.base64;
        mt = resized.mediaType;
      }
      const brain = data && goals ? buildBrain(data, goals) : null;
      const r = await analyzeFoodAI(mode === "text" ? text : "", b64, mt, useWeb, brain);
      if (r && typeof r.calories === "number") setResult(r);
      else setError(mode === "image" ? "Couldn't read that photo well. Try a clearer shot, or describe the meal in words." : "Couldn't analyze that. Try being more specific (portion size, cooking method).");
    } catch (e) { setError("Network issue. Try again."); }
    setAnalyzing(false);
  }

  function save() {
    if (!result) return;
    // Combine date + time into a timestamp
    const ts = (() => { try { return new Date(`${date}T${time}:00`).getTime(); } catch { return Date.now(); } })();
    onAdd({ date, time, ts, meal, food: result.food, calories: result.calories, protein: result.protein, carbs: result.carbs, fat: result.fat, notes: result.notes || "", id: Date.now() });
    toast("◉ " + result.food.slice(0, 24) + " added");
    setResult(null); setText(""); setFile(null); setPreview(null); setError("");
  }

  // Running daily totals
  const dayCal = todayDiet.reduce((a, m) => a + (m.calories || 0), 0);
  const dayP = todayDiet.reduce((a, m) => a + (m.protein || 0), 0);
  const dayC = todayDiet.reduce((a, m) => a + (m.carbs || 0), 0);
  const dayF = todayDiet.reduce((a, m) => a + (m.fat || 0), 0);
  const calLeft = (goals?.calories || 0) - dayCal;
  const pLeft = (goals?.protein || 0) - dayP;

  return (
    <div className="stack">
    {goals && (
      <div className="running-total">
        <div className="rt-row">
          <div className="rt-item">
            <span className="rt-v">{dayCal}<span className="rt-sub">/{goals.calories}</span></span>
            <span className="rt-l">calories</span>
          </div>
          <div className="rt-item">
            <span className="rt-v">{dayP}<span className="rt-sub">/{goals.protein}g</span></span>
            <span className="rt-l">protein</span>
          </div>
          <div className="rt-item">
            <span className={`rt-v ${calLeft < 0 ? "rt-over" : ""}`}>{calLeft >= 0 ? calLeft : `+${-calLeft}`}</span>
            <span className="rt-l">{calLeft >= 0 ? "cal left" : "cal over"}</span>
          </div>
        </div>
        {todayDiet.length > 0 && (
          <div className="rt-bar">
            <div className="rt-bar-fill" style={{ width: `${Math.min(100, (dayCal / goals.calories) * 100)}%` }} />
          </div>
        )}
        <div className="rt-hint">{pLeft > 0 ? `${pLeft}g protein to go today` : "✓ protein goal hit"}</div>
      </div>
    )}
    <Card title="Log meal" sub="Describe what you ate or upload a photo" className="log-meal-card">
      <div className="field-grid three">
        <label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Time<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
        <label>Meal<select value={meal} onChange={e => setMeal(e.target.value)}>{mealTypes.map(m => <option key={m}>{m}</option>)}</select></label>
      </div>

      <div className="seg seg-three">
        <button className={`seg-btn ${mode === "text" ? "active" : ""}`} onClick={() => { setMode("text"); setResult(null); setError(""); setBcProduct(null); }}>✎ Describe</button>
        <button className={`seg-btn ${mode === "image" ? "active" : ""}`} onClick={() => { setMode("image"); setResult(null); setError(""); setBcProduct(null); }}>⊞ Photo</button>
        <button className={`seg-btn ${mode === "barcode" ? "active" : ""}`} onClick={() => { setMode("barcode"); setResult(null); setError(""); }}>▒ Barcode</button>
      </div>

      {mode === "barcode" && !bcProduct && (
        <div className="bc-start">
          {bcLoading ? (
            <div className="loading-row"><span className="spinner" />Looking up product…</div>
          ) : (
            <>
              <button className="btn full" onClick={() => { setError(""); setScanning(true); }}>▒ Scan barcode</button>
              <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5, textAlign: "center" }}>
                Point your camera at a packaged food's barcode for exact nutrition. {barcodeScanSupported() ? "" : "(On iPhone you'll type the number — live scan isn't supported in Safari.)"}
              </p>
            </>
          )}
        </div>
      )}

      {mode === "barcode" && bcProduct && (
        <div className="ai-card">
          <div className="ai-card-label">From barcode <span className="conf-badge conf-high">database</span></div>
          <div className="ai-card-name">{bcProduct.name}</div>

          <div className="bc-portion">
            {bcProduct.perServing && (
              <div className="seg" style={{ marginBottom: 10 }}>
                <button className={`seg-btn ${useServing ? "active" : ""}`} onClick={() => setUseServing(true)}>Per serving{bcProduct.servingSize ? ` (${bcProduct.servingSize})` : ""}</button>
                <button className={`seg-btn ${!useServing ? "active" : ""}`} onClick={() => setUseServing(false)}>By weight</button>
              </div>
            )}
            {!useServing && (
              <label>Amount (g)
                <input type="number" value={grams} onChange={e => setGrams(Math.max(0, +e.target.value || 0))} />
              </label>
            )}
          </div>

          {(() => { const m = bcMacros(); return m ? (
            <div className="result-with-donut">
              <MacroDonut protein={m.protein} carbs={m.carbs} fat={m.fat} />
              <div className="macros macros-compact">
                <div className="macro"><span className="macro-v">{m.cal}</span><span className="macro-l">kcal</span></div>
                <div className="macro"><span className="macro-v" style={{ color: "#b4a8e8" }}>{m.protein}g</span><span className="macro-l">protein</span></div>
                <div className="macro"><span className="macro-v" style={{ color: "#f9c97e" }}>{m.carbs}g</span><span className="macro-l">carbs</span></div>
                <div className="macro"><span className="macro-v" style={{ color: "#f47e6e" }}>{m.fat}g</span><span className="macro-l">fat</span></div>
              </div>
            </div>
          ) : null; })()}

          {(() => { const m = bcMacros(); const r = m ? estimateGlycemicLoad({ ...m, carbs: m.carbs, food: bcProduct.name }) : null; return r && r.hasCarbs ? (
            <p className="ai-card-note" style={{ display: "flex", alignItems: "center", gap: 8 }}><GLPill meal={{ ...m, food: bcProduct.name }} /> <span className="muted small">estimate from carbs + food type</span></p>
          ) : null; })()}
          <div className="row">
            <button className="btn flex" onClick={saveBarcode}>+ Add to log</button>
            <button className="btn-ghost" onClick={() => { setBcProduct(null); setError(""); }}>Scan another</button>
          </div>
        </div>
      )}

      {mode === "text" && !result && (
        <label>What did you eat?<textarea value={text} onChange={e => setText(e.target.value)} placeholder='"2 eggs, toast, glass of OJ"' rows={3} /></label>
      )}

      {mode === "image" && !result && (
        <>
          {preview ? (
            <div className="upload has-img" onClick={() => fileRef.current.click()}>
              <img src={preview} alt="" className="upload-img" />
              <div className="upload-replace">Tap to replace</div>
            </div>
          ) : (
            <div className="photo-choices">
              <button className="photo-choice" onClick={() => cameraRef.current.click()}>
                <span className="photo-choice-icon">📷</span>
                <span>Take photo</span>
              </button>
              <button className="photo-choice" onClick={() => fileRef.current.click()}>
                <span className="photo-choice-icon">🖼️</span>
                <span>Choose photo</span>
              </button>
            </div>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={e => handleFile(e.target.files[0])} />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => handleFile(e.target.files[0])} />
        </>
      )}

      {!result && mode !== "barcode" && (
        <>
          <label className="web-toggle">
            <input type="checkbox" checked={useWeb} onChange={e => setUseWeb(e.target.checked)} />
            <span className="web-toggle-text">
              <span className="web-toggle-title">🌐 Search web for exact data</span>
              <span className="web-toggle-sub">Best for branded / restaurant foods. Slower, costs a bit more.</span>
            </span>
          </label>
          <button className="btn full" onClick={analyze} disabled={analyzing || (mode === "text" ? !text.trim() : !file)}>
            {analyzing ? <><span className="spinner" />{useWeb ? "Researching nutrition…" : "Analyzing…"}</> : "✦ Analyze with AI"}
          </button>
        </>
      )}

      {scanning && <BarcodeScanner onResult={onBarcode} onClose={() => setScanning(false)} />}

      {error && <div className="err">{error}</div>}

      {result && (
        <div className="ai-card">
          <div className="ai-card-label">
            AI analysis
            {result.confidence && <span className={`conf-badge conf-${result.confidence}`}>{result.confidence} confidence</span>}
          </div>
          <div className="ai-card-name">{result.food}</div>
          <div className="result-with-donut">
            <MacroDonut protein={result.protein} carbs={result.carbs} fat={result.fat} />
            <div className="macros macros-compact">
              <div className="macro"><span className="macro-v">{result.calories}</span><span className="macro-l">kcal</span></div>
              <div className="macro"><span className="macro-v" style={{ color: "#b4a8e8" }}>{result.protein}g</span><span className="macro-l">protein</span></div>
              <div className="macro"><span className="macro-v" style={{ color: "#f9c97e" }}>{result.carbs}g</span><span className="macro-l">carbs</span></div>
              <div className="macro"><span className="macro-v" style={{ color: "#f47e6e" }}>{result.fat}g</span><span className="macro-l">fat</span></div>
            </div>
          </div>
          {result.notes && <p className="ai-card-note">{result.notes}</p>}
          {(() => { const r = estimateGlycemicLoad(result); return r.hasCarbs ? (
            <p className="ai-card-note" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><GLPill meal={result} /> <span className="muted small">{r.blunted ? "softened by the protein/fat here" : r.band === "high" ? "carb-heavy — pair with protein/fat or fibre to flatten the spike" : "gentle on blood sugar"}</span></p>
          ) : null; })()}
          <div className="row">
            <button className="btn flex" onClick={save}>+ Add to log</button>
            <button className="btn-ghost" onClick={() => { setResult(null); }}>Redo</button>
          </div>
        </div>
      )}
      </Card>
      <ProteinTimingCard data={data} goals={goals} todayDiet={todayDiet} />
      <FuelCard data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} />
      <RecentList entries={recent} render={m => <><span className="ra-main">{m.meal} · {m.calories} kcal · {m.food.slice(0, 26)}{m.food.length > 26 ? "…" : ""} <GLPill meal={m} showValue={false} /></span><span className="ra-date">{formatShortDate(m.date)}</span></>} />
    </div>
  );
}

// ─── EXERCISE (paste from Strong) ──
function ExerciseForm({ onAdd, recent, hideRecent, header }) {
  const [date, setDate] = useState(getTodayStr());
  const [time, setTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");

  const parsed = useMemo(() => parseWorkout(text), [text]);

  function save() {
    if (!text.trim()) return;
    const p = parseWorkout(text);
    const prs = detectPRs(p, recent || []);
    onAdd({ id: Date.now(), date, time, label: label.trim() || "Workout", text: text.trim(), _parsed: p, prs });
    if (prs.length) {
      haptic([18, 40, 18]);
      SFX.pr();
      toast(`🏆 New PR: ${prs[0].name} ${prs[0].weight}${prs[0].unit} × ${prs[0].reps}`, { silent: true });
    } else {
      toast("◆ Workout saved");
    }
    setText(""); setLabel("");
  }

  return (
    <>
    <Card title="Log workout" sub="Paste from Strong, or write your own">
      {header}
      <div className="field-grid three">
        <label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Time<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
        <label>Label<input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Push Day A" /></label>
      </div>
      <label>Workout details
        <textarea value={text} onChange={e => setText(e.target.value)} rows={9}
          placeholder={"Push Day A\n1h 12m\n\nBench Press (Barbell)\nSet 1: 60 kg × 10\nSet 2: 80 kg × 8"}
          style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.84rem" }} />
      </label>

      {parsed.exercises.length > 0 && (
        <div className="parse-preview">
          <div className="parse-head">
            <span>Detected {parsed.exercises.length} exercise{parsed.exercises.length === 1 ? "" : "s"}</span>
            <span className="parse-vol">{parsed.totalSets} sets · {parsed.totalVolume.toLocaleString()} kg volume</span>
          </div>
          <div className="parse-list">
            {parsed.exercises.map((ex, i) => {
              const bs = bestSet(ex.sets);
              return (
                <div key={i} className="parse-ex">
                  <span className="parse-ex-name">{ex.name}</span>
                  <span className="parse-ex-detail">{ex.sets.length} sets{bs ? ` · top ${bs.weight}${bs.unit}×${bs.reps}` : ""}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button className="btn full" onClick={save} disabled={!text.trim()}>Save workout</button>
    </Card>
    {!hideRecent && <RecentList entries={recent} render={w => <><span className="ra-main">{w.label}{w.prs?.length ? " 🏆" : ""}</span><span className="ra-date">{formatShortDate(w.date)}</span></>} />}
    </>
  );
}

// ─── SPORTS ──
function SportsForm({ onAdd, recent }) {
  const [form, setForm] = useState(() => {
    const d = new Date();
    return { date: getTodayStr(), time: `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`, sport: "Basketball", duration: "60", intensity: "Moderate", result: "", opponent: "", score: "", notes: "" };
  });
  const [weight, setWeight] = useState("75");
  const [est, setEst] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setEst(null); };

  return (
    <>
    <Card title="Log sport">
      <div className="field-grid">
        <label>Date<input type="date" value={form.date} onChange={e => set("date", e.target.value)} /></label>
        <label>Time<input type="time" value={form.time} onChange={e => set("time", e.target.value)} /></label>
        <label>Sport<select value={form.sport} onChange={e => set("sport", e.target.value)}>{sportsOptions.map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Duration (min)<input type="number" value={form.duration} onChange={e => set("duration", e.target.value)} /></label>
        <label>Intensity<select value={form.intensity} onChange={e => set("intensity", e.target.value)}>{intensityLevels.map(l => <option key={l}>{l}</option>)}</select></label>
        <label>Your weight (kg)<input type="number" value={weight} onChange={e => { setWeight(e.target.value); setEst(null); }} /></label>
        <label>Result<select value={form.result} onChange={e => set("result", e.target.value)}><option value="">—</option><option>Win</option><option>Loss</option><option>Draw</option><option>Practice</option></select></label>
        <label>Opponent<input type="text" value={form.opponent} onChange={e => set("opponent", e.target.value)} placeholder="Optional" /></label>
        <label>Score<input type="text" value={form.score} onChange={e => set("score", e.target.value)} placeholder="Optional" /></label>
      </div>
      <label>Notes<textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} placeholder="How did it go?" /></label>

      {!est && (
        <button className="btn-ghost full" onClick={async () => {
          if (!form.duration) return;
          setEstimating(true);
          const r = await estimateSportsCalories(form.sport, +form.duration, form.intensity, +weight || 75);
          setEst(r); setEstimating(false);
        }} disabled={estimating || !form.duration}>
          {estimating ? <><span className="spinner" />Calculating (MET-based)…</> : "✦ Estimate calories with AI"}
        </button>
      )}

      {est && (
        <div className="ai-card">
          <div className="ai-card-label">AI estimate</div>
          <div className="ai-card-big">{est.calories}<span> kcal</span></div>
          <p className="ai-card-note">{est.note}</p>
          <div className="row">
            <button className="btn flex" onClick={() => { onAdd({ ...form, id: Date.now(), duration: +form.duration || 0, calories: est.calories }); toast("◇ " + form.sport + " logged"); setForm(f => ({ ...f, opponent: "", score: "", result: "", notes: "" })); setEst(null); }}>+ Save sport</button>
            <button className="btn-ghost" onClick={() => setEst(null)}>Redo</button>
          </div>
        </div>
      )}
    </Card>
    <RecentList entries={recent} render={s => <><span className="ra-main">{s.sport} · {s.duration}min · {s.calories} kcal</span><span className="ra-date">{formatShortDate(s.date)}</span></>} />
    </>
  );
}

// ─── WATER ──
function IntakeTab({ data, goals, addEntry, deleteEntry }) {
  const [view, setView] = useState("water");
  return (
    <div className="stack">
      <div className="seg">
        <button className={`seg-btn ${view === "water" ? "active" : ""}`} onClick={() => setView("water")}>💧 Water</button>
        <button className={`seg-btn ${view === "supp" ? "active" : ""}`} onClick={() => setView("supp")}>⊕ Supps</button>
        <button className={`seg-btn ${view === "weight" ? "active" : ""}`} onClick={() => setView("weight")}>⚖ Weight</button>
      </div>
      {view === "water" && <WaterForm data={data} goals={goals} onAdd={addEntry("water")} onDelete={deleteEntry("water")} />}
      {view === "supp" && <SupplementForm data={data} onAdd={addEntry("supplements")} onDelete={deleteEntry("supplements")} />}
      {view === "weight" && <WeightForm data={data} goals={goals} onAdd={addEntry("weight")} onDelete={deleteEntry("weight")} />}
    </div>
  );
}

function WaterForm({ data, goals, onAdd, onDelete }) {
  const today = getTodayStr();
  const todayWater = data.water.filter(w => w.date === today);
  const totalMl = todayWater.reduce((a, w) => a + w.ml, 0);
  const pct = Math.min(100, Math.round((totalMl / goals.waterGoalMl) * 100));
  const [custom, setCustom] = useState("");
  const [unit, setUnit] = useState("ml");

  const add = ml => { onAdd({ id: Date.now(), date: today, ml, ts: Date.now() }); toast(`💧 +${ml}ml water`); };
  const past7 = Array.from({ length: 7 }, (_, i) => {
    const d = daysAgo(6 - i);
    const ml = data.water.filter(w => w.date === d).reduce((a, w) => a + w.ml, 0);
    return { date: d, ml };
  });
  const maxPast = Math.max(goals.waterGoalMl, ...past7.map(p => p.ml));

  return (
    <div className="stack">
      <Card>
        <div className="center-stack">
          <Ring pct={pct} label={`of ${goals.waterGoalMl}ml`} value={totalMl} unit="ml" big />
        </div>
        <div className="quick-water">
          <button className="qa" onClick={() => add(250)}>+ Glass<br /><span>250ml</span></button>
          <button className="qa" onClick={() => add(500)}>+ Bottle<br /><span>500ml</span></button>
          <button className="qa" onClick={() => add(1000)}>+ 1L<br /><span>1000ml</span></button>
        </div>
      </Card>

      <Card title="Custom amount">
        <div className="seg">
          <button className={`seg-btn ${unit === "ml" ? "active" : ""}`} onClick={() => { setUnit("ml"); setCustom(""); }}>Milliliters</button>
          <button className={`seg-btn ${unit === "l" ? "active" : ""}`} onClick={() => { setUnit("l"); setCustom(""); }}>Liters</button>
        </div>
        <div className="row">
          <input type="number" step={unit === "l" ? "0.1" : "50"} value={custom} onChange={e => setCustom(e.target.value)} placeholder={unit === "l" ? "0.5" : "350"} />
          <button className="btn" onClick={() => { const v = parseFloat(custom); if (!v) return; add(unit === "l" ? Math.round(v * 1000) : Math.round(v)); setCustom(""); }} disabled={!custom}>Add</button>
        </div>
      </Card>

      {todayWater.length > 0 && (
        <Card title="Today's log" sub={`${todayWater.length} ${todayWater.length === 1 ? "entry" : "entries"}`}>
          <div className="list">
            {todayWater.slice().reverse().map(w => {
              const t = new Date(w.ts || Date.now());
              return (
                <div key={w.id} className="list-row">
                  <span className="muted">{t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="list-main">{w.ml}ml</span>
                  <button className="x" onClick={() => onDelete(w.id)}>×</button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Past 7 days">
        <div className="week">
          {past7.map(d => (
            <div key={d.date} className="week-col">
              <div className="week-bar-wrap">
                <div className="week-bar" style={{ height: `${(d.ml / maxPast) * 100}%`, background: d.ml >= goals.waterGoalMl ? "var(--accent)" : "var(--muted)" }} />
              </div>
              <div className="week-day">{new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" }).slice(0, 1)}</div>
              <div className="week-val">{d.ml >= 1000 ? (d.ml/1000).toFixed(1) + "L" : d.ml + "ml"}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── SUPPLEMENT ──
function SupplementForm({ data, onAdd, onDelete }) {
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const todaySupps = data.supplements.filter(s => s.date === getTodayStr());
  return (
    <div className="stack">
      <Card title="Log supplement">
        <div className="field-grid">
          <label>Name<input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Creatine, Multi, Whey" /></label>
          <label>Dose / notes<input type="text" value={dose} onChange={e => setDose(e.target.value)} placeholder="5g, 1 cap" /></label>
        </div>
        <button className="btn full" onClick={() => { if (!name.trim()) return; onAdd({ id: Date.now(), date: getTodayStr(), name: name.trim(), dose: dose.trim(), ts: Date.now() }); toast("⊕ " + name.trim() + " logged"); setName(""); setDose(""); }} disabled={!name.trim()}>Save</button>
      </Card>

      {todaySupps.length > 0 && (
        <Card title="Today's supplements">
          <div className="list">
            {todaySupps.slice().reverse().map(s => {
              const t = new Date(s.ts || Date.now());
              return (
                <div key={s.id} className="list-row">
                  <div className="list-main">
                    <div>{s.name}</div>
                    {s.dose && <div className="muted small">{s.dose}</div>}
                  </div>
                  <span className="muted">{t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <button className="x" onClick={() => onDelete(s.id)}>×</button>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── BODYWEIGHT ──
function WeightForm({ data, goals, onAdd, onDelete }) {
  const today = getTodayStr();
  const [kg, setKg] = useState("");
  const todayWeights = (data.weight || []).filter(w => w.date === today);
  const trend = computeWeightTrend(data);
  const hasAny = (data.weight || []).length > 0;
  const lastLogged = hasAny ? [...data.weight].sort((a, b) => (b.ts || 0) - (a.ts || 0))[0] : null;

  const save = () => {
    const v = parseFloat(kg);
    if (!v || v <= 0) return;
    onAdd({ id: Date.now(), date: today, kg: +v.toFixed(2), ts: Date.now() });
    toast(`⚖ ${v.toFixed(1)}kg logged`);
    setKg("");
  };

  // Chart: one point per day (earliest weigh-in) across the last 30 days.
  const points = Array.from({ length: 30 }, (_, i) => {
    const d = daysAgo(29 - i);
    const dayEntries = (data.weight || []).filter(w => w.date === d);
    let val = null;
    if (dayEntries.length) val = dayEntries.reduce((a, b) => ((a.ts || 0) <= (b.ts || 0) ? a : b)).kg;
    return { value: val, label: d };
  });

  const dirIcon = trend ? (trend.direction === "gaining" ? "↑" : trend.direction === "losing" ? "↓" : "→") : "";
  const rateLabel = trend && trend.ratePerWeekG != null
    ? `${trend.ratePerWeekG > 0 ? "+" : ""}${trend.ratePerWeekG} g/wk${trend.pctBWPerWeek != null ? ` · ${trend.pctBWPerWeek > 0 ? "+" : ""}${trend.pctBWPerWeek}%BW/wk` : ""}`
    : "Need a few more weigh-ins to estimate rate";

  return (
    <div className="stack">
      <Card title="Log weight" sub={lastLogged ? `Last: ${lastLogged.kg}kg on ${formatShortDate(lastLogged.date)}` : "Weigh in the morning, after the toilet, before eating — that's the most consistent reading"}>
        <div className="row">
          <input type="number" step="0.1" inputMode="decimal" value={kg} onChange={e => setKg(e.target.value)} placeholder={lastLogged ? String(lastLogged.kg) : "e.g. 80.5"} />
          <span className="muted">kg</span>
          <button className="btn" onClick={save} disabled={!kg}>Save</button>
        </div>
      </Card>

      {trend ? (
        <Card title="Trend" sub={`${trend.nDays} weigh-in${trend.nDays === 1 ? "" : "s"} · ${trend.confidence} confidence`}>
          <div className="center-stack">
            <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{trend.current}<span className="muted" style={{ fontSize: 18, marginLeft: 4 }}>kg</span></div>
            <div className="muted">{dirIcon} {trend.direction} · {rateLabel}</div>
          </div>
          <MiniChart points={points} height={96} rollingAvg unit="kg" />
          {Math.abs(trend.divergence) >= 0.6 && (
            <div className="muted small" style={{ marginTop: 8 }}>
              Today's scale ({trend.latestRaw}kg) is {Math.abs(trend.divergence)}kg {trend.divergence > 0 ? "above" : "below"} the trend — likely water, not fat. Trust the line, not the daily number.
            </div>
          )}
        </Card>
      ) : (
        <Empty icon="⚖" title="No weight logged yet" hint="Log your weight a few mornings this week and a smoothed trend line will appear here." />
      )}

      {todayWeights.length > 0 && (
        <Card title="Today's weigh-ins">
          <div className="list">
            {todayWeights.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).map(w => {
              const t = new Date(w.ts || Date.now());
              return (
                <div key={w.id} className="list-row">
                  <span className="list-main">{w.kg}kg</span>
                  <span className="muted">{t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <button className="x" onClick={() => onDelete(w.id)}>×</button>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── NICOTINE TAB (single view) ──
// Layout top→bottom: Quick add · Timing readout · Intake+trend (bottom).
function NicotineTab({ data, goals, addEntry, deleteEntry }) {
  const onAdd = addEntry("nicotine");
  const onDelete = deleteEntry("nicotine");
  const today = getTodayStr();
  const todayNic = (data.nicotine || []).filter(n => n.date === today);

  function quickAdd(q) {
    const ts = Date.now();
    onAdd({ id: ts, date: getTodayStr(), ts, type: q.type, amount: q.amount, mg: q.mg, contexts: [] });
    haptic(12); SFX.tap();
    const ti = NIC_TYPES.find(t => t.key === q.type);
    toast(`${ti?.icon || ""} ${q.label} logged`.trim(), { silent: true });
  }

  const todayCount = todayNic.length;
  const todayUnits = todayNic.reduce((a, n) => a + (n.amount || 0), 0);

  return (
    <div className="stack">
      {/* 1 — QUICK ADD */}
      <Card title="Quick add" sub="One tap to log">
        <div className="nic-quick">
          {NIC_QUICK.map((q, i) => {
            const ti = NIC_TYPES.find(t => t.key === q.type);
            return (
              <button key={i} className="nic-quick-btn" onClick={() => quickAdd(q)}>
                <span className="nic-quick-icon">{ti?.icon}</span>
                <span>{q.label}</span>
              </button>
            );
          })}
        </div>
        {todayCount > 0 && (
          <p className="muted small" style={{ marginTop: 12, textAlign: "center" }}>
            Today: {todayCount} {todayCount === 1 ? "entry" : "entries"} · {todayUnits} units
          </p>
        )}
      </Card>

      {/* today's list — compact, with delete */}
      {todayNic.length > 0 && (
        <Card title="Today">
          <div className="list">
            {todayNic.slice().reverse().map(n => {
              const ti = NIC_TYPES.find(t => t.key === n.type);
              const t = new Date(n.ts || Date.now());
              return (
                <div key={n.id} className="list-row">
                  <div className="list-main"><div>{ti?.icon} {n.amount} {ti?.unit}{n.type === "pouch" && n.mg ? ` · ${n.mg}mg` : ""}</div></div>
                  <span className="muted">{t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <button className="x" onClick={() => onDelete(n.id)}>×</button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* 2 — TIMING READOUT */}
      <NicotineTiming data={data} goals={goals} />

      {/* 3 — INTAKE + 30-DAY TREND (bottom) */}
      <NicotineIntakeCard data={data} />
    </div>
  );
}

function NicotineTiming({ data, goals }) {
  const [open, setOpen] = useState(false);
  const t = computeNicotineTiming(data, goals);

  const bandMeta = {
    lower:    { label: "Lower-impact window", cls: "lower",    note: "Conditions stack less against recovery right now — this is not a green light, just less compounding." },
    moderate: { label: "Moderate-impact window", cls: "moderate", note: "Some recovery factors are working against you right now." },
    higher:   { label: "Higher-impact window", cls: "higher",  note: "Several recovery factors are stacked against you right now." },
  };
  const meta = bandMeta[t.band];

  const activeName = WEEKDAYS[(new Date(t.activeDay + "T00:00:00").getDay() + 6) % 7];
  const isTraining = goals.plan?.trainingDays?.includes(activeName);
  const contextLine = t.crossedMidnight
    ? `${isTraining ? "Training day" : "Rest day"} (${activeName}, still up) · ${t.time}`
    : `${isTraining ? "Training day" : "Rest day"} · ${t.time}`;

  return (
    <Card title="If you smoke now" sub="How today's conditions stack — not a recommendation">
      <button className={`nic-band nic-band-${meta.cls}`} onClick={() => { setOpen(o => !o); haptic(8); }}>
        <div className="nic-band-main">
          <span className="nic-band-dot" />
          <div>
            <div className="nic-band-label">{meta.label}</div>
            <div className="nic-band-ctx">{contextLine}</div>
          </div>
        </div>
        <span className="nic-band-chev">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="nic-band-detail">
          <p className="nic-band-note">{t.insufficientData ? "Not enough logged today to read your conditions — so this can't be called a lower-impact window. Log last night's sleep for a real read." : meta.note}</p>

          {t.raising.length > 0 && (
            <div className="nic-reasons">
              <div className="nic-reasons-h raising">What's raising impact now</div>
              <ul>{t.raising.map((r, i) => <li key={i}>{r.text}</li>)}</ul>
            </div>
          )}

          {t.easing.length > 0 && (
            <div className="nic-reasons">
              <div className="nic-reasons-h easing">Currently in your favor</div>
              <ul>{t.easing.map((r, i) => <li key={i}>{r.text}</li>)}</ul>
            </div>
          )}

          {t.unknown.length > 0 && (
            <p className="muted small" style={{ marginTop: 10 }}>
              Missing from today's read (not logged): {t.unknown.join(", ")}.
            </p>
          )}

          <p className="nic-band-disclaimer">
            This is a labeled composite of real factors from your logs — like a UV index, not a measurement. It describes how today's conditions stack <em>if</em> you use nicotine. It is never advice to smoke.
          </p>
        </div>
      )}
    </Card>
  );
}

function NicotineIntakeCard({ data }) {
  const hasData = (data.nicotine || []).length > 0;
  if (!hasData) {
    return <Card title="Your intake"><Empty title="No nicotine logged yet" hint="Use quick add above and your totals + 30-day trend will show here." /></Card>;
  }
  const stats = computeNicotineStats(data);
  const typeOrder = ["cigarette", "vape", "pouch"];
  return (
    <Card title="Your intake" sub="Totals, averages & 30-day trend">
      <div className="nic-stat-grid">
        <div className="nic-stat"><span className="nic-stat-v">{stats.today.count}</span><span className="nic-stat-l">today</span></div>
        <div className="nic-stat"><span className="nic-stat-v">{stats.avgCount7}</span><span className="nic-stat-l">/day (7d)</span></div>
        <div className="nic-stat"><span className="nic-stat-v">{stats.w7.count}</span><span className="nic-stat-l">last 7d</span></div>
        <div className="nic-stat"><span className="nic-stat-v">{stats.w30.count}</span><span className="nic-stat-l">last 30d</span></div>
      </div>
      <div className="nic-types-breakdown">
        {typeOrder.filter(t => stats.typeTotals[t] > 0).map(t => {
          const ti = NIC_TYPES.find(x => x.key === t);
          return <span key={t} className="nic-type-pill">{ti?.icon} {stats.typeTotals[t]} {ti?.unit} <span className="muted">(30d)</span></span>;
        })}
      </div>
      <div className="nic-trend-wrap">
        <div className="weekgrid-label">30-day trend — entries/day</div>
        <MiniChart points={stats.seriesCount30} height={84} rollingAvg />
      </div>
    </Card>
  );
}

// ─── JOURNAL TAB ──────────────────────────────────────────────────────────────
// A freeform notebook. Each entry = text + timestamp + an auto-captured snapshot of
// what was logged that day. Recent entries feed the coach's brain.

// Build a compact one-line snapshot of what the user logged on a given date.
function journalSnapshot(data, dateStr) {
  const bits = [];
  const dayDiet = (data.diet || []).filter(d => d.date === dateStr);
  if (dayDiet.length) {
    const cal = dayDiet.reduce((a, m) => a + (m.calories || 0), 0);
    const p = dayDiet.reduce((a, m) => a + (m.protein || 0), 0);
    bits.push({ icon: "◉", text: `${cal} kcal · ${p}g P` });
  }
  const sleep = (data.sleep || []).find(s => s.date === dateStr);
  if (sleep) bits.push({ icon: "☾", text: `${sleep.duration}h${sleep.quality ? ` ${sleep.quality.toLowerCase()}` : ""}` });
  const lift = (data.exercise || []).find(e => e.date === dateStr);
  const sport = (data.sports || []).find(s => s.date === dateStr);
  if (lift) bits.push({ icon: "◆", text: lift.label || "workout" });
  if (sport) bits.push({ icon: "◇", text: `${sport.sport}${sport.duration ? ` ${sport.duration}m` : ""}` });
  const nic = (data.nicotine || []).filter(n => n.date === dateStr);
  if (nic.length) bits.push({ icon: "🚬", text: `${nic.length}×` });
  return bits;
}

function JournalTab({ data, goals, addEntry, deleteEntry }) {
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const onAdd = addEntry("journal");
  const onDelete = deleteEntry("journal");

  const entries = (data.journal || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));

  // Rotate a gentle prompt for the blank-page nudge
  const prompts = [
    "What's on your mind?",
    "How did today feel?",
    "Anything worth remembering?",
    "What went well, what didn't?",
    "Notes to your future self…",
  ];
  const prompt = useMemo(() => prompts[Math.floor(Date.now() / 86400000) % prompts.length], []);

  function save() {
    const t = text.trim();
    if (!t) return;
    const now = new Date();
    const date = getTodayStr();
    onAdd({ id: Date.now(), ts: now.getTime(), date, text: t, snapshot: journalSnapshot(data, date) });
    haptic(12); SFX.log();
    toast("✒ Entry saved", { silent: true });
    setText("");
  }

  function saveEdit(id) {
    const t = editText.trim();
    if (!t) { setEditingId(null); return; }
    // Re-find entry and update via delete+add isn't ideal; use setData through addEntry's parent.
    // Simpler: mutate through a dedicated path — we delete then re-add with same id/ts.
    const orig = entries.find(e => e.id === id);
    if (orig) {
      onDelete(id);
      onAdd({ ...orig, text: t, edited: true });
    }
    setEditingId(null); setEditText("");
    haptic(10);
  }

  // Group entries by date for the diary feel
  const groups = [];
  let lastDate = null;
  entries.forEach(e => {
    if (e.date !== lastDate) { groups.push({ date: e.date, items: [] }); lastDate = e.date; }
    groups[groups.length - 1].items.push(e);
  });

  function dateLabel(ds) {
    if (ds === getTodayStr()) return "Today";
    if (ds === daysAgo(1)) return "Yesterday";
    const d = new Date(ds + "T00:00:00");
    return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  }

  return (
    <div className="journal">
      {/* Composer */}
      <div className="journal-composer">
        <textarea
          className="journal-input"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={prompt}
          rows={4}
        />
        <div className="journal-composer-foot">
          <span className="journal-hint">{text.trim() ? `${text.trim().length} characters` : "Saved privately · your coach can read recent notes"}</span>
          <button className="btn journal-save" onClick={save} disabled={!text.trim()}>Save entry</button>
        </div>
      </div>

      {/* Feed */}
      {entries.length === 0 ? (
        <div className="journal-empty">
          <div className="journal-empty-mark">✒</div>
          <p className="journal-empty-title">Your notebook is empty</p>
          <p className="journal-empty-hint">Jot down how training felt, what's going on in life, a tweak you tried, a win, a worry. Anything you write here gives your coach the context the numbers can't.</p>
        </div>
      ) : (
        groups.map(g => (
          <div key={g.date} className="journal-day">
            <div className="journal-day-head">{dateLabel(g.date)}</div>
            {g.items.map(e => (
              <div key={e.id} className="journal-entry">
                <div className="journal-entry-time">
                  {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {e.edited && <span className="journal-edited"> · edited</span>}
                </div>
                {editingId === e.id ? (
                  <div className="journal-edit">
                    <textarea value={editText} onChange={ev => setEditText(ev.target.value)} rows={4} className="journal-input" />
                    <div className="journal-edit-actions">
                      <button className="btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                      <button className="btn" onClick={() => saveEdit(e.id)}>Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="journal-entry-text">{e.text}</p>
                    {e.snapshot?.length > 0 && (
                      <div className="journal-snapshot">
                        {e.snapshot.map((s, i) => (
                          <span key={i} className="journal-snap-pill"><span className="journal-snap-icon">{s.icon}</span>{s.text}</span>
                        ))}
                      </div>
                    )}
                    <div className="journal-entry-actions">
                      <button className="journal-act" onClick={() => { setEditingId(e.id); setEditText(e.text); }}>Edit</button>
                      <button className="journal-act journal-act-del" onClick={() => { onDelete(e.id); haptic(10); }}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

// ─── HISTORY TAB ──────────────────────────────────────────────────────────────
function HistoryTab({ data, goals, addEntry, deleteEntry }) {
  const [view, setView] = useState("trends"); // trends | lists
  return (
    <div className="stack">
      <div className="subtabs">
        <button className={`subtab ${view === "trends" ? "active" : ""}`} onClick={() => setView("trends")}>📊 Trends</button>
        <button className={`subtab ${view === "lists" ? "active" : ""}`} onClick={() => setView("lists")}>≡ Lists</button>
      </div>
      {view === "trends" && <TrendsView data={data} goals={goals} />}
      {view === "lists" && <ListsView data={data} deleteEntry={deleteEntry} />}
    </div>
  );
}

function ConsistencyHeatmap({ data }) {
  // Count log entries per day over the last 12 weeks (84 days), GitHub-style.
  const WEEKS = 12;
  const today = new Date();
  const counts = {};
  const all = [...data.diet, ...data.sleep, ...data.exercise, ...data.sports, ...data.water, ...data.supplements];
  all.forEach(e => { if (e.date) counts[e.date] = (counts[e.date] || 0) + 1; });

  // Build grid: columns = weeks, rows = Mon..Sun
  const totalDays = WEEKS * 7;
  // Find the Monday that starts the window
  const start = new Date(today);
  const offsetToMon = (today.getDay() + 6) % 7;
  start.setDate(today.getDate() - offsetToMon - (WEEKS - 1) * 7);

  const cols = [];
  let loggedDays = 0;
  for (let w = 0; w < WEEKS; w++) {
    const col = [];
    for (let r = 0; r < 7; r++) {
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7 + r);
      const ds = localDateStr(d);
      const c = counts[ds] || 0;
      const future = d > today;
      if (c > 0) loggedDays++;
      const level = future ? -1 : c === 0 ? 0 : c <= 2 ? 1 : c <= 4 ? 2 : c <= 6 ? 3 : 4;
      col.push({ ds, c, level, future });
    }
    cols.push(col);
  }

  return (
    <Card title="Consistency" sub={`${loggedDays} active days in the last ${WEEKS} weeks`}>
      <div className="heatmap">
        {cols.map((col, ci) => (
          <div key={ci} className="hm-col">
            {col.map((cell, ri) => (
              <div key={ri} className={`hm-cell hm-${cell.level}`} title={cell.future ? "" : `${formatShortDate(cell.ds)}: ${cell.c} log${cell.c === 1 ? "" : "s"}`} />
            ))}
          </div>
        ))}
      </div>
      <div className="hm-legend"><span>Less</span><span className="hm-cell hm-0" /><span className="hm-cell hm-1" /><span className="hm-cell hm-2" /><span className="hm-cell hm-3" /><span className="hm-cell hm-4" /><span>More</span></div>
    </Card>
  );
}

function EnergyBalanceCard({ data, goals }) {
  const en = useMemo(() => computeEnergyBalance(data, goals), [data, goals]);

  if (!en.ready) {
    return (
      <Card title="Energy balance" sub="Your real maintenance, measured — not guessed">
        <div className="eb-building">
          <div className="muted small" style={{ lineHeight: 1.5 }}>{en.reason}</div>
          {en.haveWeight && (
            <div style={{ marginTop: 10 }}>
              <div className="rt-bar" style={{ margin: "0 0 6px" }}>
                <div className="rt-bar-fill" style={{ width: `${Math.min(100, (en.loggedDays / 14) * 100)}%` }} />
              </div>
              <div className="muted small">{en.loggedDays} of 14 days logged</div>
            </div>
          )}
        </div>
      </Card>
    );
  }

  const deficit = en.realDelta < 0;
  const deltaColor = en.intent === "cut" ? (deficit ? "var(--good)" : "var(--bad)") : en.intent === "bulk" ? (deficit ? "var(--bad)" : "var(--good)") : "var(--text)";
  const flag = en.underLogging
    ? { c: "var(--bad)", t: "Measured maintenance looks implausibly low — your food logs are likely incomplete. Tighten logging before trusting the deficit." }
    : en.plateau
      ? { c: "#f9c97e", t: "Fat loss has stalled despite an apparent deficit — adaptation or unlogged food. A diet break or a small further cut restarts it." }
      : null;

  return (
    <Card title="Energy balance" sub="Measured from your intake + weight trend" action={<StatusPill status={en.confidence === "High" ? "good" : en.confidence === "Moderate" ? "warn" : null} label={en.confidence} />}>
      <div className="center-stack" style={{ marginBottom: 8 }}>
        <div className="muted small">Your real maintenance</div>
        <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{en.tdee}<span className="muted" style={{ fontSize: 16, marginLeft: 4 }}>kcal</span></div>
        <div className="muted small" style={{ marginTop: 2 }}>
          eating ~{en.meanIntake}/day · <span style={{ color: deltaColor, fontWeight: 600 }}>{en.realDelta === 0 ? "at maintenance" : `${Math.abs(en.realDelta)} ${deficit ? "deficit" : "surplus"}`}</span>
        </div>
      </div>

      <div className="eb-grid">
        <div className="eb-cell"><span className="eb-l">Trend weight</span><span className="eb-v">{en.weightRateKgWk > 0 ? "+" : ""}{en.weightRateKgWk}<span className="muted" style={{ fontSize: 12 }}>kg/wk</span></span></div>
        <div className="eb-cell"><span className="eb-l">Your target</span><span className="eb-v">{en.currentTarget ?? "—"}</span></div>
        <div className="eb-cell"><span className="eb-l">Suggested ({en.intent})</span><span className="eb-v">{en.recommendedIntake}</span></div>
      </div>

      {flag && <div className="eb-flag" style={{ borderColor: flag.c, color: flag.c }}>{flag.t}</div>}

      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>
        Based on {en.loggedDays} logged days ({Math.round(en.completeness * 100)}% complete). This measures your actual metabolism, so it already accounts for any adaptation — trust it over any formula.
      </p>
    </Card>
  );
}

// ─── ANATOMICAL MUSCLE MAP ───────────────────────────────────────────────────
// Real anatomical muscle polygons (react-body-highlighter, MIT — see anatomyData.js).
// The art has broad regions, so each polygon is colored by the AGGREGATE volume of
// the detailed muscles that roll up to it; the tooltip and Training Analysis show
// the fine-grained split. ESTIMATE tier.
const ANATOMY_DATA = { front: ANTERIOR_POLY, back: POSTERIOR_POLY };
const POLY_TO_REGION = {
  CHEST: "CHEST", FRONT_DELTOIDS: "FRONT_DELTOIDS", BICEPS: "BICEPS", TRICEPS: "TRICEPS",
  FOREARM: "FOREARM", ABS: "ABS", OBLIQUES: "OBLIQUES", QUADRICEPS: "QUADRICEPS",
  CALVES: "CALVES", LEFT_SOLEUS: "CALVES", RIGHT_SOLEUS: "CALVES", TRAPEZIUS: "TRAPEZIUS",
  BACK_DELTOIDS: "BACK_DELTOIDS", UPPER_BACK: "UPPER_BACK", LOWER_BACK: "LOWER_BACK",
  GLUTEAL: "GLUTEAL", HAMSTRING: "HAMSTRING", ABDUCTOR: "ABDUCTORS", ABDUCTORS: "ABDUCTORS", NECK: "NECK",
};

function AnatomyBody({ view, regions, active, onPick }) {
  const data = ANATOMY_DATA[view];
  const tr = { transition: "fill .35s ease, fill-opacity .35s ease, stroke .12s ease", cursor: "pointer" };
  const colorOf = rk => { const r = rk ? regions[rk] : null; const s = r ? r.status : null; return { fill: s ? s.color : "#3a4150", op: s ? s.opacity : 0.4 }; };
  return (
    <svg viewBox="0 0 100 200" style={{ width: "100%", maxWidth: 270, display: "block", margin: "0 auto" }}>
      <g>{Object.entries(data).map(([m, polys]) => polys.map((p, i) => (
        <polygon key={"b" + m + i} points={p} fill="#242932" stroke="#0e1118" strokeWidth="0.35" />
      )))}</g>
      {Object.entries(data).map(([m, polys]) => {
        const rk = POLY_TO_REGION[m]; if (!rk || !regions[rk]) return null;
        const c = colorOf(rk), on = active === rk;
        return polys.map((p, i) => (
          <polygon key={m + i} points={p} fill={c.fill} fillOpacity={c.op} stroke={on ? "#fff" : "#0e1118"} strokeWidth={on ? 0.9 : 0.35} style={tr}
            onMouseEnter={() => onPick(rk)} onClick={() => onPick(rk)} />
        ));
      })}
    </svg>
  );
}

// ─── MUSCLE PRIORITIZATION — shared UI (Goal Plan card + Workout Sets section) ──
const PRIO_RISK_COLOR = { green: "#8fd989", amber: "#f9c97e", red: "#f47e6e", grey: "#5a6472" };
const PRIO_RISK_LABEL = { green: "Green", amber: "Amber", red: "Red" };

function savePrioTarget(goals, onSaveGoals, id, val) {
  const map = { ...(goals.musclePriorities || {}) };
  if (val == null || val === PRIO_DEFAULT_SETS) delete map[id];
  else {
    const v = Math.max(6, Math.min(20, val));
    if (v >= PRIO_MIN) { const others = Object.entries(map).filter(([k, s]) => k !== id && s >= PRIO_MIN).length; if (others >= PRIO_MAX_COUNT) { toast(`Max ${PRIO_MAX_COUNT} prioritised muscles`); return; } }
    map[id] = v;
  }
  onSaveGoals({ ...goals, musclePriorities: map });
  haptic(6);
}

function SetStepper({ value, min, max, onDec, onInc }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 0, background: "var(--bg-2)", borderRadius: 8, overflow: "hidden" }}>
      <button onClick={onDec} disabled={value <= min} style={{ width: 28, height: 28, border: "none", background: "none", color: value <= min ? "var(--text-2)" : "var(--text)", fontSize: 16, cursor: value <= min ? "default" : "pointer" }}>−</button>
      <span style={{ minWidth: 26, textAlign: "center", fontWeight: 700, fontSize: 14 }}>{value}</span>
      <button onClick={onInc} disabled={value >= max} style={{ width: 28, height: 28, border: "none", background: "none", color: value >= max ? "var(--text-2)" : "var(--text)", fontSize: 16, cursor: value >= max ? "default" : "pointer" }}>+</button>
    </span>
  );
}

function MuscleSetsSection({ prio, goals, onSaveGoals }) {
  if (!prio.ready) return <Empty icon="◫" title="No workouts logged yet" hint="Log a workout — your weekly sets vs targets and stall-risk diagnosis appear here." />;
  const sorted = [...prio.targets].sort((a, b) => (b.prioritized ? 1 : 0) - (a.prioritized ? 1 : 0) || b.current - a.current);
  const recTxt = prio.recVerdict === "good" ? "Recovery looks good" : prio.recVerdict === "poor" ? "Recovery is compromised" : "Recovery: not enough data";
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 10px", borderRadius: 8, background: "var(--bg-2)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: prio.recVerdict === "good" ? PRIO_RISK_COLOR.green : prio.recVerdict === "poor" ? PRIO_RISK_COLOR.red : PRIO_RISK_COLOR.grey }} />
        <span className="small">{recTxt}. {prio.riskTargets.length ? `${prio.riskTargets.length} muscle${prio.riskTargets.length > 1 ? "s" : ""} need attention.` : "All prioritised muscles progressing."}</span>
      </div>
      {sorted.map(t => {
        const pct = Math.min(100, t.pct || 0);
        return (
          <div key={t.id} style={{ padding: "9px 0", borderTop: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: PRIO_RISK_COLOR[t.risk], flexShrink: 0 }} title={PRIO_RISK_LABEL[t.risk]} />
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{t.label}{t.prioritized && <span style={{ fontSize: 9, marginLeft: 6, padding: "1px 6px", borderRadius: 999, background: "rgba(92,200,223,0.15)", color: "#5cc8df", fontWeight: 700 }}>PRIORITY</span>}</span>
              <span className="small" style={{ color: t.current >= t.target ? "#8fd989" : "var(--text)" }}>{t.current}/{t.target}</span>
              <SetStepper value={t.target} min={6} max={20} onDec={() => savePrioTarget(goals, onSaveGoals, t.id, t.target - 1)} onInc={() => savePrioTarget(goals, onSaveGoals, t.id, t.target + 1)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, paddingLeft: 16 }}>
              <div style={{ flex: 1, height: 5, borderRadius: 5, background: "var(--bg-2)", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", borderRadius: 5, background: t.current >= t.target ? "#8fd989" : "var(--accent)" }} /></div>
              <span className="muted small" style={{ width: 86, textAlign: "right" }}>{t.status}</span>
            </div>
            {t.diagnosis && (
              <div style={{ marginLeft: 16, marginTop: 6, padding: "7px 10px", borderRadius: 8, background: t.risk === "red" ? "rgba(244,126,110,0.1)" : "rgba(249,201,126,0.1)", border: `1px solid ${PRIO_RISK_COLOR[t.risk]}44` }}>
                <div className="small" style={{ fontWeight: 700, color: PRIO_RISK_COLOR[t.risk] }}>{t.risk === "red" ? "⚠ " : ""}{t.diagnosis}</div>
                <div className="muted small" style={{ marginTop: 1, lineHeight: 1.4 }}>{t.recommendation}</div>
              </div>
            )}
          </div>
        );
      })}
      <p className="muted small" style={{ marginTop: 6, lineHeight: 1.45 }}>Target {RIR_TARGET} on every working set. Sets count hard sets only (warmups excluded). Prioritised muscles use your chosen 12–16; everything else targets {PRIO_DEFAULT_SETS}. These are recommendations — you always choose the volume.</p>
    </>
  );
}

function V3MusclePrioCard({ data, goals, onSaveGoals }) {
  const [sel, setSel] = useState("");
  const prio = useMemo(() => computeMusclePrio(data, goals, getTodayStr()), [data, goals]);
  const byId = {}; prio.targets.forEach(t => (byId[t.id] = t));
  const chosen = prio.targets.filter(t => t.prioritized);
  const atMax = chosen.length >= PRIO_MAX_COUNT;
  const available = PRIO_TARGETS.filter(t => !(byId[t.id] && byId[t.id].prioritized));
  const add = () => { if (!sel || atMax) return; savePrioTarget(goals, onSaveGoals, sel, 14); setSel(""); };
  return (
    <Card title="Muscle Prioritization" sub={`Choose up to ${PRIO_MAX_COUNT} muscles you want to prioritize during this phase.`}>
      {atMax ? (
        <p className="small" style={{ color: "#f9c97e", margin: "0 0 4px" }}>Maximum {PRIO_MAX_COUNT} muscles prioritized. Remove one to add another.</p>
      ) : (
        <div style={{ display: "flex", gap: 8, marginBottom: chosen.length ? 16 : 0 }}>
          <select value={sel} onChange={e => setSel(e.target.value)} style={{ flex: 1, background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 11px", fontSize: 14 }}>
            <option value="">Select muscle…</option>
            {available.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button onClick={add} disabled={!sel} className="btn-primary" style={{ padding: "0 20px", opacity: sel ? 1 : 0.45 }}>Add</button>
        </div>
      )}

      {chosen.length === 0 ? (
        <Empty icon="◎" title="No muscles prioritized yet" hint="Pick a muscle above to give it extra weekly volume this phase. Everything else trains at 10 sets/week." />
      ) : chosen.map(t => <PrioMuscleCard key={t.id} t={t} goals={goals} onSaveGoals={onSaveGoals} />)}

      {chosen.length > 0 && <p className="muted small" style={{ marginTop: 6, lineHeight: 1.45 }}>These targets drive your set goals in Workout → Muscle Analysis. Non-prioritized muscles hold at {PRIO_DEFAULT_SETS} sets. All sets assume {RIR_TARGET}. The system advises — you always choose the volume.</p>}
    </Card>
  );
}

function PrioMuscleCard({ t, goals, onSaveGoals }) {
  const pct = Math.min(100, t.pct || 0);
  const rc = PRIO_RISK_COLOR[t.risk];
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: ".02em" }}>{t.label}</span>
        <button onClick={() => savePrioTarget(goals, onSaveGoals, t.id, PRIO_DEFAULT_SETS)} style={{ background: "none", border: "none", color: "var(--text-2)", fontSize: 12, cursor: "pointer", padding: 0 }}>Remove</button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 12, marginBottom: 5 }}>
        <span className="muted small">Current Weekly Sets</span>
        <span style={{ fontWeight: 800, fontSize: 15 }}>{t.current} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>/ {t.target}</span></span>
      </div>
      <div style={{ height: 8, borderRadius: 8, background: "var(--bg-2)", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", borderRadius: 8, background: t.current >= t.target ? "#8fd989" : "var(--accent)" }} /></div>

      <div className="muted small" style={{ marginTop: 13, marginBottom: 6 }}>Target sets / week</div>
      <div style={{ display: "flex", gap: 6 }}>
        {[12, 13, 14, 15, 16].map(v => (
          <button key={v} onClick={() => savePrioTarget(goals, onSaveGoals, t.id, v)} style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1.5px solid ${t.target === v ? "#5cc8df" : "var(--line)"}`, background: t.target === v ? "rgba(92,200,223,0.16)" : "transparent", color: t.target === v ? "#5cc8df" : "var(--text)", fontWeight: t.target === v ? 800 : 500, fontSize: 14, cursor: "pointer" }}>{v}</button>
        ))}
      </div>
      <div className="muted small" style={{ marginTop: 7 }}>Current target: <b style={{ color: "var(--text)" }}>{t.target} sets/week</b></div>

      <div style={{ marginTop: 13, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: rc, flexShrink: 0 }} />
          <span className="small" style={{ fontWeight: 700 }}>Stall Risk: <span style={{ color: rc }}>{PRIO_RISK_LABEL[t.risk]}</span></span>
        </div>
        {t.diagnosis && <div className="small" style={{ marginTop: 6 }}><span className="muted">Diagnosis: </span><b>{t.diagnosis}</b></div>}
        <div className="small" style={{ marginTop: 6, lineHeight: 1.45 }}><span className="muted">Recommendation: </span>{t.recommendation}</div>
      </div>
    </div>
  );
}

function WorkoutAnalysis({ data, goals, onSaveGoals }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [tab, setTab] = useState("summary");
  const [view, setView] = useState("front");
  const [active, setActive] = useState(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });
  const vol = useMemo(() => computeVolume(data, goals, getTodayStr(), weekOffset), [data, goals, weekOffset]);
  const prio = useMemo(() => computeMusclePrio(data, goals, getTodayStr()), [data, goals]);
  const vmap = useMemo(() => { const o = {}; (vol.muscles || []).forEach(m => (o[m.key] = m)); return o; }, [vol]);

  if (!vol.ready) return <Card title="Training Analysis"><Empty icon="◫" title="No workouts logged yet" hint="Log a workout above — your weekly training analysis and muscle map appear here." /></Card>;

  const ar = active ? vol.regions[active] : null;
  const s = vol.summary, b = vol.balance;
  const s$ = n => (n > 0 ? "+" : "") + n;
  const intelGroups = useMemo(() => {
    const g = {};
    vol.muscles.forEach(m => { const rk = MUSCLES[m.key].region; (g[rk] = g[rk] || { region: rk, label: vol.regions[rk].label, total: vol.regions[rk].thisWeek, status: vol.regions[rk].status, items: [] }).items.push(m); });
    Object.values(g).forEach(x => x.items.sort((a, c) => c.thisWeek - a.thisWeek));
    return Object.values(g).sort((a, c) => c.total - a.total);
  }, [vol]);

  return (
    <>
      <Card title="Training Analysis" sub={vol.weekOffset === 0 ? `This week · from ${formatShortDate(vol.weekStart)}` : `Previous week · from ${formatShortDate(vol.weekStart)}`} action={<TierBadge tier="estimate" />}>
        <div className="seg" style={{ marginBottom: 10 }}>
          <button className={`seg-btn ${weekOffset === 0 ? "active" : ""}`} onClick={() => { setWeekOffset(0); setActive(null); }}>This Week</button>
          <button className={`seg-btn ${weekOffset === 1 ? "active" : ""}`} onClick={() => { setWeekOffset(1); setActive(null); }}>Previous Week</button>
        </div>
        <div className="skin-tabs" style={{ marginBottom: 12 }}>
          {[["summary", "Summary"], ["sets", "Sets"], ["intel", "Intelligence"], ["weak", "Weak Points"]].map(([k, l]) => (
            <button key={k} className={`skin-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {tab === "summary" && (
          <>
            <div className="gp-stat-row"><span className="muted small">Total hard sets</span><span>{s.totalSets}</span></div>
            <div className="gp-stat-row"><span className="muted small">Total exercises</span><span>{s.totalExercises}</span></div>
            <div className="gp-stat-row"><span className="muted small">Sessions</span><span>{s.totalSessions}</span></div>
            <div className="gp-stat-row"><span className="muted small">Training days</span><span>{s.trainingDays} / 7</span></div>
            <div className="gp-stat-row"><span className="muted small">Most trained</span><span>{s.highest ? `${s.highest.label} (${s.highest.sets})` : "—"}</span></div>
            <div className="gp-stat-row"><span className="muted small">Least trained</span><span>{s.lowest ? `${s.lowest.label} (${s.lowest.sets})` : "—"}</span></div>
            <div className="gp-stat-row"><span className="muted small">Volume vs previous week</span><span style={{ color: s.volumeTrendPct == null ? "var(--text-2)" : s.volumeTrendPct >= 0 ? "#8fd989" : "#f47e6e" }}>{s.volumeTrendPct == null ? "—" : `${s$(s.volumeTrendPct)}%`}</span></div>
            <p className="muted small" style={{ marginTop: 8, lineHeight: 1.4 }}>Session duration isn't logged, so it isn't shown. Counts are hard working sets (warmups excluded).</p>
          </>
        )}

        {tab === "sets" && <MuscleSetsSection prio={prio} goals={goals} onSaveGoals={onSaveGoals} />}

        {tab === "intel" && (
          <>
            {intelGroups.map(g => (
              <div key={g.region} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{g.label}</span>
                  <span className="small" style={{ color: g.status.color, fontWeight: 600 }}>{g.total} · {g.status.label}</span>
                </div>
                {g.items.map(m => (
                  <div key={m.key} className="gp-stat-row" style={{ padding: "2px 0" }}>
                    <span className="small" style={{ flex: 1, paddingLeft: 10, color: "var(--text-2)" }}>{m.label}</span>
                    <span className="small" style={{ width: 48, textAlign: "right" }}>{m.thisWeek} set{m.thisWeek === 1 ? "" : "s"}</span>
                    <span className="small" style={{ width: 56, textAlign: "right", color: "var(--text-2)" }}>{m.recommended}</span>
                    <span className="small" style={{ width: 84, textAlign: "right", color: m.status.color, fontWeight: 600 }}>{m.status.label}</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 10 }}>
              <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Volume balance <span className="muted" style={{ fontWeight: 400 }}>(hard sets)</span></div>
              <div className="gp-stat-row"><span className="muted small">Push / Pull</span><span>{b.push} / {b.pull}</span></div>
              <div className="gp-stat-row"><span className="muted small">Upper / Lower</span><span>{b.upper} / {b.lower}</span></div>
              <div className="gp-stat-row"><span className="muted small">Anterior / Posterior</span><span>{b.anterior} / {b.posterior}</span></div>
            </div>
          </>
        )}

        {tab === "weak" && (
          vol.weakPoints.length === 0
            ? <Empty icon="✓" title="Nothing under-trained" hint="Every muscle hit its recommended weekly minimum this week." />
            : vol.weakPoints.map((w, i) => (
              <div key={w.key} style={{ padding: "8px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Weak point #{i + 1} · {w.label}</div>
                <p className="muted small" style={{ margin: "3px 0", lineHeight: 1.45 }}>{w.reason}</p>
                <div className="gp-stat-row"><span className="muted small">Suggested target</span><span>{w.suggestedTarget} sets/wk</span></div>
                {w.exercises.length > 0 && <div className="gp-stat-row"><span className="muted small">Try</span><span>{w.exercises.join(" · ")}</span></div>}
              </div>
            ))
        )}
      </Card>

      <Card title="Muscle Map" sub="weekly volume by muscle group" action={<span style={{ display: "flex", gap: 6 }}>
        <button className={`seg-btn ${view === "front" ? "active" : ""}`} style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => { setView("front"); setActive(null); }}>Front</button>
        <button className={`seg-btn ${view === "back" ? "active" : ""}`} style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => { setView("back"); setActive(null); }}>Back</button>
      </span>}>
        <div style={{ position: "relative" }} onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top }); }} onMouseLeave={() => setActive(null)}>
          <AnatomyBody view={view} regions={vol.regions} active={active} onPick={setActive} />
          {ar && (
            <div style={{ position: "absolute", left: Math.min(tip.x + 14, 200), top: Math.max(tip.y - 8, 0), pointerEvents: "none", background: "rgba(16,19,26,0.97)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", minWidth: 164, boxShadow: "0 10px 30px rgba(0,0,0,0.55)", zIndex: 5, backdropFilter: "blur(8px)" }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 5 }}>{ar.label}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-2)", gap: 16 }}><span>This week</span><b style={{ color: "var(--text)" }}>{ar.thisWeek} sets</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-2)", gap: 16 }}><span>Previous</span><span>{ar.lastWeek}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-2)", gap: 16 }}><span>Change</span><span style={{ color: (ar.changePct ?? ar.change) > 0 ? "#8fd989" : (ar.changePct ?? ar.change) < 0 ? "#f47e6e" : "var(--text-2)" }}>{ar.changePct != null ? `${s$(ar.changePct)}%` : `${s$(ar.change)} sets`}</span></div>
              <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: ar.status.color }}>{ar.status.label} · rec {ar.recommended}</div>
              {ar.muscles.length > 1 && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--line)" }}>
                  {ar.muscles.map(m => (
                    <div key={m.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-2)", gap: 14 }}><span style={{ color: m.thisWeek ? m.status.color : "var(--text-2)" }}>{m.label}</span><span>{m.thisWeek}</span></div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <p className="muted small" style={{ textAlign: "center", margin: "4px 0 10px" }}>{active ? vol.regions[active].label : "Hover or tap a muscle"}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          {STATUS_LEGEND.map(l => (
            <span key={l.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-2)" }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: l.color, opacity: l.opacity, display: "inline-block" }} />{l.label}
            </span>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 10, lineHeight: 1.4 }}>Colored by weekly volume vs each muscle's recommended range (estimated — individual tolerance varies). Map is a stylized anatomy, not a medical render.{s.unmappedSets > 0 ? ` ${s.unmappedSets} set${s.unmappedSets > 1 ? "s" : ""} couldn't be matched to a muscle.` : ""}</p>
      </Card>
    </>
  );
}

// ─── WORKOUT SCREEN — composes the 5 cards in order ─────────────────────────
function WorkoutScreen({ data, goals, addEntry, onSaveGoals }) {
  const today = getTodayStr();
  const sessionHeader = useMemo(() => {
    const todayEntries = (data.exercise || []).filter(e => e.date === today);
    let sets = 0, volume = 0, ant = 0, post = 0; const muscles = new Set();
    todayEntries.forEach(e => {
      const p = e._parsed || parseWorkout(e.text || "");
      volume += p.totalVolume || 0;
      (p.exercises || []).forEach(ex => {
        const w = (ex.sets || []).filter(s => !(s && s.rpe != null && s.rpe < 5)).length;
        if (!w) return; sets += w;
        const m = resolveMuscle(ex.name, goals.exerciseMap);
        if (m) { muscles.add(MUSCLES[m].label); (MUSCLES[m].side === "front" ? (ant += w) : (post += w)); }
      });
    });
    const planned = (data.plannedSessions || []).find(s => s.date === today);
    const plannedName = planned ? ((SESSION_TYPES[planned.type] || {}).label || planned.type) : null;
    const labeled = todayEntries.find(e => e.label && e.label !== "Workout");
    const name = plannedName || (labeled && labeled.label) || (sets > 0 ? (ant >= post ? "Anterior day" : "Posterior day") : "New session");
    return { name, sets, volume: Math.round(volume), muscles: [...muscles], any: todayEntries.length > 0, planned: !!plannedName };
  }, [data.exercise, data.plannedSessions, goals.exerciseMap, today]);

  const header = (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em" }}>{sessionHeader.name}</div>
        <div className="muted small">{sessionHeader.planned ? "from your plan" : sessionHeader.any ? "today" : "nothing logged yet today"}</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 90, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px" }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>Sets</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{sessionHeader.sets}</div>
        </div>
        <div style={{ flex: 1, minWidth: 90, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px" }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>Volume</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{sessionHeader.volume.toLocaleString()}<span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> kg</span></div>
        </div>
      </div>
      {sessionHeader.muscles.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {sessionHeader.muscles.map(m => <span key={m} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "rgba(92,200,223,0.12)", border: "1px solid rgba(92,200,223,0.3)", color: "#9fe0ee" }}>{m}</span>)}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <ExerciseForm onAdd={addEntry("exercise")} recent={data.exercise} hideRecent header={header} />
      <WorkoutAnalysis data={data} goals={goals} onSaveGoals={onSaveGoals} />
      <ExerciseMappingCard data={data} goals={goals} onSaveGoals={onSaveGoals} />
      <RecentWorkoutsCard recent={data.exercise} />
    </div>
  );
}

// ─── CARD 4 — Exercise Mapping (one exercise → one primary muscle, editable) ──
function ExerciseMappingCard({ data, goals, onSaveGoals }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null); // { norm, sel }
  const list = useMemo(() => listExerciseMappings(data, goals), [data, goals]);
  const filtered = q.trim() ? list.filter(x => x.name.toLowerCase().includes(q.toLowerCase())) : list;
  const save = () => { const em = { ...(goals.exerciseMap || {}) }; em[edit.norm] = edit.sel; onSaveGoals({ ...goals, exerciseMap: em }); setEdit(null); haptic(8); };
  const reset = norm => { const em = { ...(goals.exerciseMap || {}) }; delete em[norm]; onSaveGoals({ ...goals, exerciseMap: em }); setEdit(null); haptic(6); };

  return (
    <Card title="Exercise Mapping" sub="Your logged exercises — categorized" action={list.length > 0 && <button className="btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>{open ? "Hide ▾" : "Show ▸"}</button>}>
      {list.length === 0 ? (
        <Empty icon="◌" title="No exercises logged yet" hint="Log workouts and FitLog automatically builds your exercise mapping database — only the exercises you actually use." />
      ) : open ? <>
      <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search exercises…"
        style={{ width: "100%", background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 14, margin: "10px 0" }} />
      <div style={{ maxHeight: 360, overflowY: "auto", margin: "0 -4px" }}>
        {filtered.length === 0 && <p className="muted small" style={{ padding: "8px 4px" }}>No exercises match “{q}”.</p>}
        {filtered.map(x => edit && edit.norm === x.norm ? (
          <div key={x.norm} style={{ padding: "10px 8px", borderRadius: 10, background: "var(--bg-2)", margin: "4px 0" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{x.name}</div>
            <div className="muted small" style={{ marginBottom: 6 }}>Primary muscle</div>
            <select value={edit.sel} onChange={e => setEdit({ ...edit, sel: e.target.value })}
              style={{ width: "100%", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 10px", fontSize: 14 }}>
              {MUSCLE_KEYS.map(k => <option key={k} value={k}>{MUSCLES[k].label}</option>)}
            </select>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn-primary btn-sm" style={{ flex: 1 }} onClick={save}>Save changes</button>
              {x.overridden && <button className="btn-ghost btn-sm" onClick={() => reset(x.norm)}>Reset</button>}
              <button className="btn-ghost btn-sm" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button key={x.norm} onClick={() => setEdit({ norm: x.norm, sel: x.muscle || MUSCLE_KEYS[0] })}
            style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 8px", borderRadius: 8, background: "transparent", border: "none", borderBottom: "1px solid var(--line)", cursor: "pointer", textAlign: "left" }}>
            <span className="small" style={{ color: "var(--text)" }}>{x.name}{x.overridden ? " ✎" : ""}</span>
            <span className="small" style={{ color: x.muscle ? "var(--text-2)" : "#f9c97e", whiteSpace: "nowrap" }}>{x.muscle ? MUSCLES[x.muscle].label : "Set muscle"} ›</span>
          </button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>This list grows as you log new exercises — each gets an auto-suggested muscle you can change. Every workout metric (Training Analysis, Weak Points, the Muscle Map, Goal-Plan volume) reads from it.</p>
      </> : null}
    </Card>
  );
}

// ─── CARD 5 — Recent Workouts (timeline) ────────────────────────────────────
function RecentWorkoutsCard({ recent }) {
  const [open, setOpen] = useState(false);
  const items = useMemo(() => (recent || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0) || (b.date || "").localeCompare(a.date || "")).slice(0, 10), [recent]);
  if (!items.length) return null;
  const durOf = txt => { const m = (txt || "").match(/(\d+)\s*h\s*(\d+)?\s*m|\b(\d+)\s*min/i); if (!m) return null; if (m[3]) return `${m[3]}m`; return `${m[1]}h${m[2] ? " " + m[2] + "m" : ""}`; };
  return (
    <Card title="Recent Workouts" sub="View previous training sessions" action={<button className="btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>{open ? "Hide ▾" : "Show ▸"}</button>}>
      {open && items.map((w, i) => {
        const p = w._parsed || parseWorkout(w.text || "");
        const dur = durOf(w.text);
        return (
          <div key={w.id || i} style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <div style={{ width: 3, borderRadius: 3, background: w.prs && w.prs.length ? "#f9c97e" : "var(--line)", alignSelf: "stretch" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{w.label || "Workout"}{w.prs && w.prs.length ? " 🏆" : ""}</span>
                <span className="muted small" style={{ whiteSpace: "nowrap" }}>{formatShortDate(w.date)}</span>
              </div>
              <div className="muted small" style={{ marginTop: 2 }}>
                {p.totalSets} sets · {Math.round(p.totalVolume || 0).toLocaleString()} kg{dur ? ` · ${dur}` : ""}{w.prs && w.prs.length ? ` · ${w.prs.length} PR${w.prs.length > 1 ? "s" : ""}` : ""}
              </div>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function TrainingCard({ data, goals }) {
  const tr = useMemo(() => computeTraining(data, goals), [data, goals]);
  if (!tr) return null;

  const statusMeta = {
    progressing: { s: "good", label: "Progressing" },
    stalled: { s: "warn", label: "Stalled" },
    regressing: { s: "bad", label: "Slipping" },
  };
  const bandColor = { low: "var(--muted)", maint: "var(--accent)", growth: "var(--good)", high: "#f9c97e" };
  const conf = tr.confidence;

  return (
    <Card title="Training intelligence" sub="Progression + weekly volume" action={<StatusPill status={conf === "High" ? "good" : conf === "Moderate" ? "warn" : null} label={conf} />}>
      {/* PROGRESSION */}
      <div className="train-sub">Lift progression <span className="muted">· last 8 weeks</span></div>
      {tr.progression.lifts.length ? (
        <div className="train-lifts">
          {tr.progression.lifts.map((l, i) => {
            const m = statusMeta[l.status] || { s: null, label: l.status };
            return (
              <div key={i} className="train-lift-row">
                <span className="train-lift-name">{l.name}</span>
                <span className="train-lift-e1rm">{l.e1rmNow}<span className="muted" style={{ fontSize: 11 }}>kg</span></span>
                <StatusPill status={m.s} label={l.status === "progressing" ? `+${l.slopePct}%/wk` : m.label} />
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted small" style={{ lineHeight: 1.5 }}>Log a lift 3+ times over a couple of weeks and its estimated-1RM trend shows up here.</p>
      )}

      {/* VOLUME */}
      <div className="train-sub" style={{ marginTop: 16 }}>This week's volume <span className="muted">· {tr.week.workingSets} working sets · {tr.week.sessions} sessions</span></div>
      {tr.week.trained.length ? (
        <div className="train-vol">
          {tr.week.sortedVol.map((m, i) => (
            <div key={i} className="train-vol-row">
              <span className="train-vol-label">{m.label}</span>
              <div className="train-vol-track"><div className="train-vol-fill" style={{ width: `${Math.min(100, (m.sets / 20) * 100)}%`, background: bandColor[m.band] }} /></div>
              <span className="train-vol-sets">{m.sets}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">No working sets mapped this week yet.</p>
      )}

      {tr.week.neglected.length > 0 && (
        <div className="eb-flag" style={{ borderColor: "#f9c97e", color: "#f9c97e" }}>Under-trained this week: {tr.week.neglected.join(", ")} (under ~6 hard sets). For balanced growth, aim ~10+ each.</div>
      )}
      {tr.week.imbalances.length > 0 && (
        <div className="eb-flag" style={{ borderColor: "var(--border-strong)", color: "var(--text-2)", marginTop: 8 }}>{tr.week.imbalances[0]}.</div>
      )}

      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>
        Volume ranges are rough guidance (~10–20 sets/muscle/week for growth), not rules. Warm-ups are filtered approximately, and lifts are mapped to muscles by name{tr.week.unmapped.length ? ` — couldn't place: ${tr.week.unmapped.slice(0, 3).join(", ")}` : ""}.
      </p>
    </Card>
  );
}

function TrendsView({ data, goals }) {
  const [range, setRange] = useState(14);
  const series = useMemo(() => Array.from({ length: range }, (_, i) => daysAgo(range - 1 - i)), [range]);

  const sleepPts = series.map(d => { const s = data.sleep.find(x => x.date === d); return { value: s ? s.duration : null, label: d }; });
  const calPts = series.map(d => { const day = data.diet.filter(x => x.date === d); return { value: day.length ? day.reduce((a, m) => a + (m.calories || 0), 0) : null, label: d }; });
  const proteinPts = series.map(d => { const day = data.diet.filter(x => x.date === d); return { value: day.length ? day.reduce((a, m) => a + (m.protein || 0), 0) : null, label: d }; });
  const workoutPts = series.map(d => ({ value: data.exercise.filter(x => x.date === d).length + data.sports.filter(x => x.date === d).length, label: d }));
  const waterPts = series.map(d => { const ml = data.water.filter(x => x.date === d).reduce((a, w) => a + w.ml, 0); return { value: ml || null, label: d }; });

  const sleepVals = sleepPts.map(p => p.value).filter(v => v != null);
  const avgSleep = sleepVals.length ? +(sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length).toFixed(1) : null;
  const sleepNeed = estimateSleepNeed(data, goals).hours;
  const sleepDebt = sleepVals.length ? sleepVals.reduce((debt, v) => debt + (sleepNeed - v), 0) : null;

  const calVals = calPts.map(p => p.value).filter(v => v != null);
  const avgCal = calVals.length ? Math.round(calVals.reduce((a, b) => a + b, 0) / calVals.length) : null;

  const proteinHits = proteinPts.filter(p => p.value != null && p.value >= goals.protein).length;
  const proteinLogged = proteinPts.filter(p => p.value != null).length;

  const totalWorkouts = workoutPts.reduce((a, p) => a + p.value, 0);

  // Sleep × workout correlation
  const corr = (() => {
    const days = series.map(d => {
      const s = data.sleep.find(x => x.date === d);
      const w = data.exercise.filter(x => x.date === d).length + data.sports.filter(x => x.date === d).length;
      return s ? { sleep: s.duration, w } : null;
    }).filter(Boolean);
    if (days.length < 4) return null;
    const good = days.filter(d => d.sleep >= 7);
    const poor = days.filter(d => d.sleep < 7);
    if (!good.length || !poor.length) return null;
    return {
      goodAvg: +(good.reduce((a, d) => a + d.w, 0) / good.length).toFixed(2),
      poorAvg: +(poor.reduce((a, d) => a + d.w, 0) / poor.length).toFixed(2),
      goodN: good.length, poorN: poor.length
    };
  })();

  return (
    <>
      <div className="seg">
        {[7, 14, 30].map(r => (
          <button key={r} className={`seg-btn ${range === r ? "active" : ""}`} onClick={() => setRange(r)}>{r} days</button>
        ))}
      </div>

      <EnergyBalanceCard data={data} goals={goals} />

      <TrainingCard data={data} goals={goals} />

      <ConsistencyHeatmap data={data} />

      <Card title="😴 Sleep">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Average</span><span className="ts-v">{avgSleep ?? "—"}h</span></div>
          <div className="ts"><span className="ts-l">Sleep debt</span><span className={`ts-v ${sleepDebt == null ? "" : sleepDebt > 5 ? "warn" : sleepDebt > 0 ? "neutral" : "good"}`}>{sleepDebt == null ? "—" : `${sleepDebt > 0 ? "+" : ""}${Math.round(sleepDebt*10)/10}h`}</span></div>
        </div>
        <MiniChart points={sleepPts} showGoal={sleepNeed} rollingAvg unit="h" />
      </Card>

      <Card title="🍎 Calories">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Average</span><span className="ts-v">{avgCal ?? "—"}</span></div>
          <div className="ts"><span className="ts-l">Target</span><span className="ts-v muted">{goals.calories}</span></div>
        </div>
        <MiniChart points={calPts} showGoal={goals.calories} rollingAvg />
      </Card>

      <Card title="🥩 Protein">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Target hit</span><span className={`ts-v ${proteinLogged && proteinHits >= proteinLogged * 0.7 ? "good" : "neutral"}`}>{proteinLogged ? `${proteinHits}/${proteinLogged} days` : "—"}</span></div>
        </div>
        <MiniChart points={proteinPts} showGoal={goals.protein} unit="g" />
      </Card>

      <Card title="💪 Workouts">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Total</span><span className="ts-v">{totalWorkouts}</span></div>
        </div>
        <div className="bars-row">
          {workoutPts.map((p, i) => (
            <div key={i} className="bar-col" title={`${p.value} workout${p.value === 1 ? "" : "s"}`}>
              <div className="bar-fill" style={{ height: `${Math.min(100, p.value * 33)}%`, opacity: p.value === 0 ? 0.15 : 1 }} />
            </div>
          ))}
        </div>
      </Card>

      <Card title="💧 Water">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Daily target</span><span className="ts-v">{goals.waterGoalMl}ml</span></div>
        </div>
        <MiniChart points={waterPts} showGoal={goals.waterGoalMl} unit="ml" />
      </Card>

      {corr && (
        <Card title="🔬 Sleep ↔ Training" className="insight-card">
          <p className="md-p">
            On nights with <strong>7+ hours sleep</strong> ({corr.goodN} days), you averaged <strong>{corr.goodAvg}</strong> workout{corr.goodAvg === 1 ? "" : "s"}/day.
            On nights with less ({corr.poorN} days), you averaged <strong>{corr.poorAvg}</strong>.
          </p>
          <p className="muted small" style={{ marginTop: 6 }}>
            {corr.goodAvg > corr.poorAvg ? "→ Better sleep correlates with more training. Prioritize rest." : corr.goodAvg < corr.poorAvg ? "→ You train more on less sleep. Watch for burnout." : "→ No strong difference yet. Keep logging."}
          </p>
        </Card>
      )}
    </>
  );
}

function ListsView({ data, deleteEntry }) {
  const [cat, setCat] = useState("diet");
  const [limit, setLimit] = useState(50);
  const [confirm, confirmModal] = useConfirm();
  const cats = [
    { key: "diet", label: "Meals", icon: "◉" },
    { key: "sleep", label: "Sleep", icon: "◐" },
    { key: "exercise", label: "Workouts", icon: "◆" },
    { key: "sports", label: "Sports", icon: "◇" },
    { key: "water", label: "Water", icon: "◊" },
    { key: "supplements", label: "Supplements", icon: "⊕" },
    { key: "nicotine", label: "Nicotine", icon: "🚬" },
    { key: "weight", label: "Weight", icon: "⚖" },
    { key: "ejac", label: "Ejac", icon: "💧" },
  ];
  const entries = data[cat] || [];
  const shown = entries.slice(0, limit);
  const label = cats.find(c => c.key === cat).label;

  async function handleDelete(item) {
    const ok = await confirm({ title: "Delete this entry?", body: "This can't be undone.", confirmLabel: "Delete", danger: true });
    if (ok) { deleteEntry(cat)(item.id); toast("Entry deleted"); }
  }

  return (
    <>
      {confirmModal}
      <div className="subtabs">
        {cats.map(c => (
          <button key={c.key} className={`subtab ${cat === c.key ? "active" : ""}`} onClick={() => { setCat(c.key); setLimit(50); }}>
            <span className="subtab-icon">{c.icon}</span>{c.label}
          </button>
        ))}
      </div>
      <Card title={label} sub={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}>
        {entries.length === 0 ? (
          <Empty title={`No ${label.toLowerCase()} logged yet`} hint="Tap the ＋ button to add some" />
        ) : (
          <>
            <div className="hist-list">
              {shown.map(item => <HistItem key={item.id} item={item} type={cat} onDelete={() => handleDelete(item)} />)}
            </div>
            {entries.length > limit && (
              <button className="btn-ghost full" style={{ marginTop: 10 }} onClick={() => setLimit(l => l + 50)}>Show more ({entries.length - limit} remaining)</button>
            )}
          </>
        )}
      </Card>
    </>
  );
}

function HistItem({ item, type, onDelete }) {
  const [open, setOpen] = useState(false);
  let main = "", tags = [], detail = null;
  if (type === "sleep") {
    main = `${item.duration}h · ${item.quality}`;
    tags = [`${item.bedtime} → ${item.wakeTime}`];
    detail = item.notes;
  } else if (type === "diet") {
    main = `${item.meal} · ${item.food}`;
    tags = [item.time, `${item.calories} kcal`, `P ${item.protein}g`].filter(Boolean);
    detail = (
      <div className="diet-detail">
        <MacroDonut protein={item.protein} carbs={item.carbs} fat={item.fat} size={72} />
        <div className="diet-detail-macros">
          <div><span style={{ color: "#b4a8e8" }}>●</span> Protein {item.protein}g</div>
          <div><span style={{ color: "#f9c97e" }}>●</span> Carbs {item.carbs}g</div>
          <div><span style={{ color: "#f47e6e" }}>●</span> Fat {item.fat}g</div>
          {item.notes && <div className="muted small" style={{ marginTop: 4 }}>{item.notes}</div>}
        </div>
      </div>
    );
  } else if (type === "exercise") {
    const p = item._parsed || parseWorkout(item.text);
    main = item.label;
    tags = [p.exercises.length ? `${p.exercises.length} ex` : `${item.text.split("\n").filter(Boolean).length} lines`, p.totalVolume ? `${p.totalVolume.toLocaleString()}kg` : null, item.prs?.length ? `🏆 ${item.prs.length}` : null].filter(Boolean);
    detail = (
      <div>
        {item.prs?.length > 0 && (
          <div className="pr-banner">🏆 {item.prs.map(pr => `${pr.name} ${pr.weight}${pr.unit}×${pr.reps}`).join(" · ")}</div>
        )}
        {p.exercises.length > 0 && (
          <div className="ex-detail-list">
            {p.exercises.map((ex, i) => {
              const bs = bestSet(ex.sets);
              return <div key={i} className="ex-detail-row"><span>{ex.name}</span><span className="muted">{ex.sets.length}×{bs ? ` top ${bs.weight}${bs.unit}×${bs.reps}` : ""}</span></div>;
            })}
          </div>
        )}
        <pre className="raw-text">{item.text}</pre>
      </div>
    );
  } else if (type === "sports") {
    main = `${item.sport} · ${item.duration}min`;
    tags = [item.intensity, item.result || "Practice", `${item.calories} kcal`].filter(Boolean);
    detail = [item.opponent && `vs ${item.opponent}`, item.score && `Score: ${item.score}`, item.notes].filter(Boolean).join(" · ");
  } else if (type === "water") {
    main = `${item.ml}ml`;
    tags = item.ts ? [new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })] : [];
  } else if (type === "supplements") {
    main = item.name;
    tags = [item.dose, item.ts && new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })].filter(Boolean);
  } else if (type === "nicotine") {
    const ti = NIC_TYPES.find(t => t.key === item.type);
    main = `${ti?.icon || ""} ${item.amount} ${ti?.unit || item.type}${item.type === "pouch" && item.mg ? ` · ${item.mg}mg` : ""}`.trim();
    tags = [item.ts && new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), ...(item.contexts || [])].filter(Boolean);
  } else if (type === "weight") {
    main = `${item.kg}kg`;
    tags = item.ts ? [new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })] : [];
  } else if (type === "ejac") {
    const flags = [item.porn ? "porn" : null, item.gooning ? "gooning" : null].filter(Boolean);
    main = "Session" + (flags.length ? ` · ${flags.join(", ")}` : "");
    tags = item.ts ? [new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })] : [];
  }

  const hasDetail = detail && (typeof detail === "string" ? detail.trim() : true);

  return (
    <div className={`hist ${open ? "open" : ""}`}>
      <div className="hist-head" onClick={() => hasDetail && setOpen(o => !o)}>
        <div className="hist-l">
          <span className="hist-dot" style={{ background: TYPE_DOT[type] }} />
          <div className="hist-text">
            <div className="hist-main">{main}</div>
            <div className="hist-date">{formatShortDate(item.date)}</div>
          </div>
        </div>
        <div className="hist-tags">
          {tags.map((t, i) => <span key={i} className="hist-tag">{t}</span>)}
          {hasDetail && <span className="muted">{open ? "▲" : "▼"}</span>}
          <button className="x" onClick={(e) => { e.stopPropagation(); onDelete(); }}>×</button>
        </div>
      </div>
      {open && hasDetail && (
        <div className="hist-detail">{detail}</div>
      )}
    </div>
  );
}

// ─── COACH TAB ────────────────────────────────────────────────────────────────
const COACH_GREETING = { role: "assistant", text: "Hey! I'm your AI coach. Ask me anything — best exercises for your goal, how to improve your sleep, what to eat before a workout, whether you should rest today. I see your real fitness data and remember our chats. 💪", ts: Date.now() };

function loadMessages() {
  try { const r = localStorage.getItem(STORAGE_KEY + "_chat"); const p = r ? JSON.parse(r) : null; return Array.isArray(p) && p.length ? p : [COACH_GREETING]; } catch { return [COACH_GREETING]; }
}
const saveMessages = m => {
  // Don't persist base64 image previews — they'd bloat storage and the cloud row.
  const stripped = m.map(msg => msg.image ? { ...msg, image: undefined, hadImage: true } : msg);
  localStorage.setItem(STORAGE_KEY + "_chat", JSON.stringify(stripped));
  cloudSync();
};

function CoachTab({ data, goals }) {
  const [messages, setMessages] = useState(loadMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("chat"); // chat | analysis | physique
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoad, setAnalysisLoad] = useState(false);
  const [analysisErr, setAnalysisErr] = useState("");
  const [confirm, confirmModal] = useConfirm();
  const [attached, setAttached] = useState(null);
  // Physique state
  const [physFile, setPhysFile] = useState(null);
  const [physPreview, setPhysPreview] = useState(null);
  const [physResult, setPhysResult] = useState(null);
  const [physLoading, setPhysLoading] = useState(false);
  const [physErr, setPhysErr] = useState("");
  const endRef = useRef(null);
  const camRef = useRef();
  const galRef = useRef();
  const physCamRef = useRef();
  const physGalRef = useRef();

  function attachFile(f) {
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const dataUrl = ev.target.result;
      setAttached({ b64: dataUrl.split(",")[1], mediaType: f.type, preview: dataUrl });
    };
    r.readAsDataURL(f);
  }

  useEffect(() => { saveMessages(messages); }, [messages]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const hasData = data.sleep.length || data.diet.length || data.exercise.length || data.sports.length;

  function ctx() {
    return formatBrainText(buildBrain(data, goals));
  }

  async function compactIfNeeded(msgs) {
    if (msgs.length < 22) return msgs;
    if (msgs.some(m => m.summary)) {
      const sIdx = msgs.findIndex(m => m.summary);
      if (msgs.length - sIdx - 1 < 30) return msgs;
    }
    const toSum = msgs.slice(1, msgs.length - 20);
    const transcript = toSum.map(m => `${m.role.toUpperCase()}: ${m.text}`).join("\n\n");
    try {
      const sum = await callClaude({ system: "Summarize this coaching conversation in 4-6 bullet points: what the user works on, advice given, preferences, progress. Specific, no preamble.", userText: transcript, maxTokens: 400 });
      return [msgs[0], { role: "assistant", summary: true, text: `📝 *Earlier conversation summary:*\n\n${sum}`, ts: Date.now() }, ...msgs.slice(-20)];
    } catch { return msgs; }
  }

  async function send() {
    const q = input.trim();
    if ((!q && !attached) || loading) return;
    setInput("");
    const img = attached;
    setAttached(null);
    const userMsg = { role: "user", text: q || (img ? "(sent a photo)" : ""), ts: Date.now() };
    if (img) userMsg.image = img.preview; // store preview for re-display
    let updated = [...messages, userMsg];
    setMessages(updated);
    setLoading(true);
    try {
      updated = await compactIfNeeded(updated);
      setMessages(updated);
      const apiMsgs = updated.slice(1).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
      const lastU = apiMsgs.map(m => m.role).lastIndexOf("user");
      if (lastU >= 0) {
        const textPart = `[Current data]\n${ctx()}\n\n[My message]\n${q || "Please look at this photo and give feedback relevant to my fitness goal."}`;
        if (img) {
          apiMsgs[lastU] = { role: "user", content: [
            { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.b64 } },
            { type: "text", text: textPart }
          ]};
        } else {
          apiMsgs[lastU] = { role: "user", content: textPart };
        }
      }
      const reply = await callClaude({
        model: currentModelId(),
        system: `You are this user's personal coach — an elite strength & conditioning coach and sports nutritionist who actually knows them. The data block is your shared file with them. You also have your full conversation history (including a summary of older chats).

REAL-TIME ACCESS: The "RIGHT NOW" section at the top of the data block contains the ACTUAL current date, day of week, and time. This is real and authoritative — never claim you don't know what time/day it is. If asked "what time is it," answer directly from the RIGHT NOW block.

KNOW THEM AS A PERSON: The "ABOUT THE USER" section (if present) contains body stats, injuries, allergies, equipment access, preferences, and current life context. ALWAYS respect these — never suggest a movement that conflicts with an injury, never suggest a food they can't eat, never ignore their equipment limits or life context.

KNOW THE STRATEGY: The "CURRENT STRATEGY" section (if present) is what you're currently building toward — phase, focus, week of block. Evaluate data AGAINST the strategy, not in a vacuum. If they're in a cut phase and protein is low, that's a critical fix. If they're week 5 of a 6-week strength block, a deload comes next.

SIGNAL PRIORITY: The "KEY SIGNALS" section is ranked. CRITICAL signals must be addressed even if not asked. IMPORTANT signals lead the response when relevant. Notable signals only come up if the user's question touches that area.

CONNECT ACROSS CATEGORIES: Nutrition affects training. Sleep affects recovery. Today's plan affects what to eat. Recent PRs affect deload timing. Never treat these as separate topics.

${COACH_PRINCIPLES}

USE PHOTOS: When the user sends a meal/physique/gym photo, analyze it and tie back to their actual numbers and strategy when relevant.

WEB SEARCH: You can search the web, but only when you genuinely need a current/specific fact (exact branded nutrition, recent research, specific product). For general training/nutrition advice, answer directly.

FORMAT: Markdown — **bold** for key points, bullet lists for steps. Keep it tight — usually 2-3 short paragraphs. Their stated goal: ${goals.goal}.`,
        maxTokens: 1000,
        conversationMessages: apiMsgs,
        tools: WEB_SEARCH_TOOL
      });
      setMessages(m => [...m, { role: "assistant", text: reply || "Sorry, try again.", ts: Date.now() }]);
      SFX.success();
    } catch {
      setMessages(m => [...m, { role: "assistant", text: "Something went wrong. Try again.", ts: Date.now() }]);
      SFX.error();
    }
    setLoading(false);
  }

  async function clearChat() {
    const ok = await confirm({ title: "Clear chat history?", body: "All messages will be deleted. This can't be undone.", confirmLabel: "Clear", danger: true });
    if (ok) { setMessages([COACH_GREETING]); toast("Chat cleared"); }
  }

  async function runAnalysis() {
    setAnalysisLoad(true); setAnalysisErr("");
    try { setAnalysis(await analyzeAllData(data, goals)); }
    catch { setAnalysisErr("Couldn't analyze. Try again."); }
    setAnalysisLoad(false);
  }

  async function handlePhysFile(f) {
    if (!f) return;
    setPhysFile(f); setPhysResult(null); setPhysErr("");
    const r = new FileReader();
    r.onload = ev => setPhysPreview(ev.target.result);
    r.readAsDataURL(f);
  }

  async function analyzePhys() {
    if (!physFile) return;
    setPhysLoading(true); setPhysErr(""); setPhysResult(null);
    try {
      const resized = await fileToResizedBase64(physFile, 1280, 0.85);
      const brain = buildBrain(data, goals);
      const r = await analyzePhysique(resized.base64, resized.mediaType, goals, brain);
      if (r) setPhysResult(r); else setPhysErr("Couldn't analyze that photo. Try a clearer one in better light.");
    } catch { setPhysErr("Couldn't analyze that photo. Try again."); }
    setPhysLoading(false);
  }

  function clearPhys() {
    setPhysFile(null); setPhysPreview(null); setPhysResult(null); setPhysErr("");
  }

  const suggestions = ["Should I train today or rest?", "Am I eating enough protein?", "What should I eat pre-workout?", "How can I improve my sleep?"];
  const statusColor = { good: "var(--good)", warning: "var(--warn)", critical: "var(--bad)" };

  return (
    <div className="coach-wrap">
      {confirmModal}
      <div className="coach-bar">
        <div className="coach-bar-l">
          <span className="coach-bar-title">AI Coach</span>
          <span className="muted small">{view === "chat" ? `${messages.length - 1} messages · ${MODELS[_currentModel]?.label}` : MODELS[_currentModel]?.label}</span>
        </div>
        {view === "chat" && messages.length > 1 && <button className="link-btn" onClick={clearChat}>Clear</button>}
      </div>

      <div className="seg coach-seg">
        <button className={`seg-btn ${view === "chat" ? "active" : ""}`} onClick={() => setView("chat")}>💬 Chat</button>
        <button className={`seg-btn ${view === "analysis" ? "active" : ""}`} onClick={() => setView("analysis")}>📊 Analysis</button>
        <button className={`seg-btn ${view === "physique" ? "active" : ""}`} onClick={() => setView("physique")}>📸 Physique</button>
      </div>

      {view === "chat" && (
        <>
          <div className="msgs">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.role === "assistant" && <div className="avatar">✦</div>}
                <div className="bubble">
                  {m.image && <img src={m.image} alt="" className="bubble-img" />}
                  {!m.image && m.hadImage && <div className="bubble-img-gone">📷 photo</div>}
                  {m.text && <div className="md">{renderMarkdown(m.text)}</div>}
                </div>
              </div>
            ))}
            {loading && (
              <div className="msg assistant">
                <div className="avatar">✦</div>
                <div className="bubble typing"><span /><span /><span /></div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {messages.length <= 1 && (
            <div className="suggs">
              {suggestions.map((s, i) => <button key={i} className="sugg" onClick={() => setInput(s)}>{s}</button>)}
            </div>
          )}

          <div className="composer-wrap">
            {attached && (
              <div className="attach-preview">
                <img src={attached.preview} alt="" />
                <button className="attach-x" onClick={() => setAttached(null)}>×</button>
                <span className="attach-label">Photo attached</span>
              </div>
            )}
            <div className="composer">
              <button className="attach-btn" onClick={() => camRef.current.click()} disabled={loading} title="Take photo">📷</button>
              <button className="attach-btn" onClick={() => galRef.current.click()} disabled={loading} title="Choose photo">🖼️</button>
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={attached ? "Add a note (optional)…" : "Ask, or attach a photo…"} disabled={loading} />
              <button className="send" onClick={send} disabled={(!input.trim() && !attached) || loading}>{loading ? <span className="spinner" /> : "↑"}</button>
            </div>
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={e => attachFile(e.target.files[0])} />
            <input ref={galRef} type="file" accept="image/*" hidden onChange={e => attachFile(e.target.files[0])} />
          </div>
        </>
      )}

      {view === "analysis" && (
        <div className="stack analysis-stack">
          <Card title="Full data analysis" sub={`Reviews your last 14 days vs your ${goals.goal} goal`}>
            {!hasData ? <Empty title="No data yet" hint="Log some sleep, food, or workouts first" /> : (
              <button className="btn full" onClick={runAnalysis} disabled={analysisLoad}>
                {analysisLoad ? <><span className="spinner" />Analyzing…</> : analysis ? "Re-run analysis" : "Run analysis"}
              </button>
            )}
            {analysisErr && <div className="err">{analysisErr}</div>}
          </Card>

          {analysis && (
            <>
              <Card>
                <div className="score-row">
                  <div className="score-ring">
                    <svg viewBox="0 0 80 80">
                      <circle cx="40" cy="40" r="34" fill="none" stroke="var(--track)" strokeWidth="6" />
                      <circle cx="40" cy="40" r="34" fill="none" stroke="var(--accent)" strokeWidth="6" strokeDasharray={`${(analysis.overallScore / 10) * 213.6} 213.6`} strokeLinecap="round" transform="rotate(-90 40 40)" />
                    </svg>
                    <div className="score-n">{analysis.overallScore}<span>/10</span></div>
                  </div>
                  <div>
                    <div className="card-title" style={{ marginBottom: 4 }}>Overall score</div>
                    <p className="md-p">{analysis.summary}</p>
                  </div>
                </div>
              </Card>

              <Card className="priority-card">
                <div className="priority-label">⚡ This week's #1 priority</div>
                <p className="priority-text">{analysis.priorityAction}</p>
              </Card>

              {analysis.sections.map((s, i) => (
                <Card key={i}>
                  <div className="ana-hd">
                    <span className="card-title">{s.category}</span>
                    <div className="ana-score">
                      <span style={{ color: statusColor[s.status] }}>{s.score}/10</span>
                      <span className="ana-dot" style={{ background: statusColor[s.status] }} />
                    </div>
                  </div>
                  <p className="muted" style={{ lineHeight: 1.6, fontSize: ".88rem", marginTop: 8 }}>{s.insight}</p>
                  <ul className="ana-tips">
                    {s.tips.map((t, j) => <li key={j}><span className="ana-arrow">→</span><span>{t}</span></li>)}
                  </ul>
                </Card>
              ))}
            </>
          )}
        </div>
      )}

      {view === "physique" && (
        <div className="stack analysis-stack">
          <Card title="Physique check" sub="Upload a photo for AI feedback toward your goal">
            {!physResult && !physPreview && (
              <>
                <p className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }}>
                  Tip: front-facing, relaxed, good lighting, fitted clothing or shirtless gives the most useful read. The AI is your coach — it'll be honest, not flattering.
                </p>
                <div className="photo-choices">
                  <button className="photo-choice" onClick={() => physCamRef.current.click()}>
                    <span className="photo-choice-icon">📷</span><span>Take photo</span>
                  </button>
                  <button className="photo-choice" onClick={() => physGalRef.current.click()}>
                    <span className="photo-choice-icon">🖼️</span><span>Choose photo</span>
                  </button>
                </div>
                <input ref={physCamRef} type="file" accept="image/*" capture="environment" hidden onChange={e => handlePhysFile(e.target.files[0])} />
                <input ref={physGalRef} type="file" accept="image/*" hidden onChange={e => handlePhysFile(e.target.files[0])} />
                <p className="muted small" style={{ marginTop: 12, fontSize: ".72rem", lineHeight: 1.5 }}>
                  🔒 The photo is sent only to the AI for this analysis. It's not stored on your device or in the cloud after.
                </p>
              </>
            )}

            {physPreview && !physResult && (
              <>
                <img src={physPreview} alt="" className="phys-img" />
                {physErr && <div className="err">{physErr}</div>}
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn flex" onClick={analyzePhys} disabled={physLoading}>
                    {physLoading ? <><span className="spinner" />Analyzing your physique…</> : "✦ Analyze"}
                  </button>
                  <button className="btn-ghost" onClick={clearPhys} disabled={physLoading}>Cancel</button>
                </div>
              </>
            )}

            {physResult && (
              <>
                <div className="phys-result">
                  {physResult.summary && <p className="phys-summary">{physResult.summary}</p>}
                  {physResult.strengths?.length > 0 && (
                    <div className="phys-section">
                      <div className="phys-section-h">💪 Strengths</div>
                      <ul className="phys-list">{physResult.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}
                  {physResult.observations?.length > 0 && (
                    <div className="phys-section">
                      <div className="phys-section-h">👀 What I see</div>
                      <ul className="phys-list">{physResult.observations.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}
                  {physResult.focusAreas?.length > 0 && (
                    <div className="phys-section">
                      <div className="phys-section-h">🎯 Focus areas</div>
                      <ul className="phys-list">{physResult.focusAreas.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}
                  {physResult.trainingAdvice && (
                    <div className="phys-section">
                      <div className="phys-section-h">🏋️ Training direction</div>
                      <p className="phys-p">{physResult.trainingAdvice}</p>
                    </div>
                  )}
                  {physResult.nutritionAdvice && (
                    <div className="phys-section">
                      <div className="phys-section-h">🍎 Nutrition direction</div>
                      <p className="phys-p">{physResult.nutritionAdvice}</p>
                    </div>
                  )}
                </div>
                <button className="btn-ghost full" style={{ marginTop: 14 }} onClick={clearPhys}>Analyze another photo</button>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── SETTINGS TAB ─────────────────────────────────────────────────────────────
function SettingsTab({ data, goals, onSaveGoals, onClearAll, onImport, session, onSignOut, initialSection = "goals" }) {
  const [section, setSection] = useState(initialSection);

  return (
    <div className="stack">
      <div className="subtabs">
        <button className={`subtab ${section === "goals" ? "active" : ""}`} onClick={() => setSection("goals")}>⊙ Goals</button>
        <button className={`subtab ${section === "export" ? "active" : ""}`} onClick={() => setSection("export")}>⬇ Export</button>
        <button className={`subtab ${section === "data" ? "active" : ""}`} onClick={() => setSection("data")}>⌗ Data</button>
      </div>
      {section === "goals" && <><GoalsSettings goals={goals} onSave={onSaveGoals} /><ProfileSettings goals={goals} onSave={onSaveGoals} /><StrategySettings goals={goals} onSave={onSaveGoals} /><AIModelSettings /><SoundSettings /></>}
      {section === "export" && <ExportSettings data={data} goals={goals} />}
      {section === "data" && <DataSettings data={data} onClearAll={onClearAll} onImport={onImport} />}

      {session && (
        <Card title="Account">
          <div className="account-row">
            <div>
              <div className="account-email">{session.user?.email}</div>
              <div className="muted small">☁ Synced across your devices</div>
            </div>
            <button className="btn-ghost" onClick={onSignOut}>Sign out</button>
          </div>
        </Card>
      )}
    </div>
  );
}

function AIModelSettings() {
  const [model, setModel] = useState(loadModelPref);
  function pick(key) { setModel(key); saveModelPref(key); toast(`AI model: ${MODELS[key].label}`); }
  return (
    <Card title="AI model" sub="Used for food, sports & coach. Switch anytime.">
      <div className="model-opts">
        {Object.entries(MODELS).map(([key, m]) => (
          <button key={key} className={`model-opt ${model === key ? "active" : ""}`} onClick={() => pick(key)}>
            <div className="model-opt-top">
              <span className="model-opt-name">{m.label}</span>
              {model === key && <span className="model-opt-check">✓</span>}
            </div>
            <span className="model-opt-desc">{m.desc}</span>
          </button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>
        Haiku is plenty for daily logging. Switch to Sonnet for tricky meals or deeper coaching when accuracy matters most.
      </p>
    </Card>
  );
}

function SoundSettings() {
  const [on, setOn] = useState(soundEnabled());
  function toggle() {
    const next = !on;
    setOn(next);
    setSoundPref(next);
    if (next) { SFX.success(); } // play a sample when turning on
    haptic(12);
  }
  return (
    <Card title="Sound effects" sub="Audio feedback when you log, hit a PR, and more">
      <div className="sound-row">
        <div className="sound-info">
          <span className="sound-state">{on ? "🔊 On" : "🔇 Off"}</span>
          <span className="muted small">Synthesized in-app · works offline</span>
        </div>
        <button className={`toggle-switch ${on ? "on" : ""}`} onClick={toggle} role="switch" aria-checked={on}>
          <span className="toggle-knob" />
        </button>
      </div>
      {on && (
        <div className="sound-samples">
          <button className="sample-btn" onClick={() => SFX.log()}>Log</button>
          <button className="sample-btn" onClick={() => SFX.water()}>Water</button>
          <button className="sample-btn" onClick={() => SFX.pr()}>PR 🏆</button>
          <button className="sample-btn" onClick={() => SFX.success()}>Done</button>
        </div>
      )}
    </Card>
  );
}

function ProfileSettings({ goals, onSave }) {
  const initial = goals.profile || {};
  const [p, setP] = useState({ ...defaultProfile, ...initial });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => setP(prev => ({ ...prev, [k]: v }));
  function save() {
    onSave({ ...goals, profile: p });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
    haptic(12);
  }
  // Detect changes from saved version
  const changed = JSON.stringify({ ...defaultProfile, ...initial }) !== JSON.stringify(p);
  return (
    <Card title="About me" sub="Tell your coach who you are — informs every AI response">
      <div className="field-grid three">
        <label>Sex
          <select value={p.sex} onChange={e => set("sex", e.target.value)}>
            <option value="">—</option><option>Male</option><option>Female</option><option>Other</option>
          </select>
        </label>
        <label>Age<input type="number" value={p.age} onChange={e => set("age", e.target.value)} placeholder="e.g. 25" /></label>
        <label>Height (cm)<input type="number" value={p.heightCm} onChange={e => set("heightCm", e.target.value)} placeholder="e.g. 178" /></label>
      </div>
      <div className="field-grid">
        <label>Weight (kg)<input type="number" value={p.weightKg} onChange={e => set("weightKg", e.target.value)} placeholder="e.g. 75" /></label>
        <label>Training experience
          <select value={p.trainingExp} onChange={e => set("trainingExp", e.target.value)}>
            <option value="">—</option>
            <option value="beginner">Beginner (&lt; 1 year)</option>
            <option value="intermediate">Intermediate (1-3 years)</option>
            <option value="advanced">Advanced (3+ years)</option>
          </select>
        </label>
      </div>
      <label>Lifting background <span className="muted small" style={{ fontWeight: 400 }}>(historical PRs, years training, lifetime context — not your current strategy)</span>
        <textarea value={p.liftingBackground} onChange={e => set("liftingBackground", e.target.value)} rows={5}
          placeholder={"e.g. 4 years lifting, big-3 PRs: Bench 100kg, Squat 130kg, Deadlift 135kg. Strong on lower body. OHP deprioritized due to shoulder."} />
      </label>
      <label>Equipment access
        <select value={p.equipment} onChange={e => set("equipment", e.target.value)}>
          <option value="">—</option>
          <option value="full gym">Full gym</option>
          <option value="home gym (full)">Home gym (barbell, rack, plates)</option>
          <option value="home basic (dumbbells)">Home basic (dumbbells, bands)</option>
          <option value="bodyweight only">Bodyweight only</option>
        </select>
      </label>
      <label>Injuries or limitations (the AI will avoid suggesting things that conflict)
        <textarea value={p.injuries} onChange={e => set("injuries", e.target.value)} rows={2}
          placeholder="e.g. left shoulder impingement, knee gives out on heavy squats" />
      </label>
      <label>Food allergies / dietary restrictions
        <textarea value={p.allergies} onChange={e => set("allergies", e.target.value)} rows={2}
          placeholder="e.g. lactose intolerant, no shellfish, vegetarian" />
      </label>
      <label>Preferences (the AI will respect these)
        <textarea value={p.preferences} onChange={e => set("preferences", e.target.value)} rows={2}
          placeholder="e.g. I don't like running, I train at 6am, I prefer compound lifts" />
      </label>
      <label>Current life context (what's going on right now)
        <textarea value={p.lifeContext} onChange={e => set("lifeContext", e.target.value)} rows={2}
          placeholder="e.g. stressful work month, sister's wedding in 8 weeks, just moved" />
      </label>
      <button className="btn full" onClick={save} disabled={!changed && !saved}>
        {saved ? "✓ Profile saved" : "Save profile"}
      </button>
    </Card>
  );
}

function StrategySettings({ goals, onSave }) {
  const initial = goals.strategy || {};
  const [s, setS] = useState({ ...defaultStrategy, ...initial });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => setS(prev => ({ ...prev, [k]: v }));
  function save() {
    onSave({ ...goals, strategy: s });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
    haptic(12);
  }
  const changed = JSON.stringify({ ...defaultStrategy, ...initial }) !== JSON.stringify(s);

  // Compute current block week if applicable
  let blockWeek = null;
  if (s.blockStarted && s.blockWeeks) {
    const startMs = new Date(s.blockStarted + "T00:00:00").getTime();
    blockWeek = Math.max(1, Math.floor((Date.now() - startMs) / (7 * 86400000)) + 1);
  }
  return (
    <Card title="Current strategy" sub="What you're building toward right now">
      <div className="field-grid">
        <label>Phase
          <select value={s.phase} onChange={e => set("phase", e.target.value)}>
            <option value="">—</option>
            <option value="bulk">Bulk (gain muscle)</option>
            <option value="cut">Cut (lose fat)</option>
            <option value="maintenance">Maintenance</option>
            <option value="recomp">Recomp</option>
            <option value="performance">Performance (sport-focused)</option>
          </select>
        </label>
        <label>Focus
          <select value={s.focus} onChange={e => set("focus", e.target.value)}>
            <option value="">—</option>
            <option value="strength">Strength</option>
            <option value="hypertrophy">Hypertrophy</option>
            <option value="conditioning">Conditioning</option>
            <option value="fat loss">Fat loss</option>
            <option value="general">General</option>
          </select>
        </label>
      </div>
      <div className="field-grid">
        <label>Block started<input type="date" value={s.blockStarted} onChange={e => set("blockStarted", e.target.value)} /></label>
        <label>Block length (weeks)<input type="number" value={s.blockWeeks} onChange={e => set("blockWeeks", e.target.value)} placeholder="e.g. 6" /></label>
      </div>
      {blockWeek && s.blockWeeks && (
        <p className="muted small" style={{ marginTop: -6, marginBottom: 12 }}>
          You're in <strong style={{ color: "var(--accent)" }}>week {blockWeek} of {s.blockWeeks}</strong>
        </p>
      )}
      <label>Strategy notes
        <textarea value={s.notes} onChange={e => set("notes", e.target.value)} rows={3}
          placeholder="e.g. focusing on overhead press progression, eating in slight surplus, recovering from last month's volume spike" />
      </label>
      <button className="btn full" onClick={save} disabled={!changed && !saved}>
        {saved ? "✓ Strategy saved" : "Save strategy"}
      </button>
    </Card>
  );
}

function GoalsSettings({ goals, onSave }) {
  const [form, setForm] = useState(goals);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setForm(goals); }, [goals]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const autoCalc = (cal, goal) => {
    if (goal === "Build Muscle") return { protein: Math.round(cal*.30/4), carbs: Math.round(cal*.45/4), fat: Math.round(cal*.25/9) };
    if (goal === "Lose Fat") return { protein: Math.round(cal*.35/4), carbs: Math.round(cal*.35/4), fat: Math.round(cal*.30/9) };
    if (goal === "Improve Endurance") return { protein: Math.round(cal*.20/4), carbs: Math.round(cal*.55/4), fat: Math.round(cal*.25/9) };
    if (goal === "Athletic Performance") return { protein: Math.round(cal*.25/4), carbs: Math.round(cal*.50/4), fat: Math.round(cal*.25/9) };
    return { protein: Math.round(cal*.25/4), carbs: Math.round(cal*.45/4), fat: Math.round(cal*.30/9) };
  };
  const total = form.protein*4 + form.carbs*4 + form.fat*9;
  const pPct = Math.round((form.protein*4/total)*100);
  const cPct = Math.round((form.carbs*4/total)*100);
  const fPct = Math.round((form.fat*9/total)*100);

  return (
    <Card title="Goals & targets">
      <div className="field-grid">
        <label>Primary goal<select value={form.goal} onChange={e => set("goal", e.target.value)}>{fitnessGoals.map(g => <option key={g}>{g}</option>)}</select></label>
        <label>Daily calories<input type="number" value={form.calories} onChange={e => set("calories", +e.target.value)} /></label>
      </div>

      <div className="row-between">
        <span className="lbl">Macros</span>
        <button className="link-btn" onClick={() => setForm(f => ({ ...f, ...autoCalc(f.calories, f.goal) }))}>Auto-calc for {form.goal}</button>
      </div>
      <div className="field-grid three">
        <label>Protein (g)<input type="number" value={form.protein} onChange={e => set("protein", +e.target.value)} /></label>
        <label>Carbs (g)<input type="number" value={form.carbs} onChange={e => set("carbs", +e.target.value)} /></label>
        <label>Fat (g)<input type="number" value={form.fat} onChange={e => set("fat", +e.target.value)} /></label>
      </div>

      <div className="macro-bar">
        <div className="macro-seg" style={{ width: `${pPct}%`, background: "#b4a8e8" }} />
        <div className="macro-seg" style={{ width: `${cPct}%`, background: "#f9c97e" }} />
        <div className="macro-seg" style={{ width: `${fPct}%`, background: "#f47e6e" }} />
      </div>
      <div className="legend">
        <span><span className="dot" style={{ background: "#b4a8e8" }} />Protein {pPct}%</span>
        <span><span className="dot" style={{ background: "#f9c97e" }} />Carbs {cPct}%</span>
        <span><span className="dot" style={{ background: "#f47e6e" }} />Fat {fPct}%</span>
        <span className="muted" style={{ marginLeft: "auto" }}>{total} / {form.calories} kcal</span>
      </div>

      <div className="divider" />
      <div className="field-grid">
        <label>Daily water (ml)<input type="number" step="100" value={form.waterGoalMl} onChange={e => set("waterGoalMl", +e.target.value)} /></label>
      </div>

      <button className="btn full" onClick={() => { onSave(form); setSaved(true); setTimeout(() => setSaved(false), 2000); }}>{saved ? "✓ Saved" : "Save goals"}</button>
    </Card>
  );
}

function ExportSettings({ data, goals }) {
  const esc = v => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const csv = (rows, h) => [h.join(","), ...rows.map(r => h.map(k => esc(r[k])).join(","))].join("\n");
  const dl = (name, content, mime = "text/csv") => {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  };
  const t = getTodayStr();
  const dlSleep = () => dl(`fitlog-sleep-${t}.csv`, csv(data.sleep, ["date","duration","bedtime","wakeTime","quality","notes"]));
  const dlDiet = () => dl(`fitlog-diet-${t}.csv`, csv(data.diet, ["date","time","meal","food","calories","protein","carbs","fat","notes"]));
  const dlExer = () => dl(`fitlog-workouts-${t}.csv`, csv(data.exercise, ["date","label","text"]));
  const dlSp = () => dl(`fitlog-sports-${t}.csv`, csv(data.sports, ["date","sport","duration","intensity","calories","result","opponent","score","notes"]));
  const dlWater = () => dl(`fitlog-water-${t}.csv`, csv(data.water.map(w => ({ ...w, time: w.ts ? new Date(w.ts).toISOString() : "" })), ["date","time","ml"]));
  const dlSupp = () => dl(`fitlog-supplements-${t}.csv`, csv(data.supplements.map(s => ({ ...s, time: s.ts ? new Date(s.ts).toISOString() : "" })), ["date","time","name","dose"]));
  const dlChat = () => {
    try { const msgs = JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]");
      const rows = msgs.map(m => ({ timestamp: m.ts ? new Date(m.ts).toISOString() : "", role: m.role, text: m.text }));
      dl(`fitlog-chat-${t}.csv`, csv(rows, ["timestamp","role","text"]));
    } catch { alert("Could not export chat."); }
  };
  const dlAll = () => {
    [dlSleep, dlDiet, dlExer, dlSp, dlWater, dlSupp, dlChat].forEach((fn, i) => setTimeout(fn, i * 200));
  };
  const dlJson = () => dl(`fitlog-backup-${t}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), goals, data, chat: JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]") }, null, 2), "application/json");

  let chatCount = 0;
  try { chatCount = JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]").length; } catch {}

  const cats = [
    { label: "Sleep", icon: "◐", n: data.sleep.length, fn: dlSleep },
    { label: "Meals", icon: "◉", n: data.diet.length, fn: dlDiet },
    { label: "Workouts", icon: "◆", n: data.exercise.length, fn: dlExer },
    { label: "Sports", icon: "◇", n: data.sports.length, fn: dlSp },
    { label: "Water", icon: "◊", n: data.water.length, fn: dlWater },
    { label: "Supps", icon: "⊕", n: data.supplements.length, fn: dlSupp },
    { label: "Chat", icon: "✦", n: Math.max(0, chatCount - 1), fn: dlChat },
  ];

  return (
    <Card title="Export your data" sub="CSVs open in Excel, Google Sheets, Numbers">
      <div className="exp-grid">
        {cats.map(c => (
          <button key={c.label} className="exp-card" onClick={c.fn} disabled={!c.n}>
            <span className="exp-icon">{c.icon}</span>
            <span className="exp-name">{c.label}</span>
            <span className="exp-n">{c.n}</span>
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn flex" onClick={dlAll}>⬇ All as CSV</button>
        <button className="btn-ghost" onClick={dlJson}>JSON backup</button>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>JSON backup includes everything and can be restored from the Data tab.</p>
    </Card>
  );
}

function DataSettings({ data, onClearAll, onImport }) {
  const fileRef = useRef();
  const [confirm, confirmModal] = useConfirm();
  const total = Object.values(data).reduce((a, arr) => a + (Array.isArray(arr) ? arr.length : 0), 0);
  let chatCount = 0;
  try { chatCount = Math.max(0, JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]").length - 1); } catch {}

  function importFile(e) {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async ev => {
      try {
        const p = JSON.parse(ev.target.result);
        if (!p.data || !p.goals) throw new Error();
        const ok = await confirm({ title: "Restore this backup?", body: "This replaces all your current data with the contents of the file.", confirmLabel: "Restore" });
        if (!ok) return;
        onImport(p);
      } catch { toast("Couldn't read that file"); }
    };
    r.readAsText(f);
    e.target.value = "";
  }

  async function clearAll() {
    const ok1 = await confirm({ title: "Delete everything?", body: "All tracked data and chat history will be permanently erased. Goals remain.", confirmLabel: "Continue", danger: true });
    if (!ok1) return;
    const ok2 = await confirm({ title: "Are you absolutely sure?", body: "This cannot be undone. Export a backup first if you're unsure.", confirmLabel: "Delete everything", danger: true });
    if (ok2) onClearAll();
  }

  return (
    <>
      {confirmModal}
      <Card title="Your data">
        <div className="stat-row">
          <div className="stat"><div className="stat-n">{total}</div><div className="stat-l">Total entries</div></div>
          <div className="stat"><div className="stat-n">{chatCount}</div><div className="stat-l">Chat messages</div></div>
        </div>
      </Card>

      <Card title="📥 Restore backup" sub="Load a fitlog JSON file. Replaces current data.">
        <button className="btn-ghost full" onClick={() => fileRef.current.click()}>Choose file…</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importFile} />
      </Card>

      <Card title="⚠ Danger zone" className="danger-card">
        <p className="muted" style={{ marginBottom: 12, fontSize: ".85rem", lineHeight: 1.6 }}>
          Permanently delete all sleep, meals, workouts, sports, water, supplements, and chat history. Goals remain. <strong>Export a backup first.</strong>
        </p>
        <button className="btn-danger full" onClick={clearAll}>Clear everything</button>
      </Card>

      <p className="muted small center" style={{ marginTop: 8 }}>☁ Your data is synced to the cloud and available on any device you sign in to.</p>
    </>
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

// ─── SKIN INTELLIGENCE SECTION ──────────────────────────────────────────────
const SKIN_CONDITION = [{ v: 1, l: "Poor" }, { v: 2, l: "Fair" }, { v: 3, l: "OK" }, { v: 4, l: "Good" }, { v: 5, l: "Great" }];
const SKIN_PHOTO_KEY = "fitlog_skin_photos"; // local-only, never synced to the cloud blob (face photos are sensitive)

function SkinLogForm({ onAdd, recent }) {
  const [form, setForm] = useState({ date: getTodayStr(), condition: 4, breakouts: "", concern: "", notes: "" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  function save() {
    onAdd({ date: form.date, condition: form.condition, breakouts: form.breakouts === "" ? 0 : Math.max(0, parseInt(form.breakouts) || 0), concern: form.concern.trim(), notes: form.notes.trim(), id: Date.now() });
    toast("✦ Skin logged");
    setForm(f => ({ ...f, breakouts: "", notes: "" }));
  }
  return (
    <>
      <Card title="Log skin" action={<input type="date" className="sleep-date" value={form.date} onChange={e => set("date", e.target.value)} />}>
        <div className="sleep-field-label">How's your skin today?</div>
        <div className="sleep-q-chips">
          {SKIN_CONDITION.map(c => (
            <button key={c.v} className={`sleep-q-chip ${form.condition === c.v ? "on" : ""}`} onClick={() => { set("condition", c.v); haptic(8); }}>{c.l}</button>
          ))}
        </div>
        <div className="field-grid" style={{ marginTop: 14 }}>
          <label>Active breakouts<input type="number" inputMode="numeric" value={form.breakouts} onChange={e => set("breakouts", e.target.value)} placeholder="e.g. 2" /></label>
          <label>Main concern<input type="text" value={form.concern} onChange={e => set("concern", e.target.value)} placeholder="jawline, redness…" /></label>
        </div>
        <label>Notes<textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Anything notable — new product, flare, period…" rows={2} /></label>
        <button className="btn full" onClick={save}>Save skin log</button>
      </Card>
      <RecentList entries={recent} render={s => <><span className="ra-main">{(SKIN_CONDITION.find(c => c.v === s.condition) || {}).l || s.condition}{s.breakouts ? ` · ${s.breakouts} breakout${s.breakouts > 1 ? "s" : ""}` : ""}</span><span className="ra-date">{formatShortDate(s.date)}</span></>} />
    </>
  );
}

function SkinRoutineCard({ goals, onSaveGoals, conflicts, addEntry }) {
  const routine = goals.skinRoutine || { am: [], pm: [] };
  const [adding, setAdding] = useState(null); // "am" | "pm" | null
  const [val, setVal] = useState("");
  const logChange = (slot, action, product) => { if (addEntry) addEntry("skinRoutineChanges")({ id: Date.now(), date: getTodayStr(), slot, action, product }); };
  function addStep(slot) {
    if (!val.trim()) return;
    const next = { ...routine, [slot]: [...(routine[slot] || []), { product: val.trim() }] };
    onSaveGoals({ ...goals, skinRoutine: next });
    logChange(slot, "added", val.trim());
    setVal(""); setAdding(null); haptic(8);
  }
  function removeStep(slot, i) {
    const removed = routine[slot][i];
    const next = { ...routine, [slot]: routine[slot].filter((_, idx) => idx !== i) };
    onSaveGoals({ ...goals, skinRoutine: next });
    if (removed) logChange(slot, "removed", removed.product);
  }
  const Col = ({ slot, label }) => (
    <div className="skin-routine-col">
      <div className="skin-routine-head">{label}</div>
      {(routine[slot] || []).map((s, i) => (
        <div key={i} className="skin-routine-step"><span>{s.product}</span><button className="skin-x" onClick={() => removeStep(slot, i)}>×</button></div>
      ))}
      {adding === slot ? (
        <div className="row" style={{ marginTop: 6 }}>
          <input autoFocus value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === "Enter" && addStep(slot)} placeholder="Product name" />
          <button className="btn" onClick={() => addStep(slot)}>Add</button>
        </div>
      ) : (
        <button className="skin-add-step" onClick={() => { setAdding(slot); setVal(""); }}>+ Add product</button>
      )}
    </div>
  );
  return (
    <Card title="Routine" sub="Tag products so SkinLog can flag conflicts">
      <div className="skin-routine-grid"><Col slot="am" label="☀ AM" /><Col slot="pm" label="☾ PM" /></div>
      {conflicts.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {conflicts.map((c, i) => <div key={i} className="sleep-flag">⚠ {c}</div>)}
        </div>
      )}
      {conflicts.length === 0 && (routine.am.length + routine.pm.length > 0) && <p className="muted small" style={{ marginTop: 10 }}>No conflicts detected in your current actives.</p>}
    </Card>
  );
}

function SkinExperimentCard({ data, goals, onSaveGoals }) {
  const exp = goals.skinExperiment;
  const skin = useMemo(() => computeSkin(data, goals), [data, goals]);
  function start(name) {
    onSaveGoals({ ...goals, skinExperiment: { name: name || "New product", startDate: getTodayStr(), weeks: 8, baseline: skin?.avgCond14 ?? null } });
    toast("🧪 Skin experiment started");
  }
  function end() { onSaveGoals({ ...goals, skinExperiment: null }); toast("Experiment ended"); }
  const [name, setName] = useState("");
  if (!exp) {
    return (
      <Card title="🧪 Run a skin experiment" sub="One variable, 8–12 weeks — skin is slow, so isolate the change">
        <div className="row">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="What are you testing? (e.g. azelaic acid)" />
          <button className="btn" onClick={() => start(name)}>Start</button>
        </div>
        <p className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>SkinLog snapshots your current skin rating as a baseline, tracks physiology alongside (so a win isn't just a good-sleep month), and tells you to hold everything else steady. Give it the full window — cell turnover is ~6–8 weeks.</p>
      </Card>
    );
  }
  const daysIn = Math.max(0, Math.round((Date.now() - new Date(exp.startDate + "T00:00:00").getTime()) / 86400000));
  const now = skin?.avgCond14 ?? null;
  const delta = (now != null && exp.baseline != null) ? +(now - exp.baseline).toFixed(1) : null;
  return (
    <Card title={`🧪 Testing: ${exp.name}`} sub={`Day ${daysIn} of ~${exp.weeks * 7} · hold everything else steady`}>
      <div className="rt-bar" style={{ margin: "4px 0 12px" }}><div className="rt-bar-fill" style={{ width: `${Math.min(100, (daysIn / (exp.weeks * 7)) * 100)}%` }} /></div>
      <div className="eb-grid">
        <div className="eb-cell"><span className="eb-l">Baseline</span><span className="eb-v">{exp.baseline ?? "—"}</span></div>
        <div className="eb-cell"><span className="eb-l">Now</span><span className="eb-v">{now ?? "—"}{delta != null ? <span className={delta >= 0 ? "good" : "bad"} style={{ fontSize: 12 }}> {delta >= 0 ? "+" : ""}{delta}</span> : ""}</span></div>
        <div className="eb-cell"><span className="eb-l">Weeks left</span><span className="eb-v">{Math.max(0, exp.weeks - Math.floor(daysIn / 7))}</span></div>
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>{daysIn < exp.weeks * 7 - 14 ? "Too early to judge — keep going and don't change anything else." : "Enough time has passed to read the result."}</p>
      <button className="btn-ghost full" style={{ marginTop: 8 }} onClick={end}>End experiment</button>
    </Card>
  );
}

function SkinResearchStore({ data, addEntry, deleteEntry }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", text: "", tags: "" });
  const research = (data.skinResearch || []).slice().reverse();
  function save() {
    if (!form.title.trim() && !form.text.trim()) return;
    addEntry("skinResearch")({ id: Date.now(), date: getTodayStr(), title: form.title.trim(), text: form.text.trim(), tags: form.tags.split(",").map(t => t.trim()).filter(Boolean) });
    setForm({ title: "", text: "", tags: "" }); setOpen(false); toast("✦ Research saved");
  }
  return (
    <Card title="Research notes" sub="Paste studies & findings — the coach reads these">
      {open ? (
        <div className="stack">
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Title (e.g. Azelaic acid for PIH)" />
          <textarea value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} placeholder="Key finding / notes…" rows={3} />
          <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="tags, comma separated (acne, retinoid…)" />
          <div className="row"><button className="btn-ghost flex" onClick={() => setOpen(false)}>Cancel</button><button className="btn flex" onClick={save}>Save</button></div>
        </div>
      ) : (
        <button className="btn full" onClick={() => setOpen(true)}>+ Add research note</button>
      )}
      {research.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {research.map(r => (
            <div key={r.id} className="skin-research-item">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: ".9rem" }}>{r.title || "Untitled"}</div>
                {r.text && <div className="muted small" style={{ marginTop: 2, lineHeight: 1.4 }}>{r.text.length > 140 ? r.text.slice(0, 140) + "…" : r.text}</div>}
                {r.tags?.length > 0 && <div className="skin-tags">{r.tags.map((t, i) => <span key={i} className="skin-tag">{t}</span>)}</div>}
              </div>
              <button className="skin-x" onClick={() => deleteEntry("skinResearch")(r.id)}>×</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SkinPhotos() {
  const [photos, setPhotos] = useState([]);
  const [compare, setCompare] = useState(false);
  useEffect(() => {
    try { const raw = localStorage.getItem(SKIN_PHOTO_KEY); if (raw) setPhotos(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  function persist(next) { setPhotos(next); try { localStorage.setItem(SKIN_PHOTO_KEY, JSON.stringify(next)); } catch { toast("Couldn't save photo (storage full)"); } }
  async function onFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const { base64, mediaType } = await fileToResizedBase64(file, 900, 0.8);
      const next = [...photos, { id: Date.now(), date: getTodayStr(), url: `data:${mediaType};base64,${base64}` }];
      persist(next); toast("✦ Photo saved (stays on this device)");
    } catch { toast("Couldn't process that image"); }
    e.target.value = "";
  }
  function remove(id) { persist(photos.filter(p => p.id !== id)); }
  const sorted = [...photos].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Card title="Progress photos" sub="Side-by-side over time — stays on this device only" action={sorted.length >= 2 ? <button className="link-btn" onClick={() => setCompare(c => !c)}>{compare ? "Grid" : "Compare"}</button> : null}>
      {compare && sorted.length >= 2 ? (
        <div className="skin-compare">
          <div className="skin-compare-cell"><img src={sorted[0].url} alt="earliest" /><span className="muted small">{formatShortDate(sorted[0].date)}</span></div>
          <div className="skin-compare-cell"><img src={sorted[sorted.length - 1].url} alt="latest" /><span className="muted small">{formatShortDate(sorted[sorted.length - 1].date)}</span></div>
        </div>
      ) : (
        <div className="skin-photo-grid">
          {sorted.map(p => (
            <div key={p.id} className="skin-photo">
              <img src={p.url} alt={p.date} />
              <span className="skin-photo-date">{formatShortDate(p.date)}</span>
              <button className="skin-photo-x" onClick={() => remove(p.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      <label className="btn full" style={{ marginTop: 12, textAlign: "center", cursor: "pointer" }}>
        + Add photo
        <input type="file" accept="image/*" capture="user" onChange={onFile} style={{ display: "none" }} />
      </label>
      <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>For useful comparisons: same spot, same light, no makeup, same time of day. SkinLog shows the photos honestly — it won't invent "pore counts" or a skin score.</p>
    </Card>
  );
}

const SKIN_PROCEDURES = ["Microneedling", "Subcision", "PRP", "Chemical peel", "Laser", "Botox", "Filler", "Facial", "Extraction", "LED therapy", "Other"];

// Educational recovery/prep guidance per procedure. Defers specifics to the provider.
const PROC_PLAN = {
  Microneedling: { down: "3–5 days", steps: [
    { d: -14, t: "Pause retinoids & strong actives (if your provider agrees)", why: "lowers irritation on the day" },
    { d: -3, t: "Stop exfoliating acids and scrubs; avoid sunburn and tanning", why: "compromised skin reacts worse" },
    { d: -1, t: "Hydrate well; plan to arrive with clean, bare skin", why: "better tolerance, lower infection risk" },
    { d: 0, t: "Gentle cleanse, hyaluronic + bland moisturizer; no makeup 24h", why: "the barrier is briefly open" },
    { d: 1, t: "Expect redness/flushing; SPF even indoors; no actives", why: "skin is raw and photosensitive" },
    { d: 3, t: "Light flaking is normal — keep it simple, don't pick", why: "picking causes marks/scarring" },
    { d: 7, t: "Reintroduce actives slowly if calm (confirm with provider)", why: "barrier has recovered" },
  ] },
  Subcision: { down: "1–2 weeks", medical: true, steps: [
    { d: -7, t: "Ask your provider about pausing blood thinners / alcohol", why: "reduces bruising — medical, provider decides" },
    { d: -1, t: "Arrive with clean skin and clear your calendar", why: "visible bruising and swelling are expected" },
    { d: 0, t: "Cold compress as directed; gentle care only", why: "controls swelling early" },
    { d: 2, t: "Bruising/swelling peaks; don't massage unless told to", why: "can disrupt healing tissue" },
    { d: 7, t: "Most bruising fading; keep actives off the area", why: "tissue is still remodeling" },
    { d: 14, t: "Firmness/lumps can persist — attend your provider review", why: "remodeling takes weeks" },
  ] },
  PRP: { down: "3–5 days", steps: [
    { d: -3, t: "Stay hydrated; pause strong actives if advised", why: "calmer baseline skin" },
    { d: 0, t: "Gentle care only; no makeup that day", why: "injection sites are fresh" },
    { d: 1, t: "Expect redness and mild swelling; SPF; skip workouts 24–48h", why: "limits flushing/swelling" },
    { d: 3, t: "Resume gentle routine; still no harsh actives", why: "skin settling" },
    { d: 5, t: "Reintroduce actives slowly if calm", why: "recovered enough" },
  ] },
  "Chemical peel": { down: "3–7 days", steps: [
    { d: -7, t: "Stop retinoids/acids per your provider; no waxing", why: "avoids over-exfoliation" },
    { d: -1, t: "No sunburn; arrive bare-skinned", why: "peels need intact skin" },
    { d: 0, t: "Follow neutralise/aftercare exactly; bland moisturizer", why: "depth-specific steps matter" },
    { d: 2, t: "Peeling/flaking begins — do NOT pick or pull", why: "picking scars and pigments" },
    { d: 5, t: "Keep moisturising; strict SPF", why: "new skin burns easily" },
    { d: 7, t: "Reintroduce actives once peeling fully stops", why: "barrier restored" },
  ] },
  Laser: { down: "5–7 days", steps: [
    { d: -14, t: "Strict sun avoidance; no self-tan; pause actives as advised", why: "tanned skin raises burn/pigment risk" },
    { d: -1, t: "Arrive clean, no makeup/products", why: "clear field for treatment" },
    { d: 0, t: "Cool compresses, bland moisturizer; follow aftercare", why: "skin is heat-stressed" },
    { d: 2, t: "Redness/swelling, possible darkening; SPF is non-negotiable", why: "photosensitive and fragile" },
    { d: 5, t: "Light peeling/sloughing may happen — let it shed", why: "picking marks the skin" },
    { d: 14, t: "Reintroduce actives slowly; keep sun protection up for weeks", why: "pigment risk lingers" },
  ] },
  Botox: { down: "~1 day", steps: [
    { d: 0, t: "Stay upright 4h; no exercise or rubbing the area 24h", why: "keeps product where intended" },
    { d: 1, t: "Normal routine; avoid facials/massage on the area a few days", why: "avoids migration" },
    { d: 4, t: "Effect appears over 3–7 days; review if uneven at 2 weeks", why: "it takes time to settle" },
  ] },
  Filler: { down: "2–5 days", steps: [
    { d: -3, t: "Ask about pausing alcohol/blood thinners", why: "less bruising — provider decides" },
    { d: 0, t: "Ice gently; no exercise/heat 24–48h; don't massage", why: "limits swelling and migration" },
    { d: 2, t: "Swelling/bruising peak then fade; avoid facials a couple weeks", why: "let it integrate" },
    { d: 14, t: "Final result; review with provider if needed", why: "swelling fully gone" },
  ] },
  Facial: { down: "~1 day", steps: [
    { d: 0, t: "Skip actives that night if extractions were done", why: "skin is briefly sensitised" },
    { d: 1, t: "Back to normal; SPF as always", why: "no real downtime" },
  ] },
  Extraction: { down: "1–2 days", steps: [
    { d: 0, t: "Spot-treat gently; don't squeeze more at home", why: "DIY squeezing scars" },
    { d: 1, t: "Marks fade; keep actives light 24h", why: "pores are open" },
  ] },
  "LED therapy": { down: "none", steps: [
    { d: 0, t: "No downtime — resume everything", why: "non-ablative" },
    { d: 1, t: "Consistency beats intensity — schedule regular sessions", why: "effects are cumulative" },
  ] },
  Other: { down: "varies", steps: [
    { d: -3, t: "Ask your provider what to pause beforehand", why: "every treatment differs" },
    { d: 0, t: "Follow the aftercare you were given exactly", why: "provider knows the specifics" },
    { d: 3, t: "Reintroduce actives once your provider clears you", why: "avoid irritating healing skin" },
  ] },
};

function ProcTimeline({ type, procDate }) {
  const plan = PROC_PLAN[type] || PROC_PLAN.Other;
  const today = getTodayStr();
  const base = new Date(procDate + "T00:00:00");
  const dayN = Math.round((new Date(today + "T00:00:00") - base) / 86400000);
  const fmt = off => { const dt = new Date(base.getTime() + off * 86400000); return `${dt.getMonth() + 1}/${dt.getDate()}`; };
  const nowIdx = plan.steps.findIndex(s => s.d >= dayN);
  return (
    <div className="proc-timeline" data-medical={plan.medical ? "1" : "0"}>
      <div className="proc-tl-head">Science-based plan · downtime {plan.down}</div>
      {plan.steps.map((s, i) => {
        const state = nowIdx === -1 ? "past" : i < nowIdx ? "past" : i === nowIdx ? "now" : "future";
        return (
          <div key={i} className={`proc-tl-row ${state}`}>
            <span className="proc-tl-when">{s.d === 0 ? "Day 0" : s.d < 0 ? `${s.d}d` : `+${s.d}d`}<small>{fmt(s.d)}</small></span>
            <div className="proc-tl-body"><div className="proc-tl-act">{s.t}</div><div className="muted small">{s.why}</div></div>
          </div>
        );
      })}
      <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>{plan.medical ? "This is a medical procedure — your provider's instructions override everything here." : "General, science-based aftercare — your provider's specific instructions always come first."} Nicotine slows healing; SPF protects every result.</p>
    </div>
  );
}

function SkinProceduresCard({ data, addEntry, deleteEntry }) {
  const [type, setType] = useState(null);
  const [form, setForm] = useState({ date: getTodayStr(), provider: "", notes: "" });
  const today = getTodayStr();
  const all = (data.skinProcedures || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const upcoming = all.filter(p => (p.date || "") > today).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const past = all.filter(p => (p.date || "") <= today);
  const recentDate = daysAgo(10);
  function save() {
    if (!type) return;
    addEntry("skinProcedures")({ id: Date.now(), date: form.date, type, provider: form.provider.trim(), notes: form.notes.trim() });
    setType(null); setForm({ date: getTodayStr(), provider: "", notes: "" }); toast("✦ Procedure saved");
  }
  return (
    <Card title="Procedures" sub="Log past treatments or plan ahead — pick a future date to plan">
      <div className="skin-proc-chips">
        {SKIN_PROCEDURES.map(p => <button key={p} className={`skin-proc-chip ${type === p ? "on" : ""}`} onClick={() => { setType(t => t === p ? null : p); haptic(8); }}>{p}</button>)}
      </div>
      {type && (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="field-grid">
            <label>Date (future = planned)<input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></label>
            <label>Provider / clinic<input value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} placeholder="optional" /></label>
          </div>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="What was done, settings if you know, how your skin reacted…" rows={2} />
          <button className="btn full" onClick={save}>Save {type}</button>
        </div>
      )}

      {upcoming.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="skin-section-h">Planned</div>
          {upcoming.map(p => (
            <div key={p.id} className="skin-proc-block">
              <div className="skin-proc-item">
                <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: ".9rem" }}>{p.type}{p.provider ? ` · ${p.provider}` : ""}</div><div className="muted small">{formatShortDate(p.date)} · in {Math.max(0, Math.round((new Date(p.date + "T00:00:00") - Date.now()) / 86400000))} days</div></div>
                <button className="skin-x" onClick={() => deleteEntry("skinProcedures")(p.id)}>×</button>
              </div>
              <ProcTimeline type={p.type} procDate={p.date} />
            </div>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="skin-section-h">Done</div>
          {past.map(p => (
            <div key={p.id} className="skin-proc-block">
              <div className="skin-proc-item">
                <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: ".9rem" }}>{p.type}{p.provider ? ` · ${p.provider}` : ""}</div><div className="muted small">{formatShortDate(p.date)}{p.notes ? ` — ${p.notes}` : ""}</div></div>
                <button className="skin-x" onClick={() => deleteEntry("skinProcedures")(p.id)}>×</button>
              </div>
              {p.date >= recentDate && <ProcTimeline type={p.type} procDate={p.date} />}
            </div>
          ))}
        </div>
      )}

      <p className="muted small" style={{ marginTop: 12, lineHeight: 1.45 }}>Recovery guidance is general and educational — it won't replace your provider's aftercare. Anything that looks off (signs of infection, lasting reactions) goes to your provider.</p>
    </Card>
  );
}

const SKIN_COACH_SYSTEM = `You are SkinLog's skin coach. You ONLY help with SKIN. The data below is skin-relevant only.

SCOPE — THIS IS A HARD BOUNDARY:
- You help with skin: condition, breakouts, skincare routine (AM/PM products), procedures, and the lifestyle factors that affect skin — sleep, nicotine, diet (dairy/sugar/glycemic load), hydration, and stress.
- You have NO data about and must NOT discuss: training, workouts, lifting, gym splits, sports, bodyweight, strength, fuelling, or macros for muscle. None of that is your job.
- If the user asks about any of that, do NOT answer it. Say one line like "That's outside what I track here — I'm just your skin coach" and steer back to skin.
- "Routine" ALWAYS means their SKINCARE routine (AM/PM products) — NEVER a workout or training split. If they ask you to "build a routine," build a SKINCARE routine from their products and skin needs.

YOUR EDGE: you can see how this person's sleep, nicotine, diet, hydration and stress move their skin — use those links. Lead with the highest-evidence lever for THIS person.

RULES:
- Be specific and personal — cite their actual numbers and logged patterns. No generic listicles.
- Frame correlations as personal patterns, not proven cause.
- Evidence order: not smoking + daily SPF (strong) > dairy/glycemic load, sleep, stress (moderate) > hydration/"detox" (weak — don't oversell water).
- Prefer one-variable experiments over changing everything at once. Skin is slow (~6–8 weeks) — set that expectation.
- PROCEDURES (microneedling, PRP, peels, lasers): you may EDUCATE — what it does, rough evidence, recovery/aftercare, how it interacts with their actives, and what to ask a provider. Do NOT prescribe protocols, depths or settings, or replace an in-person assessment. Send them to a dermatologist for the decision and anything medical (cystic/persistent acne, suspicious lesions, prescription actives).
- Keep replies tight: a short answer plus the one next action. No walls of text.`;

const SKIN_PROMPTS = ["Why am I breaking out?", "What's my biggest skin lever?", "Is microneedling worth it for me?", "Build me a simple skincare routine"];

// Skin-ONLY context. Deliberately excludes training, sports, fuel, weight, strength,
// macros and strategy — the coach can't leak what it never receives.
function buildSkinContext(data, goals) {
  const today = getTodayStr();
  const skin = computeSkin(data, goals);
  const L = [];
  if (skin) L.push(`SKIN CONDITION: 14-day avg ${skin.avgCond14 ?? "—"}/5, trend ${skin.condTrend == null ? "n/a" : skin.condTrend > 0.2 ? "improving" : skin.condTrend < -0.2 ? "worsening" : "steady"}, ${skinLogStreak(data.skin)}-day log streak, confidence ${skin.confidence}.${skin.breakouts14 != null ? ` ~${skin.breakouts14} breakouts/log.` : ""}`);
  else L.push("SKIN CONDITION: not enough logs yet for trends.");
  const recent = (data.skin || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 10);
  if (recent.length) L.push("Recent skin logs: " + recent.map(s => `${s.date} ${s.condition}/5${s.breakouts ? ` ${s.breakouts}br` : ""}${s.concern ? ` (${s.concern})` : ""}${s.notes ? ` "${s.notes}"` : ""}`).join(" | "));

  const lastSleep = (data.sleep || []).filter(s => s.date === today || s.date === daysAgo(1)).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  const slept = lastSleep ? sleepTST(lastSleep) : null;
  const need = estimateSleepNeed(data, goals).hours;
  const waterMl = (data.water || []).filter(w => w.date === today).reduce((a, w) => a + (w.ml || 0), 0);
  const nic = (data.nicotine || []).filter(n => n.date === today).length;
  const td = (data.diet || []).filter(d => d.date === today);
  const gl = dayGlycemicLoad(td);
  const dairy = td.some(d => DAIRY_LEVER_RE.test(`${d.name || ""} ${d.food || ""} ${d.notes || ""}`));
  const rl = (data.skinRoutineLogs || []).filter(l => l.date === today);
  const adh = skinRoutineAdherence(data);
  L.push(`TODAY'S SKIN LEVERS: sleep ${slept != null ? slept.toFixed(1) + "h" : "—"} (need ~${need}h); water ${(waterMl / 1000).toFixed(1)}L/${(((goals && goals.waterGoalMl) || 2500) / 1000)}L; nicotine ${nic === 0 ? "none" : nic + "x"}; diet ${gl.hasData ? gl.band + " glycemic load" : "unlogged"}${dairy ? " + dairy today" : ""}; routine done today: AM ${rl.some(l => l.slot === "am") ? "yes" : "no"}, PM ${rl.some(l => l.slot === "pm") ? "yes" : "no"}. Routine adherence 14d: AM ${adh.amPct}%, PM ${adh.pmPct}%.`);

  if (skin && skin.correlations && skin.correlations.length) L.push("SKIN CORRELATIONS (this person's patterns — correlation, not proof): " + skin.correlations.map(c => c.text).join(" | "));
  if (skin && skin.topLever) L.push("Biggest lever: " + skin.topLever.text);

  const r = (goals && goals.skinRoutine) || { am: [], pm: [] };
  L.push(`SKINCARE ROUTINE — AM: ${(r.am || []).map(s => s.product).join(", ") || "(empty)"} | PM: ${(r.pm || []).map(s => s.product).join(", ") || "(empty)"}.`);

  const intros = data.skinProductIntros || [], changes = data.skinRoutineChanges || [];
  if (intros.length || changes.length) L.push("PRODUCT HISTORY: " + [...intros.map(p => `introduced ${p.name} ${p.startDate}`), ...changes.map(c => `${c.action} ${c.product} (${c.slot}) ${c.date}`)].join("; "));

  const procs = data.skinProcedures || [];
  if (procs.length) {
    const up = procs.filter(p => (p.date || "") > today), past = procs.filter(p => (p.date || "") <= today);
    L.push("PROCEDURES: " + [...up.map(p => `PLANNED ${p.type} ${p.date}${p.notes ? ` (${p.notes})` : ""}`), ...past.map(p => `past ${p.type} ${p.date}`)].join("; "));
  }
  if (goals && goals.skinExperiment) { const e = goals.skinExperiment; L.push(`SKIN EXPERIMENT running: ${e.variable || e.name || "active"}${e.startDate || e.start ? ` since ${e.startDate || e.start}` : ""}.`); }
  if ((data.skinResearch || []).length) L.push("Saved skin research: " + (data.skinResearch || []).map(x => x.title).filter(Boolean).join("; "));

  const days = Array.from({ length: 14 }, (_, i) => daysAgo(i));
  const sleeps = (data.sleep || []).filter(s => days.includes(s.date)).map(s => sleepTST(s)).filter(x => x != null);
  const avgSleep = sleeps.length ? (sleeps.reduce((a, b) => a + b, 0) / sleeps.length).toFixed(1) : null;
  const nicDays = days.filter(d => (data.nicotine || []).some(n => n.date === d)).length;
  const dairyDays = days.filter(d => (data.diet || []).some(x => x.date === d && DAIRY_LEVER_RE.test(`${x.name || ""} ${x.food || ""} ${x.notes || ""}`))).length;
  L.push(`LIFESTYLE INPUTS THAT AFFECT SKIN (14d): avg sleep ${avgSleep ?? "?"}h; nicotine on ${nicDays}/14 days; dairy on ${dairyDays}/14 days.`);
  const moods = (data.journal || []).filter(j => days.includes(j.date) && (j.mood != null || j.stress != null));
  if (moods.length) L.push(`Mood/stress noted on ${moods.length}/14 days (stress can flare skin).`);

  return L.join("\n");
}

function SkinCoach({ data, goals, addEntry }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [concluding, setConcluding] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, loading]);
  async function ask(text) {
    const q = (text || input).trim(); if (!q || loading) return;
    const next = [...messages, { role: "user", content: q }];
    setMessages(next); setInput(""); setLoading(true);
    try {
      const system = SKIN_COACH_SYSTEM + "\n\n=== YOUR SKIN DATA (skin-relevant only) ===\n" + buildSkinContext(data, goals);
      const reply = await callClaude({ system, conversationMessages: next, maxTokens: 1100 });
      setMessages(m => [...m, { role: "assistant", content: reply || "I didn't catch that — try rephrasing?" }]);
    } catch {
      setMessages(m => [...m, { role: "assistant", content: "Couldn't reach the coach right now — check your connection and try again." }]);
    }
    setLoading(false);
  }
  async function conclude() {
    if (!messages.length || concluding || loading) return;
    setConcluding(true);
    try {
      const sys = "You turn a skin coaching chat into a short action plan. Output ONLY 2–5 concrete skin actions, one per line, each starting with '- ', each under ~16 words. Skin only — no training/diet-for-muscle. No preamble, headers, or bold.";
      const convo = messages.map(m => `${m.role === "user" ? "User" : "Coach"}: ${m.content}`).join("\n");
      const raw = await callClaude({ system: sys, conversationMessages: [{ role: "user", content: `Conversation:\n${convo}\n\nWrite the action plan.` }], maxTokens: 400 });
      let items = (raw || "").split("\n").map(l => l.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 5).map(text => ({ text, done: false }));
      if (!items.length) items = [{ text: (raw || "Reviewed skin plan with coach.").trim().slice(0, 160), done: false }];
      const summary = (messages.find(m => m.role === "user")?.content || "Skin coach session").slice(0, 80);
      addEntry("skinCoachPlans")({ id: Date.now(), date: getTodayStr(), summary, items, messages });
      setMessages([]); setInput("");
      toast("✦ Saved to your Plan");
    } catch {
      toast("Couldn't save — try again");
    }
    setConcluding(false);
  }
  return (
    <Card title="Ask your skin coach" sub="Skin only — reads your skin + sleep, nicotine, diet, hydration & stress">
      {messages.length === 0 ? (
        <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 10 }}>Ask anything about your skin. The coach reads only your skin-relevant patterns — your routine, condition, and the lifestyle factors that move skin. It won't touch your training.</p>
      ) : (
        <div className="skin-chat">
          {messages.map((m, i) => <div key={i} className={`skin-msg ${m.role === "user" ? "user" : "ai"}`}>{m.content}</div>)}
          {loading && <div className="skin-msg ai typing"><span /><span /><span /></div>}
          <div ref={endRef} />
        </div>
      )}
      {messages.length > 0 && (
        <button className="btn-ghost coach-conclude" onClick={conclude} disabled={concluding || loading}>{concluding ? "Saving…" : "✓ Conclude — save & add to Plan"}</button>
      )}
      <div className="skin-coach-chips">
        {SKIN_PROMPTS.map(p => <button key={p} className="skin-coach-chip" onClick={() => ask(p)} disabled={loading}>{p}</button>)}
      </div>
      <div className="skin-coach-row">
        <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }} placeholder="Ask about your skin…" rows={1} />
        <button className="btn" onClick={() => ask()} disabled={loading || !input.trim()}>{loading ? "…" : "Send"}</button>
      </div>
    </Card>
  );
}

// ─── SKIN TAB COMPONENTS ────────────────────────────────────────────────────
const PRODUCT_KINDS = [
  { k: "retinoid", label: "Retinoid" },
  { k: "acid", label: "Exfoliating acid" },
  { k: "vitc", label: "Vitamin C" },
  { k: "other", label: "Other active" },
];
const PRODUCT_RAMP = {
  retinoid: ["Patch test 48h behind the ear", "Weeks 1–2: 2 nights/week, pea-size, buffer with moisturizer", "Weeks 3–4: every other night if no irritation", "Week 5+: nightly as tolerated", "Never the same night as exfoliating acids; always AM SPF"],
  acid: ["Patch test 48h", "Weeks 1–2: 1–2×/week", "Weeks 3–4: alternate days if tolerated", "Don't stack with a retinoid the same night", "AM SPF is non-negotiable"],
  vitc: ["Patch test 48h", "Start every other morning", "Build to daily AM use", "Keep separate from benzoyl peroxide", "Store away from light and air"],
  other: ["Patch test 48h behind the ear", "Introduce just this one product at a time", "Start every other day, watch for irritation", "Give it 4–6 weeks before judging it"],
};

function skinRoutineAdherence(data) {
  const days = 14; let am = 0, pm = 0;
  for (let i = 0; i < days; i++) { const d = daysAgo(i); const l = (data.skinRoutineLogs || []).filter(x => x.date === d); if (l.some(x => x.slot === "am")) am++; if (l.some(x => x.slot === "pm")) pm++; }
  return { amPct: Math.round((am / days) * 100), pmPct: Math.round((pm / days) * 100) };
}
function skinLogStreak(entries) {
  const has = d => (entries || []).some(e => e.date === d);
  let s = 0; let i = has(getTodayStr()) ? 0 : 1;
  for (; i < 90; i++) { if (has(daysAgo(i))) s++; else break; }
  return s;
}

const DAIRY_LEVER_RE = /\b(milk|cheese|yogurt|yoghurt|dairy|whey|ice ?cream|latte|cappuccino)\b/i;
function SkinLevers({ data, goals }) {
  const today = getTodayStr();
  const lastSleep = (data.sleep || []).filter(s => s.date === today || s.date === daysAgo(1)).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  const need = estimateSleepNeed(data, goals).hours;
  const slept = lastSleep ? sleepTST(lastSleep) : null;
  const waterMl = (data.water || []).filter(w => w.date === today).reduce((a, w) => a + (w.ml || 0), 0);
  const waterGoal = (goals && goals.waterGoalMl) || 2500;
  const nic = (data.nicotine || []).filter(n => n.date === today).length;
  const todayDiet = (data.diet || []).filter(d => d.date === today);
  const gl = dayGlycemicLoad(todayDiet);
  const dairy = todayDiet.some(d => DAIRY_LEVER_RE.test(`${d.name || ""} ${d.food || ""} ${d.notes || ""}`));
  const rlogs = (data.skinRoutineLogs || []).filter(l => l.date === today);
  const amDone = rlogs.some(l => l.slot === "am"), pmDone = rlogs.some(l => l.slot === "pm");
  const routineN = (amDone ? 1 : 0) + (pmDone ? 1 : 0);
  const items = [
    { l: "Sleep", v: slept != null ? `${slept.toFixed(1)}h` : "—", warn: slept != null && slept < need - 1, ok: slept == null || slept >= need - 0.5 },
    { l: "Water", v: waterMl ? `${(waterMl / 1000).toFixed(1)}L` : "—", warn: false, ok: waterMl >= waterGoal * 0.7 },
    { l: "Nicotine", v: nic === 0 ? "none" : `${nic}×`, warn: nic > 0, ok: nic === 0 },
    { l: "Diet", v: gl.hasData ? (gl.band + (dairy ? " · dairy" : "")) : (dairy ? "dairy" : "—"), warn: gl.band === "high" || dairy, ok: gl.hasData && gl.band !== "high" && !dairy },
    { l: "Routine", v: routineN === 2 ? "AM·PM ✓" : routineN === 1 ? (amDone ? "AM ✓" : "PM ✓") : "—", warn: false, ok: routineN === 2 },
  ];
  return (
    <Card title="Today's skin levers" sub="the controllables — surfaced before they show up in your skin">
      <div className="lever-grid">
        {items.map((it, i) => (
          <div key={i} className="lever" data-tone={it.warn ? "warn" : it.ok ? "ok" : "neutral"}>
            <span className="lever-v">{it.v}</span><span className="lever-l">{it.l}</span>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>Sleep and nicotine are your strongest levers; water and a calm diet help a little. Hydration is real but oversold — don't expect miracles from water alone.</p>
    </Card>
  );
}

function RoutineCheck({ data, addEntry, deleteEntry, compact }) {
  const today = getTodayStr();
  const logs = (data.skinRoutineLogs || []).filter(l => l.date === today);
  const done = slot => logs.some(l => l.slot === slot);
  const toggle = slot => {
    const ex = logs.find(l => l.slot === slot);
    if (ex) deleteEntry("skinRoutineLogs")(ex.id);
    else addEntry("skinRoutineLogs")({ id: Date.now(), date: today, slot });
    haptic(8);
  };
  const adh = skinRoutineAdherence(data);
  return (
    <div>
      <div className="routine-check">
        <button className={`routine-toggle ${done("am") ? "on" : ""}`} onClick={() => toggle("am")}>{done("am") ? "✓" : "○"} AM routine</button>
        <button className={`routine-toggle ${done("pm") ? "on" : ""}`} onClick={() => toggle("pm")}>{done("pm") ? "✓" : "○"} PM routine</button>
      </div>
      {!compact && <div className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>Last 14 days: AM {adh.amPct}% · PM {adh.pmPct}%. Consistency is what makes any routine actually work.</div>}
    </div>
  );
}

function SkinDashboard({ data, goals, skin }) {
  const streak = skinLogStreak(data.skin);
  const today = getTodayStr();
  const procs = data.skinProcedures || [];
  const upcoming = procs.filter(p => (p.date || "") > today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const recent = procs.filter(p => (p.date || "") <= today && p.date >= daysAgo(14)).sort((a, b) => b.date.localeCompare(a.date))[0];
  const proc = upcoming || recent;
  let procLine = null;
  if (proc) {
    const dayN = Math.round((new Date(today + "T00:00:00") - new Date(proc.date + "T00:00:00")) / 86400000);
    const plan = PROC_PLAN[proc.type] || PROC_PLAN.Other;
    const next = (plan.steps || []).filter(s => s.d >= dayN).sort((a, b) => a.d - b.d)[0];
    procLine = { proc, dayN, next, upcoming: !!upcoming };
  }
  return (
    <>
      <SkinLevers data={data} goals={goals} />
      {procLine && (
        <Card className="proc-countdown">
          <div className="muted small" style={{ textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>{procLine.upcoming ? "Coming up" : "Recovering"}</div>
          <div className="sleep-need-v" style={{ fontSize: "1.4rem" }}>{procLine.proc.type}{procLine.upcoming ? ` · in ${-procLine.dayN}d` : ` · day ${procLine.dayN}`}</div>
          {procLine.next && <p className="muted small" style={{ lineHeight: 1.5, marginTop: 4 }}>{procLine.upcoming ? `Next: ${procLine.next.t}` : procLine.next.t} — {procLine.next.why}. See the full timeline in Plan.</p>}
        </Card>
      )}
      {skin ? (
        <>
          <Card>
            <div className="sleep-need-row">
              <div>
                <div className="muted small">Skin condition (14-day avg)</div>
                <div className="sleep-need-v">{skin.avgCond14 ?? "—"}<span>/5</span></div>
                <div className="muted small" style={{ marginTop: 2 }}>{skin.condTrend == null ? "building a trend" : skin.condTrend > 0.2 ? "↑ improving" : skin.condTrend < -0.2 ? "↓ slipping" : "→ steady"} · {streak}-day log streak</div>
              </div>
              <div style={{ textAlign: "right" }}><div className="muted small">Confidence</div><div style={{ fontWeight: 600 }}>{skin.confidence}</div></div>
            </div>
          </Card>
          {skin.topLever && <Card title="Your biggest skin lever" className="sleep-lever-card"><p className="sleep-lever-text">{skin.topLever.text}</p></Card>}
        </>
      ) : (
        <Card title="Skin intelligence"><Empty icon="✦" title="Log your skin for a couple of weeks" hint="Once there's a week or two of entries, SkinLog learns how your sleep, nicotine, diet and stress move your skin." /></Card>
      )}
    </>
  );
}

function SkinAdviceCard({ skin, conflicts }) {
  let action, why, tone = "ok";
  const leverName = { sleep: "protecting your sleep", nicotine: "cutting nicotine", dairy: "a 4-week dairy test", glycemic: "lowering your glycemic load", stress: "managing stress load" };
  if (conflicts && conflicts.length) { action = "Fix your routine conflict first"; why = conflicts[0]; tone = "warn"; }
  else if (skin && skin.topLever) { action = `Focus on ${leverName[skin.topLever.key] || "your top lever"}`; why = skin.topLever.text; }
  else if (skin && skin.condTrend != null && skin.condTrend <= -0.6) { action = "Find what changed"; why = "Your skin trended down recently — review new products, sleep, stress and diet over the last two weeks."; tone = "warn"; }
  else if (!skin || skin.confidence === "Low") { action = "Keep logging daily"; why = "A week or two of consistent logs unlocks your personal correlations — then the advice gets specific to you."; }
  else { action = "Hold steady"; why = "Things look stable — don't change several variables at once. Let your current routine keep working."; }
  return (
    <Card title="Best next step" sub="the single highest-value thing right now">
      <p className="advice-action" data-tone={tone}>{action}</p>
      <p className="muted small" style={{ lineHeight: 1.5, marginTop: 4 }}>{why}</p>
    </Card>
  );
}

function ProductIntroCard({ data, addEntry, deleteEntry }) {
  const [kind, setKind] = useState(null);
  const [name, setName] = useState("");
  const intros = (data.skinProductIntros || []).slice().sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
  function start() { if (!kind || !name.trim()) return; addEntry("skinProductIntros")({ id: Date.now(), name: name.trim(), kind, startDate: getTodayStr() }); setKind(null); setName(""); toast("✦ Introduction plan added"); }
  return (
    <Card title="Introduce a new product" sub="add one active at a time, the safe way">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Product name (e.g. Tretinoin 0.025%)" />
      <div className="skin-proc-chips" style={{ marginTop: 8 }}>
        {PRODUCT_KINDS.map(p => <button key={p.k} className={`skin-proc-chip ${kind === p.k ? "on" : ""}`} onClick={() => setKind(p.k)}>{p.label}</button>)}
      </div>
      <button className="btn full" style={{ marginTop: 10 }} onClick={start} disabled={!kind || !name.trim()}>Build ramp plan</button>
      {intros.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {intros.map(it => (
            <div key={it.id} className="intro-block">
              <div className="skin-proc-item"><div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: ".9rem" }}>{it.name}</div><div className="muted small">started {formatShortDate(it.startDate)}</div></div><button className="skin-x" onClick={() => deleteEntry("skinProductIntros")(it.id)}>×</button></div>
              <ol className="intro-steps">{(PRODUCT_RAMP[it.kind] || PRODUCT_RAMP.other).map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function avgCondBetween(skin, startStr, endStr) {
  const xs = (skin || []).filter(s => s.date >= startStr && s.date <= endStr && s.condition != null).map(s => s.condition);
  return xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null;
}

function ProductEffectCard({ data }) {
  const today = getTodayStr();
  const dayMs = 86400000;
  const changes = [
    ...(data.skinProductIntros || []).map(p => ({ name: p.name, date: p.startDate, slot: p.kind })),
    ...(data.skinRoutineChanges || []).filter(c => c.action === "added").map(c => ({ name: c.product, date: c.date, slot: c.slot })),
  ].filter(c => c.date).sort((a, b) => b.date.localeCompare(a.date));
  if (!changes.length) return (
    <Card title="Product effects" sub="add a product in Plan → SkinLog tracks its long-term effect here">
      <Empty icon="🧴" title="No product changes logged yet" hint="When you introduce or add a product, SkinLog watches your skin for the weeks before and after to estimate its real effect." />
    </Card>
  );
  return (
    <Card title="Product effects" sub="before vs after — correlation over weeks, not proof">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {changes.map((c, i) => {
          const start = new Date(c.date + "T00:00:00");
          const daysSince = Math.round((new Date(today + "T00:00:00") - start) / dayMs);
          const before = avgCondBetween(data.skin, localDateStr(new Date(start.getTime() - 21 * dayMs)), localDateStr(new Date(start.getTime() - dayMs)));
          const after = avgCondBetween(data.skin, c.date, localDateStr(new Date(start.getTime() + 21 * dayMs)));
          const muddied = changes.some(o => o !== c && Math.abs((new Date(o.date + "T00:00:00") - start) / dayMs) <= 10);
          let body;
          if (daysSince < 14) body = <span className="muted small">Too soon — about {14 - daysSince} more days for a first read (skin is slow; give it 6–8 weeks for the full picture).</span>;
          else if (before == null || after == null) body = <span className="muted small">Not enough skin logs around this change to compare yet.</span>;
          else { const d = +(after - before).toFixed(1); body = <span className="small">{before} → {after}/5 <b style={{ color: d > 0.2 ? "var(--good)" : d < -0.2 ? "#d98a3c" : "inherit" }}>{d > 0 ? `↑ +${d}` : d < 0 ? `↓ ${d}` : "→ flat"}</b> over {daysSince} days</span>; }
          return (
            <div key={i} className="prod-effect">
              <div className="prod-effect-h"><b>{c.name}</b><span className="muted small">{formatShortDate(c.date)}{c.slot ? ` · ${c.slot}` : ""}</span></div>
              {body}
              {muddied && <div className="muted small" style={{ marginTop: 4 }}>⚠ Other changes happened around the same time — hard to isolate this one.</div>}
            </div>
          );
        })}
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>This is correlation, not proof. For a clean read, change one product at a time and give it 6–8 weeks.</p>
    </Card>
  );
}

function RoutineSuggestCard({ goals, conflicts }) {
  const routine = goals.skinRoutine || { am: [], pm: [] };
  const amText = (routine.am || []).map(s => s.product.toLowerCase()).join(" ");
  const pmText = (routine.pm || []).map(s => s.product.toLowerCase()).join(" ");
  const all = `${amText} ${pmText}`;
  const count = (routine.am || []).length + (routine.pm || []).length;
  const suggestions = [];
  (conflicts || []).forEach(c => suggestions.push({ tone: "warn", evidence: "high", text: c }));
  if ((routine.am || []).length && !/spf|sunscreen|sun ?screen|sun ?block/.test(amText)) suggestions.push({ tone: "warn", evidence: "high", text: "No morning SPF detected — add a daily SPF. It's the single highest-evidence step for ageing, pigmentation, and protecting any procedure results." });
  if (/retin|tretinoin|adapalene|retinal|retinol/.test(all) && !/spf|sunscreen/.test(amText)) suggestions.push({ tone: "warn", evidence: "high", text: "You list a retinoid but no SPF — daily sun protection is essential while using one." });
  if (count > 0 && !/moisturiz|moisturis|cream|lotion|hydrat|ceramide/.test(all)) suggestions.push({ tone: "neutral", evidence: "moderate", text: "No moisturizer listed — a basic one supports your barrier, especially alongside actives." });
  if (count > 0 && !/cleans|wash|face ?wash|gel|foam/.test(all)) suggestions.push({ tone: "neutral", evidence: "low", text: "No cleanser listed — a gentle cleanser morning and night is a sensible base." });
  if (!suggestions.length) suggestions.push({ tone: "ok", evidence: "", text: count ? "No gaps or conflicts detected. Hold steady and let your routine work — avoid changing several things at once." : "Add your AM/PM products above and SkinLog will check for gaps, conflicts, and missing SPF." });
  return (
    <Card title="Routine suggestions" sub="science-ranked tweaks from your actual routine">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {suggestions.map((s, i) => (
          <div key={i} className="rs-row" data-tone={s.tone}>
            <span className="small" style={{ lineHeight: 1.5 }}>{s.text}</span>
            {s.evidence && <span className="rs-ev">{s.evidence}</span>}
          </div>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>Suggestions, not prescriptions. Patch-test new actives; prescription products and persistent acne are a dermatologist's call.</p>
    </Card>
  );
}

function CoachPlanCard({ data, updateEntry, deleteEntry }) {
  const plans = (data.skinCoachPlans || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);
  if (!plans.length) return null;
  const toggle = (plan, i) => {
    const items = (plan.items || []).map((it, idx) => idx === i ? { ...it, done: !it.done } : it);
    updateEntry("skinCoachPlans")(plan.id, { items });
    haptic(6);
  };
  return (
    <Card title="From your coach" sub="action items you saved by concluding a coach chat">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {plans.map(p => (
          <div key={p.id} className="coach-plan">
            <div className="coach-plan-h"><span className="muted small">{formatShortDate(p.date)}{p.summary ? ` · ${p.summary}` : ""}</span><button className="skin-x" onClick={() => deleteEntry("skinCoachPlans")(p.id)}>×</button></div>
            {(p.items || []).map((it, i) => (
              <button key={i} className={`coach-plan-item ${it.done ? "done" : ""}`} onClick={() => toggle(p, i)}>
                <span className="cpi-box">{it.done ? "✓" : "○"}</span><span className="cpi-text">{it.text}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

const SKIN_TABS = [
  { k: "dash", label: "Dashboard" },
  { k: "log", label: "Log" },
  { k: "insights", label: "Insights" },
  { k: "plan", label: "Plan" },
  { k: "coach", label: "Coach" },
  { k: "research", label: "Research" },
];

function SkinSection({ data, goals, addEntry, deleteEntry, updateEntry, onSaveGoals }) {
  const [tab, setTab] = useState("dash");
  const skin = useMemo(() => computeSkin(data, goals), [data, goals]);
  const conflicts = useMemo(() => detectRoutineConflicts(goals.skinRoutine), [goals.skinRoutine]);
  return (
    <div className="skin-scope stack">
      <div className="skinlog-bg" aria-hidden="true">
        <span className="sl-bloom b1" /><span className="sl-bloom b2" /><span className="sl-bloom b3" />
        <span className="sl-leaf l1" /><span className="sl-leaf l2" /><span className="sl-leaf l3" /><span className="sl-leaf l4" /><span className="sl-leaf l5" /><span className="sl-leaf l6" />
      </div>
      <div className="skinlog-brand"><span className="skinlog-mark" />SkinLog</div>
      <div className="skin-tabs">
        {SKIN_TABS.map(t => <button key={t.k} className={`skin-tab ${tab === t.k ? "on" : ""}`} onClick={() => { setTab(t.k); haptic(6); }}>{t.label}</button>)}
      </div>

      {tab === "dash" && <SkinDashboard data={data} goals={goals} skin={skin} />}

      {tab === "log" && (
        <>
          <SkinLogForm onAdd={addEntry("skin")} recent={data.skin} />
          <Card title="Routine check-off" sub="mark today's routine to build a consistency record"><RoutineCheck data={data} addEntry={addEntry} deleteEntry={deleteEntry} /></Card>
          <SkinRoutineCard goals={goals} onSaveGoals={onSaveGoals} conflicts={conflicts} addEntry={addEntry} />
          <SkinPhotos />
        </>
      )}

      {tab === "insights" && (
        <>
          {skin ? (
            <>
              <Card>
                <div className="sleep-need-row">
                  <div><div className="muted small">Skin condition (14-day avg)</div><div className="sleep-need-v">{skin.avgCond14 ?? "—"}<span>/5</span></div><div className="muted small" style={{ marginTop: 2 }}>{skin.condTrend == null ? "building a trend" : skin.condTrend > 0.2 ? "↑ improving" : skin.condTrend < -0.2 ? "↓ slipping" : "→ steady"}{skin.breakouts14 != null ? ` · ~${skin.breakouts14} breakouts/log` : ""}</div></div>
                  <div style={{ textAlign: "right" }}><div className="muted small">Confidence</div><div style={{ fontWeight: 600 }}>{skin.confidence}</div></div>
                </div>
                {skin.series && <div className="cond-spark">{skin.series.map((s, i) => <span key={i} className="cond-bar" style={{ height: `${s.value ? s.value * 7 + 6 : 3}px`, opacity: s.value ? 1 : 0.25 }} title={s.label} />)}</div>}
              </Card>
              <SkinAdviceCard skin={skin} conflicts={conflicts} />
              {skin.correlations.length > 0 && (
                <Card title="How your body affects your skin" sub="patterns from your own data — correlation, not proof">
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{skin.correlations.map((c, i) => <div key={i} className="sleep-couple-row"><span className="sleep-couple-dot" style={{ background: c.evidence === "strong" ? "var(--good)" : "#f9c97e" }} /><span className="small" style={{ lineHeight: 1.5 }}>{c.text}</span></div>)}</div>
                </Card>
              )}
              <SkinExperimentCard data={data} goals={goals} onSaveGoals={onSaveGoals} />
              <ProductEffectCard data={data} />
            </>
          ) : (
            <>
              <Card title="Insights"><Empty icon="✦" title="Not enough data yet" hint="Log your skin daily for a week or two and your trends, correlations and progress show up here." /></Card>
              <SkinAdviceCard skin={skin} conflicts={conflicts} />
              <ProductEffectCard data={data} />
            </>
          )}
        </>
      )}

      {tab === "plan" && (
        <>
          <CoachPlanCard data={data} updateEntry={updateEntry} deleteEntry={deleteEntry} />
          <SkinProceduresCard data={data} addEntry={addEntry} deleteEntry={deleteEntry} />
          <RoutineSuggestCard goals={goals} conflicts={conflicts} />
          <ProductIntroCard data={data} addEntry={addEntry} deleteEntry={deleteEntry} />
        </>
      )}

      {tab === "coach" && <SkinCoach data={data} goals={goals} addEntry={addEntry} />}

      {tab === "research" && <SkinResearchStore data={data} addEntry={addEntry} deleteEntry={deleteEntry} />}

      <p className="muted small" style={{ textAlign: "center", lineHeight: 1.5, padding: "4px 12px" }}>SkinLog's skin tools track, correlate, experiment and explain — they don't diagnose or prescribe. For persistent acne, suspicious spots, prescription actives, or the decision to get a procedure, see a dermatologist.</p>
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

function TierBadge({ tier }) {
  const M = { measured: ["Measured", "#5cc8df"], calc: ["Calculated", "#8fd989"], estimate: ["Estimated", "#f9c97e"], forecast: ["Forecast", "#aab2c0"] };
  const [label, color] = M[tier] || M.estimate;
  return <span className="tier-badge" style={{ color, borderColor: `${color}55` }}>{label}</span>;
}

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


// Full-screen sheet launched by the raised ＋. Shows logging options grouped by
// intent; tapping one opens that existing form. Reuses every form component.
function LogOverlay({ data, goals, addEntry, deleteEntry, onSaveGoals, setData, initial, onClose }) {
  const updateEntry = type => (id, patch) => setData(d => ({ ...d, [type]: (d[type] || []).map(e => e.id === id ? { ...e, ...patch } : e) }));
  const [view, setView] = useState(initial || null);
  const today = getTodayStr();
  const groups = [
    { title: "Nutrition", items: [
      { key: "diet", label: "Meal", icon: "◉", color: "#f9c97e" },
      { key: "water", label: "Water", icon: "◊", color: "#5cc8df" },
      { key: "supps", label: "Supps", icon: "⊕", color: "#b4a8e8" },
    ] },
    { title: "Training", items: [
      { key: "exercise", label: "Workout", icon: "◆", color: "#f47e6e" },
      { key: "sports", label: "Sport", icon: "◇", color: "#8fd989" },
      { key: "plan", label: "Plan", icon: "▦", color: "#6ee7f7" },
    ] },
    { title: "Body & habits", items: [
      { key: "sleep", label: "Sleep", icon: "◐", color: "#6ee7f7" },
      { key: "weight", label: "Weight", icon: "◈", color: "#e8c97e" },
      { key: "nicotine", label: "Nicotine", icon: "●", color: "#d98fa8" },
    ] },
    { title: "Reflect", items: [
      { key: "journal", label: "Journal", icon: "✎", color: "#9aa8e8" },
    ] },
    { title: "Skin", items: [
      { key: "skin", label: "Skin", icon: "✦", color: "#e89ab0" },
    ] },
    { title: "Goal", items: [
      { key: "goalplan", label: "Goal Plan", icon: "◎", color: "#7cc4a0" },
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
        <SettingsTab data={data} goals={goals} onSaveGoals={onSaveGoals} onClearAll={onClearAll} onImport={onImport} session={session} onSignOut={onSignOut} initialSection={section} />
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
      <div className="app">
        <header className="topbar">
          <h1 className="brand">FitLog</h1>
          {syncing && <span className="sync-badge"><span className="spinner" />syncing</span>}
        </header>

        <main className="main">
          {activeTab === "Home" && <ErrorBoundary compact label="Home"><HomeTab data={data} goals={goals} onAddWater={addEntry("water")} onAddNicotine={addEntry("nicotine")} onNav={navTo} /></ErrorBoundary>}
          {activeTab === "Insights" && <ErrorBoundary compact label="Insights"><HistoryTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} /></ErrorBoundary>}
          {activeTab === "Coach" && <ErrorBoundary compact label="Coach"><CoachTab data={data} goals={goals} /></ErrorBoundary>}
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
          <button className="tab-plus" onClick={() => openLog(null)} aria-label="Log">＋</button>
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
// ─── EJAC TAB (private personal habit tracker) ──────────────────────────────
// Neutral behavioral metric. Logs one entry per session: { id, date, ts, porn,
// gooning }. Daily count = entries on that date. No coaching or judgments here.
function EjacTab({ data, addEntry, deleteEntry }) {
  const today = getTodayStr();
  const [modalOpen, setModalOpen] = useState(false);
  const [mPorn, setMPorn] = useState(false);
  const [mGoon, setMGoon] = useState(false);

  const ejac = data.ejac || [];
  const onAdd = addEntry("ejac");
  const onDelete = deleteEntry("ejac");

  const logSession = (porn, gooning) => {
    onAdd({ id: Date.now(), date: today, ts: Date.now(), porn: !!porn, gooning: !!gooning });
    haptic(12); SFX.tap();
    toast("Logged", { silent: true });
  };
  const quickAdd = () => logSession(false, false);
  const saveModal = () => { logSession(mPorn, mGoon); setModalOpen(false); setMPorn(false); setMGoon(false); };

  const inDays = (n) => ejac.filter(e => e.date >= daysAgo(n - 1));
  const todayList = ejac.filter(e => e.date === today).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const wk = inDays(7), mo = inDays(30);
  const tally = arr => ({ total: arr.length, porn: arr.filter(e => e.porn).length, goon: arr.filter(e => e.gooning).length });
  const T = tally(todayList), W = tally(wk), M = tally(mo);
  const activeDays30 = new Set(mo.map(e => e.date)).size;
  const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;

  // Daily bars (last 30 days)
  const daily = Array.from({ length: 30 }, (_, i) => {
    const d = daysAgo(29 - i);
    return { d, n: ejac.filter(e => e.date === d).length };
  });
  const dailyMax = Math.max(1, ...daily.map(x => x.n));

  // Weekly trend (last 8 weeks) and monthly trend (last 6 months)
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const wi = 7 - i; // oldest..newest
    const start = daysAgo(wi * 7 + 6), end = daysAgo(wi * 7);
    const n = ejac.filter(e => e.date >= start && e.date <= end).length;
    return { value: n, label: start.slice(5) };
  });
  const monthly = (() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const dt = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      const n = ejac.filter(e => (e.date || "").slice(0, 7) === key).length;
      return { value: n, label: key.slice(2) };
    });
  })();

  const Stat = ({ label, value }) => (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );

  return (
    <div className="stack">
      <Card title="Today" sub={today}>
        <div style={{ display: "flex", gap: 8 }}>
          <Stat label="sessions" value={T.total} />
          <Stat label="porn" value={T.porn} />
          <Stat label="gooning" value={T.goon} />
        </div>
        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setModalOpen(true)}>+ Log session</button>
          <button className="btn btn-ghost" onClick={quickAdd}>+1 quick</button>
        </div>
      </Card>

      <Card title="This week" sub="last 7 days">
        <div style={{ display: "flex", gap: 8 }}>
          <Stat label="sessions" value={W.total} />
          <Stat label="porn" value={W.porn} />
          <Stat label="gooning" value={W.goon} />
        </div>
      </Card>

      <Card title="This month" sub="last 30 days">
        <div style={{ display: "flex", gap: 8 }}>
          <Stat label="sessions" value={M.total} />
          <Stat label="/day (cal)" value={(M.total / 30).toFixed(2)} />
          <Stat label="/active day" value={activeDays30 ? (M.total / activeDays30).toFixed(2) : "0"} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Stat label="porn %" value={`${pct(M.porn, M.total)}%`} />
          <Stat label="gooning %" value={`${pct(M.goon, M.total)}%`} />
        </div>
      </Card>

      {ejac.length > 0 ? (
        <>
          <Card title="Daily frequency" sub="sessions per day · last 30 days">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 70 }}>
              {daily.map((x, i) => (
                <div key={i} title={`${x.d}: ${x.n}`} style={{ flex: 1, height: `${(x.n / dailyMax) * 100}%`, minHeight: x.n ? 3 : 1, background: x.n ? "var(--accent)" : "var(--muted)", opacity: x.n ? 1 : 0.3, borderRadius: 2 }} />
              ))}
            </div>
          </Card>
          <Card title="Weekly trend" sub="total sessions per week · last 8 weeks">
            <MiniChart points={weekly} height={90} />
          </Card>
          <Card title="Monthly trend" sub="total sessions per month · last 6 months">
            <MiniChart points={monthly} height={90} />
          </Card>
        </>
      ) : (
        <Empty icon="•" title="No sessions logged yet" hint="Use + Log session or +1 quick to start building your history." />
      )}

      {todayList.length > 0 && (
        <Card title="Today's sessions">
          <div className="list">
            {todayList.map(e => (
              <div key={e.id} className="list-row">
                <span className="list-main">{e.ts ? new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                <span className="muted small">{[e.porn ? "porn" : null, e.gooning ? "gooning" : null].filter(Boolean).join(", ") || "—"}</span>
                <button className="x" onClick={() => onDelete(e.id)}>×</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Log session</h3>
            <div style={{ margin: "14px 0" }}>
              <div className="muted small" style={{ marginBottom: 6 }}>Pornography used?</div>
              <div className="seg">
                <button className={`seg-btn ${!mPorn ? "active" : ""}`} onClick={() => setMPorn(false)}>No</button>
                <button className={`seg-btn ${mPorn ? "active" : ""}`} onClick={() => setMPorn(true)}>Yes</button>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div className="muted small" style={{ marginBottom: 6 }}>Gooning session?</div>
              <div className="seg">
                <button className={`seg-btn ${!mGoon ? "active" : ""}`} onClick={() => setMGoon(false)}>No</button>
                <button className={`seg-btn ${mGoon ? "active" : ""}`} onClick={() => setMGoon(true)}>Yes</button>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="btn" onClick={saveModal}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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

