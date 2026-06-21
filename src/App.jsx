import { useState, useEffect, useRef, useMemo } from "react";
import { supabase, hasSupabase } from "./supabase";
import { styles } from "./styles";
import { localDateStr, getTodayStr, formatDate, formatShortDate, daysAgo, daysAgoFrom } from "./lib/dates";
import { computeWeightTrend } from "./engines/weight";
import { avgTimeMins, avgTimeHHMM, minsOfTime } from "./lib/time";
import { parseWorkout, bestSet, e1rm, detectPRs } from "./engines/workout";
import { clusterFeedings, computeProteinDistribution } from "./engines/protein";
import { computeEnergyBalance, mifflinBMR } from "./engines/energy";
import { computeTraining, mapMuscles, MUSCLE_LABELS } from "./engines/training";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TABS = ["Home", "Log", "History", "Coach", "Journal", "Settings", "Ejac"];
const STORAGE_KEY = "fitlog_v5";
const defaultData = { sleep: [], diet: [], exercise: [], sports: [], water: [], supplements: [], nicotine: [], nicotinePlans: [], journal: [], weight: [], ejac: [] };
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

const defaultGoals = { calories: 2500, protein: 180, carbs: 250, fat: 80, goal: "Build Muscle", waterGoalMl: 2500, profile: defaultProfile, strategy: defaultStrategy, sleepScreen: null, sleepExperiment: null };
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
const NIC_MG = { cigarette: 1.2, vape: 0.05, pouch: 6 }; // pouch overridden by its own mg if set

// ─── WORKOUT PLANNING ─────────────────────────────────────────────────────────
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
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

// ─── HAPTICS ──────────────────────────────────────────────────────────────────
// Subtle vibration on supported mobile devices. No-op on desktop/unsupported.
function haptic(pattern = 12) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
}

// ─── SOUND ────────────────────────────────────────────────────────────────────
// Synthesized via Web Audio API — no audio files, tiny, works offline.
// Respects a user preference stored in localStorage (default ON).
let _soundOn = (() => { try { return localStorage.getItem(STORAGE_KEY + "_sound") !== "off"; } catch { return true; } })();
function setSoundPref(on) { _soundOn = on; try { localStorage.setItem(STORAGE_KEY + "_sound", on ? "on" : "off"); } catch {} }
function soundEnabled() { return _soundOn; }

let _audioCtx = null;
function audioCtx() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    return _audioCtx;
  } catch { return null; }
}

// Play a single tone. freq in Hz, dur in seconds, type of wave, gain 0-1, startOffset for sequencing.
function tone(freq, dur, { type = "sine", gain = 0.18, when = 0, glideTo = null } = {}) {
  const ctx = audioCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  // Quick attack, smooth exponential release — avoids clicks
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Named sound effects. Each is a no-op when sound is disabled.
const SFX = {
  log()    { if (!soundEnabled()) return; tone(660, 0.12, { type: "triangle", gain: 0.16 }); tone(880, 0.14, { type: "triangle", gain: 0.14, when: 0.06 }); },
  water()  { if (!soundEnabled()) return; tone(440, 0.10, { type: "sine", gain: 0.18, glideTo: 880 }); },
  tap()    { if (!soundEnabled()) return; tone(520, 0.05, { type: "square", gain: 0.06 }); },
  pr()     { if (!soundEnabled()) return; [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: "triangle", gain: 0.18, when: i * 0.10 })); },
  success(){ if (!soundEnabled()) return; tone(587, 0.12, { type: "triangle", gain: 0.16 }); tone(880, 0.18, { type: "triangle", gain: 0.16, when: 0.10 }); },
  error()  { if (!soundEnabled()) return; tone(220, 0.18, { type: "sine", gain: 0.16, glideTo: 160 }); },
  start()  { if (!soundEnabled()) return; tone(440, 0.10, { type: "triangle", gain: 0.12, glideTo: 660 }); },
};


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
function nicMg(entry) {
  if (entry.type === "pouch") return (entry.amount || 0) * (entry.mg || NIC_MG.pouch);
  return (entry.amount || 0) * (NIC_MG[entry.type] || 0);
}
function computeNicotineStats(data) {
  const nic = data.nicotine || [];
  const today = getTodayStr();
  const byDay = {}; // date -> { mg, count, byType }
  nic.forEach(e => {
    if (!e.date) return;
    if (!byDay[e.date]) byDay[e.date] = { mg: 0, count: 0, cigarette: 0, vape: 0, pouch: 0 };
    const d = byDay[e.date];
    d.mg += nicMg(e);
    d.count += 1;
    d[e.type] = (d[e.type] || 0) + (e.amount || 0);
  });

  const sumWindow = (days) => {
    let mg = 0, count = 0, daysWithData = 0;
    for (let i = 0; i < days; i++) {
      const ds = daysAgo(i);
      if (byDay[ds]) { mg += byDay[ds].mg; count += byDay[ds].count; daysWithData++; }
    }
    return { mg, count, daysWithData };
  };

  const todayStats = byDay[today] || { mg: 0, count: 0, cigarette: 0, vape: 0, pouch: 0 };
  const w7 = sumWindow(7);
  const w30 = sumWindow(30);
  // Rolling averages per day (over the window length, treating no-log days as 0)
  const avg7 = +(w7.mg / 7).toFixed(1);
  const avg30 = +(w30.mg / 30).toFixed(1);
  const avgCount7 = +(w7.count / 7).toFixed(1);

  // Daily series for the trend chart (last 30 days, mg per day)
  const series30 = Array.from({ length: 30 }, (_, i) => {
    const ds = daysAgo(29 - i);
    return { value: byDay[ds] ? +byDay[ds].mg.toFixed(1) : 0, label: ds };
  });
  // Entries-per-day series (what the trend chart shows — more intuitive than mg)
  const seriesCount30 = Array.from({ length: 30 }, (_, i) => {
    const ds = daysAgo(29 - i);
    return { value: byDay[ds] ? byDay[ds].count : 0, label: ds };
  });

  // Type breakdown over last 30 days
  const typeTotals = { cigarette: 0, vape: 0, pouch: 0 };
  nic.filter(e => e.date >= daysAgo(29)).forEach(e => { typeTotals[e.type] = (typeTotals[e.type] || 0) + (e.amount || 0); });

  // Context tag frequency (last 30d)
  const contextCounts = {};
  nic.filter(e => e.date >= daysAgo(29)).forEach(e => (e.contexts || []).forEach(c => { contextCounts[c] = (contextCounts[c] || 0) + 1; }));
  const topContexts = Object.entries(contextCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return { byDay, today: todayStats, w7, w30, avg7, avg30, avgCount7, series30, seriesCount30, typeTotals, topContexts, totalDaysLogged: Object.keys(byDay).length };
}

// Honest, data-gated correlations. Only returns a finding when there's enough signal.
// Compares "higher intake" vs "lower intake" days/weeks within the user's OWN data.
function computeNicotineCorrelations(data) {
  const nic = data.nicotine || [];
  if (nic.length < 10) return { ready: false, reason: "Keep logging — correlations unlock once there's about 2 weeks of data." };

  const stats = computeNicotineStats(data);
  const byDay = stats.byDay;
  // Only consider days that have BOTH a nicotine value (0 counts) and the comparison metric.
  const findings = [];

  // Helper: split days into high vs low nicotine (above/below median mg) and compare a metric
  function compareByNicotine(metricForDate, label, unit, minPairs = 8) {
    const rows = [];
    // Look back 60 days
    for (let i = 0; i < 60; i++) {
      const ds = daysAgo(i);
      const mg = byDay[ds] ? byDay[ds].mg : 0;
      const metric = metricForDate(ds);
      if (metric != null) rows.push({ mg, metric });
    }
    if (rows.length < minPairs) return null;
    const mgs = rows.map(r => r.mg).sort((a, b) => a - b);
    const median = mgs[Math.floor(mgs.length / 2)];
    const high = rows.filter(r => r.mg > median);
    const low = rows.filter(r => r.mg <= median);
    if (high.length < 3 || low.length < 3) return null;
    const avg = arr => arr.reduce((a, b) => a + b.metric, 0) / arr.length;
    const hi = avg(high), lo = avg(low);
    const diff = hi - lo;
    return { hi, lo, diff, label, unit, nHigh: high.length, nLow: low.length };
  }

  // Sleep duration vs nicotine
  const sleepByDate = {};
  (data.sleep || []).forEach(s => { if (s.date) sleepByDate[s.date] = s.duration; });
  const sleepCorr = compareByNicotine(ds => sleepByDate[ds] ?? null, "sleep", "h");
  if (sleepCorr && Math.abs(sleepCorr.diff) >= 0.4) {
    const mins = Math.abs(Math.round(sleepCorr.diff * 60));
    findings.push(`On your higher-nicotine days, average sleep was about ${mins} min ${sleepCorr.diff < 0 ? "shorter" : "longer"} (${sleepCorr.hi.toFixed(1)}h vs ${sleepCorr.lo.toFixed(1)}h).`);
  }

  // Workout RPE vs nicotine (same-day)
  const rpeByDate = {};
  (data.exercise || []).forEach(e => { const p = e._parsed || parseWorkout(e.text || ""); if (p.avgRPE != null && e.date) rpeByDate[e.date] = p.avgRPE; });
  const rpeCorr = compareByNicotine(ds => rpeByDate[ds] ?? null, "RPE", "");
  if (rpeCorr && Math.abs(rpeCorr.diff) >= 0.5) {
    findings.push(`On higher-nicotine days, your logged session RPE averaged ${rpeCorr.hi.toFixed(1)} vs ${rpeCorr.lo.toFixed(1)} — sessions felt ${rpeCorr.diff > 0 ? "harder" : "easier"}.`);
  }

  // Calories vs nicotine (appetite)
  const calByDate = {};
  (data.diet || []).forEach(m => { if (m.date) calByDate[m.date] = (calByDate[m.date] || 0) + (m.calories || 0); });
  const calCorr = compareByNicotine(ds => calByDate[ds] ?? null, "calories", "kcal");
  if (calCorr && Math.abs(calCorr.diff) >= 150) {
    findings.push(`On higher-nicotine days, you ate about ${Math.abs(Math.round(calCorr.diff))} kcal ${calCorr.diff < 0 ? "less" : "more"} on average (${Math.round(calCorr.hi)} vs ${Math.round(calCorr.lo)}).`);
  }

  // Sleep quality (map quality words to score)
  const qMap = { Poor: 1, Fair: 2, Good: 3, Great: 4, Excellent: 4 };
  const sleepQByDate = {};
  (data.sleep || []).forEach(s => { if (s.date && qMap[s.quality]) sleepQByDate[s.date] = qMap[s.quality]; });
  const sqCorr = compareByNicotine(ds => sleepQByDate[ds] ?? null, "sleep quality", "");
  if (sqCorr && Math.abs(sqCorr.diff) >= 0.4) {
    findings.push(`On higher-nicotine days, your sleep quality rating trended ${sqCorr.diff < 0 ? "lower" : "higher"}.`);
  }

  return { ready: true, findings, enoughForMore: nic.length >= 20 };
}

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
function computeNicotineTiming(data, goals) {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const today = getTodayStr();
  const minsOf = t => { if (!t) return null; const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? +m[1] * 60 + +m[2] : null; };

  // ── ACTIVE DAY ──
  // People don't reset at midnight — they reset when they wake. If it's the small hours
  // (before ~5am) and there's no sleep logged for the new calendar day yet, the user is
  // still inside their PREVIOUS waking day. So "today's" workouts/meals should be read from
  // yesterday's date, and time-since-event must count across midnight (+24h).
  const preDawn = nowMins < 5 * 60; // before 5:00am
  const sleptForToday = (data.sleep || []).some(s => s.date === today);
  const activeDay = (preDawn && !sleptForToday) ? daysAgo(1) : today;
  const crossedMidnight = activeDay !== today;
  // When comparing event times on the active (previous) day to "now", add 24h to now.
  const nowMinsAdj = crossedMidnight ? nowMins + 24 * 60 : nowMins;

  const raising = [];   // { text } — factors increasing impact right now
  const easing = [];    // { text } — factors that are currently favorable
  const unknown = [];   // metrics we couldn't read
  let strongOverride = false; // post-workout 0-2h or near-bedtime → never "Lower"

  // ── FACTOR 1: Trained in last ~0–3h (lift OR sport) ──
  // Read from the ACTIVE day (which may be yesterday's date if pre-dawn).
  const dayWorkouts = [
    ...(data.exercise || []).filter(e => e.date === activeDay && e.time).map(e => ({ time: e.time, label: e.label || "workout" })),
    ...(data.sports || []).filter(s => s.date === activeDay && s.time).map(s => ({ time: s.time, label: s.sport || "sport" })),
  ];
  if (dayWorkouts.length) {
    let mostRecent = null, mostRecentMins = -1;
    dayWorkouts.forEach(w => {
      let m = minsOf(w.time);
      if (m == null) return;
      // If we're past midnight, the event happened on the previous day → it's at m (no +24);
      // "now" already had +24 added, so the difference is correct.
      if (m > mostRecentMins && m <= nowMinsAdj) { mostRecentMins = m; mostRecent = w; }
    });
    if (mostRecent) {
      const hrsSince = (nowMinsAdj - mostRecentMins) / 60;
      if (hrsSince >= 0 && hrsSince <= 2) {
        raising.push({ text: `Trained ${hrsSince < 1 ? "under an hour" : Math.round(hrsSince) + "h"} ago — you're in the post-workout window where blood flow drives recovery and protein synthesis; nicotine's vasoconstriction works directly against that.` });
        strongOverride = true;
      } else if (hrsSince > 2 && hrsSince <= 3) {
        raising.push({ text: `Trained about ${Math.round(hrsSince)}h ago — still within the recovery window where blood flow matters.` });
      } else {
        easing.push({ text: `Last trained ${Math.round(hrsSince)}h ago — outside the tightest recovery window.` });
      }
    }
  } else {
    const activeName = WEEKDAYS[(new Date(activeDay + "T00:00:00").getDay() + 6) % 7];
    const isTrainingDay = goals.plan?.trainingDays?.includes(activeName);
    if (isTrainingDay) easing.push({ text: `No training logged ${crossedMidnight ? "yesterday" : "yet today"} — not currently in a recovery window.` });
    else easing.push({ text: `Rest day — no training stress to recover from right now, so the training-specific cost is lowest.` });
  }

  // ── FACTOR 2: Short / poor sleep ──
  // Find the MOST RECENT sleep log (not just today/yesterday — don't "forget" older data).
  const sortedSleep = (data.sleep || []).filter(s => s.date && s.duration != null).sort((a, b) => b.date.localeCompare(a.date));
  const lastSleep = sortedSleep[0] || null;
  if (!lastSleep) {
    unknown.push("sleep");
  } else {
    // Staleness is measured from the most recent night that COULD have a log.
    // If we've crossed midnight and slept already, last night = today's date; otherwise
    // last night = yesterday's date. Compare the log's age against that reference.
    const lastNightDate = sleptForToday ? today : daysAgo(1);
    const daysOld = Math.round((new Date(lastNightDate + "T00:00:00") - new Date(lastSleep.date + "T00:00:00")) / 86400000);
    const whenLabel = daysOld <= 0 ? "last night" : daysOld === 1 ? "the night before last" : `${daysOld + 1} nights ago (most recent log)`;
    const stale = daysOld >= 1; // anything older than the most recent loggable night is stale
    const poorQuality = lastSleep.quality === "Poor" || lastSleep.quality === "Fair";
    const dur = lastSleep.duration;
    const qStr = lastSleep.quality ? ` (${lastSleep.quality.toLowerCase()})` : "";
    if (stale) {
      unknown.push(`sleep — not logged for last night (most recent: ${dur}h${qStr}, ${whenLabel})`);
    } else if (dur < 6) {
      raising.push({ text: `Slept ${dur}h last night — recovery is already compromised before anything else stacks on top.` });
    } else if (dur < 7 || poorQuality) {
      raising.push({ text: `Slept ${dur}h${qStr} last night — recovery is running below par.` });
    } else {
      easing.push({ text: `Slept ${dur}h${qStr} last night — recovery base is solid.` });
    }
  }

  // ── FACTOR 3: Under-fuelled vs target on the ACTIVE day (esp. protein) ──
  const dayDiet = (data.diet || []).filter(d => d.date === activeDay);
  // "Hours into the waking day" — if pre-dawn, the day's been going a long time, so don't
  // excuse low intake as "just getting started".
  const hoursIntoDay = crossedMidnight ? (nowMins / 60 + 24 - 6) : (nowMins / 60 - 6);
  if (dayDiet.length === 0 && !crossedMidnight && nowMins < 11 * 60) {
    easing.push({ text: `Early in the day — fuelling just getting started.` });
  } else if (dayDiet.length === 0) {
    // Late in a day (or past midnight) with no food logged is itself a fuelling gap, not "unknown".
    if (crossedMidnight || nowMins >= 15 * 60) {
      raising.push({ text: `No food logged ${crossedMidnight ? "for yesterday" : "today"} — if that's accurate, you're under-fuelled, which compounds the recovery hit.` });
    } else {
      unknown.push("food");
    }
  } else {
    const cal = dayDiet.reduce((a, m) => a + (m.calories || 0), 0);
    const protein = dayDiet.reduce((a, m) => a + (m.protein || 0), 0);
    const calTarget = goals.calories || 0;
    const pTarget = goals.protein || 0;
    // Fraction of the day elapsed (cap at 1 once past ~9pm or after midnight)
    const dayFrac = crossedMidnight ? 1 : Math.max(0, Math.min(1, (nowMins - 6 * 60) / ((21 - 6) * 60)));
    const expectedCal = calTarget * dayFrac;
    const lowProtein = pTarget && protein < pTarget * dayFrac * 0.7;
    const lowCal = calTarget && cal < expectedCal * 0.65;
    if (lowProtein && lowCal) {
      raising.push({ text: `Under-fuelled (${cal} kcal, ${protein}g protein) ${crossedMidnight ? "across yesterday" : "for this point in the day"} — under-eating, especially low protein, compounds the recovery hit.` });
    } else if (lowProtein) {
      raising.push({ text: `Protein is behind (${protein}g vs ${pTarget}g target) — low protein leaves recovery under-supported.` });
    } else if (lowCal) {
      raising.push({ text: `Calories are behind target — under-fuelling compounds recovery stress.` });
    } else {
      easing.push({ text: `Fuelling is on track — recovery is supported.` });
    }
  }

  // ── FACTOR 4: Within ~1–2h of usual bedtime ──
  // Use 7-day average bedtime, fall back to last night's.
  const recentBedtimes = (data.sleep || []).filter(s => s.date >= daysAgo(7) && s.bedtime).map(s => s.bedtime);
  let bedtimeMins = null;
  if (recentBedtimes.length >= 2) {
    bedtimeMins = avgTimeMins(recentBedtimes);
  } else if (lastSleep?.bedtime) {
    bedtimeMins = minsOf(lastSleep.bedtime);
    if (bedtimeMins != null && bedtimeMins < 5 * 60) bedtimeMins += 24 * 60;
  }
  if (bedtimeMins == null) {
    unknown.push("bedtime");
  } else {
    // Normalize "now" to compare against a possibly-after-midnight bedtime
    let nowForBed = nowMins;
    if (bedtimeMins >= 24 * 60 && nowMins < 12 * 60) nowForBed += 24 * 60;
    const minsToBed = bedtimeMins - nowForBed;
    const bedLabel = `${String(Math.floor((bedtimeMins % (24 * 60)) / 60)).padStart(2, "0")}:${String(bedtimeMins % 60).padStart(2, "0")}`;
    if (minsToBed >= 0 && minsToBed <= 60) {
      raising.push({ text: `It's within an hour of your usual bedtime (~${bedLabel}) — nicotine is a stimulant and fragments sleep, your biggest recovery lever.` });
      strongOverride = true;
    } else if (minsToBed > 60 && minsToBed <= 120) {
      raising.push({ text: `Getting close to your usual bedtime (~${bedLabel}) — late nicotine can disrupt sleep onset and quality.` });
    } else if (minsToBed > 120 && minsToBed <= 240) {
      easing.push({ text: `A few hours from your usual bedtime — outside the window where it most disrupts sleep.` });
    } else {
      easing.push({ text: `Far from bedtime — sleep disruption isn't the main concern right now.` });
    }
  }

  // ── ROLL INTO BANDS ──
  // Additive: 0 raising → lower; 1-2 → moderate; 3+ → higher.
  // Override: a strong factor (0-2h post-workout OR within 1h of bed) can never read "Lower".
  let band;
  const n = raising.length;
  if (n >= 3) band = "higher";
  else if (n >= 1) band = "moderate";
  else band = "lower";
  if (band === "lower" && strongOverride) band = "moderate";

  // Guard: the two factors that most define recovery are sleep and training status.
  // If sleep is unknown, we can't honestly call this a "Lower-impact" window — that would
  // read like a green light based on missing data. Floor it at Moderate and flag why.
  const sleepUnknown = unknown.some(u => u === "sleep" || u.startsWith("sleep"));
  let insufficientData = false;
  if (band === "lower" && sleepUnknown) {
    band = "moderate";
    insufficientData = true;
  }

  return { band, raising, easing, unknown, strongOverride, insufficientData, crossedMidnight, activeDay, time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` };
}

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
function computeRecovery(data, goals) {
  const today = getTodayStr();
  const reasons = [];   // { text, dir: "neg" | "pos" } — neg pushes toward rest
  const unknown = [];
  let negScore = 0;     // weighted points pushing toward rest
  const negByCat = {};  // weighted negatives grouped by category → finds the limiter

  const add = (text, dir, weight = 1, category = "load") => {
    reasons.push({ text, dir, category });
    if (dir === "neg") { negScore += weight; negByCat[category] = (negByCat[category] || 0) + weight; }
  };

  // What does the plan say for today?
  const todayName = WEEKDAYS[(new Date(today + "T00:00:00").getDay() + 6) % 7];
  const plannedToday = goals.plan?.trainingDays?.includes(todayName);
  const todayLabel = goals.plan?.assignments?.[todayName] || (plannedToday ? "training" : "rest");

  // ── Last night's sleep ──
  const sortedSleep = (data.sleep || []).filter(s => s.date && s.duration != null).sort((a, b) => b.date.localeCompare(a.date));
  const lastSleep = sortedSleep[0];
  const lastNightDate = (data.sleep || []).some(s => s.date === today) ? today : daysAgo(1);
  if (!lastSleep || Math.round((new Date(lastNightDate + "T00:00:00") - new Date(lastSleep.date + "T00:00:00")) / 86400000) >= 1) {
    unknown.push("last night's sleep");
  } else {
    const poor = lastSleep.quality === "Poor" || lastSleep.quality === "Fair";
    if (lastSleep.duration < 5.5) add(`Only ${lastSleep.duration}h sleep last night — recovery is significantly down`, "neg", 2, "sleep");
    else if (lastSleep.duration < 7 || poor) add(`Slept ${lastSleep.duration}h${poor ? ` (${lastSleep.quality.toLowerCase()})` : ""} last night — a bit under-recovered`, "neg", 1, "sleep");
    else add(`Slept ${lastSleep.duration}h (${(lastSleep.quality || "ok").toLowerCase()}) last night — well rested`, "pos");
  }

  // ── Sleep timing: hours awake since waking, estimated hours until next sleep ──
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const minsOf = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
  // Hours awake: from last logged wake time (if today/last night)
  let hoursAwake = null;
  if (lastSleep?.wakeTime) {
    const wake = minsOf(lastSleep.wakeTime);
    if (wake != null) {
      // If the sleep log is for today, wake was today; otherwise assume it was yesterday morning
      const wakeWasToday = lastSleep.date === today;
      let mins = nowMins - wake;
      if (!wakeWasToday) mins += 24 * 60; // woke yesterday
      if (mins >= 0 && mins < 36 * 60) hoursAwake = +(mins / 60).toFixed(1);
    }
  }
  // Estimated next bedtime: 7-day average bedtime (fallback last night's)
  const recentBeds = (data.sleep || []).filter(s => s.date >= daysAgo(7) && s.bedtime).map(s => s.bedtime);
  let nextBedMins = recentBeds.length >= 2 ? avgTimeMins(recentBeds) : (lastSleep?.bedtime ? minsOf(lastSleep.bedtime) : null);
  let hoursToBed = null, nextBedLabel = null;
  if (nextBedMins != null) {
    nextBedLabel = `${String(Math.floor((nextBedMins % 1440) / 60)).padStart(2, "0")}:${String(nextBedMins % 60).padStart(2, "0")}`;
    let toBed = nextBedMins - nowMins;
    if (toBed < -60) toBed += 24 * 60; // bedtime already passed → next one is tomorrow
    if (toBed >= -60 && toBed <= 24 * 60) hoursToBed = +(toBed / 60).toFixed(1);
  }
  // Surface as context (not heavily weighted — informational, plus a nudge if up very late)
  if (hoursAwake != null && hoursAwake >= 16) add(`You've been awake ~${hoursAwake}h — long day, recovery capacity is lower late`, "neg", 0.5, "sleep");

  const sleepTiming = { hoursAwake, hoursToBed, nextBedLabel, lastWake: lastSleep?.wakeTime || null, lastBed: lastSleep?.bedtime || null };

  // ── 7-day sleep debt (vs the user's personal need, not a hardcoded 8h) ──
  const last7Sleep = (data.sleep || []).filter(s => s.date >= daysAgo(6));
  if (last7Sleep.length >= 3) {
    const need = estimateSleepNeed(data, goals).hours;
    const debt = last7Sleep.reduce((d, s) => d + (need - sleepTST(s)), 0);
    if (debt > 8) add(`Sleep debt is high (~${debt.toFixed(0)}h short of your ${need}h need this week)`, "neg", 2, "sleep");
    else if (debt > 4) add(`Some sleep debt building this week (~${debt.toFixed(0)}h short of your ${need}h need)`, "neg", 1, "sleep");
  }

  // ── Consecutive training days / days since rest ──
  const trainDates = new Set([...(data.exercise || []).map(e => e.date), ...(data.sports || []).map(s => s.date)]);
  let consec = 0;
  { let cur = new Date(); if (!trainDates.has(getTodayStr())) cur.setDate(cur.getDate() - 1);
    for (;;) { const ds = localDateStr(cur); if (trainDates.has(ds)) { consec++; cur.setDate(cur.getDate() - 1); } else break; } }
  if (consec >= 5) add(`Trained ${consec} days straight with no rest — strong deload signal`, "neg", 2, "load");
  else if (consec >= 3) add(`${consec} training days in a row — fatigue accumulating`, "neg", 1, "load");
  else if (consec === 0 && trainDates.size > 0) add(`Rested recently — you're fresh`, "pos");

  // ── Recent RPE trend (from parsed Strong data) ──
  const last5Lifts = (data.exercise || []).filter(e => e.date >= daysAgo(6))
    .map(e => (e._parsed || parseWorkout(e.text || "")).avgRPE).filter(v => v != null);
  if (last5Lifts.length >= 2) {
    const avgRPE = last5Lifts.reduce((a, b) => a + b, 0) / last5Lifts.length;
    if (avgRPE >= 8.5) add(`Recent sessions have felt very hard (avg RPE ${avgRPE.toFixed(1)})`, "neg", 1, "load");
    else if (avgRPE <= 6.5) add(`Recent sessions felt manageable (avg RPE ${avgRPE.toFixed(1)})`, "pos");
  }

  // ── Under-fuelling over the last few days ──
  const calByDay = {};
  (data.diet || []).filter(d => d.date >= daysAgo(2)).forEach(d => { calByDay[d.date] = (calByDay[d.date] || 0) + (d.calories || 0); });
  const calDays = Object.values(calByDay);
  if (calDays.length >= 2 && goals.calories) {
    const avg = calDays.reduce((a, b) => a + b, 0) / calDays.length;
    if (avg < goals.calories * 0.7) add(`Under-eating recently (~${Math.round(avg)} vs ${goals.calories} target) — under-fuelled recovery`, "neg", 1, "fuel");
  }

  // ── Protein adequacy (B1) & aggressive-deficit signal (A1) ──
  const pdRec = computeProteinDistribution(data, goals);
  if (pdRec && pdRec.confidence !== "Low" && pdRec.proteinGoal && pdRec.avgProtein < pdRec.proteinGoal * 0.8) {
    add(`Protein's been low (~${pdRec.avgProtein}g vs ${pdRec.proteinGoal}g) — under-supports tissue repair`, "neg", 1, "fuel");
  }
  const wtRec = computeWeightTrend(data);
  if (wtRec && wtRec.confidence !== "Low" && wtRec.pctBWPerWeek != null && wtRec.pctBWPerWeek <= -0.9) {
    add(`Losing weight fast (trend ${wtRec.pctBWPerWeek}%BW/wk) — an aggressive deficit lowers recovery capacity`, "neg", 1, "fuel");
  }

  // ── Carbs vs a hard session (conservative placeholder until the C1 glycogen engine) ──
  if (goals.carbs) {
    const hardSession = (data.exercise || []).some(e => {
      if (e.date !== today && e.date !== daysAgo(1)) return false;
      const pr = e._parsed || parseWorkout(e.text || "");
      return (pr.avgRPE != null && pr.avgRPE >= 8) || (pr.totalVolume != null && pr.totalVolume >= 12000);
    }) || (data.sports || []).some(s => (s.date === today || s.date === daysAgo(1)) && (s.duration || 0) >= 60);
    const carbsToday = (data.diet || []).filter(d => d.date === today).reduce((a, d) => a + (d.carbs || 0), 0);
    if (hardSession && carbsToday > 0 && carbsToday < goals.carbs * 0.5) {
      add(`Hard session but carbs are low today (~${Math.round(carbsToday)}g vs ${goals.carbs}g) — glycogen may be under-replenished`, "neg", 0.5, "carbs");
    }
  }

  // ── Journal sentiment (light touch — only explicit fatigue words) ──
  const recentJournal = (data.journal || []).filter(e => e.date >= daysAgo(2));
  const fatigueWords = /\b(exhausted|drained|run down|rundown|burnt out|burned out|wrecked|sore|aching|tired|sick|ill|stressed|no energy|knackered)\b/i;
  const flagged = recentJournal.find(e => fatigueWords.test(e.text));
  if (flagged) add(`Your recent journal notes mention feeling run down`, "neg", 1, "stress");

  // ── Nicotine load (only if notably high) ──
  if ((data.nicotine || []).length) {
    const ns = computeNicotineStats(data);
    if (ns.avg7 > 0 && ns.today.count >= 5) add(`High nicotine intake today may blunt recovery`, "neg", 0.5, "stress");
  }

  // ── ROLL INTO VERDICT ──
  // Heavy single signals (sleep<5.5h, 5+ consec days) already weighted 2.
  let verdict;
  if (negScore >= 4) verdict = "rest";
  else if (negScore >= 2) verdict = "caution";
  else verdict = "go";

  // If sleep is unknown, don't confidently say "go" — soften to caution and flag.
  let lowData = false;
  if (verdict === "go" && unknown.includes("last night's sleep")) { verdict = "caution"; lowData = true; }

  // Reconcile with the plan: note when the verdict and the plan disagree.
  let reconcile = null;
  if (verdict === "rest" && plannedToday) reconcile = `Your plan has ${todayLabel} today, but your recovery says rest. Consider swapping today with an upcoming rest day.`;
  else if (verdict === "go" && !plannedToday) reconcile = `You're recovered, but today is a scheduled rest day. Extra rest never hurts — or move a session here if you're keen.`;
  else if (verdict === "caution" && plannedToday) reconcile = `Plan says ${todayLabel}. You can train, but keep intensity in check and cut volume if it feels rough.`;

  // ── LIMITER + READINESS ──
  // The limiter is the category dragging recovery down the most — the single
  // bottleneck to name instead of generic advice. Only surfaced once there's
  // meaningful negative load (caution/rest); at "go" nothing is limiting.
  const catLabels = { sleep: "Sleep", fuel: "Fuel / nutrition", carbs: "Carbs / glycogen", load: "Training load", stress: "Stress / lifestyle" };
  let limiter = null;
  const ranked = Object.entries(negByCat).sort((a, b) => b[1] - a[1]);
  if (ranked.length && negScore >= 2) {
    const [cat, w] = ranked[0];
    const topReason = reasons.find(r => r.dir === "neg" && r.category === cat);
    limiter = { category: cat, label: catLabels[cat] || cat, weight: w, topReason: topReason ? topReason.text : null };
  }
  const readiness = Math.max(0, Math.min(100, Math.round(100 - negScore * 14)));

  return { verdict, reasons, unknown, lowData, plannedToday, todayLabel, reconcile, negScore, sleepTiming, limiter, readiness, negByCat };
}

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
function sleepTST(s) {
  const tib = s.duration || 0;
  return Math.max(0.5, tib - (s.latencyMin || 0) / 60 - (s.wakeMin || 0) / 60);
}

// Individual sleep need. Override wins; otherwise learn from the user's own
// well-rated, unrestricted nights (median TST). Never assumes 8h as fact.
function estimateSleepNeed(data, goals) {
  const override = parseFloat(goals?.profile?.sleepNeedH);
  if (override > 0) return { hours: Math.max(4, Math.min(12, override)), source: "override", confidence: "set", nGood: 0 };
  const good = (data.sleep || []).filter(s => s && s.date >= daysAgo(59) && /^(Good|Great|Excellent)$/.test(s.quality || ""));
  const tsts = good.map(sleepTST).sort((a, b) => a - b);
  if (tsts.length >= 5) {
    const m = tsts.length >> 1;
    let need = tsts.length % 2 ? tsts[m] : (tsts[m - 1] + tsts[m]) / 2;
    need = Math.max(6, Math.min(9.5, +need.toFixed(1)));
    return { hours: need, source: "learned", confidence: tsts.length >= 10 ? "high" : "moderate", nGood: tsts.length };
  }
  return { hours: 8, source: "default", confidence: "low", nGood: tsts.length };
}

function computeSleep(data, goals) {
  const sleep = (data.sleep || []).filter(s => s && s.date && s.duration != null);
  if (sleep.length === 0) return null;
  const today = getTodayStr();
  const mins = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
  const qScore = { Poor: 1, Fair: 2, Good: 3, Great: 4, Excellent: 5 };
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const fmtClock = m => m == null ? null : `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;

  const need = estimateSleepNeed(data, goals);

  const enrich = s => {
    const bed = mins(s.bedtime), wake = mins(s.wakeTime);
    const tib = s.duration || 0;
    const tst = sleepTST(s);
    const eff = tib > 0 ? Math.round((tst / tib) * 100) : null;
    const mid = bed != null ? (bed + tib * 30) % 1440 : null; // mid-sleep clock minute
    return { date: s.date, tib, tst, eff, latency: s.latencyMin ?? null, waso: s.wakeMin ?? null, quality: s.quality, q: qScore[s.quality] ?? null, bed, wake, mid, hasEff: (s.latencyMin != null || s.wakeMin != null) };
  };
  const sorted = [...sleep].sort((a, b) => a.date.localeCompare(b.date));
  const inWin = n => sorted.filter(s => s.date >= daysAgo(n - 1)).map(enrich);
  const last7 = inWin(7), last14 = inWin(14), last21 = inWin(21);

  // Circular-stats helpers (clock times wrap at midnight)
  const circMean = arr => {
    if (!arr.length) return null;
    let sx = 0, sy = 0; arr.forEach(v => { const a = (v / 1440) * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a); });
    if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return Math.round(arr.reduce((x, y) => x + y, 0) / arr.length);
    let a = Math.atan2(sy, sx); if (a < 0) a += 2 * Math.PI; return Math.round(a / (2 * Math.PI) * 1440) % 1440;
  };
  const circSD = arr => {
    if (arr.length < 2) return null;
    let sx = 0, sy = 0; arr.forEach(v => { const a = (v / 1440) * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a); });
    const R = Math.sqrt(sx * sx + sy * sy) / arr.length;
    if (R <= 0.0001) return 720;
    return Math.round(Math.sqrt(-2 * Math.log(Math.min(1, R))) * 1440 / (2 * Math.PI));
  };
  const circDiff = (a, b) => { if (a == null || b == null) return null; let d = Math.abs(a - b) % 1440; return d > 720 ? 1440 - d : d; };

  // ── AXIS 1 — QUANTITY (vs personal need) ──
  const avgTST7 = last7.length ? +mean(last7.map(r => r.tst)).toFixed(1) : null;
  const avgTST14 = last14.length ? +mean(last14.map(r => r.tst)).toFixed(1) : null;
  const debt7 = +last7.reduce((d, r) => d + (need.hours - r.tst), 0).toFixed(1); // net vs need
  let qStatus = "good", qLabel = "On target";
  if (avgTST7 != null) {
    const gap = avgTST7 - need.hours;
    if (gap <= -1.5) { qStatus = "bad"; qLabel = "Significantly short"; }
    else if (gap <= -0.5) { qStatus = "warn"; qLabel = "Running short"; }
    else if (gap >= 1.2) { qStatus = "warn"; qLabel = "Oversleeping"; }
  }

  // ── AXIS 2 — TIMING / REGULARITY ──
  const midVals = last14.map(r => r.mid).filter(v => v != null);
  const wakeVals = last14.map(r => r.wake).filter(v => v != null);
  const midSD = circSD(midVals);
  const wakeSD = circSD(wakeVals);
  let rStatus = null, rLabel = null;
  if (midSD != null) {
    if (midSD <= 30) { rStatus = "good"; rLabel = "Very regular"; }
    else if (midSD <= 60) { rStatus = "good"; rLabel = "Fairly regular"; }
    else if (midSD <= 90) { rStatus = "warn"; rLabel = "Irregular"; }
    else { rStatus = "bad"; rLabel = "Highly irregular"; }
  }
  const isWknd = ds => { const wd = new Date(ds + "T00:00:00").getDay(); return wd === 0 || wd === 6; };
  const wkdayMid = last21.filter(r => r.mid != null && !isWknd(r.date)).map(r => r.mid);
  const wkendMid = last21.filter(r => r.mid != null && isWknd(r.date)).map(r => r.mid);
  let socialJetlag = null;
  if (wkdayMid.length >= 2 && wkendMid.length >= 1) socialJetlag = +(circDiff(circMean(wkendMid), circMean(wkdayMid)) / 60).toFixed(1);
  const anchorWakeMin = wakeVals.length ? circMean(wakeVals) : null;
  const typLatency = (() => { const ls = last14.map(r => r.latency).filter(v => v != null); return ls.length ? median(ls) : 15; })();
  const bedTargetMin = anchorWakeMin != null ? ((anchorWakeMin - Math.round(need.hours * 60) - typLatency) % 1440 + 1440) % 1440 : null;

  // ── AXIS 3 — CONTINUITY / QUALITY ──
  const effNights = last14.filter(r => r.hasEff);
  const avgEff = effNights.length ? Math.round(mean(effNights.map(r => r.eff))) : null;
  const avgLatency = (() => { const v = last14.map(r => r.latency).filter(x => x != null); return v.length ? Math.round(mean(v)) : null; })();
  const avgWaso = (() => { const v = last14.map(r => r.waso).filter(x => x != null); return v.length ? Math.round(mean(v)) : null; })();
  const q7 = last7.map(r => r.q).filter(v => v != null);
  const qOlder = last14.filter(r => r.date < daysAgo(6)).map(r => r.q).filter(v => v != null);
  const avgQ7 = q7.length ? +mean(q7).toFixed(1) : null;
  const qualityTrend = (avgQ7 != null && qOlder.length) ? +(avgQ7 - mean(qOlder)).toFixed(1) : null;
  // Unrefreshing sleep: adequate duration but consistently poor quality — the
  // single highest-leverage screening signal (possible OSA / fragmentation).
  const unrefreshNights = last14.filter(r => r.q != null && r.q <= 2 && r.tst >= need.hours - 0.5);
  const unrefreshing = last14.length >= 5 && unrefreshNights.length >= 3 && (unrefreshNights.length / last14.length) >= 0.4;
  let cStatus = null, cLabel = null;
  if (avgEff != null) {
    if (avgEff >= 90) { cStatus = "good"; cLabel = "Solid & consolidated"; }
    else if (avgEff >= 85) { cStatus = "warn"; cLabel = "Slightly fragmented"; }
    else { cStatus = "bad"; cLabel = "Fragmented / inefficient"; }
  } else if (avgQ7 != null) {
    if (avgQ7 >= 3.5) { cStatus = "good"; cLabel = "Feels restful"; }
    else if (avgQ7 >= 2.5) { cStatus = "warn"; cLabel = "Mediocre quality"; }
    else { cStatus = "bad"; cLabel = "Poor quality"; }
  }
  if (unrefreshing && cStatus !== "bad") { cStatus = "warn"; cLabel = "Unrefreshing"; }

  // ── COUPLING — sleep × the rest of the body (their own data only) ──
  const coupling = [];
  // 1) Partitioning: short sleep in a deficit burns muscle, not fat.
  const wt = computeWeightTrend(data);
  const phase = (goals?.strategy?.phase || "").toLowerCase();
  const goal = (goals?.goal || "").toLowerCase();
  const cutting = /cut|deficit|fat/.test(phase) || goal.includes("fat") || goal.includes("lose") || (wt && wt.confidence !== "Low" && wt.pctBWPerWeek != null && wt.pctBWPerWeek <= -0.3);
  if (cutting && avgTST7 != null && avgTST7 < need.hours - 0.8) {
    coupling.push({ key: "partitioning", severity: "critical", text: `You're in a deficit and averaging ${avgTST7}h (need ~${need.hours}h). At matched calories, short sleep makes more of your loss come from muscle, not fat — the scale moves the same, the mirror doesn't. Protecting sleep is your strongest muscle-retention lever while cutting.` });
  }
  // 2) RPE inflation: under-slept loads feel harder; you quietly cut volume.
  const rpe7 = last7.length ? (() => {
    const v = (data.exercise || []).filter(e => e.date >= daysAgo(6)).map(e => (e._parsed || parseWorkout(e.text || "")).avgRPE).filter(x => x != null);
    return v.length ? +mean(v).toFixed(1) : null;
  })() : null;
  if (rpe7 != null && rpe7 >= 8 && debt7 >= 3) {
    coupling.push({ key: "rpe", severity: "important", text: `Sessions are feeling hard (avg RPE ${rpe7}) and you're carrying ~${debt7}h of sleep debt. That's central fatigue inflating perceived effort — not lost strength. Hold your planned load; don't auto-cut volume.` });
  }
  // 3) APPETITE TAX — sleep → eating (Tasali 2022: sleep loss drives reward-seeking
  // intake; mechanism is hedonic/endocannabinoid + more waking hours, NOT leptin/ghrelin
  // which the evidence downgrades). We never estimate hormones — we measure the four
  // behavioural fingerprints in the user's OWN logs: total kcal, eating occasions
  // (snacking), late-night calories, and protein share (a proxy for drifting toward
  // calorie-dense food). Same-day alignment: a night's short sleep shapes THAT day's eating.
  let appetite = null;
  {
    const dietByDate = {};
    (data.diet || []).forEach(d => { if (!d.date) return; (dietByDate[d.date] = dietByDate[d.date] || []).push(d); });
    const win = sorted.filter(s => s.date >= daysAgo(29)).map(enrich);
    const lateMin = 21 * 60; // 9pm
    const dayMetrics = r => {
      const ents = dietByDate[r.date];
      if (!ents || !ents.length) return null;
      const kcal = ents.reduce((a, e) => a + (e.calories || 0), 0);
      if (kcal <= 0) return null;
      const protein = ents.reduce((a, e) => a + (e.protein || 0), 0);
      const occasions = clusterFeedings(ents).length;
      const lateKcal = ents.filter(e => { const m = mins(e.time); return m != null && m >= lateMin; }).reduce((a, e) => a + (e.calories || 0), 0);
      return { kcal, occasions, lateKcal, pShare: (protein * 4 / kcal) * 100 };
    };
    const shortM = win.filter(r => r.tst < need.hours - 1).map(dayMetrics).filter(Boolean);
    const okM = win.filter(r => r.tst >= need.hours - 0.5).map(dayMetrics).filter(Boolean);
    if (shortM.length >= 3 && okM.length >= 3) {
      const avg = (arr, k) => mean(arr.map(x => x[k]).filter(v => v != null));
      const kcalDelta = Math.round(avg(shortM, "kcal") - avg(okM, "kcal"));
      const occDelta = +(avg(shortM, "occasions") - avg(okM, "occasions")).toFixed(1);
      const lateDelta = Math.round(avg(shortM, "lateKcal") - avg(okM, "lateKcal"));
      const ps = avg(shortM, "pShare"), po = avg(okM, "pShare");
      const pShareDrop = (ps != null && po != null) ? +(po - ps).toFixed(1) : null;
      const n = Math.min(shortM.length, okM.length);
      const confidence = n >= 6 ? "High" : n >= 4 ? "Moderate" : "Low";
      // Population expectation says intake rises — but defer to THEIR reality.
      const responder = kcalDelta >= 120 || lateDelta >= 100 || (pShareDrop != null && pShareDrop >= 4);
      const ph = (/cut|deficit|fat/.test(phase) || goal.includes("fat") || goal.includes("lose")) ? "cut"
               : (/bulk|surplus|gain/.test(phase) || goal.includes("muscle")) ? "bulk" : "maintain";
      appetite = { shortDays: shortM.length, okDays: okM.length, kcalDelta, occDelta, lateDelta, pShareDrop, responder, phase: ph, confidence };

      // Surface it only when the user's OWN data shows the pattern (responder).
      // Behavioural readout, externalised, never a restriction instruction.
      if (responder) {
        const bits = [];
        if (kcalDelta >= 120) bits.push(`+${kcalDelta} kcal`);
        if (occDelta >= 0.7) bits.push(`~${occDelta} more eating occasion${occDelta >= 1.5 ? "s" : ""}`);
        if (lateDelta >= 100) bits.push(`+${lateDelta} kcal after 9pm`);
        if (pShareDrop != null && pShareDrop >= 3) bits.push(`protein share down ~${pShareDrop}pts`);
        const hasPart = coupling.some(c => c.key === "partitioning");
        let tail, sev;
        if (ph === "cut") {
          tail = ` On a cut this is where the deficit quietly leaks${hasPart ? ", same root cause as the muscle-loss risk above" : ""} — the lever is upstream: protect sleep, and pre-plan tomorrow's food after a bad night rather than fighting it in the moment.`;
          sev = "important";
        } else if (ph === "bulk") {
          tail = ` In a surplus that's a mild tailwind for hitting calories — just steer the extra toward protein and whole food, not late snacks.`;
          sev = "notable";
        } else {
          tail = ` Pre-planning meals after a short night beats white-knuckling it in the moment.`;
          sev = "notable";
        }
        const caveat = confidence === "Low" ? " (early read — only a few matched days so far)" : "";
        coupling.push({ key: "appetite", severity: sev, text: `On your short-sleep days your eating shifts — ${bits.join(", ")} vs well-slept days${caveat}. That's the sleep→appetite drive (reward-seeking, not willpower).${tail}` });
      }
    }
  }
  // 4) Mood: poor sleep preceding low journal sentiment.
  const fatigueRe = /\b(exhausted|drained|run down|rundown|burnt out|burned out|wrecked|tired|no energy|low|down|stressed|anxious|irritable|foggy)\b/i;
  const poorThenLow = last14.filter(r => (r.q != null && r.q <= 2) || r.tst < need.hours - 1.5).filter(r => {
    const next = daysAgoFrom(r.date, -1);
    return (data.journal || []).some(j => (j.date === r.date || j.date === next) && fatigueRe.test(j.text || ""));
  });
  if (poorThenLow.length >= 2) {
    coupling.push({ key: "mood", severity: "notable", text: `Your rougher nights tend to line up with lower-mood journal entries the next day. Sleep is upstream of mood as often as the reverse — protecting it may lift how you feel, not just how you train.` });
  }

  // ── INSIGHTS + biggest lever ──
  const insights = [];
  const push = (text, priority, axis) => insights.push({ text, priority, axis });
  if (qStatus === "bad") push(`Averaging ${avgTST7}h vs your ~${need.hours}h need — a real shortfall that drags recovery, partitioning and mood.`, "critical", "quantity");
  else if (qStatus === "warn" && qLabel === "Running short") push(`Running ~${(need.hours - avgTST7).toFixed(1)}h short of your ${need.hours}h need most nights — close the gap before adding training load.`, "important", "quantity");
  if (rStatus === "bad" || (wakeSD != null && wakeSD > 75)) push(`Your wake time swings ~${Math.round((wakeSD ?? midSD) / 60 * 10) / 10}h night to night. Anchoring a fixed wake time (even weekends) is higher-leverage than adding hours.`, "important", "regularity");
  else if (rStatus === "warn") push(`Sleep timing is a bit irregular (mid-sleep varies ~${midSD}min). Tightening it stabilises your whole circadian system.`, "notable", "regularity");
  if (socialJetlag != null && socialJetlag >= 1.5) push(`Social jetlag ~${socialJetlag}h (weekend vs weekday) — like a mild self-inflicted timezone shift every week. Pull weekend timing closer to weekdays.`, "notable", "regularity");
  if (unrefreshing) push(`You're logging enough hours but rating sleep poor on ${unrefreshNights.length} of ${last14.length} recent nights. Persistent unrefreshing sleep is the top signal worth raising with a clinician (e.g. screening for sleep apnea) — it can't be fixed by hygiene alone.`, "important", "continuity");
  if (avgEff != null && avgEff < 85) push(`Sleep efficiency ~${avgEff}% (asleep ÷ in bed). Below ~85% usually means too much time in bed or fragmentation — spending less time in bed often consolidates it.`, "important", "continuity");
  else if (avgLatency != null && avgLatency > 30) push(`Taking ~${avgLatency}min to fall asleep on average — long onset points to going to bed before you're sleepy or evening arousal.`, "notable", "continuity");
  coupling.forEach(c => push(c.text, c.severity === "critical" ? "critical" : c.severity === "important" ? "important" : "notable", "coupling"));
  if (qLabel === "Oversleeping" && qStatus === "warn") push(`Averaging ${avgTST7}h, above your ~${need.hours}h need. Long sleep is often a symptom (illness, low mood, debt repayment) rather than a goal — worth noting if it's new.`, "notable", "quantity");

  const order = { critical: 0, important: 1, notable: 2 };
  const ranked = [...insights].sort((a, b) => order[a.priority] - order[b.priority]);
  const topLever = ranked[0] || null;

  // ── Tonight read + sparkline series ──
  const todayRec = last7.find(r => r.date === today) || null;
  const series14 = sorted.filter(s => s.date >= daysAgo(13)).map(s => { const e = enrich(s); return e; });
  const tstSeries = Array.from({ length: 14 }, (_, i) => { const d = daysAgo(13 - i); const r = series14.find(x => x.date === d); return { value: r ? +r.tst.toFixed(1) : null, label: d }; });
  const qSeries = Array.from({ length: 14 }, (_, i) => { const d = daysAgo(13 - i); const r = series14.find(x => x.date === d); return { value: r ? r.q : null, label: d }; });

  // Overall confidence from how much is logged
  let confidence = "Low";
  if (sleep.length >= 7) confidence = "Moderate";
  if (sleep.length >= 14 && midVals.length >= 7) confidence = "High";

  return {
    need, nightsLogged: sleep.length, confidence,
    quantity: { avgTST7, avgTST14, need: need.hours, debt7, status: qStatus, label: qLabel, loggedNights7: last7.length },
    regularity: { midSD, wakeSD, socialJetlag, status: rStatus, label: rLabel, anchorWake: fmtClock(anchorWakeMin), bedTarget: fmtClock(bedTargetMin) },
    continuity: { avgEff, avgLatency, avgWaso, qualityTrend, unrefreshing, unrefreshCount: unrefreshNights.length, recentNights: last14.length, status: cStatus, label: cLabel, hasEffData: effNights.length > 0 },
    coupling, insights, topLever, appetite,
    today: todayRec ? { tst: +todayRec.tst.toFixed(1), eff: todayRec.eff, quality: todayRec.quality } : null,
    series: { tst: tstSeries, quality: qSeries },
  };
}

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
function insightCategory(text) {
  const t = (text || "").toLowerCase();
  if (/sleep|bedtime|rested|circadian|awake|deload|overtrain/.test(t)) return "sleep/recovery";
  if (/protein|mps|feeding|leucine/.test(t)) return "protein";
  if (/carb|glycogen/.test(t)) return "carbs";
  if (/trend weight|%bw|lean-gain|gaining fast|losing fast|surplus|deficit|maintenance|calorie|kcal|under-eat|fuel/.test(t)) return "energy/weight";
  if (/volume|rpe|days in a row|days straight|training/.test(t)) return "training";
  if (/hydration|water/.test(t)) return "hydration";
  return "other";
}

function prioritizeInsights(insights) {
  const impactByPriority = { critical: 100, important: 60, notable: 30 };
  const actionCue = /\b(shift|add|move|consider|recheck|aim|spread|reduce|increase|swap|deload|smaller|protect|raise|cut|keep|prioriti|eat)\b/i;
  const scored = (insights || []).map((ins, idx) => {
    let score = impactByPriority[ins.priority] ?? 20;
    if (ins.text.includes("—") || ins.text.includes(" - ")) score += 8; // embeds a "what to do"
    if (actionCue.test(ins.text)) score += 7;
    return { ...ins, category: insightCategory(ins.text), score, _idx: idx };
  });
  const ranked = scored.slice().sort((a, b) => b.score - a.score || a._idx - b._idx);
  // headline focus: highest-scored per category, up to 5 (keeps the top list diverse)
  const seen = new Set();
  const top = [];
  for (const i of ranked) {
    if (seen.has(i.category)) continue;
    seen.add(i.category);
    top.push(i);
    if (top.length >= 5) break;
  }
  return { ranked, top };
}

function buildBrain(data, goals) {
  const now = new Date();
  const today = getTodayStr();
  const yesterday = daysAgo(1);
  const todayName = WEEKDAYS[(now.getDay() + 6) % 7];
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeNow = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const timeOfDay = hour < 5 ? "late night" : hour < 11 ? "morning" : hour < 14 ? "midday" : hour < 18 ? "afternoon" : hour < 22 ? "evening" : "night";
  const isWeekend = todayName === "Sat" || todayName === "Sun";

  // ── Time windows
  const inWindow = (arr, days) => arr.filter(i => i.date >= daysAgo(days - 1));
  const last7 = a => inWindow(a, 7);
  const last14 = a => inWindow(a, 14);
  const last30 = a => inWindow(a, 30);

  // Helper: parse HH:MM into minutes since midnight, or null
  const minsOf = t => { if (!t) return null; const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? +m[1] * 60 + +m[2] : null; };

  // ── TODAY: nutrition + intake so far
  const todayDiet = data.diet.filter(d => d.date === today);
  const todayCal = todayDiet.reduce((a, m) => a + (m.calories || 0), 0);
  const todayP = todayDiet.reduce((a, m) => a + (m.protein || 0), 0);
  const todayC = todayDiet.reduce((a, m) => a + (m.carbs || 0), 0);
  const todayF = todayDiet.reduce((a, m) => a + (m.fat || 0), 0);
  const calRemaining = (goals.calories || 0) - todayCal;
  const pRemaining = (goals.protein || 0) - todayP;
  const cRemaining = (goals.carbs || 0) - todayC;
  const fRemaining = (goals.fat || 0) - todayF;
  const todayWaterMl = data.water.filter(w => w.date === today).reduce((a, w) => a + w.ml, 0);
  const waterRemainingMl = (goals.waterGoalMl || 0) - todayWaterMl;
  const todaySupps = data.supplements.filter(s => s.date === today);
  const todaySleep = data.sleep.find(s => s.date === today);
  const yestSleep = data.sleep.find(s => s.date === yesterday);
  const todayWorkout = data.exercise.find(e => e.date === today);
  const todaySport = data.sports.find(s => s.date === today);

  // Time since last meal
  const todayMealsWithTime = todayDiet.filter(m => m.time).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const lastMealTime = todayMealsWithTime.length ? todayMealsWithTime[todayMealsWithTime.length - 1].time : null;
  const hoursSinceLastMeal = (() => {
    if (!lastMealTime) return null;
    const m = minsOf(lastMealTime);
    const nowMins = hour * 60 + minute;
    const diff = nowMins - m;
    return diff >= 0 ? +(diff / 60).toFixed(1) : null;
  })();

  // ── PLAN
  const plan = goals.plan || null;
  const isTrainingDay = plan?.trainingDays?.includes(todayName) || false;
  const todayPlanLabel = plan?.assignments?.[todayName] || (isTrainingDay ? "Training day" : "Rest day");
  const tomorrowName = WEEKDAYS[(now.getDay() + 7) % 7];
  const tomorrowPlanLabel = plan?.assignments?.[tomorrowName] || (plan?.trainingDays?.includes(tomorrowName) ? "Training" : "Rest");

  // ── DAILY TIMELINES — chronological event list per day (last 7 days)
  // This is the heart of "mapping everything out." Each day becomes a sequence:
  //   08:15 Breakfast 450kcal P25g | 10:30 Workout (Push) | 13:00 Lunch 700kcal | ...
  function buildTimeline(date) {
    const events = [];
    data.diet.filter(d => d.date === date).forEach(m => events.push({ t: m.time || "??:??", kind: "meal", text: `${m.meal} ${m.calories}kcal P${m.protein}g`, sortKey: minsOf(m.time) ?? 9999 }));
    data.exercise.filter(e => e.date === date).forEach(e => {
      const p = e._parsed || parseWorkout(e.text || "");
      events.push({ t: e.time || "??:??", kind: "workout", text: `Workout: ${e.label}${p.totalVolume ? ` (${p.totalVolume}kg vol)` : ""}${e.prs?.length ? ` 🏆${e.prs.length}` : ""}`, sortKey: minsOf(e.time) ?? 9999 });
    });
    data.sports.filter(s => s.date === date).forEach(s => events.push({ t: s.time || "??:??", kind: "sport", text: `${s.sport} ${s.duration}min ${s.intensity}${s.calories ? ` ${s.calories}kcal` : ""}`, sortKey: minsOf(s.time) ?? 9999 }));
    data.water.filter(w => w.date === date).forEach(w => {
      const t = w.ts ? new Date(w.ts) : null;
      const ts = t ? `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}` : "??:??";
      events.push({ t: ts, kind: "water", text: `Water ${w.ml}ml`, sortKey: t ? t.getHours() * 60 + t.getMinutes() : 9999 });
    });
    data.supplements.filter(s => s.date === date).forEach(s => {
      const t = s.ts ? new Date(s.ts) : null;
      const ts = t ? `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}` : "??:??";
      events.push({ t: ts, kind: "supp", text: `Supp: ${s.name}${s.dose ? ` ${s.dose}` : ""}`, sortKey: t ? t.getHours() * 60 + t.getMinutes() : 9999 });
    });
    const slp = data.sleep.find(s => s.date === date);
    if (slp) events.push({ t: slp.bedtime || "??:??", kind: "sleep", text: `Slept ${slp.duration}h (${slp.quality}) until ${slp.wakeTime || "?"}`, sortKey: 0 });
    return events.sort((a, b) => a.sortKey - b.sortKey);
  }

  // Aggregate water by day for compactness, since dozens of entries would bloat the timeline
  function compactTimeline(events) {
    const waters = events.filter(e => e.kind === "water");
    const totalWater = waters.reduce((a, e) => { const m = /Water (\d+)ml/.exec(e.text); return a + (m ? +m[1] : 0); }, 0);
    const out = events.filter(e => e.kind !== "water");
    if (totalWater > 0) out.push({ t: "—", kind: "water", text: `Total water ${totalWater}ml`, sortKey: 9999 });
    return out;
  }

  const timelines = Array.from({ length: 7 }, (_, i) => {
    const d = daysAgo(6 - i);
    const events = compactTimeline(buildTimeline(d));
    return { date: d, dayName: WEEKDAYS[(new Date(d + "T00:00:00").getDay() + 6) % 7], events };
  });

  // ── 7-DAY NUTRITION
  const last7Diet = last7(data.diet);
  const dietByDay7 = {};
  last7Diet.forEach(d => {
    if (!dietByDay7[d.date]) dietByDay7[d.date] = { cal: 0, p: 0, c: 0, f: 0, meals: 0, firstMeal: null, lastMeal: null };
    const day = dietByDay7[d.date];
    day.cal += d.calories || 0;
    day.p += d.protein || 0;
    day.c += d.carbs || 0;
    day.f += d.fat || 0;
    day.meals++;
    if (d.time) {
      if (!day.firstMeal || d.time < day.firstMeal) day.firstMeal = d.time;
      if (!day.lastMeal || d.time > day.lastMeal) day.lastMeal = d.time;
    }
  });
  const dietDays7 = Object.values(dietByDay7);
  const avgCal7 = dietDays7.length ? Math.round(dietDays7.reduce((a, d) => a + d.cal, 0) / dietDays7.length) : null;
  const avgP7 = dietDays7.length ? Math.round(dietDays7.reduce((a, d) => a + d.p, 0) / dietDays7.length) : null;
  const proteinHits7 = dietDays7.filter(d => d.p >= (goals.protein || 0)).length;
  const calDeficit7 = avgCal7 != null ? (goals.calories || 0) - avgCal7 : null;
  // Average first/last meal times across the week
  const firstMealTimes = dietDays7.map(d => d.firstMeal).filter(Boolean);
  const lastMealTimes = dietDays7.map(d => d.lastMeal).filter(Boolean);
  const avgFirstMeal = firstMealTimes.length ? avgTimeHHMM(firstMealTimes) : null;
  const avgLastMeal = lastMealTimes.length ? avgTimeHHMM(lastMealTimes) : null;

  // ── 14-day calorie trend (rising/falling)
  const last14Diet = last14(data.diet);
  const trendBucket = (start, end) => {
    const days = {};
    last14Diet.filter(d => d.date >= start && d.date <= end).forEach(d => { days[d.date] = (days[d.date] || 0) + (d.calories || 0); });
    const vs = Object.values(days);
    return vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) : null;
  };
  const recentHalf = trendBucket(daysAgo(6), today);
  const olderHalf = trendBucket(daysAgo(13), daysAgo(7));
  const calorieTrend = (recentHalf && olderHalf) ? (recentHalf - olderHalf) : null;

  // ── SLEEP
  const sleepIntel = computeSleep(data, goals);
  const sleepNeed = (sleepIntel?.need?.hours) ?? estimateSleepNeed(data, goals).hours;
  const last7Sleep = last7(data.sleep);
  const avgSleep7 = last7Sleep.length ? +(last7Sleep.reduce((a, s) => a + s.duration, 0) / last7Sleep.length).toFixed(1) : null;
  const sleepDebt7 = last7Sleep.reduce((d, s) => d + (sleepNeed - sleepTST(s)), 0);
  const sleepPatternIssue = last7Sleep.length >= 3 && avgSleep7 != null && avgSleep7 < sleepNeed - 0.5;
  // Average bedtime / wake time across the week
  const bedtimes = last7Sleep.map(s => s.bedtime).filter(Boolean);
  const wakeTimes = last7Sleep.map(s => s.wakeTime).filter(Boolean);
  const avgBedtime = bedtimes.length ? avgTimeHHMM(bedtimes, true) : null;
  const avgWakeTime = wakeTimes.length ? avgTimeHHMM(wakeTimes) : null;
  // Weekend vs weekday sleep gap
  const weekdaySleeps = last7Sleep.filter(s => { const wd = WEEKDAYS[(new Date(s.date + "T00:00:00").getDay() + 6) % 7]; return wd !== "Sat" && wd !== "Sun"; });
  const weekendSleeps = last7Sleep.filter(s => { const wd = WEEKDAYS[(new Date(s.date + "T00:00:00").getDay() + 6) % 7]; return wd === "Sat" || wd === "Sun"; });
  const wkdayAvgSleep = weekdaySleeps.length ? +(weekdaySleeps.reduce((a, s) => a + s.duration, 0) / weekdaySleeps.length).toFixed(1) : null;
  const wkendAvgSleep = weekendSleeps.length ? +(weekendSleeps.reduce((a, s) => a + s.duration, 0) / weekendSleeps.length).toFixed(1) : null;

  // ── TRAINING
  const last7Lifts = last7(data.exercise);
  const last7Sports = last7(data.sports);
  const last14Lifts = last14(data.exercise);
  const last7TotalSessions = last7Lifts.length + last7Sports.length;
  const volume7 = last7Lifts.reduce((sum, e) => sum + ((e._parsed || parseWorkout(e.text || "")).totalVolume || 0), 0);
  const volume7_olderHalf = inWindow(data.exercise, 14).filter(e => e.date < daysAgo(6)).reduce((sum, e) => sum + ((e._parsed || parseWorkout(e.text || "")).totalVolume || 0), 0);
  const volumeTrend = (volume7 && volume7_olderHalf) ? volume7 - volume7_olderHalf : null;
  // Average session RPE over last 7 days (from parsed Strong RPE), if logged
  const rpe7vals = last7Lifts.map(e => (e._parsed || parseWorkout(e.text || "")).avgRPE).filter(v => v != null);
  const avgRPE7 = rpe7vals.length ? +(rpe7vals.reduce((a, b) => a + b, 0) / rpe7vals.length).toFixed(1) : null;
  const trainingDates = new Set([...data.exercise.map(e => e.date), ...data.sports.map(s => s.date)]);
  let consecutiveTrained = 0;
  {
    let cur = new Date(); if (!trainingDates.has(getTodayStr())) cur.setDate(cur.getDate() - 1);
    for (;;) { const ds = localDateStr(cur); if (trainingDates.has(ds)) { consecutiveTrained++; cur.setDate(cur.getDate() - 1); } else break; }
  }
  const daysSinceLastRest = (() => {
    let c = 0; const cur = new Date();
    for (let i = 0; i < 14; i++) {
      const ds = localDateStr(cur);
      if (trainingDates.has(ds)) c++; else return c;
      cur.setDate(cur.getDate() - 1);
    }
    return c;
  })();
  const recentPRs = last14Lifts.flatMap(e => (e.prs || []).map(pr => ({ date: e.date, ...pr }))).slice(0, 5);

  // ── WATER PATTERNS
  const last7Water = last7(data.water);
  const waterByDay7 = {};
  last7Water.forEach(w => { waterByDay7[w.date] = (waterByDay7[w.date] || 0) + w.ml; });
  const avgWaterMl7 = Object.values(waterByDay7).length ? Math.round(Object.values(waterByDay7).reduce((a, b) => a + b, 0) / Object.values(waterByDay7).length) : null;

  // ── STREAK
  const dayHas = {};
  [...data.diet, ...data.sleep, ...data.exercise, ...data.sports, ...data.water, ...data.supplements].forEach(e => { if (e.date) dayHas[e.date] = true; });
  let streak = 0;
  {
    let cur = new Date(); if (!dayHas[getTodayStr()]) cur.setDate(cur.getDate() - 1);
    for (;;) { const ds = localDateStr(cur); if (dayHas[ds]) { streak++; cur.setDate(cur.getDate() - 1); } else break; }
  }

  // ── CROSS-CATEGORY PATTERNS
  // Sleep-on-training-day vs rest-day
  const trainNightSleep = last7Sleep.filter(s => trainingDates.has(s.date));
  const restNightSleep = last7Sleep.filter(s => !trainingDates.has(s.date));
  const trainNightAvg = trainNightSleep.length ? +(trainNightSleep.reduce((a, s) => a + s.duration, 0) / trainNightSleep.length).toFixed(1) : null;
  const restNightAvg = restNightSleep.length ? +(restNightSleep.reduce((a, s) => a + s.duration, 0) / restNightSleep.length).toFixed(1) : null;

  // ── WEIGHT TREND (A1 engine)
  const weightTrend = computeWeightTrend(data);

  // ── PROTEIN DISTRIBUTION / MPS (B1 engine)
  const proteinDist = computeProteinDistribution(data, goals);

  // ── RECOVERY (D1 engine — now fed to the Coach, not just the Plan card)
  const recovery = computeRecovery(data, goals);

  // ── ENERGY BALANCE / ADAPTIVE TDEE
  const energy = computeEnergyBalance(data, goals);

  // ── TRAINING INTELLIGENCE (per-lift progression + per-muscle volume)
  const training = computeTraining(data, goals);

  // ── EJAC (private metric — neutral data only, NO insights/judgments generated)
  const ejacAll = data.ejac || [];
  const ejac30 = ejacAll.filter(e => e.date >= daysAgo(29));
  const ejacSummary = ejacAll.length ? {
    last7: ejacAll.filter(e => e.date >= daysAgo(6)).length,
    last30: ejac30.length,
    avgPerDay30: +(ejac30.length / 30).toFixed(2),
    pornPct30: ejac30.length ? Math.round(ejac30.filter(e => e.porn).length / ejac30.length * 100) : 0,
    goonPct30: ejac30.length ? Math.round(ejac30.filter(e => e.gooning).length / ejac30.length * 100) : 0,
  } : null;

  // ── DERIVED INSIGHTS — high-signal flags
  // Insights are now { text, priority: "critical" | "important" | "notable" }
  // Critical = recovery is at risk or strategy is broken; Important = clear pattern worth acting on;
  // Notable = mention only if the user's question is in that area.
  const insights = [];
  const wins = []; // things going well — used to reinforce positive behavior

  // --- CRITICAL: recovery / safety / strategy breaks ---
  if (consecutiveTrained >= 5) insights.push({ text: `Trained ${consecutiveTrained} days in a row with no rest — overtraining risk, deload strongly suggested`, priority: "critical" });
  else if (consecutiveTrained >= 4) insights.push({ text: `Trained ${consecutiveTrained} days in a row with no rest — deload signal`, priority: "important" });
  if (sleepDebt7 > 8) insights.push({ text: `Sleep debt accumulating fast: ${sleepDebt7.toFixed(1)}h short over last week — recovery compromised`, priority: "critical" });
  else if (sleepDebt7 > 5) insights.push({ text: `Sleep debt: ${sleepDebt7.toFixed(1)}h short over last week`, priority: "important" });
  if (sleepPatternIssue) insights.push({ text: `Avg sleep ${avgSleep7}h is below your ~${sleepNeed}h need — recovery limiter`, priority: avgSleep7 < sleepNeed - 1.5 ? "critical" : "important" });
  // Sleep Intelligence Engine — fold in the NEW dimensions (regularity, continuity,
  // disorder screening, cross-domain coupling) that the legacy sleep insights above
  // don't cover. Quantity is already handled above, so skip those to avoid dupes.
  if (sleepIntel) {
    sleepIntel.insights.filter(i => i.axis !== "quantity").forEach(i => insights.push({ text: i.text, priority: i.priority }));
  }
  // Adaptive TDEE / energy-balance insights (real maintenance, deficit/surplus, plateau, under-logging)
  if (energy && energy.ready) energy.insights.forEach(i => insights.push(i));
  // Training intelligence insights (stalls, neglected muscles, imbalances, progress)
  if (training) training.insights.forEach(i => insights.push(i));

  // --- IMPORTANT: nutrition and trend issues ---
  if (calDeficit7 != null && Math.abs(calDeficit7) > 400) {
    insights.push({ text: `7-day avg calories ${avgCal7} is ${Math.abs(calDeficit7)}kcal ${calDeficit7 > 0 ? "BELOW" : "ABOVE"} target — large gap from plan`, priority: "important" });
  } else if (calDeficit7 != null && Math.abs(calDeficit7) > 200) {
    insights.push({ text: `7-day avg calories ${avgCal7} is ${Math.abs(calDeficit7)}kcal ${calDeficit7 > 0 ? "below" : "above"} target`, priority: "notable" });
  }
  if (avgP7 != null && goals.protein && avgP7 < goals.protein * 0.75) {
    insights.push({ text: `Protein well below target: ${avgP7}g avg vs ${goals.protein}g target (${proteinHits7}/${dietDays7.length} days hit goal)`, priority: "important" });
  } else if (avgP7 != null && goals.protein && avgP7 < goals.protein * 0.85) {
    insights.push({ text: `Protein consistently a bit low: ${avgP7}g avg vs ${goals.protein}g target`, priority: "notable" });
  }
  if (calorieTrend != null && Math.abs(calorieTrend) > 300) {
    insights.push({ text: `Calorie intake ${calorieTrend > 0 ? "rising" : "falling"} sharply: ${calorieTrend > 0 ? "+" : ""}${calorieTrend}kcal/day vs prev week`, priority: "important" });
  }
  if (volumeTrend != null && Math.abs(volumeTrend) > 2000) {
    insights.push({ text: `Training volume ${volumeTrend > 0 ? "UP" : "DOWN"} ${Math.round(Math.abs(volumeTrend)).toLocaleString()}kg vs previous week`, priority: "important" });
  }
  if (last7TotalSessions === 0 && plan?.trainingDays?.length) {
    insights.push({ text: `No training in 7 days despite ${plan.trainingDays.length}-day/week plan`, priority: "important" });
  }
  if (avgWaterMl7 != null && goals.waterGoalMl && avgWaterMl7 < goals.waterGoalMl * 0.6) {
    insights.push({ text: `Hydration low: avg ${avgWaterMl7}ml/day vs ${goals.waterGoalMl}ml target`, priority: "important" });
  }

  // --- weight trend vs intent (only once there's enough signal) ---
  if (weightTrend && weightTrend.confidence !== "Low" && weightTrend.ratePerWeekG != null) {
    const pct = weightTrend.pctBWPerWeek;
    const goalLower = (goals.goal || "").toLowerCase();
    const phase = (goals.strategy?.phase || "").toLowerCase();
    const wantGain = goalLower.includes("muscle") || /bulk|surplus|gain/.test(phase);
    const wantLose = goalLower.includes("fat") || goalLower.includes("lose") || /cut|deficit/.test(phase);
    const rateStr = `${weightTrend.ratePerWeekG > 0 ? "+" : ""}${weightTrend.ratePerWeekG}g/wk`;
    if (wantGain && weightTrend.direction !== "gaining") {
      insights.push({ text: `Goal is to build muscle but trend weight is ${weightTrend.direction} (${rateStr}) — not the surplus the plan assumes; recheck intake vs true maintenance`, priority: "important" });
    } else if (wantLose && weightTrend.direction !== "losing") {
      insights.push({ text: `Goal is fat loss but trend weight is ${weightTrend.direction} (${rateStr}) — the intended deficit isn't translating to weight change`, priority: "important" });
    }
    if (pct != null && pct > 1.0) insights.push({ text: `Gaining fast: trend +${pct}%BW/wk, above the ~0.25–0.5%/wk lean-gain range — more of this is likely fat than muscle`, priority: "notable" });
    if (pct != null && pct < -1.2) insights.push({ text: `Losing fast: trend ${pct}%BW/wk — aggressive enough to risk muscle loss; a smaller deficit may protect lean mass`, priority: "notable" });
  }

  // --- protein distribution / MPS (B1 — no new data needed) ---
  if (proteinDist && proteinDist.confidence !== "Low") {
    const pd = proteinDist;
    const hittingTotal = pd.proteinGoal && pd.avgProtein >= pd.proteinGoal * 0.9;
    if (hittingTotal && pd.avgEffective < 3) {
      insights.push({ text: `Protein TOTAL is on point (${pd.avgProtein}g/day) but distribution isn't: only ${pd.avgEffective} of your meals/day cross the ~${pd.perMeal}g MPS threshold (aim 3–5). Same protein, more growth stimulus if you shift some earlier.`, priority: "important" });
    } else if (pd.avgEffective < 3 && pd.daysWithMeals >= 4) {
      insights.push({ text: `Few MPS-effective protein feedings: ${pd.avgEffective}/day cross ~${pd.perMeal}g (aim 3–5)`, priority: "notable" });
    }
    if (pd.avgSkew != null && pd.avgSkew >= 50) insights.push({ text: `Protein skewed: ~${pd.avgSkew}% of the day's protein lands in one meal — spreading it raises total daily MPS`, priority: "notable" });
    if (pd.avgLargestGap != null && pd.avgLargestGap >= 6) insights.push({ text: `Long protein gaps: ~${pd.avgLargestGap}h between feedings on average — a mid-gap feeding keeps MPS elevated`, priority: "notable" });
    if (pd.preEligibleDays >= 3 && pd.preOKDays / pd.preEligibleDays < 0.4) insights.push({ text: `Rarely a protein feeding near bedtime (${pd.preOKDays}/${pd.preEligibleDays} nights) — a ~30–40g pre-sleep dose may support overnight recovery`, priority: "notable" });
  }

  // --- NOTABLE: contextual patterns the AI should mention if relevant ---
  if (avgLastMeal && minsOf(avgLastMeal) > 21 * 60) insights.push({ text: `Eating late: avg last meal at ${avgLastMeal} — may affect sleep quality`, priority: "notable" });
  if (trainNightAvg != null && restNightAvg != null && Math.abs(trainNightAvg - restNightAvg) > 0.8) {
    insights.push({ text: `Sleep ${trainNightAvg > restNightAvg ? "BETTER" : "WORSE"} on training nights (${trainNightAvg}h vs ${restNightAvg}h on rest nights)`, priority: "notable" });
  }
  if (wkdayAvgSleep != null && wkendAvgSleep != null && Math.abs(wkdayAvgSleep - wkendAvgSleep) > 1.5) {
    insights.push({ text: `Weekend sleep ${wkendAvgSleep > wkdayAvgSleep ? "much longer" : "much shorter"} than weekdays (${wkdayAvgSleep}h vs ${wkendAvgSleep}h) — circadian disruption`, priority: "notable" });
  }

  // --- WINS: reinforce what's working ---
  if (avgP7 != null && goals.protein && avgP7 >= goals.protein * 0.95 && dietDays7.length >= 4) wins.push(`Protein dialed in: ${avgP7}g/day avg vs ${goals.protein}g target, ${proteinHits7}/${dietDays7.length} days on goal`);
  if (avgSleep7 != null && avgSleep7 >= 7.5) wins.push(`Sleep solid: ${avgSleep7}h/day avg`);
  if (last7TotalSessions >= (plan?.trainingDays?.length || 3) && plan?.trainingDays?.length) wins.push(`Training consistent: ${last7TotalSessions} sessions in the last 7 days`);
  if (recentPRs.length > 0) wins.push(`${recentPRs.length} recent PR${recentPRs.length === 1 ? "" : "s"}: ${recentPRs.slice(0, 2).map(p => `${p.name} ${p.weight}${p.unit}×${p.reps}`).join(", ")}`);
  if (streak >= 7) wins.push(`${streak}-day logging streak`);
  if (avgWaterMl7 != null && goals.waterGoalMl && avgWaterMl7 >= goals.waterGoalMl * 0.9) wins.push(`Hydration consistent: ${avgWaterMl7}ml/day avg`);
  if (weightTrend && weightTrend.confidence !== "Low" && weightTrend.pctBWPerWeek != null) {
    const pct = weightTrend.pctBWPerWeek, gl = (goals.goal || "").toLowerCase();
    if (gl.includes("muscle") && pct >= 0.15 && pct <= 0.6) wins.push(`Lean-gain pace dialed in: trend +${pct}%BW/wk`);
    if ((gl.includes("fat") || gl.includes("lose")) && pct <= -0.4 && pct >= -1.0) wins.push(`Fat-loss pace dialed in: trend ${pct}%BW/wk`);
  }
  if (proteinDist && proteinDist.confidence !== "Low" && proteinDist.avgEffective >= 3.5 && proteinDist.daysWithMeals >= 4) {
    wins.push(`Protein distribution dialed: ~${proteinDist.avgEffective} MPS-effective feedings/day`);
  }

  return {
    // Real-time awareness
    now: { iso: now.toISOString(), date: today, dayName: todayName, time: timeNow, hour, timeOfDay, isWeekend },
    goal: goals.goal,
    targets: { calories: goals.calories, protein: goals.protein, carbs: goals.carbs, fat: goals.fat, waterMl: goals.waterGoalMl },
    todayProgress: {
      cal: todayCal, protein: todayP, carbs: todayC, fat: todayF,
      calRemaining, pRemaining, cRemaining, fRemaining,
      waterMl: todayWaterMl, waterRemainingMl,
      supplements: todaySupps.map(s => `${s.name}${s.dose ? ` (${s.dose})` : ""}`),
      sleep: todaySleep ? { duration: todaySleep.duration, quality: todaySleep.quality, bedtime: todaySleep.bedtime, wakeTime: todaySleep.wakeTime } : null,
      yesterdaySleep: yestSleep ? { duration: yestSleep.duration, quality: yestSleep.quality, bedtime: yestSleep.bedtime, wakeTime: yestSleep.wakeTime } : null,
      workoutLogged: !!todayWorkout, sportLogged: !!todaySport,
      meals: todayDiet.map(d => ({ time: d.time, meal: d.meal, food: d.food, cal: d.calories, p: d.protein })),
      lastMealTime, hoursSinceLastMeal,
    },
    plan: plan ? { split: plan.split, todayLabel: todayPlanLabel, tomorrowLabel: tomorrowPlanLabel, trainingDays: plan.trainingDays, isTrainingDay, tomorrowName } : null,
    timelines, // chronological event sequence for each of the last 7 days
    week: {
      avgCal: avgCal7, avgProtein: avgP7, proteinHitDays: proteinHits7, daysLogged: dietDays7.length,
      avgSleep: avgSleep7, sleepDebt: +sleepDebt7.toFixed(1),
      avgBedtime, avgWakeTime, wkdayAvgSleep, wkendAvgSleep,
      avgFirstMeal, avgLastMeal,
      sessions: last7TotalSessions, volumeKg: Math.round(volume7), volumeTrend, calorieTrend, avgRPE: avgRPE7,
      consecutiveTrained, daysSinceLastRest,
      recentPRs, streak,
      avgWaterMl: avgWaterMl7,
      trainNightSleep: trainNightAvg, restNightSleep: restNightAvg,
    },
    insights,
    topInsights: prioritizeInsights(insights).top,
    wins,
    weight: weightTrend,
    proteinDist,
    sleepIntel,
    sleepScreen: goals.sleepScreen || null,
    energy,
    training,
    recovery: {
      verdict: recovery.verdict,
      readiness: recovery.readiness,
      limiter: recovery.limiter,
      plannedToday: recovery.plannedToday,
      todayLabel: recovery.todayLabel,
      topNeg: recovery.reasons.filter(r => r.dir === "neg").slice(0, 4).map(r => r.text),
    },
    ejac: ejacSummary,
    profile: goals.profile || {},
    strategy: goals.strategy || {},
    nicotine: (() => {
      if (!data.nicotine || data.nicotine.length === 0) return null;
      const ns = computeNicotineStats(data);
      const plans = (data.nicotinePlans || []).filter(p => p.when && new Date(p.when) >= new Date(Date.now() - 3600000))
        .sort((a, b) => a.when.localeCompare(b.when)).slice(0, 3);
      return {
        today: ns.today.count, avg7: ns.avgCount7, mg7: ns.avg7, mg30: ns.avg30,
        last7: ns.w7.count, last30: ns.w30.count,
        types: ns.typeTotals, topContexts: ns.topContexts.map(([c]) => c),
        plannedSessions: plans.map(p => ({ when: p.when, label: p.label })),
      };
    })(),
    journal: (() => {
      const j = (data.journal || []).filter(e => e.date >= daysAgo(13)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      if (!j.length) return null;
      // Keep it bounded: most recent ~8 entries, trimmed.
      return j.slice(0, 8).map(e => ({ date: e.date, text: e.text.length > 280 ? e.text.slice(0, 280) + "…" : e.text }));
    })(),
  };
}

// Helpers for time math. avgTimeHHMM averages a list of "HH:MM" strings.
// `wrapPM` handles bedtime (treating 00:00–05:00 as the same night, after midnight, by adding 24h).

// Turns the brain object into a tight text block every AI prompt gets.
// Pre-digested signals at the top so the model immediately knows what matters.
function formatBrainText(brain) {
  const tp = brain.todayProgress;
  const w = brain.week;
  const n = brain.now;
  const lines = [];

  // ─── RIGHT NOW ────────────────────────────────────────────────────────────
  // The model is trained to hedge about real-time access by default. Tell it
  // explicitly that this block is authoritative.
  lines.push(`== RIGHT NOW (current real-time clock from user's device — this is authoritative; never claim you don't know what time/day it is) ==`);
  lines.push(`Date: ${n.date} (${n.dayName}${n.isWeekend ? ", weekend" : ""}) | Time: ${n.time} (${n.timeOfDay}) | Local ISO: ${n.iso}`);
  lines.push(`Goal: ${brain.goal}`);
  lines.push(`Targets — ${brain.targets.calories}kcal | P${brain.targets.protein}g C${brain.targets.carbs}g F${brain.targets.fat}g | water ${brain.targets.waterMl}ml`);
  if (brain.plan) {
    lines.push(`Plan: ${brain.plan.split} | Today: ${brain.plan.todayLabel} | Tomorrow (${brain.plan.tomorrowName}): ${brain.plan.tomorrowLabel} | Training days: ${brain.plan.trainingDays.join(", ")}`);
  }

  // ─── ABOUT THE USER (profile + strategy) ─────────────────────────────────
  // These are facts the user has explicitly told their coach. Reference and respect them.
  const p = brain.profile || {};
  const s = brain.strategy || {};
  const profileBits = [];
  if (p.sex) profileBits.push(p.sex);
  if (p.age) profileBits.push(`${p.age}y`);
  if (p.heightCm) profileBits.push(`${p.heightCm}cm`);
  if (p.weightKg) profileBits.push(`${p.weightKg}kg`);
  if (p.trainingExp) profileBits.push(`${p.trainingExp} lifter`);
  const hasProfile = profileBits.length || p.injuries || p.allergies || p.equipment || p.preferences || p.lifeContext || p.liftingBackground;
  if (hasProfile) {
    lines.push("");
    lines.push("== ABOUT THE USER ==");
    if (profileBits.length) lines.push(`Body: ${profileBits.join(", ")}`);
    if (p.liftingBackground) lines.push(`Lifting background (historical, not current strategy):\n${p.liftingBackground}`);
    if (p.injuries) lines.push(`Injuries / limitations: ${p.injuries}  ← respect these. Avoid suggesting movements that conflict.`);
    if (p.allergies) lines.push(`Food allergies / restrictions: ${p.allergies}  ← never recommend foods on this list.`);
    if (p.equipment) lines.push(`Equipment access: ${p.equipment}`);
    if (p.preferences) lines.push(`Preferences: ${p.preferences}`);
    if (p.lifeContext) lines.push(`Current life context: ${p.lifeContext}  ← factor this into expectations and advice.`);
  }
  const hasStrategy = s.phase || s.focus || s.blockStarted || s.notes;
  if (hasStrategy) {
    lines.push("");
    lines.push("== CURRENT STRATEGY ==");
    const bits = [];
    if (s.phase) bits.push(`Phase: ${s.phase}`);
    if (s.focus) bits.push(`Focus: ${s.focus}`);
    if (s.blockStarted && s.blockWeeks) {
      // Compute which week of the block we're in
      const startMs = new Date(s.blockStarted + "T00:00:00").getTime();
      const weeksIn = Math.max(1, Math.floor((Date.now() - startMs) / (7 * 86400000)) + 1);
      bits.push(`Block: week ${weeksIn} of ${s.blockWeeks}`);
    } else if (s.blockStarted) {
      bits.push(`Block started: ${s.blockStarted}`);
    }
    if (bits.length) lines.push(bits.join(" | "));
    if (s.notes) lines.push(`Strategy notes: ${s.notes}`);
    lines.push(`Evaluate progress AGAINST this strategy — not in a vacuum.`);
  }

  // ─── TODAY SO FAR ─────────────────────────────────────────────────────────
  lines.push("");
  lines.push(`== TODAY SO FAR (${n.date} only — counts ONLY events dated ${n.date}, never yesterday) ==`);
  lines.push(`Nutrition consumed today: ${tp.cal}/${brain.targets.calories} kcal (${tp.calRemaining >= 0 ? tp.calRemaining + " remaining today" : Math.abs(tp.calRemaining) + " OVER today's target"}) | P ${tp.protein}/${brain.targets.protein}g (${tp.pRemaining > 0 ? tp.pRemaining + "g to go" : "hit"}) | C ${tp.carbs}g | F ${tp.fat}g`);
  lines.push(`Water today: ${tp.waterMl}/${brain.targets.waterMl}ml (${tp.waterRemainingMl > 0 ? tp.waterRemainingMl + "ml to go" : "hit"})`);
  if (tp.supplements.length) lines.push(`Supplements today: ${tp.supplements.join(", ")}`);
  if (tp.sleep) lines.push(`Slept last night: ${tp.sleep.duration}h (${tp.sleep.quality})${tp.sleep.bedtime ? `, ${tp.sleep.bedtime}→${tp.sleep.wakeTime}` : ""}`);
  else if (tp.yesterdaySleep) lines.push(`Most recent sleep log: ${tp.yesterdaySleep.duration}h (${tp.yesterdaySleep.quality}) — note: nothing logged for last night yet`);
  if (tp.workoutLogged) lines.push(`✓ Workout logged today`);
  if (tp.sportLogged) lines.push(`✓ Sport logged today`);
  if (tp.lastMealTime) lines.push(`Last meal today: ${tp.lastMealTime}${tp.hoursSinceLastMeal != null ? ` (${tp.hoursSinceLastMeal}h ago)` : ""}`);
  else lines.push(`No meals logged for today yet.`);

  // ─── KEY SIGNALS — ranked top priorities, then the rest grouped by tier ─────
  const topInsights = brain.topInsights || [];
  const topTexts = new Set(topInsights.map(i => i.text));
  const rest = brain.insights.filter(i => !topTexts.has(i.text));
  const critical = rest.filter(i => i.priority === "critical");
  const important = rest.filter(i => i.priority === "important");
  const notable = rest.filter(i => i.priority === "notable");
  if (topInsights.length || critical.length || important.length || notable.length) {
    lines.push("");
    lines.push("== KEY SIGNALS ==");
    if (topInsights.length) {
      lines.push("TOP PRIORITIES (ranked highest-leverage first — lead with #1 unless the user asks about something else):");
      topInsights.forEach((i, n) => lines.push(`  ${n + 1}. ${i.text}`));
    }
    if (critical.length) {
      lines.push("Other CRITICAL (address even if not asked):");
      critical.forEach(i => lines.push("  • " + i.text));
    }
    if (important.length) {
      lines.push("Other IMPORTANT (lead with if relevant):");
      important.forEach(i => lines.push("  • " + i.text));
    }
    if (notable.length) {
      lines.push("Notable (mention if the user's question is in this area):");
      notable.forEach(i => lines.push("  • " + i.text));
    }
  }

  // ─── WINS — what's going well, reinforce when natural ────────────────────
  if (brain.wins?.length) {
    lines.push("");
    lines.push("== WINS (acknowledge briefly when relevant, don't force) ==");
    brain.wins.forEach(w => lines.push("  ✓ " + w));
  }

  // ─── 7-DAY OVERVIEW ───────────────────────────────────────────────────────
  lines.push("");
  lines.push("== 7-DAY OVERVIEW ==");
  lines.push(`Calories: ${w.avgCal ?? "—"} avg (target ${brain.targets.calories}) across ${w.daysLogged} logged days${w.calorieTrend != null ? ` | trend vs prev wk: ${w.calorieTrend > 0 ? "+" : ""}${w.calorieTrend}kcal/day` : ""}`);
  lines.push(`Protein: ${w.avgProtein ?? "—"}g avg, hit goal ${w.proteinHitDays}/${w.daysLogged} days`);
  lines.push(`Sleep: ${w.avgSleep ?? "—"}h avg, debt ${w.sleepDebt}h${w.avgBedtime ? ` | avg bedtime ${w.avgBedtime}, wake ${w.avgWakeTime}` : ""}`);
  if (w.wkdayAvgSleep != null && w.wkendAvgSleep != null) {
    lines.push(`  Weekday sleep ${w.wkdayAvgSleep}h vs weekend ${w.wkendAvgSleep}h`);
  }
  if (w.trainNightSleep != null && w.restNightSleep != null) {
    lines.push(`  Sleep on training nights ${w.trainNightSleep}h vs rest nights ${w.restNightSleep}h`);
  }
  if (w.avgFirstMeal && w.avgLastMeal) {
    lines.push(`Meal timing: avg first meal ${w.avgFirstMeal}, avg last meal ${w.avgLastMeal} (eating window ~${meanGap(w.avgFirstMeal, w.avgLastMeal)}h)`);
  }
  lines.push(`Training: ${w.sessions} sessions | ${w.volumeKg.toLocaleString()}kg volume${w.volumeTrend != null ? ` (${w.volumeTrend > 0 ? "+" : ""}${w.volumeTrend.toLocaleString()}kg vs prev wk)` : ""} | ${w.consecutiveTrained}-day streak | ${w.daysSinceLastRest} days since rest`);
  if (w.avgRPE != null) lines.push(`Avg session RPE (last 7d): ${w.avgRPE}/10`);
  if (w.avgWaterMl != null) lines.push(`Water: ${w.avgWaterMl}ml/day avg`);
  if (w.recentPRs.length) lines.push(`Recent PRs: ${w.recentPRs.slice(0, 3).map(p => `${p.name} ${p.weight}${p.unit}×${p.reps} on ${p.date}`).join("; ")}`);
  lines.push(`Logging streak: ${w.streak} day${w.streak === 1 ? "" : "s"}`);

  // ─── BODYWEIGHT ───────────────────────────────────────────────────────────
  if (brain.weight) {
    const wt = brain.weight;
    lines.push("");
    lines.push("== BODYWEIGHT (trend weight is the smoothed line — it reflects real tissue change; the raw daily number is mostly water/glycogen/gut) ==");
    const rateStr = wt.ratePerWeekG != null
      ? `${wt.ratePerWeekG > 0 ? "+" : ""}${wt.ratePerWeekG}g/wk${wt.pctBWPerWeek != null ? ` (${wt.pctBWPerWeek > 0 ? "+" : ""}${wt.pctBWPerWeek}%BW/wk)` : ""}`
      : "rate not yet estimable";
    lines.push(`Trend weight: ${wt.current}kg | latest scale: ${wt.latestRaw}kg (${wt.latestDate}) | ${wt.nDays} weigh-ins over ${wt.spanDays}d | confidence: ${wt.confidence}`);
    lines.push(`Direction: ${wt.direction} — ${rateStr}`);
    if (Math.abs(wt.divergence) >= 0.6) {
      lines.push(`Note: latest scale reading is ${wt.divergence > 0 ? "above" : "below"} the trend by ${Math.abs(wt.divergence)}kg — likely water/glycogen, not real tissue change. Judge progress by the trend, not the daily number.`);
    }
    lines.push(`Use the TREND weight + rate for any energy-balance reasoning.${wt.confidence === "Low" ? " Confidence is Low (few weigh-ins) — treat the rate as provisional and avoid strong conclusions." : ""}`);
  }

  // ─── PROTEIN DISTRIBUTION (MPS) ───────────────────────────────────────────
  if (brain.proteinDist) {
    const pd = brain.proteinDist;
    lines.push("");
    lines.push("== PROTEIN DISTRIBUTION / MPS (distribution is a SEPARATE lever from daily total — 3–5 feedings each crossing the per-meal threshold beats the same protein skewed into 1–2 meals) ==");
    lines.push(`Per-meal MPS threshold: ~${pd.perMeal}g (${pd.bw ? `0.4g/kg × ${pd.bw}kg` : "default — no bodyweight set"}) | avg effective feedings/day: ${pd.avgEffective} (target 3–5) | avg daily protein: ${pd.avgProtein}g${pd.proteinGoal ? ` (goal ${pd.proteinGoal}g, hit ${pd.goalHitDays}/${pd.daysWithMeals}d)` : ""} | confidence: ${pd.confidence}`);
    if (pd.avgSkew != null) lines.push(`Skew: ~${pd.avgSkew}% of daily protein in the single biggest meal${pd.avgLargestGap != null ? ` | avg largest gap between feedings: ${pd.avgLargestGap}h` : ""}`);
    if (pd.preEligibleDays >= 1) lines.push(`Pre-sleep protein: ${pd.preOKDays}/${pd.preEligibleDays} nights had a ≥20g feeding within 3h of bedtime`);
    lines.push(`When advising on protein, treat DISTRIBUTION (per-meal dose + timing) separately from total grams — if the total is already met, the lever is spreading it, not "eat more protein".${pd.confidence === "Low" ? " Confidence Low (few logged days) — keep it gentle." : ""}`);
  }

  // ─── RECOVERY ─────────────────────────────────────────────────────────────
  if (brain.recovery) {
    const rc = brain.recovery;
    const vlabel = rc.verdict === "go" ? "good to train" : rc.verdict === "caution" ? "train with caution" : "rest";
    lines.push("");
    lines.push("== RECOVERY (today's training readiness) ==");
    lines.push(`Verdict: ${vlabel} | readiness: ${rc.readiness}/100 | plan today: ${rc.plannedToday ? rc.todayLabel : "rest day"}`);
    if (rc.limiter) {
      lines.push(`#1 LIMITER right now: ${rc.limiter.label}${rc.limiter.topReason ? ` — ${rc.limiter.topReason}` : ""}. If recovery comes up, name THIS specific bottleneck rather than generic "rest more" advice.`);
      const others = (rc.topNeg || []).filter(t => t !== rc.limiter.topReason).slice(0, 3);
      if (others.length) lines.push(`Other drags on recovery: ${others.join("; ")}`);
    } else {
      lines.push(`Nothing is meaningfully limiting recovery right now — fine to train as planned.`);
    }
  }

  // ─── SLEEP (the intelligence engine — three axes + cross-domain coupling) ──
  if (brain.sleepIntel) {
    const sl = brain.sleepIntel;
    const q = sl.quantity, r = sl.regularity, c = sl.continuity;
    lines.push("");
    lines.push("== SLEEP (modelled as 3 separate problems: quantity vs the user's OWN need, regularity/timing, and continuity/quality — never assume 8h is their target) ==");
    lines.push(`Personal sleep need: ${sl.need.hours}h (${sl.need.source}${sl.need.source === "learned" ? `, from ${sl.need.nGood} best nights` : ""}) | overall confidence: ${sl.confidence}`);
    lines.push(`Quantity: avg ${q.avgTST7 ?? "—"}h asleep/night (7d) vs ${q.need}h need — ${q.label}${q.debt7 > 0.5 ? `, ~${q.debt7}h debt this week` : ""}`);
    if (r.status) lines.push(`Regularity: ${r.label} (mid-sleep varies ±${r.midSD}min${r.socialJetlag != null ? `, social jetlag ${r.socialJetlag}h` : ""})${r.anchorWake ? ` | their anchor wake time ≈ ${r.anchorWake}` : ""}`);
    if (c.status) lines.push(`Continuity/quality: ${c.label}${c.avgEff != null ? ` (efficiency ${c.avgEff}%)` : ""}${c.avgLatency != null ? `, ~${c.avgLatency}min to fall asleep` : ""}${c.unrefreshing ? " — UNREFRESHING-SLEEP flag (enough hours, poor quality; possible disorder — encourage a clinician check, do NOT diagnose)" : ""}`);
    if (sl.coupling.length) {
      lines.push(`How sleep is shaping the rest of their body (correlations from their own data — never state as proven causation):`);
      sl.coupling.forEach(co => lines.push(`  • ${co.text}`));
    }
    if (sl.topLever) lines.push(`Biggest sleep lever right now: ${sl.topLever.text}`);
    if (brain.sleepScreen?.risk && brain.sleepScreen.risk.band !== "low") {
      const sk = brain.sleepScreen.risk;
      lines.push(`Sleep screen flagged: ${sk.osaCluster ? "possible OSA cluster; " : ""}${sk.insomniaCluster ? "insomnia pattern (CBT-I-treatable); " : ""}${sk.rls ? "restless-legs symptoms; " : ""}worth a clinician conversation. Reference supportively if sleep comes up; never diagnose.`);
    }
    lines.push(`SLEEP COACHING RULES: Treat the three axes as separate levers. If total sleep is fine but timing is irregular, the fix is regularity, not "sleep more". Anchor a fixed wake time as the #1 move. Do not chase sleep-stage/deep-sleep numbers (unreliable). Under a deficit, frame sleep as a muscle-retention tool.`);
  }

  // ─── ENERGY BALANCE / ADAPTIVE TDEE ───────────────────────────────────────
  if (brain.energy) {
    const en = brain.energy;
    lines.push("");
    if (!en.ready) {
      lines.push("== ENERGY BALANCE / TDEE ==");
      lines.push(`Not enough data to measure maintenance yet: ${en.reason} Do NOT estimate their TDEE from a formula or guess — say it's still being measured from their logs.`);
    } else {
      lines.push("== ENERGY BALANCE / TDEE (measured from their OWN intake + weight trend — this is real, not a Mifflin estimate) ==");
      lines.push(`Measured maintenance: ~${en.tdee} kcal/day | confidence: ${en.confidence} (${en.loggedDays} logged days, ${Math.round(en.completeness * 100)}% complete) | their target: ${en.currentTarget ?? "—"}`);
      lines.push(`At ~${en.meanIntake} kcal/day they're in a real ${en.realDelta < 0 ? `deficit of ~${Math.abs(en.realDelta)}` : en.realDelta > 0 ? `surplus of ~${en.realDelta}` : "neutral balance"}/day | trend weight ${en.weightRateKgWk > 0 ? "+" : ""}${en.weightRateKgWk}kg/wk | suggested intake for ${en.intent}: ~${en.recommendedIntake}`);
      if (en.underLogging) lines.push(`⚠ UNDER-LOGGING SUSPECTED: measured maintenance is implausibly low — their food logs are probably incomplete. Gently flag this; don't trust the deficit until logging tightens.`);
      if (en.plateau) lines.push(`PLATEAU: fat loss has stalled despite an apparent deficit — adaptation or under-logging. Reference this if they ask why the scale isn't moving.`);
      lines.push(`Use the MEASURED maintenance (not formulas) for any calorie-target advice. If their target and measured maintenance disagree, trust the measured number. Confidence ${en.confidence} — ${en.confidence === "Low" ? "treat as provisional and say so" : "solid enough to act on"}.`);
    }
  }

  // ─── TRAINING INTELLIGENCE (per-lift progression + per-muscle weekly volume) ─
  if (brain.training) {
    const tr = brain.training;
    lines.push("");
    lines.push("== TRAINING (progression = est-1RM trend per lift; volume = working sets/muscle/week. Progressive overload + weekly volume are the two evidence-based drivers. MEV/MAV/MRV landmark numbers are soft heuristics — guide with them, don't dictate) ==");
    if (tr.progression.lifts.length) {
      lines.push(`Lift progression (8wk): ${tr.progression.lifts.map(l => `${l.name} ${l.status}${l.status === "progressing" ? ` +${l.slopePct}%/wk` : ""} (~${l.e1rmNow}kg)`).join("; ")}`);
      if (tr.progression.stalls.length) lines.push(`STALLED/REGRESSING — needs a variable changed: ${tr.progression.stalls.map(l => l.name).join(", ")}. Suggest concrete fixes (add a set, change rep range + load, or deload), not generic "push harder".`);
    } else {
      lines.push(`Not enough repeated sessions yet to trend any single lift (need a lift logged 3+ times over 2+ weeks).`);
    }
    if (tr.week.trained.length) {
      lines.push(`This week's volume (working sets, fractional for secondary): ${tr.week.sortedVol.map(m => `${m.label} ${m.sets}`).join(", ")} — ${tr.week.sessions} sessions.`);
      if (tr.week.neglected.length) lines.push(`Under-trained majors (<6 sets): ${tr.week.neglected.join(", ")}.`);
      if (tr.week.imbalances.length) lines.push(`Imbalance: ${tr.week.imbalances[0]}.`);
    }
    if (tr.week.unmapped.length) lines.push(`Couldn't map these lifts to muscles (name didn't match): ${tr.week.unmapped.slice(0, 5).join(", ")} — their volume isn't counted, so don't claim total-body volume is complete.`);
    lines.push(`TRAINING COACHING RULES: For a stall, the fix is a changed variable, not more effort. ~10–20 hard sets/muscle/week is the rough productive range for growth; treat it as guidance, not law. Volume landmarks are individual.`);
  }

  // ─── PERSONAL METRIC (EJAC) — neutral data only, with guardrails ──────────
  if (brain.ejac) {
    const e = brain.ejac;
    lines.push("");
    lines.push("== PERSONAL METRIC (EJAC) — private behavioral tracker ==");
    lines.push(`Last 7d: ${e.last7} sessions | last 30d: ${e.last30} (avg ${e.avgPerDay30}/day) | porn ${e.pornPct30}% | gooning ${e.goonPct30}%`);
    lines.push(`GUARDRAILS: This is a neutral self-tracked metric. Only discuss it if the user explicitly raises it. Do NOT moralize, pathologize, judge, congratulate, shame, or give unsolicited health/behavioral advice about it. If the user asks, report the numbers factually and matter-of-factly.`);
  }

  // ─── NICOTINE ─────────────────────────────────────────────────────────────
  if (brain.nicotine) {
    const nic = brain.nicotine;
    lines.push("");
    lines.push("== NICOTINE ==");
    lines.push(`Today: ${nic.today} entries | 7-day: ${nic.last7} entries (${nic.avg7}/day) | 30-day: ${nic.last30} entries`);
    lines.push(`Est. nicotine load: ${nic.mg7}mg/day (7d), ${nic.mg30}mg/day (30d)`);
    const typeBits = Object.entries(nic.types).filter(([, v]) => v > 0).map(([t, v]) => `${t} ${v}`);
    if (typeBits.length) lines.push(`Type mix (30d): ${typeBits.join(", ")}`);
    if (nic.topContexts.length) lines.push(`Common triggers: ${nic.topContexts.join(", ")}`);
    if (nic.plannedSessions.length) {
      lines.push(`PLANNED sessions (user told you in advance — treat as EXPECTED, do NOT nag about these; instead help protect training/sleep around them):`);
      nic.plannedSessions.forEach(p => {
        const d = new Date(p.when);
        lines.push(`  • ${p.label} — ${d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`);
      });
    }
    lines.push(`NICOTINE COACHING RULES: The user is NOT trying to quit (maybe reduce). Do not lecture or push abstinence. Your job is timing guidance — help them keep intake away from the ~1-2h before training, the post-workout recovery window, and the 1-2h before sleep, since those are when it most blunts gains and recovery. When you cite effects on their data, be honest these are correlations not proven causation. Never invent precise figures like "X% of gains lost".`);
  }

  // ─── JOURNAL — the user's own words, the context behind the numbers ───
  if (brain.journal?.length) {
    lines.push("");
    lines.push("== JOURNAL (recent notes in the user's own words — use these for context; reference them naturally when relevant, e.g. how they've been feeling, life stress, injuries, what they tried) ==");
    brain.journal.forEach(e => lines.push(`[${e.date}] ${e.text}`));
    lines.push(`(These are personal reflections. Weigh them alongside the data — if they wrote they're stressed or hurt, factor that into recovery expectations. Don't quote them back verbatim unless it helps; weave the context in.)`);
  }


  // ─── DAY-BY-DAY TIMELINES — the chronological "map" the user asked for ───
  // For each of the last 7 days, list every event in order. Lets the model
  // see meal-to-workout gaps, late dinners, training-after-poor-sleep, etc.
  if (brain.timelines?.length) {
    lines.push("");
    lines.push("== DAY-BY-DAY TIMELINE (last 7 days, chronological) ==");
    lines.push("Each day shows events as they happened. Look for cross-category patterns: meal timing vs sleep, training vs energy intake, water gaps, etc.");
    brain.timelines.forEach(day => {
      if (!day.events.length) {
        lines.push(`${day.date} (${day.dayName}): no logs`);
        return;
      }
      lines.push(`${day.date} (${day.dayName}):`);
      day.events.forEach(e => {
        lines.push(`  ${e.t}  ${e.text}`);
      });
    });
  }

  return lines.join("\n");
}

// Compute hours between two HH:MM times (last minus first), wrapping over midnight is not an issue here
// since first/last meal of a day are by definition same-day.
function meanGap(first, last) {
  const m1 = /^(\d{1,2}):(\d{2})/.exec(first);
  const m2 = /^(\d{1,2}):(\d{2})/.exec(last);
  if (!m1 || !m2) return "?";
  const mins = (+m2[1] * 60 + +m2[2]) - (+m1[1] * 60 + +m1[2]);
  return Math.max(0, +(mins / 60).toFixed(1));
}

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
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
function Ring({ pct, label, value, unit, big }) {
  const size = big ? 130 : 88, stroke = big ? 9 : 7;
  const r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const filled = Math.min(1, pct / 100) * circ;
  return (
    <div className="ring">
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke}
          strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray .8s cubic-bezier(.4,0,.2,1)" }} />
      </svg>
      <div className="ring-center">
        <div className={`ring-val ${big ? "big" : ""}`}>{value}<span className="ring-unit">{unit}</span></div>
      </div>
      <div className="ring-label">{label}</div>
    </div>
  );
}

function MacroDonut({ protein, carbs, fat, size = 88 }) {
  const pCal = protein * 4, cCal = carbs * 4, fCal = fat * 9;
  const tot = pCal + cCal + fCal;
  if (tot <= 0) return null;
  const r = (size - 12) / 2, circ = 2 * Math.PI * r;
  const segs = [
    { val: pCal, color: "#b4a8e8", label: "P" },
    { val: cCal, color: "#f9c97e", label: "C" },
    { val: fCal, color: "#f47e6e", label: "F" },
  ];
  let offset = 0;
  return (
    <div className="donut">
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--track)" strokeWidth="11" />
        {segs.map((s, i) => {
          const frac = s.val / tot;
          const dash = frac * circ;
          const el = (
            <circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={s.color} strokeWidth="11"
              strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset}
              style={{ transition: "stroke-dasharray .6s ease, stroke-dashoffset .6s ease" }} />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="donut-center"><span>{Math.round(tot)}</span><small>kcal</small></div>
    </div>
  );
}

function MiniChart({ points, height = 80, showGoal = null, rollingAvg = false, unit = "" }) {
  const [sel, setSel] = useState(null);
  if (!points || points.length === 0) return <div className="muted-center">No data</div>;
  const W = 320, H = height, padX = 6, padY = 10;
  const vals = points.map(p => p.value).filter(v => v != null);
  if (vals.length === 0) return <div className="muted-center">Not enough data</div>;
  let min = Math.min(...vals), max = Math.max(...vals);
  if (showGoal != null) { min = Math.min(min, showGoal); max = Math.max(max, showGoal); }
  if (max === min) max = min + 1;
  const range = max - min; min -= range * 0.1; max += range * 0.1;
  const sx = i => padX + (i / Math.max(1, points.length - 1)) * (W - 2 * padX);
  const sy = v => H - padY - ((v - min) / (max - min)) * (H - 2 * padY);

  // Build line segments (skip nulls)
  const segments = [];
  let cur = [];
  points.forEach((p, i) => {
    if (p.value != null) cur.push({ x: sx(i), y: sy(p.value), i });
    else if (cur.length) { segments.push(cur); cur = []; }
  });
  if (cur.length) segments.push(cur);

  // Rolling 7-day average line
  let avgPath = "";
  if (rollingAvg) {
    const pts = [];
    points.forEach((p, i) => {
      const window = points.slice(Math.max(0, i - 6), i + 1).map(x => x.value).filter(v => v != null);
      if (window.length >= 2) pts.push({ x: sx(i), y: sy(window.reduce((a, b) => a + b, 0) / window.length) });
    });
    avgPath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  }

  const fmt = v => (v >= 1000 ? v.toLocaleString() : v) + unit;

  return (
    <div className="chart-wrap">
      {sel != null && points[sel]?.value != null && (
        <div className="chart-tip" style={{ left: `${(sx(sel) / W) * 100}%` }}>
          <span className="chart-tip-v">{fmt(points[sel].value)}</span>
          {points[sel].label && <span className="chart-tip-d">{formatShortDate(points[sel].label)}</span>}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chart">
        {showGoal != null && (
          <line x1={padX} x2={W - padX} y1={sy(showGoal)} y2={sy(showGoal)} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" opacity=".35" />
        )}
        {segments.map((seg, si) => {
          const path = seg.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
          const area = seg.length > 1 ? `${path} L${seg[seg.length-1].x.toFixed(1)},${H - padY} L${seg[0].x.toFixed(1)},${H - padY} Z` : null;
          return (
            <g key={si}>
              {area && <path d={area} fill="var(--accent)" opacity=".08" />}
              <path d={path} stroke="var(--accent)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        })}
        {avgPath && <path d={avgPath} stroke="#f9c97e" strokeWidth="1.4" fill="none" strokeDasharray="4 3" opacity=".8" strokeLinecap="round" />}
        {/* selection marker */}
        {sel != null && points[sel]?.value != null && (
          <line x1={sx(sel)} x2={sx(sel)} y1={padY} y2={H - padY} stroke="var(--accent)" strokeWidth="1" opacity=".3" />
        )}
        {points.map((p, i) => p.value != null && (
          <circle key={i} cx={sx(i)} cy={sy(p.value)} r={sel === i ? 3.5 : 2} fill="var(--accent)" />
        ))}
        {/* invisible tap targets */}
        {points.map((p, i) => (
          <rect key={"t" + i} x={sx(i) - (W / points.length) / 2} y={0} width={W / points.length} height={H} fill="transparent"
            onClick={() => { setSel(sel === i ? null : i); haptic(8); }} style={{ cursor: "pointer" }} />
        ))}
      </svg>
      {rollingAvg && <div className="chart-legend"><span className="cl-line solid" />daily<span className="cl-line dash" />7-day avg</div>}
    </div>
  );
}

function Card({ title, sub, action, children, className = "" }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-hd">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {sub && <p className="card-sub">{sub}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function Empty({ icon = "✦", title, hint, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action}
    </div>
  );
}

// ─── TOAST (global, no context needed) ────────────────────────────────────────
let _toastFn = null;
function toast(msg, opts = {}) { haptic(12); if (!opts.silent) SFX.log(); if (_toastFn) _toastFn(msg); }

function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    _toastFn = (msg) => {
      const id = Date.now() + Math.random();
      setItems(it => [...it, { id, msg }]);
      setTimeout(() => setItems(it => it.filter(x => x.id !== id)), 2200);
    };
    return () => { _toastFn = null; };
  }, []);
  return (
    <div className="toast-host">
      {items.map(t => <div key={t.id} className="toast">{t.msg}</div>)}
    </div>
  );
}

// ─── CONFIRM MODAL ────────────────────────────────────────────────────────────
function ConfirmModal({ open, title, body, confirmLabel = "Confirm", danger, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        {body && <p className="modal-body">{body}</p>}
        <div className="modal-actions">
          <button className="btn-ghost flex" onClick={onCancel}>Cancel</button>
          <button className={danger ? "btn-danger flex" : "btn flex"} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// Hook for confirm flow
function useConfirm() {
  const [state, setState] = useState({ open: false });
  const confirm = (opts) => new Promise(resolve => {
    setState({
      open: true, ...opts,
      onConfirm: () => { setState({ open: false }); resolve(true); },
      onCancel: () => { setState({ open: false }); resolve(false); },
    });
  });
  const modal = <ConfirmModal {...state} />;
  return [confirm, modal];
}

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
      {sub === "diet" && <DietForm onAdd={addEntry("diet")} recent={data.diet} goals={goals} data={data} todayDiet={data.diet.filter(d => d.date === getTodayStr())} />}
      {sub === "sleep" && <SleepForm onAdd={addEntry("sleep")} recent={data.sleep} />}
      {sub === "exercise" && <ExerciseForm onAdd={addEntry("exercise")} recent={data.exercise} />}
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
function ProteinTimingCard({ data, goals }) {
  const pd = computeProteinDistribution(data, goals);
  if (!pd) return null;
  const t = pd.today;
  const target = pd.perMeal;
  return (
    <Card title="Protein timing" sub={`MPS-effective feedings today · ~${target}g per-meal threshold${pd.bw ? "" : " (set your weight to personalize)"}`}>
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
    </Card>
  );
}

function DietForm({ onAdd, recent, goals, data, todayDiet = [] }) {
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
    <>
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
    <ProteinTimingCard data={data} goals={goals} />
    <Card title="Log meal" sub="Describe what you ate or upload a photo">
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
          <div className="row">
            <button className="btn flex" onClick={save}>+ Add to log</button>
            <button className="btn-ghost" onClick={() => { setResult(null); }}>Redo</button>
          </div>
        </div>
      )}
      </Card>
      <RecentList entries={recent} render={m => <><span className="ra-main">{m.meal} · {m.calories} kcal · {m.food.slice(0, 26)}{m.food.length > 26 ? "…" : ""}</span><span className="ra-date">{formatShortDate(m.date)}</span></>} />
    </>
  );
}

// ─── EXERCISE (paste from Strong) ──
function ExerciseForm({ onAdd, recent }) {
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
    <RecentList entries={recent} render={w => <><span className="ra-main">{w.label}{w.prs?.length ? " 🏆" : ""}</span><span className="ra-date">{formatShortDate(w.date)}</span></>} />
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
  const sleepDebt = sleepVals.reduce((debt, v) => debt + (sleepNeed - v), 0);

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
          <div className="ts"><span className="ts-l">Sleep debt</span><span className={`ts-v ${sleepDebt > 5 ? "warn" : sleepDebt > 0 ? "neutral" : "good"}`}>{sleepDebt > 0 ? "+" : ""}{Math.round(sleepDebt*10)/10}h</span></div>
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

// ─── LOG HUB OVERLAY (the center ＋) ─────────────────────────────────────────
// Full-screen sheet launched by the raised ＋. Shows logging options grouped by
// intent; tapping one opens that existing form. Reuses every form component.
function LogOverlay({ data, goals, addEntry, deleteEntry, onSaveGoals, setData, initial, onClose }) {
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
  ];
  const labelFor = k => { for (const g of groups) for (const it of g.items) if (it.key === k) return it.label; return "Log"; };

  const renderForm = () => {
    switch (view) {
      case "diet": return <DietForm onAdd={addEntry("diet")} recent={data.diet} goals={goals} data={data} todayDiet={data.diet.filter(d => d.date === today)} />;
      case "water": return <WaterForm data={data} goals={goals} onAdd={addEntry("water")} onDelete={deleteEntry("water")} />;
      case "supps": return <SupplementForm data={data} onAdd={addEntry("supplements")} onDelete={deleteEntry("supplements")} />;
      case "weight": return <WeightForm data={data} goals={goals} onAdd={addEntry("weight")} onDelete={deleteEntry("weight")} />;
      case "exercise": return <ExerciseForm onAdd={addEntry("exercise")} recent={data.exercise} />;
      case "sports": return <SportsForm onAdd={addEntry("sports")} recent={data.sports} />;
      case "plan": return <PlanTab data={data} goals={goals} onSaveGoals={onSaveGoals} />;
      case "sleep": return <SleepSection data={data} goals={goals} addEntry={addEntry} onSaveGoals={onSaveGoals} />;
      case "nicotine": return <NicotineTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} />;
      case "journal": return <JournalTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} setData={setData} />;
      default: return null;
    }
  };

  return (
    <div className="log-overlay">
      <div className="log-overlay-head">
        {view
          ? <button className="log-back" onClick={() => setView(null)}>‹ All</button>
          : <span className="log-overlay-title">Log anything</span>}
        <span className="log-overlay-mid">{view ? labelFor(view) : ""}</span>
        <button className="log-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="log-overlay-body">
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
          {activeTab === "Home" && <HomeTab data={data} goals={goals} onAddWater={addEntry("water")} onAddNicotine={addEntry("nicotine")} onNav={navTo} />}
          {activeTab === "Insights" && <HistoryTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} />}
          {activeTab === "Coach" && <CoachTab data={data} goals={goals} />}
          {activeTab === "Me" && <MeTab data={data} goals={goals} onSaveGoals={setGoals} onClearAll={clearAll} onImport={importData} session={session} onSignOut={signOut} addEntry={addEntry} deleteEntry={deleteEntry} />}
        </main>

        {logOpen && (
          <LogOverlay data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} onSaveGoals={setGoals} setData={setData} initial={logInitial} onClose={closeLog} />
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

