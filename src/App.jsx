import { useState, useEffect, useRef, useMemo } from "react";
import { supabase, hasSupabase } from "./supabase";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TABS = ["Home", "Log", "History", "Coach", "Settings"];
const STORAGE_KEY = "fitlog_v5";
const defaultData = { sleep: [], diet: [], exercise: [], sports: [], water: [], supplements: [] };
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
};

const defaultStrategy = {
  phase: "", // bulk | cut | maintenance | recomp | performance | (empty)
  focus: "", // strength | hypertrophy | conditioning | fat loss | general
  blockStarted: "", // YYYY-MM-DD when current block started
  blockWeeks: "", // target length of current block, e.g. "6"
  notes: "", // free text — anything else the AI should know about strategy right now
};

const defaultGoals = { calories: 2500, protein: 180, carbs: 250, fat: 80, goal: "Build Muscle", waterGoalMl: 2500, profile: defaultProfile, strategy: defaultStrategy };
const fitnessGoals = ["Build Muscle", "Lose Fat", "Improve Endurance", "Maintain Weight", "Athletic Performance"];
const mealTypes = ["Breakfast", "Lunch", "Dinner", "Snack"];
const sportsOptions = ["Running","Football","Basketball","Tennis","Swimming","Cycling","Yoga","Boxing","Soccer","Volleyball","Badminton","Table Tennis","Golf","Martial Arts","Hiking","Walking","Rowing","Climbing","Other"];
const sleepQuality = ["Poor", "Fair", "Good", "Great", "Excellent"];
const intensityLevels = ["Light", "Moderate", "Intense", "All-out"];

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

const TYPE_DOT = { sleep: "#6ee7f7", diet: "#f9c97e", exercise: "#f47e6e", sports: "#8fd989", water: "#5cc8df", supplements: "#b4a8e8" };
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
const localDateStr = d => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const getTodayStr = () => localDateStr(new Date());
const formatDate = ds => new Date(ds + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const formatShortDate = ds => new Date(ds + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return localDateStr(d); };

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
function parseWorkout(text) {
  if (!text) return { exercises: [], totalVolume: 0, totalSets: 0 };
  const lines = text.split("\n").map(l => l.trim());
  const exercises = [];
  let current = null;
  let totalVolume = 0, totalSets = 0;

  const setRe = /(?:set\s*\d+\s*[:.]?\s*)?(\d+(?:\.\d+)?)\s*(kg|lb|lbs)?\s*[x×]\s*(\d+)/i;
  const bwRe = /[x×]\s*(\d+)\s*(?:reps)?$/i;

  for (const line of lines) {
    if (!line) continue;
    const lower = line.toLowerCase();
    // Skip duration/date/total lines
    if (/^\d+\s*h(\s*\d+\s*m)?$/i.test(line) || /^\d+\s*m(in)?$/i.test(line)) continue;
    if (/^(total|duration|volume|notes?|rest)\b/i.test(lower)) continue;

    const m = line.match(setRe);
    if (m && current) {
      const weight = parseFloat(m[1]);
      const unit = (m[2] || "kg").toLowerCase().replace("lbs", "lb");
      const reps = parseInt(m[3], 10);
      const wKg = unit === "lb" ? weight * 0.453592 : weight;
      current.sets.push({ weight, unit, reps });
      current.volume += wKg * reps;
      totalVolume += wKg * reps;
      totalSets++;
      continue;
    }
    // Bodyweight set like "× 12"
    const bw = line.match(bwRe);
    if (bw && current && !m) {
      current.sets.push({ weight: 0, unit: "kg", reps: parseInt(bw[1], 10) });
      totalSets++;
      continue;
    }
    // Otherwise treat as an exercise name (must contain a letter, not be too long)
    if (/[a-z]/i.test(line) && line.length < 60) {
      current = { name: line.replace(/\s*\(.*?\)\s*$/, "").trim() || line, raw: line, sets: [], volume: 0 };
      exercises.push(current);
    }
  }
  // Drop exercises with no sets (likely stray header lines)
  const withSets = exercises.filter(e => e.sets.length > 0);
  return { exercises: withSets, totalVolume: Math.round(totalVolume), totalSets };
}

// Best set for an exercise = highest weight; tie-break on reps. Returns {weight, unit, reps} or null.
function bestSet(sets) {
  if (!sets || !sets.length) return null;
  return sets.reduce((best, s) => {
    const sKg = s.unit === "lb" ? s.weight * 0.453592 : s.weight;
    const bKg = best.unit === "lb" ? best.weight * 0.453592 : best.weight;
    if (sKg > bKg || (sKg === bKg && s.reps > best.reps)) return s;
    return best;
  });
}

// Estimated 1-rep max (Epley formula) in kg, for comparing PRs fairly across rep ranges.
function e1rm(set) {
  if (!set) return 0;
  const wKg = set.unit === "lb" ? set.weight * 0.453592 : set.weight;
  if (set.reps <= 0) return 0;
  return wKg * (1 + set.reps / 30);
}

// Given a new parsed workout and all prior exercise entries, detect PRs.
// Returns array of { name, weight, unit, reps } for exercises that beat all-time e1RM.
function detectPRs(parsed, priorExercises) {
  if (!parsed?.exercises?.length) return [];
  // Build best historical e1RM per exercise name (case-insensitive)
  const history = {};
  for (const entry of priorExercises) {
    const p = entry._parsed || parseWorkout(entry.text);
    for (const ex of p.exercises) {
      const key = ex.name.toLowerCase();
      const best = e1rm(bestSet(ex.sets));
      if (!history[key] || best > history[key]) history[key] = best;
    }
  }
  const prs = [];
  for (const ex of parsed.exercises) {
    const key = ex.name.toLowerCase();
    const bs = bestSet(ex.sets);
    const newE = e1rm(bs);
    if (newE > 0 && (history[key] === undefined || newE > history[key] + 0.01)) {
      // Only count as PR if there was some history OR it's a meaningful lift (avoid first-ever everything)
      if (history[key] !== undefined) prs.push({ name: ex.name, ...bs });
    }
  }
  return prs;
}

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
  const last7Sleep = last7(data.sleep);
  const avgSleep7 = last7Sleep.length ? +(last7Sleep.reduce((a, s) => a + s.duration, 0) / last7Sleep.length).toFixed(1) : null;
  const sleepDebt7 = last7Sleep.reduce((d, s) => d + (8 - s.duration), 0);
  const sleepPatternIssue = last7Sleep.length >= 3 && avgSleep7 != null && avgSleep7 < 7;
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
  if (sleepPatternIssue) insights.push({ text: `Avg sleep ${avgSleep7}h is below 7h — recovery limiter`, priority: avgSleep7 < 6 ? "critical" : "important" });

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
      sessions: last7TotalSessions, volumeKg: Math.round(volume7), volumeTrend, calorieTrend,
      consecutiveTrained, daysSinceLastRest,
      recentPRs, streak,
      avgWaterMl: avgWaterMl7,
      trainNightSleep: trainNightAvg, restNightSleep: restNightAvg,
    },
    insights,
    wins,
    profile: goals.profile || {},
    strategy: goals.strategy || {},
  };
}

// Helpers for time math. avgTimeHHMM averages a list of "HH:MM" strings.
// `wrapPM` handles bedtime (treating 00:00–05:00 as the same night, after midnight, by adding 24h).
function avgTimeHHMM(times, wrapPM = false) {
  if (!times || !times.length) return null;
  const mins = times.map(t => {
    const m = /^(\d{1,2}):(\d{2})/.exec(t);
    if (!m) return null;
    let v = +m[1] * 60 + +m[2];
    if (wrapPM && v < 5 * 60) v += 24 * 60; // bedtime after midnight counts as previous night
    return v;
  }).filter(v => v != null);
  if (!mins.length) return null;
  let avg = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
  if (avg >= 24 * 60) avg -= 24 * 60;
  return `${String(Math.floor(avg / 60)).padStart(2, "0")}:${String(avg % 60).padStart(2, "0")}`;
}

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

  // ─── KEY SIGNALS — grouped by priority ────────────────────────────────────
  // CRITICAL = must address; IMPORTANT = lead with if relevant; NOTABLE = mention only if asked
  const critical = brain.insights.filter(i => i.priority === "critical");
  const important = brain.insights.filter(i => i.priority === "important");
  const notable = brain.insights.filter(i => i.priority === "notable");
  if (critical.length || important.length || notable.length) {
    lines.push("");
    lines.push("== KEY SIGNALS ==");
    if (critical.length) {
      lines.push("CRITICAL (address even if not asked):");
      critical.forEach(i => lines.push("  • " + i.text));
    }
    if (important.length) {
      lines.push("IMPORTANT (lead with if relevant):");
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
  if (w.avgWaterMl != null) lines.push(`Water: ${w.avgWaterMl}ml/day avg`);
  if (w.recentPRs.length) lines.push(`Recent PRs: ${w.recentPRs.slice(0, 3).map(p => `${p.name} ${p.weight}${p.unit}×${p.reps} on ${p.date}`).join("; ")}`);
  lines.push(`Logging streak: ${w.streak} day${w.streak === 1 ? "" : "s"}`);

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

// Robustly pull a JSON object out of a response that may contain prose around it.
function extractJSON(raw) {
  let s = raw.replace(/```json|```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
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
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

// Suggests which split day goes on each chosen training day.
async function suggestSplitSchedule(plan, goals) {
  const sys = `You are a strength coach. The user follows a "${plan.split}" split and can train on these days: ${plan.trainingDays.join(", ")}. Goal: ${goals.goal}.
Assign a specific workout to each available training day, optimizing recovery (don't put two heavy overlapping sessions back-to-back; space out muscle groups). Days NOT in their available list are rest days.
Return ONLY JSON mapping each available day to a short workout label:
{"assignments":{${plan.trainingDays.map(d => `"${d}":"<label>"`).join(",")}},"rationale":"<1-2 sentence explanation of the arrangement>"}`;
  const raw = await callClaude({ system: sys, maxTokens: 700, userText: `Arrange my ${plan.split} across: ${plan.trainingDays.join(", ")}.` });
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

// Conversational plan builder — the user describes what they want in plain English,
// and the AI designs the entire week: which days to train, the split, day-by-day workouts, and why.
async function buildPlanFromPrompt(prompt, goals, current, data) {
  const brain = data ? buildBrain(data, goals) : null;
  const brainText = brain ? `\n\nUser's current state (factor this in — e.g. if undereating, recommend lower volume; if just finishing a hard block, schedule a deload week):\n${formatBrainText(brain)}` : "";
  const sys = `You are this user's coach. They've described how they want their training week — design it for them.

Their stated fitness goal: ${goals.goal}.
${current?.trainingDays?.length ? `Their current plan (they may want to keep or change it): split="${current.split}", training days=${current.trainingDays.join(", ")}.` : ""}

Rules:
- Honor explicit constraints (number of days, specific days, sports, muscle priorities, time limits, injuries from the ABOUT THE USER section if provided).
- Pick the most appropriate split (Push/Pull/Legs, Upper/Lower, Full Body, Bro Split, Arnold, or Custom).
- Optimize recovery: don't hammer the same muscles consecutive days, space heavy lifts sensibly, account for any sports as extra fatigue.
- Factor in their CURRENT STRATEGY and recent data — if undereating, recommend lower volume; if week 5 of 6 in a strength block, schedule a deload.
- Use the 7 day keys exactly: Mon, Tue, Wed, Thu, Fri, Sat, Sun.
- For rest days, omit them from "assignments" (only include training days).
- Keep workout labels short (e.g. "Push", "Upper A", "Legs + Core", "Chest & Back").

${COACH_PRINCIPLES}

Return ONLY valid JSON, no markdown:
{
  "split": "<chosen split name>",
  "trainingDays": ["Mon","Wed",...],
  "assignments": {"Mon":"Push","Wed":"Pull",...},
  "summary": "<2-3 sentences explaining the plan and why it fits>",
  "tips": ["<concrete actionable tip>","<tip>"]
}${brainText}`;
  const raw = await callClaude({
    model: currentModelId(),
    system: sys,
    maxTokens: 1200,
    userText: `Here's what I want for my training week:\n\n"${prompt}"\n\nDesign my week.`,
  });
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
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
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
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
function HomeTab({ data, goals, onAddWater, onNav }) {
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
        <button className="qa" onClick={() => onNav("Coach")}>
          <span className="qa-icon">✦</span><span>Ask coach</span>
        </button>
      </div>

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

function LogTab({ data, goals, addEntry, deleteEntry, initialSub, onSaveGoals }) {
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
    </div>
  );
}

// ─── PLAN TAB ──
function PlanTab({ data, goals, onSaveGoals }) {
  const plan = goals.plan || defaultPlan;
  const [split, setSplit] = useState(plan.split);
  const [trainingDays, setTrainingDays] = useState(plan.trainingDays);
  const [assignments, setAssignments] = useState(plan.assignments || {});

  // Conversational AI plan builder
  const [prompt, setPrompt] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState(null);
  const [buildErr, setBuildErr] = useState("");
  const [editing, setEditing] = useState(false);

  // Rest-day recommendation
  const [rec, setRec] = useState(null);
  const [recLoading, setRecLoading] = useState(false);

  const todayName = WEEKDAYS[(new Date().getDay() + 6) % 7];
  const hasPlan = trainingDays.length > 0 && Object.keys(assignments).length > 0;

  async function buildPlan() {
    if (!prompt.trim() || building) return;
    setBuilding(true); setBuildErr(""); setBuildResult(null);
    try {
      const r = await buildPlanFromPrompt(prompt, goals, { split, trainingDays }, data);
      if (!r || !r.trainingDays?.length) throw new Error();
      setBuildResult(r);
    } catch { setBuildErr("Couldn't build that plan. Try rephrasing what you want."); }
    setBuilding(false);
  }

  function applyBuiltPlan() {
    if (!buildResult) return;
    setSplit(buildResult.split || split);
    setTrainingDays(buildResult.trainingDays);
    setAssignments(buildResult.assignments || {});
    onSaveGoals({ ...goals, plan: { split: buildResult.split || split, trainingDays: buildResult.trainingDays, assignments: buildResult.assignments || {}, notes: "" } });
    setBuildResult(null); setPrompt("");
    toast("\u2713 Plan saved");
    haptic([12, 30, 12]);
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
    onSaveGoals({ ...goals, plan: { split, trainingDays, assignments, notes: "" } });
    setEditing(false);
    toast("\u2713 Plan saved");
  }

  async function getRec() {
    setRecLoading(true);
    try { setRec(await recommendRest(data, goals)); }
    catch { toast("Couldn't get recommendation"); }
    setRecLoading(false);
  }

  const recColor = { train: "var(--good)", light: "var(--warn)", rest: "var(--bad)" };
  const recLabel = { train: "Train today", light: "Go light today", rest: "Rest / deload today" };

  return (
    <div className="stack">
      {/* TODAY'S CALL */}
      <Card title="Today's call" sub="AI checks your recent load & sleep">
        {!rec && !recLoading && (
          <button className="btn-ghost full" onClick={getRec}>\u2726 Should I train today?</button>
        )}
        {recLoading && <div className="loading-row"><span className="spinner" />Checking your recovery\u2026</div>}
        {rec && !recLoading && (
          <div className="rec-result">
            <div className="rec-badge" style={{ background: `${recColor[rec.recommendation]}22`, color: recColor[rec.recommendation], borderColor: `${recColor[rec.recommendation]}55` }}>
              {recLabel[rec.recommendation] || "Train today"}
            </div>
            <p className="rec-reason">{rec.reason}</p>
            {rec.tip && <p className="rec-tip">\ud83d\udca1 {rec.tip}</p>}
            <button className="link-btn" onClick={getRec}>Refresh</button>
          </div>
        )}
      </Card>

      {/* AI PLAN BUILDER */}
      <Card title="\u2726 Build my week" sub="Tell the AI what you want \u2014 it designs your whole week">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={3}
          placeholder={'e.g. "I can train 4 days a week, focus on chest and arms, and I play football on Sundays so keep legs away from then"'}
        />
        <div className="prompt-chips">
          {[
            "5 days, push/pull/legs, weekends off",
            "4 days, focus on arms & shoulders",
            "3 full-body days, max recovery",
            "Plan around football Sat & Sun",
          ].map((p, i) => (
            <button key={i} className="prompt-chip" onClick={() => setPrompt(p)}>{p}</button>
          ))}
        </div>
        <button className="btn full" style={{ marginTop: 10 }} onClick={buildPlan} disabled={building || !prompt.trim()}>
          {building ? <><span className="spinner" />Designing your week\u2026</> : (hasPlan ? "\u2726 Rebuild my week" : "\u2726 Design my week")}
        </button>
        {buildErr && <div className="err">{buildErr}</div>}

        {buildResult && (
          <div className="build-result">
            <div className="build-split-tag">{buildResult.split}</div>
            <div className="build-week">
              {WEEKDAYS.map(d => {
                const w = buildResult.assignments?.[d];
                const training = buildResult.trainingDays.includes(d);
                return (
                  <div key={d} className={`build-day ${training ? "on" : ""} ${d === todayName ? "today" : ""}`}>
                    <span className="build-day-name">{d}</span>
                    <span className="build-day-w">{training ? (w || "Train") : "Rest"}</span>
                  </div>
                );
              })}
            </div>
            {buildResult.summary && <p className="build-summary">{buildResult.summary}</p>}
            {buildResult.tips?.length > 0 && (
              <ul className="build-tips">{buildResult.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn flex" onClick={applyBuiltPlan}>\u2713 Use this plan</button>
              <button className="btn-ghost" onClick={() => setBuildResult(null)}>Discard</button>
            </div>
          </div>
        )}
      </Card>

      {/* CURRENT WEEK */}
      {hasPlan && !buildResult && (
        <Card title="Your week" sub={split} action={<button className="link-btn" onClick={() => editing ? saveEdits() : setEditing(true)}>{editing ? "Done" : "Edit"}</button>}>
          <div className="build-week">
            {WEEKDAYS.map(d => {
              const training = trainingDays.includes(d);
              if (editing) {
                return (
                  <div key={d} className={`build-day ${d === todayName ? "today" : ""}`}>
                    <span className="build-day-name">{d}</span>
                    <input className="wo-input" value={assignments[d] || ""} placeholder="Rest \u2014 type to add"
                      onChange={e => editDay(d, e.target.value)} />
                  </div>
                );
              }
              return (
                <div key={d} className={`build-day ${training ? "on" : ""} ${d === todayName ? "today" : ""}`}>
                  <span className="build-day-name">{d}</span>
                  <span className="build-day-w">{training ? (assignments[d] || "Train") : "Rest"}</span>
                  {d === todayName && <span className="wo-today-tag">today</span>}
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
  const [form, setForm] = useState({ date: getTodayStr(), bedtime: "22:30", wakeTime: "06:30", quality: "Good", notes: "" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const dur = (() => {
    const [bh, bm] = form.bedtime.split(":").map(Number), [wh, wm] = form.wakeTime.split(":").map(Number);
    let m = (wh * 60 + wm) - (bh * 60 + bm); if (m < 0) m += 1440; return (m / 60).toFixed(1);
  })();
  function save() {
    onAdd({ ...form, duration: parseFloat(dur), id: Date.now() });
    toast("◐ Sleep logged");
    setForm(f => ({ ...f, notes: "" }));
  }
  return (
    <>
      <Card title="Log sleep">
        <div className="field-grid">
          <label>Date<input type="date" value={form.date} onChange={e => set("date", e.target.value)} /></label>
          <label>Quality<select value={form.quality} onChange={e => set("quality", e.target.value)}>{sleepQuality.map(q => <option key={q}>{q}</option>)}</select></label>
          <label>Bedtime<input type="time" value={form.bedtime} onChange={e => set("bedtime", e.target.value)} /></label>
          <label>Wake time<input type="time" value={form.wakeTime} onChange={e => set("wakeTime", e.target.value)} /></label>
        </div>
        <div className="duration-pill"><span>{dur}h</span> sleep</div>
        <label>Notes<textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="How did you sleep?" rows={2} /></label>
        <button className="btn full" onClick={save}>Save sleep</button>
      </Card>
      <RecentList entries={recent} render={s => <><span className="ra-main">{s.duration}h · {s.quality}</span><span className="ra-date">{formatShortDate(s.date)}</span></>} />
    </>
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
        <button className={`seg-btn ${view === "supp" ? "active" : ""}`} onClick={() => setView("supp")}>⊕ Supplements</button>
      </div>
      {view === "water" && <WaterForm data={data} goals={goals} onAdd={addEntry("water")} onDelete={deleteEntry("water")} />}
      {view === "supp" && <SupplementForm data={data} onAdd={addEntry("supplements")} onDelete={deleteEntry("supplements")} />}
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
  const sleepDebt = sleepVals.reduce((debt, v) => debt + (8 - v), 0);

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

      <ConsistencyHeatmap data={data} />

      <Card title="😴 Sleep">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Average</span><span className="ts-v">{avgSleep ?? "—"}h</span></div>
          <div className="ts"><span className="ts-l">Sleep debt</span><span className={`ts-v ${sleepDebt > 5 ? "warn" : sleepDebt > 0 ? "neutral" : "good"}`}>{sleepDebt > 0 ? "+" : ""}{Math.round(sleepDebt*10)/10}h</span></div>
        </div>
        <MiniChart points={sleepPts} showGoal={8} rollingAvg unit="h" />
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
          <Empty title={`No ${label.toLowerCase()} logged yet`} hint="Head to the Log tab to add some" />
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
function SettingsTab({ data, goals, onSaveGoals, onClearAll, onImport, session, onSignOut }) {
  const [section, setSection] = useState("goals");

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

function AppShell({ session, syncing }) {
  const [activeTab, setActiveTab] = useState("Home");
  const [logSub, setLogSub] = useState(null);
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
    setActiveTab(tab);
    if (sub) setLogSub(sub);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

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
          {activeTab === "Home" && <HomeTab data={data} goals={goals} onAddWater={addEntry("water")} onNav={navTo} />}
          {activeTab === "Log" && <LogTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} initialSub={logSub} onSaveGoals={setGoals} />}
          {activeTab === "History" && <HistoryTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} />}
          {activeTab === "Coach" && <CoachTab data={data} goals={goals} />}
          {activeTab === "Settings" && <SettingsTab data={data} goals={goals} onSaveGoals={setGoals} onClearAll={clearAll} onImport={importData} session={session} onSignOut={signOut} />}
        </main>

        <nav className="tabbar">
          {TABS.map(tab => (
            <button key={tab} className={`tabbtn ${activeTab === tab ? "active" : ""}`} onClick={() => { SFX.tap(); setActiveTab(tab); if (tab !== "Log") setLogSub(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
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
  if (name === "Settings") return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>;
  return null;
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = `
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600;700&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0a0b0f;
  --surface: #14161c;
  --surface-2: #1a1d25;
  --border: rgba(255,255,255,0.06);
  --border-strong: rgba(255,255,255,0.1);
  --text: #ebedf2;
  --text-2: #b5b9c4;
  --muted: #6b7180;
  --accent: #6ee7f7;
  --accent-dim: rgba(110,231,247,0.12);
  --track: rgba(255,255,255,0.06);
  --good: #8fd989;
  --warn: #f9c97e;
  --bad: #f47e6e;
  --radius: 14px;
  --radius-sm: 10px;
  --accent-glow: rgba(110,231,247,0.35);
  --shadow-card: 0 1px 2px rgba(0,0,0,0.3), 0 6px 16px rgba(0,0,0,0.25);
  --shadow-lift: 0 4px 12px rgba(0,0,0,0.35), 0 12px 32px rgba(0,0,0,0.3);
  --spring: cubic-bezier(.34,1.56,.64,1);
  --ease-out: cubic-bezier(.22,1,.36,1);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}

html, body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
body { font-size: 15px; line-height: 1.5; }

/* Atmospheric background — soft accent glow up top + subtle grain, fixed so it doesn't scroll */
body::before {
  content: ""; position: fixed; inset: 0; z-index: -2; pointer-events: none;
  background:
    radial-gradient(900px 500px at 50% -8%, rgba(110,231,247,0.10), transparent 60%),
    radial-gradient(700px 600px at 100% 100%, rgba(180,168,232,0.06), transparent 55%);
}
body::after {
  content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: 0.4;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
  mix-blend-mode: overlay;
}

.app { min-height: 100vh; min-height: 100dvh; max-width: 720px; margin: 0 auto; padding: 0 18px 96px; padding-bottom: calc(96px + env(safe-area-inset-bottom)); }

/* Top */
.topbar { padding: 22px 0 14px; }
.brand {
  font-family: 'DM Serif Display', serif; font-size: 1.7rem; font-weight: 400; letter-spacing: -0.5px;
  background: linear-gradient(100deg, var(--text) 30%, var(--accent) 50%, var(--text) 70%);
  background-size: 200% 100%; -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: brandIn .6s var(--ease-out) both, sheen 6s ease-in-out 1s infinite;
}
@keyframes brandIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@keyframes sheen { 0%, 100% { background-position: 150% 0; } 50% { background-position: -50% 0; } }

/* Tab bar bottom */
.tabbar {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: rgba(10,11,15,0.92); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid var(--border);
  display: flex; padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
  z-index: 100;
}
.tabbtn {
  flex: 1; background: transparent; border: none; color: var(--muted);
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 6px 4px; cursor: pointer; transition: color .2s var(--ease-out), transform .12s ease;
  font-family: inherit; position: relative; -webkit-tap-highlight-color: transparent;
}
.tabbtn::before {
  content: ""; position: absolute; top: 1px; width: 4px; height: 4px; border-radius: 50%;
  background: var(--accent); box-shadow: 0 0 8px var(--accent-glow);
  opacity: 0; transform: scale(0); transition: opacity .25s, transform .35s var(--spring);
}
.tabbtn.active::before { opacity: 1; transform: scale(1); }
.tabbtn:active { transform: scale(.9); }
.tabbtn.active { color: var(--accent); }
.tabbtn.active svg, .tabbtn.active .tabbtn-icon { animation: iconPop .4s var(--spring); }
@keyframes iconPop { 0% { transform: scale(1); } 45% { transform: scale(1.22); } 100% { transform: scale(1); } }
.tabbtn-icon { font-size: 1.1rem; line-height: 1; }
.tabbtn-label { font-size: .67rem; font-weight: 500; }

.main { animation: fade .3s var(--ease-out); }
@keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* Staggered reveal — each direct child of a .stack rises in sequence */
.stack > * { animation: riseIn .5s var(--ease-out) both; }
.stack > *:nth-child(1) { animation-delay: .02s; }
.stack > *:nth-child(2) { animation-delay: .08s; }
.stack > *:nth-child(3) { animation-delay: .14s; }
.stack > *:nth-child(4) { animation-delay: .20s; }
.stack > *:nth-child(5) { animation-delay: .26s; }
.stack > *:nth-child(6) { animation-delay: .32s; }
.stack > *:nth-child(n+7) { animation-delay: .36s; }
@keyframes riseIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

/* Layout */
.stack { display: flex; flex-direction: column; gap: 14px; }
.row { display: flex; gap: 8px; align-items: center; }
.flex { flex: 1; }
.row-between { display: flex; justify-content: space-between; align-items: center; margin: 10px 0 8px; }

/* Greeting */
.greeting { padding: 4px 2px 6px; }
.greeting-date { color: var(--muted); font-size: .8rem; font-weight: 500; letter-spacing: 0.02em; text-transform: uppercase; }
.greeting-h { font-family: 'DM Serif Display', serif; font-size: 1.85rem; font-weight: 400; margin: 6px 0 4px; line-height: 1.05; letter-spacing: -0.01em; }
.greeting-goal { color: var(--text-2); font-size: .9rem; }

/* Card */
.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px;
  box-shadow: var(--shadow-card); position: relative;
  transition: transform .3s var(--ease-out), box-shadow .3s var(--ease-out), border-color .3s var(--ease-out);
}
.card::before {
  content: ""; position: absolute; inset: 0 0 auto; height: 1px; border-radius: var(--radius) var(--radius) 0 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent); pointer-events: none;
}
.card-hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.card-title { font-size: .92rem; font-weight: 600; color: var(--text); letter-spacing: -0.005em; }
.card-sub { color: var(--muted); font-size: .8rem; margin-top: 3px; line-height: 1.5; }

/* Rings */
.rings-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.ring { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; animation: ringDraw .7s var(--ease-out) both; }
.ring:nth-child(2) { animation-delay: .1s; }
.ring:nth-child(3) { animation-delay: .2s; }
@keyframes ringDraw { from { opacity: 0; transform: scale(.85) rotate(-8deg); } to { opacity: 1; transform: none; } }
.ring svg { display: block; }
.ring svg circle:last-child { filter: drop-shadow(0 0 4px var(--accent-glow)); }
.ring-center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding-bottom: 18px; }
.ring-val { font-family: 'DM Serif Display', serif; font-size: 1.05rem; color: var(--text); animation: valIn .6s var(--ease-out) .25s both; }
.ring-val.big { font-size: 1.4rem; }
.ring-unit { font-family: 'Inter', sans-serif; font-size: .65rem; color: var(--muted); margin-left: 2px; font-weight: 500; }
.ring-label { font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
@keyframes valIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.ring-targets { display: flex; justify-content: space-around; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); font-size: .72rem; color: var(--muted); }

/* Quick actions */
.quick-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.qa {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 14px; display: flex; align-items: center; gap: 10px;
  color: var(--text); font-family: inherit; font-size: .9rem; font-weight: 500; cursor: pointer;
  transition: border-color .2s var(--ease-out), background .2s var(--ease-out), transform .15s var(--spring), box-shadow .2s var(--ease-out);
  min-height: 56px; -webkit-tap-highlight-color: transparent;
}
.qa:hover { border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow-card); }
.qa:active { transform: translateY(0) scale(.97); }
.qa.qa-primary { background: var(--accent-dim); border-color: rgba(110,231,247,0.25); color: var(--accent); }
.qa.qa-primary:hover { box-shadow: 0 6px 20px var(--accent-dim); border-color: var(--accent-glow); }
.qa-icon { font-size: 1.1rem; transition: transform .3s var(--spring); }
.qa:hover .qa-icon { transform: scale(1.18) rotate(-6deg); }

.quick-water { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
.quick-water .qa { flex-direction: column; gap: 4px; text-align: center; padding: 14px 8px; min-height: 64px; line-height: 1.2; }
.quick-water .qa span { color: var(--muted); font-size: .7rem; font-weight: 400; }

/* Today items */
.today-items { display: flex; flex-direction: column; gap: 8px; }
.today-item { display: flex; align-items: center; gap: 10px; font-size: .87rem; padding: 4px 0; animation: slideRight .45s var(--ease-out) both; }
.today-item:nth-child(2) { animation-delay: .05s; }
.today-item:nth-child(3) { animation-delay: .1s; }
.today-item:nth-child(4) { animation-delay: .15s; }
.today-item:nth-child(5) { animation-delay: .2s; }
@keyframes slideRight { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
.today-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; animation: dotPulse 2.4s ease-in-out infinite; }
@keyframes dotPulse { 0%, 100% { box-shadow: 0 0 0 0 transparent; } 50% { box-shadow: 0 0 0 3px rgba(255,255,255,0.04); } }
.today-text { color: var(--text-2); }


/* Insight */
.insight { font-size: .9rem; line-height: 1.6; color: var(--text); }

/* Sub-tabs */
.subtabs {
  display: flex; gap: 4px; background: var(--surface); padding: 4px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  overflow-x: auto; scrollbar-width: none;
}
.subtabs::-webkit-scrollbar { display: none; }
.subtab {
  flex: 1; padding: 8px 10px; background: transparent; border: none; color: var(--muted);
  font-family: inherit; font-size: .8rem; font-weight: 500; cursor: pointer; border-radius: 7px;
  white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 5px;
  transition: color .2s var(--ease-out), background .25s var(--ease-out), transform .12s ease; min-width: 60px;
  -webkit-tap-highlight-color: transparent;
}
.subtab.active { background: var(--surface-2); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,0.25); }
.subtab:active { transform: scale(.95); }
.subtab:hover:not(.active) { color: var(--text-2); }
.subtab-icon { font-size: .9rem; }

/* Forms */
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.field-grid.three { grid-template-columns: 1fr 1fr 1fr; }
@media (max-width: 480px) { .field-grid:not(.three) { grid-template-columns: 1fr; } }
label { display: flex; flex-direction: column; gap: 5px; font-size: .73rem; color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }
input, select, textarea {
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); font-family: inherit; font-size: .92rem; padding: 11px 12px;
  outline: none; transition: border-color .2s var(--ease-out), box-shadow .2s var(--ease-out); width: 100%;
}
input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
textarea { resize: vertical; min-height: 64px; line-height: 1.5; }
select option { background: var(--surface-2); }

.duration-pill { display: inline-flex; gap: 4px; background: var(--accent-dim); border: 1px solid rgba(110,231,247,0.2); color: var(--accent); padding: 4px 12px; border-radius: 16px; font-size: .82rem; margin-bottom: 12px; font-weight: 500; }
.duration-pill span { font-weight: 600; }

.lbl { font-size: .82rem; color: var(--text); font-weight: 500; }

/* Buttons */
.btn {
  background: var(--accent); color: #0a1418; border: none; border-radius: 10px; padding: 11px 18px;
  font-family: inherit; font-size: .88rem; font-weight: 600; cursor: pointer;
  transition: transform .14s var(--spring), box-shadow .2s var(--ease-out), opacity .15s;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  position: relative; overflow: hidden; -webkit-tap-highlight-color: transparent;
}
.btn::after {
  content: ""; position: absolute; top: 0; left: -120%; width: 60%; height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.4), transparent);
  transform: skewX(-20deg); transition: left .6s var(--ease-out);
}
.btn:hover:not(:disabled) { box-shadow: 0 4px 16px var(--accent-glow); transform: translateY(-1px); }
.btn:hover:not(:disabled)::after { left: 140%; }
.btn:active:not(:disabled) { transform: translateY(0) scale(.97); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.full { width: 100%; }
.btn-ghost { background: transparent; border: 1px solid var(--border-strong); color: var(--text); border-radius: 10px; padding: 10px 18px; font-family: inherit; font-size: .85rem; font-weight: 500; cursor: pointer; transition: background .2s var(--ease-out), transform .14s var(--spring), border-color .2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; -webkit-tap-highlight-color: transparent; }
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); border-color: var(--accent-glow); }
.btn-ghost:active:not(:disabled) { transform: scale(.97); }
.btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-ghost.full { width: 100%; }
.btn-danger { background: rgba(244,126,110,0.1); border: 1px solid rgba(244,126,110,0.3); color: var(--bad); border-radius: 10px; padding: 11px 18px; font-family: inherit; font-size: .88rem; font-weight: 600; cursor: pointer; transition: background .15s; }
.btn-danger:hover { background: rgba(244,126,110,0.18); }
.btn-danger.full { width: 100%; }
.link-btn { background: transparent; border: none; color: var(--accent); font-family: inherit; font-size: .78rem; font-weight: 500; cursor: pointer; padding: 2px 6px; }
.link-btn:hover:not(:disabled) { text-decoration: underline; }
.link-btn:disabled { opacity: .4; cursor: not-allowed; }

/* Segmented control */
.seg { display: flex; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 3px; margin-bottom: 12px; }
.seg-btn { flex: 1; background: transparent; border: none; color: var(--muted); font-family: inherit; font-size: .8rem; font-weight: 500; padding: 7px 10px; border-radius: 6px; cursor: pointer; transition: all .15s; }
.seg-btn.active { background: var(--bg); color: var(--text); }

/* Upload */
.upload {
  border: 2px dashed var(--border-strong); border-radius: 10px; min-height: 140px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  cursor: pointer; color: var(--muted); margin-bottom: 12px; overflow: hidden;
  transition: border-color .25s var(--ease-out), background .25s, transform .15s var(--spring);
}
.upload:hover { border-color: var(--accent); background: var(--accent-dim); transform: scale(1.01); }
.upload:hover .upload-icon { animation: bob 1.2s ease-in-out infinite; }
@keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
.upload-icon { font-size: 2rem; }
.upload-img { width: 100%; max-height: 220px; object-fit: cover; }

/* AI cards */
.ai-card {
  background: var(--accent-dim); border: 1px solid rgba(110,231,247,0.2); border-radius: 12px; padding: 16px; margin-top: 4px;
  position: relative; animation: aiReveal .5s var(--ease-out) both;
}
.ai-card::before {
  content: ""; position: absolute; inset: -1px; border-radius: 12px; padding: 1px; pointer-events: none;
  background: linear-gradient(120deg, var(--accent), transparent 40%, transparent 60%, var(--accent));
  background-size: 300% 100%; -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude; opacity: .5; animation: sheen 4s linear infinite;
}
@keyframes aiReveal { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
.ai-card-label { font-size: .68rem; font-weight: 600; color: var(--accent); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
.ai-card-name { font-size: .95rem; font-weight: 500; margin-bottom: 12px; }
.conf-badge { font-size: .62rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; padding: 2px 7px; border-radius: 8px; margin-left: 8px; }
.conf-high { background: rgba(143,217,137,0.15); color: var(--good); }
.conf-medium { background: rgba(249,201,126,0.15); color: var(--warn); }
.conf-low { background: rgba(244,126,110,0.15); color: var(--bad); }
.web-toggle { display: flex; align-items: flex-start; gap: 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 10px; cursor: pointer; text-transform: none; letter-spacing: normal; }
.web-toggle input { width: 18px; height: 18px; margin-top: 1px; flex-shrink: 0; accent-color: var(--accent); cursor: pointer; }
.web-toggle-text { display: flex; flex-direction: column; gap: 2px; }
.web-toggle-title { font-size: .85rem; font-weight: 500; color: var(--text); }
.web-toggle-sub { font-size: .72rem; color: var(--muted); line-height: 1.4; }
.model-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.model-opt { text-align: left; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 14px; cursor: pointer; font-family: inherit; transition: border-color .15s, background .15s, transform .12s ease; -webkit-tap-highlight-color: transparent; }
.model-opt:active { transform: scale(.97); }
.model-opt.active { border-color: var(--accent); background: var(--accent-dim); }
.model-opt-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
.model-opt-name { font-size: .95rem; font-weight: 600; color: var(--text); }
.model-opt-check { color: var(--accent); font-weight: 700; }
.model-opt-desc { font-size: .73rem; color: var(--muted); line-height: 1.45; }
@media (max-width: 380px) { .model-opts { grid-template-columns: 1fr; } }
.ai-card-big { font-family: 'DM Serif Display', serif; font-size: 2.4rem; color: var(--accent); line-height: 1; margin-bottom: 6px; }
.ai-card-big span { font-family: 'Inter', sans-serif; font-size: .9rem; color: var(--muted); font-weight: 500; }
.ai-card-note { font-size: .82rem; color: var(--text-2); line-height: 1.55; margin-bottom: 12px; }

.macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px; }
.macro { background: var(--surface); border-radius: 8px; padding: 9px 6px; text-align: center; border: 1px solid var(--border); animation: macroPop .4s var(--spring) both; }
.macro:nth-child(2) { animation-delay: .06s; }
.macro:nth-child(3) { animation-delay: .12s; }
.macro:nth-child(4) { animation-delay: .18s; }
@keyframes macroPop { from { opacity: 0; transform: scale(.8); } to { opacity: 1; transform: none; } }
.macro-v { display: block; font-size: .95rem; font-weight: 600; color: var(--text); }
.macro-l { display: block; font-size: .62rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }

/* Spinner */
.spinner { display: inline-block; width: 13px; height: 13px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
.spinner.inline { width: 12px; height: 12px; }
@keyframes spin { to { transform: rotate(360deg); } }
.loading-row { display: flex; align-items: center; gap: 10px; color: var(--accent); font-size: .85rem; }

/* Errors */
.err { padding: 10px 14px; background: rgba(244,126,110,0.08); border: 1px solid rgba(244,126,110,0.25); color: var(--bad); border-radius: 8px; font-size: .82rem; margin-top: 10px; }

/* Empty */
.empty { text-align: center; padding: 24px 12px; }
.empty-icon { font-size: 1.6rem; color: var(--muted); margin-bottom: 8px; opacity: 0.5; display: inline-block; animation: breathe 3s ease-in-out infinite; }
@keyframes breathe { 0%, 100% { transform: scale(1); opacity: .4; } 50% { transform: scale(1.08); opacity: .6; } }
.empty-title { color: var(--text-2); font-size: .92rem; font-weight: 500; }
.empty-hint { color: var(--muted); font-size: .8rem; margin-top: 4px; line-height: 1.5; }

/* History list */
.hist-list { display: flex; flex-direction: column; gap: 4px; }
.hist { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; transition: border-color .2s, transform .15s var(--ease-out); }
.hist:hover { border-color: var(--border-strong); }
.hist.open { border-color: var(--border-strong); }
.hist-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; gap: 10px; cursor: pointer; }
.hist-l { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.hist-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.hist-text { min-width: 0; flex: 1; }
.hist-main { font-size: .87rem; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hist-date { font-size: .72rem; color: var(--muted); margin-top: 2px; }
.hist-tags { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.hist-tag { font-size: .7rem; color: var(--muted); background: var(--surface); border: 1px solid var(--border); padding: 2px 8px; border-radius: 8px; white-space: nowrap; }
.hist-detail { padding: 0 12px 12px; font-size: .85rem; color: var(--text-2); line-height: 1.5; border-top: 1px solid var(--border); padding-top: 10px; }
.raw-text { font-family: ui-monospace, monospace; font-size: .78rem; white-space: pre-wrap; word-break: break-word; line-height: 1.6; background: var(--bg); padding: 12px; border-radius: 8px; }

/* List rows (water log etc) */
.list { display: flex; flex-direction: column; gap: 4px; }
.list-row { display: flex; align-items: center; gap: 12px; padding: 9px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; }
.list-main { flex: 1; font-size: .87rem; }
.x { background: transparent; border: none; color: var(--muted); cursor: pointer; font-size: 1.3rem; line-height: 1; padding: 4px 6px; border-radius: 4px; transition: color .15s; }
.x:hover { color: var(--bad); background: rgba(244,126,110,0.08); }

/* Inline form */
.inline-form { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
.inline-form input { flex: 1; }

/* Trends */
.trend-stats { display: flex; gap: 18px; margin-bottom: 10px; }
.ts { display: flex; flex-direction: column; gap: 2px; }
.ts-l { font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
.ts-v { font-size: .98rem; font-weight: 600; color: var(--text); }
.ts-v.good { color: var(--good); }
.ts-v.warn { color: var(--warn); }
.ts-v.neutral { color: var(--text-2); }
.ts-v.muted { color: var(--muted); }
.chart { width: 100%; height: 70px; display: block; }
.muted-center { color: var(--muted); font-size: .82rem; text-align: center; padding: 18px; font-style: italic; }

.bars-row { display: grid; grid-auto-columns: 1fr; grid-auto-flow: column; gap: 3px; height: 56px; align-items: end; }
.bar-col { height: 100%; display: flex; align-items: flex-end; }
.bar-fill { width: 100%; min-height: 3px; background: var(--accent); border-radius: 2px; transition: height .6s ease; }

/* Week mini */
.week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; align-items: end; }
.week-col { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.week-bar-wrap { width: 100%; height: 64px; background: var(--surface-2); border-radius: 4px; display: flex; align-items: flex-end; overflow: hidden; }
.week-bar { width: 100%; border-radius: 3px; min-height: 3px; transition: height .6s; transform-origin: bottom; animation: growUp .6s var(--ease-out) both; }
@keyframes growUp { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.week-day { font-size: .68rem; color: var(--muted); font-weight: 500; }
.week-val { font-size: .64rem; color: var(--text-2); }

.center-stack { display: flex; justify-content: center; padding: 8px 0 16px; }

/* Markdown */
.md > *:first-child { margin-top: 0; }
.md > *:last-child { margin-bottom: 0; }
.md-p { line-height: 1.55; margin: 6px 0 0; font-size: .87rem; }
.md-h1 { font-family: 'DM Serif Display', serif; font-size: 1rem; color: var(--text); margin: 12px 0 4px; font-weight: 400; }
.md-h2 { font-family: 'DM Serif Display', serif; font-size: .9rem; color: var(--text); margin: 10px 0 4px; font-weight: 400; }
.md-ul, .md-ol { margin: 6px 0; padding-left: 18px; font-size: .87rem; }
.md-ul li, .md-ol li { margin: 3px 0; line-height: 1.5; }
.md-ul { list-style: none; padding-left: 0; }
.md-ul li { position: relative; padding-left: 14px; }
.md-ul li::before { content: "→"; position: absolute; left: 0; color: var(--accent); }
.md-code { background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-size: .82em; font-family: ui-monospace, monospace; }

/* Coach */
.coach-wrap { display: flex; flex-direction: column; min-height: calc(100dvh - 200px); }
.coach-bar { display: flex; justify-content: space-between; align-items: center; padding: 0 4px 14px; }
.coach-bar-l { display: flex; flex-direction: column; }
.coach-bar-title { font-size: .92rem; font-weight: 600; }
.coach-bar-r { display: flex; gap: 4px; }
.msgs { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 12px; min-height: 200px; }
.msg { display: flex; gap: 8px; align-items: flex-start; animation: msgIn .4s var(--ease-out) both; }
.msg.assistant { animation-name: msgInLeft; }
.msg.user { flex-direction: row-reverse; animation-name: msgInRight; }
@keyframes msgInLeft { from { opacity: 0; transform: translate(-12px, 6px); } to { opacity: 1; transform: none; } }
@keyframes msgInRight { from { opacity: 0; transform: translate(12px, 6px); } to { opacity: 1; transform: none; } }
.avatar { width: 26px; height: 26px; border-radius: 8px; background: var(--accent-dim); border: 1px solid rgba(110,231,247,0.25); display: flex; align-items: center; justify-content: center; font-size: .72rem; color: var(--accent); flex-shrink: 0; margin-top: 2px; }
.bubble { max-width: 82%; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 10px 14px; }
.msg.user .bubble { background: var(--accent-dim); border-color: rgba(110,231,247,0.2); border-radius: 14px 14px 4px 14px; }
.msg.assistant .bubble { border-radius: 4px 14px 14px 14px; }
.bubble.typing { display: flex; gap: 4px; padding: 14px; }
.bubble.typing span { width: 6px; height: 6px; background: var(--muted); border-radius: 50%; animation: bounce .9s infinite; }
.bubble.typing span:nth-child(2) { animation-delay: .15s; }
.bubble.typing span:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }

.suggs { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 2px 12px; }
.sugg { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 6px 12px; color: var(--text-2); font-family: inherit; font-size: .78rem; cursor: pointer; transition: color .2s, border-color .2s, transform .14s var(--spring); -webkit-tap-highlight-color: transparent; }
.sugg:hover { color: var(--accent); border-color: rgba(110,231,247,0.3); transform: translateY(-2px); }
.sugg:active { transform: scale(.95); }

.composer { display: flex; gap: 8px; padding: 12px 2px 8px; position: sticky; bottom: calc(80px + env(safe-area-inset-bottom)); background: var(--bg); margin-top: auto; }
.composer::before { content: ""; position: absolute; left: 0; right: 0; top: -16px; height: 16px; background: linear-gradient(transparent, var(--bg)); pointer-events: none; }
.composer input { flex: 1; }
.send { width: 38px; height: 38px; min-width: 38px; border-radius: 10px; background: var(--accent); color: #0a1418; border: none; font-size: 1.1rem; font-weight: 700; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: transform .14s var(--spring), box-shadow .2s; -webkit-tap-highlight-color: transparent; }
.send:hover:not(:disabled) { box-shadow: 0 4px 14px var(--accent-glow); transform: translateY(-1px); }
.send:active:not(:disabled) { transform: scale(.88); }
.send:disabled { opacity: 0.35; cursor: not-allowed; }

/* Analysis */
.analysis-stack { animation: fade .2s ease; }
.score-row { display: flex; align-items: center; gap: 16px; }
.score-ring { position: relative; width: 80px; height: 80px; flex-shrink: 0; animation: ringDraw .7s var(--ease-out) both; }
.score-ring svg { width: 80px; height: 80px; }
.score-ring svg circle:last-child { filter: drop-shadow(0 0 4px var(--accent-glow)); }
.score-n { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: 'DM Serif Display', serif; font-size: 1.5rem; }
.score-n span { font-family: 'Inter', sans-serif; font-size: .62rem; color: var(--muted); margin-left: 2px; }

.priority-card { background: var(--accent-dim); border-color: rgba(110,231,247,0.2); animation: priorityGlow 3.5s ease-in-out infinite; }
@keyframes priorityGlow { 0%, 100% { box-shadow: var(--shadow-card); } 50% { box-shadow: var(--shadow-card), 0 0 24px var(--accent-dim); } }
.priority-label { font-size: .68rem; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
.priority-text { font-size: .92rem; line-height: 1.55; color: var(--text); font-weight: 500; }

.ana-hd { display: flex; justify-content: space-between; align-items: center; }
.ana-score { display: flex; align-items: center; gap: 7px; font-size: .85rem; font-weight: 600; }
.ana-dot { width: 7px; height: 7px; border-radius: 50%; }
.ana-tips { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 7px; }
.ana-tips li { display: flex; gap: 9px; font-size: .85rem; color: var(--text); line-height: 1.5; animation: slideRight .45s var(--ease-out) both; }
.ana-tips li:nth-child(2) { animation-delay: .08s; }
.ana-tips li:nth-child(3) { animation-delay: .16s; }
.ana-arrow { color: var(--accent); font-weight: 700; flex-shrink: 0; }

/* Settings macros bar */
.macro-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; gap: 2px; background: var(--surface-2); margin: 10px 0 8px; }
.macro-seg { height: 100%; transition: width .4s; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: .73rem; color: var(--text-2); }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; }
.divider { height: 1px; background: var(--border); margin: 16px 0; }

/* Export grid */
.exp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
.exp-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 14px 8px; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; transition: border-color .2s, transform .15s var(--spring), box-shadow .2s; color: var(--text); font-family: inherit; -webkit-tap-highlight-color: transparent; }
.exp-card:hover:not(:disabled) { border-color: var(--accent); transform: translateY(-3px); box-shadow: var(--shadow-card); }
.exp-card:active:not(:disabled) { transform: translateY(0) scale(.96); }
.exp-card:disabled { opacity: 0.4; cursor: not-allowed; }
.exp-icon { font-size: 1.4rem; color: var(--accent); margin-bottom: 2px; transition: transform .3s var(--spring); }
.exp-card:hover:not(:disabled) .exp-icon { transform: scale(1.2); }
.exp-name { font-size: .82rem; font-weight: 500; }
.exp-n { font-size: .65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }

/* Stats */
.stat-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stat { text-align: center; padding: 14px 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; }
.stat-n { font-family: 'DM Serif Display', serif; font-size: 1.6rem; color: var(--accent); line-height: 1; margin-bottom: 4px; }
.stat-l { font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }

.danger-card { border-color: rgba(244,126,110,0.2); }
.muted-tag { font-size: .72rem; color: var(--good); }

/* Helpers */
.muted { color: var(--muted); }
.small { font-size: .76rem; }
.center { text-align: center; }

/* Tab icons */
.tabbtn-icon { line-height: 0; }
.tabbtn svg { display: block; }

/* Rings zero-state */
.rings-zero { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); font-size: .82rem; color: var(--muted); text-align: center; line-height: 1.5; }

/* Recent-after (under log forms) */
.recent-after { margin-top: 4px; }
.recent-after-label { font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; padding: 0 4px 6px; }
.recent-after-list { display: flex; flex-direction: column; gap: 4px; }
.recent-after-item { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; font-size: .82rem; }
.ra-main { color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ra-date { color: var(--muted); font-size: .72rem; white-space: nowrap; flex-shrink: 0; }

/* Toast */
.toast-host { position: fixed; left: 0; right: 0; bottom: calc(96px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 200; pointer-events: none; padding: 0 18px; }
.toast { background: var(--surface-2); border: 1px solid var(--border-strong); color: var(--text); border-radius: 12px; padding: 10px 18px; font-size: .85rem; font-weight: 500; box-shadow: 0 8px 24px rgba(0,0,0,0.4); animation: toastIn .25s cubic-bezier(.2,.8,.2,1); max-width: 100%; }
@keyframes toastIn { from { opacity: 0; transform: translateY(12px) scale(.96); } to { opacity: 1; transform: none; } }

/* Modal */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 24px; z-index: 300; animation: fade .15s ease; }
.modal { background: var(--surface); border: 1px solid var(--border-strong); border-radius: 16px; padding: 22px; max-width: 360px; width: 100%; animation: modalIn .2s cubic-bezier(.2,.8,.2,1); }
@keyframes modalIn { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: none; } }
.modal-title { font-family: 'DM Serif Display', serif; font-size: 1.2rem; font-weight: 400; margin-bottom: 8px; }
.modal-body { color: var(--text-2); font-size: .88rem; line-height: 1.55; margin-bottom: 18px; }
.modal-actions { display: flex; gap: 8px; }

/* Boot spinner */
.boot { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; color: var(--accent); }

/* Auth screen */
.auth { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.auth-box { width: 100%; max-width: 360px; animation: authIn .6s var(--ease-out) both; }
@keyframes authIn { from { opacity: 0; transform: translateY(16px) scale(.98); } to { opacity: 1; transform: none; } }
.auth-brand { font-family: 'DM Serif Display', serif; font-size: 2.4rem; color: var(--text); text-align: center; font-weight: 400; }
.auth-sub { text-align: center; color: var(--muted); margin: 4px 0 24px; font-size: .9rem; }
.auth-box label { margin-bottom: 12px; }
.auth-switch { text-align: center; margin-top: 16px; font-size: .85rem; color: var(--muted); }
.auth-switch .link-btn { font-size: .85rem; margin-left: 4px; }

/* Sync badge */
.sync-badge { display: inline-flex; align-items: center; gap: 6px; font-size: .72rem; color: var(--muted); margin-left: 12px; }
.topbar { display: flex; align-items: center; }

/* Account */
.account-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.account-email { font-size: .9rem; font-weight: 500; color: var(--text); margin-bottom: 3px; }

/* ─── Coach images ─── */
.bubble-img { display: block; max-width: 220px; width: 100%; border-radius: 10px; margin-bottom: 8px; }
.bubble-img-gone { font-size: .8rem; color: var(--muted); background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; margin-bottom: 8px; display: inline-block; }
.composer-wrap { position: sticky; bottom: calc(80px + env(safe-area-inset-bottom)); background: var(--bg); padding-top: 10px; margin-top: auto; }
.composer-wrap::before { content: ""; position: absolute; left: 0; right: 0; top: -16px; height: 16px; background: linear-gradient(transparent, var(--bg)); pointer-events: none; }
.attach-preview { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 8px; margin-bottom: 8px; position: relative; animation: riseIn .3s var(--ease-out) both; }
.attach-preview img { width: 48px; height: 48px; object-fit: cover; border-radius: 8px; }
.attach-label { font-size: .82rem; color: var(--text-2); }
.attach-x { margin-left: auto; background: var(--surface-2); border: none; color: var(--text); width: 26px; height: 26px; border-radius: 50%; cursor: pointer; font-size: 1rem; line-height: 1; flex-shrink: 0; }
.attach-btn { width: 38px; height: 38px; min-width: 38px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); cursor: pointer; font-size: 1.05rem; flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: transform .12s ease, background .15s; -webkit-tap-highlight-color: transparent; }
.attach-btn:active { transform: scale(.9); }
.attach-btn:disabled { opacity: .4; }

/* ─── Diet photo choices ─── */
.photo-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.photo-choice { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 22px 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: pointer; color: var(--text); font-family: inherit; font-size: .85rem; font-weight: 500; transition: transform .12s ease, border-color .15s, background .15s; -webkit-tap-highlight-color: transparent; }
.photo-choice:hover { border-color: var(--accent); background: var(--accent-dim); }
.photo-choice:active { transform: scale(.96); }
.photo-choice-icon { font-size: 1.8rem; }
.upload.has-img { position: relative; padding: 0; min-height: 0; }
.upload-replace { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.6); color: #fff; font-size: .72rem; padding: 4px 10px; border-radius: 12px; backdrop-filter: blur(4px); }

/* ─── Streak chip ─── */
.greeting-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.streak-chip { font-size: .78rem; font-weight: 600; color: var(--warn); background: rgba(249,201,126,0.12); border: 1px solid rgba(249,201,126,0.25); padding: 3px 10px; border-radius: 14px; animation: streakPop .5s var(--spring) both; }
@keyframes streakPop { 0% { opacity: 0; transform: scale(.6); } 60% { transform: scale(1.12); } 100% { opacity: 1; transform: scale(1); } }

/* ─── Day progress bar ─── */
.day-progress { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }
.day-progress-bar { height: 6px; background: var(--track); border-radius: 3px; overflow: hidden; }
.day-progress-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--accent), #8fd989); transition: width 1s var(--ease-out); box-shadow: 0 0 10px var(--accent-glow); }
.day-progress-label { display: block; text-align: center; font-size: .78rem; color: var(--text-2); margin-top: 8px; }

/* ─── Mobile friendliness ─── */
@media (max-width: 520px) {
  .app { padding: 0 14px 96px; padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
  .greeting-h { font-size: 1.6rem; }
  .rings-row { gap: 2px; }
  .ring-val.big { font-size: 1.15rem; }
  .ring svg { width: 104px; height: 104px; }
  .quick-actions { grid-template-columns: 1fr 1fr; }
  .ring-targets { font-size: .66rem; flex-wrap: wrap; gap: 4px; }
  .card { padding: 16px; }
  .field-grid, .field-grid.three { grid-template-columns: 1fr 1fr; }
  .macros { grid-template-columns: repeat(2, 1fr); }
  .bubble { max-width: 88%; }
  .subtab { font-size: .76rem; padding: 8px 8px; min-width: 54px; }
  .tabbtn-label { font-size: .62rem; }
}
@media (max-width: 360px) {
  .field-grid, .field-grid.three { grid-template-columns: 1fr; }
  .quick-actions { grid-template-columns: 1fr; }
}
/* Larger tap targets + no tap highlight on interactive things */
button, .qa, .subtab, .seg-btn, .exp-card, .photo-choice, .tabbtn { -webkit-tap-highlight-color: transparent; }
input, select, textarea { font-size: 16px; } /* prevents iOS zoom-on-focus */
@media (min-width: 521px) { input, select, textarea { font-size: .92rem; } }

/* ─── Macro donut ─── */
.donut { position: relative; flex-shrink: 0; }
.donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.donut-center span { font-family: 'DM Serif Display', serif; font-size: 1.1rem; line-height: 1; }
.donut-center small { font-size: .58rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.result-with-donut { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
.macros-compact { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; flex: 1; margin-bottom: 0; }

/* ─── Running total ─── */
.running-total { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
.rt-row { display: flex; justify-content: space-between; gap: 8px; }
.rt-item { display: flex; flex-direction: column; gap: 2px; align-items: center; flex: 1; }
.rt-v { font-family: 'DM Serif Display', serif; font-size: 1.35rem; line-height: 1; color: var(--text); }
.rt-v.rt-over { color: var(--bad); }
.rt-sub { font-family: 'Inter', sans-serif; font-size: .62rem; color: var(--muted); font-weight: 500; }
.rt-l { font-size: .64rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
.rt-bar { height: 5px; background: var(--track); border-radius: 3px; overflow: hidden; margin: 12px 0 8px; }
.rt-bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), #8fd989); border-radius: 3px; transition: width .6s var(--ease-out); }
.rt-hint { text-align: center; font-size: .74rem; color: var(--text-2); }

/* ─── Workout parse preview ─── */
.parse-preview { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin: 4px 0 12px; }
.parse-head { display: flex; justify-content: space-between; font-size: .76rem; color: var(--text-2); margin-bottom: 8px; flex-wrap: wrap; gap: 4px; }
.parse-vol { color: var(--accent); font-weight: 500; }
.parse-list { display: flex; flex-direction: column; gap: 5px; }
.parse-ex { display: flex; justify-content: space-between; gap: 8px; font-size: .82rem; }
.parse-ex-name { color: var(--text); font-weight: 500; }
.parse-ex-detail { color: var(--muted); flex-shrink: 0; }

/* ─── Plan tab ─── */
.weekgrid-label { font-size: .73rem; color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: .04em; margin: 14px 0 8px; }
.weekgrid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.weekday { aspect-ratio: 1; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2); color: var(--muted); font-family: inherit; font-size: .76rem; font-weight: 600; cursor: pointer; transition: transform .12s ease, background .15s, color .15s, border-color .15s; -webkit-tap-highlight-color: transparent; }
.weekday:active { transform: scale(.9); }
.weekday.on { background: var(--accent-dim); color: var(--accent); border-color: rgba(110,231,247,0.4); }
.weekday.today { box-shadow: 0 0 0 2px var(--accent-glow); }
.week-outline { display: flex; flex-direction: column; gap: 6px; }
.wo-day { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; }
.wo-day.today { border-color: rgba(110,231,247,0.4); }
.wo-day-name { width: 64px; flex-shrink: 0; font-size: .82rem; font-weight: 600; color: var(--text); display: flex; flex-direction: column; gap: 2px; }
.wo-today-tag { font-size: .6rem; color: var(--accent); font-weight: 500; text-transform: uppercase; }
.wo-input { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 7px; padding: 8px 10px; font-size: .85rem; }
.wo-rest { flex: 1; font-size: .82rem; color: var(--muted); font-style: italic; }
.rec-result { animation: riseIn .3s var(--ease-out) both; }
.rec-badge { display: inline-block; padding: 6px 14px; border-radius: 16px; border: 1px solid; font-size: .85rem; font-weight: 600; margin-bottom: 10px; }
.rec-reason { font-size: .88rem; line-height: 1.55; color: var(--text); margin-bottom: 8px; }
.rec-tip { font-size: .82rem; color: var(--text-2); line-height: 1.5; background: var(--surface-2); border-radius: 8px; padding: 8px 10px; }

/* ─── Achievements ─── */
.ach-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; }
.ach { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 12px 6px; border-radius: 10px; border: 1px solid var(--border); text-align: center; transition: transform .15s; }
.ach.got { background: var(--accent-dim); border-color: rgba(110,231,247,0.25); }
.ach.got:hover { transform: translateY(-2px); }
.ach.locked { background: var(--surface-2); opacity: .45; filter: grayscale(1); }
.ach-icon { font-size: 1.5rem; line-height: 1; }
.ach-title { font-size: .64rem; color: var(--text-2); font-weight: 500; line-height: 1.2; }

/* ─── Chart tooltip + legend ─── */
.chart-wrap { position: relative; }
.chart-tip { position: absolute; top: -4px; transform: translateX(-50%); background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: 8px; padding: 4px 9px; display: flex; flex-direction: column; align-items: center; pointer-events: none; z-index: 5; white-space: nowrap; animation: fade .12s ease; }
.chart-tip-v { font-size: .8rem; font-weight: 600; color: var(--accent); }
.chart-tip-d { font-size: .64rem; color: var(--muted); }
.chart-legend { display: flex; align-items: center; gap: 6px; font-size: .68rem; color: var(--muted); margin-top: 6px; justify-content: flex-end; }
.cl-line { display: inline-block; width: 14px; height: 0; border-top: 2px solid var(--accent); }
.cl-line.dash { border-top: 2px dashed #f9c97e; }

/* ─── Heatmap ─── */
.heatmap { display: flex; gap: 3px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
.heatmap::-webkit-scrollbar { display: none; }
.hm-col { display: flex; flex-direction: column; gap: 3px; }
.hm-cell { width: 14px; height: 14px; border-radius: 3px; background: var(--surface-2); flex-shrink: 0; }
.hm-cell.hm--1 { background: transparent; }
.hm-cell.hm-0 { background: rgba(255,255,255,0.04); }
.hm-cell.hm-1 { background: rgba(110,231,247,0.25); }
.hm-cell.hm-2 { background: rgba(110,231,247,0.45); }
.hm-cell.hm-3 { background: rgba(110,231,247,0.7); }
.hm-cell.hm-4 { background: var(--accent); }
.hm-legend { display: flex; align-items: center; gap: 4px; justify-content: flex-end; margin-top: 10px; font-size: .68rem; color: var(--muted); }

/* ─── Onboarding ─── */
.ob { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.ob-box { width: 100%; max-width: 380px; }
.ob-progress { display: flex; gap: 6px; justify-content: center; margin-bottom: 24px; }
.ob-dot { width: 28px; height: 4px; border-radius: 2px; background: var(--surface-2); transition: background .3s; }
.ob-dot.on { background: var(--accent); }
.ob-step { animation: riseIn .35s var(--ease-out) both; }
.ob-logo { font-family: 'DM Serif Display', serif; font-size: 2.6rem; text-align: center; background: linear-gradient(100deg, var(--text) 30%, var(--accent)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px; }
.ob-h { font-family: 'DM Serif Display', serif; font-size: 1.6rem; font-weight: 400; text-align: center; margin-bottom: 10px; }
.ob-p { color: var(--text-2); text-align: center; font-size: .9rem; line-height: 1.55; margin-bottom: 22px; }
.ob-choices { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
.ob-choice { padding: 14px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-family: inherit; font-size: .92rem; font-weight: 500; cursor: pointer; transition: transform .12s ease, background .15s, border-color .15s; -webkit-tap-highlight-color: transparent; }
.ob-choice:active { transform: scale(.97); }
.ob-choice.on { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
.ob-cal { display: flex; align-items: center; justify-content: center; gap: 18px; margin-bottom: 14px; }
.ob-cal-val { font-family: 'DM Serif Display', serif; font-size: 2.4rem; min-width: 130px; text-align: center; }
.ob-cal-val span { font-family: 'Inter', sans-serif; font-size: .9rem; color: var(--muted); margin-left: 4px; }
.ob-step-btn { width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text); font-size: 1.5rem; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: transform .12s ease; }
.ob-step-btn:active { transform: scale(.88); }
.ob-macros { text-align: center; font-size: .8rem; color: var(--muted); margin-bottom: 22px; }
.ob-back { display: block; margin: 14px auto 0; }

@media (max-width: 520px) {
  .result-with-donut { gap: 12px; }
  .hm-cell { width: 12px; height: 12px; }
}

/* ─── History detail extras ─── */
.diet-detail { display: flex; align-items: center; gap: 16px; }
.diet-detail-macros { font-size: .82rem; line-height: 1.7; }
.pr-banner { background: rgba(249,201,126,0.12); border: 1px solid rgba(249,201,126,0.3); color: var(--warn); border-radius: 8px; padding: 8px 10px; font-size: .8rem; font-weight: 500; margin-bottom: 10px; }
.ex-detail-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.ex-detail-row { display: flex; justify-content: space-between; gap: 8px; font-size: .82rem; }

/* ─── AI plan builder ─── */
.prompt-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.prompt-chip { background: var(--surface-2); border: 1px solid var(--border); border-radius: 14px; padding: 6px 11px; color: var(--text-2); font-family: inherit; font-size: .74rem; cursor: pointer; transition: color .15s, border-color .15s; text-align: left; -webkit-tap-highlight-color: transparent; }
.prompt-chip:hover { color: var(--accent); border-color: rgba(110,231,247,0.3); }
.build-result { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); animation: riseIn .35s var(--ease-out) both; }
.build-split-tag { display: inline-block; background: var(--accent-dim); border: 1px solid rgba(110,231,247,0.3); color: var(--accent); font-size: .76rem; font-weight: 600; padding: 4px 12px; border-radius: 14px; margin-bottom: 12px; }
.build-week { display: flex; flex-direction: column; gap: 5px; }
.build-day { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 9px; background: var(--surface-2); border: 1px solid var(--border); }
.build-day.on { background: var(--accent-dim); border-color: rgba(110,231,247,0.25); }
.build-day-name { width: 42px; font-size: .8rem; font-weight: 600; color: var(--text); flex-shrink: 0; }
.build-day-w { font-size: .85rem; color: var(--text-2); }
.build-day.on .build-day-w { color: var(--text); font-weight: 500; }
.build-summary { font-size: .86rem; line-height: 1.55; color: var(--text); margin-top: 12px; }
.build-tips { margin: 10px 0 0; padding-left: 18px; }
.build-tips li { font-size: .82rem; color: var(--text-2); line-height: 1.5; margin: 4px 0; }

/* ─── Coach view segmented ─── */
.coach-seg { margin-bottom: 14px; }

/* ─── Physique check ─── */
.phys-img { width: 100%; max-height: 360px; object-fit: contain; border-radius: 12px; background: var(--surface-2); margin-bottom: 6px; }
.phys-result { animation: riseIn .35s var(--ease-out) both; }
.phys-summary { font-size: .92rem; line-height: 1.55; color: var(--text); margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
.phys-section { margin-bottom: 14px; }
.phys-section:last-child { margin-bottom: 0; }
.phys-section-h { font-size: .76rem; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
.phys-list { margin: 0; padding-left: 0; list-style: none; }
.phys-list li { position: relative; padding-left: 14px; margin: 5px 0; font-size: .86rem; line-height: 1.55; color: var(--text); }
.phys-list li::before { content: "→"; position: absolute; left: 0; color: var(--accent); font-weight: 700; }
.phys-p { font-size: .86rem; line-height: 1.55; color: var(--text); }

/* ─── Sound settings ─── */
.sound-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.sound-info { display: flex; flex-direction: column; gap: 2px; }
.sound-state { font-size: .95rem; font-weight: 600; color: var(--text); }
.toggle-switch { width: 52px; height: 30px; border-radius: 15px; background: var(--surface-2); border: 1px solid var(--border); position: relative; cursor: pointer; flex-shrink: 0; transition: background .2s, border-color .2s; -webkit-tap-highlight-color: transparent; padding: 0; }
.toggle-switch.on { background: var(--accent-dim); border-color: var(--accent); }
.toggle-knob { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: var(--muted); transition: transform .2s var(--spring), background .2s; }
.toggle-switch.on .toggle-knob { transform: translateX(22px); background: var(--accent); }
.sound-samples { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.sample-btn { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 8px 14px; color: var(--text-2); font-family: inherit; font-size: .82rem; font-weight: 500; cursor: pointer; transition: transform .12s ease, border-color .15s, color .15s; -webkit-tap-highlight-color: transparent; }
.sample-btn:hover { color: var(--accent); border-color: rgba(110,231,247,0.3); }
.sample-btn:active { transform: scale(.93); }

/* ─── Barcode scanner ─── */
.seg-three .seg-btn { font-size: .82rem; padding: 9px 6px; }
.bc-start { padding: 8px 0; }
.scan-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(6px); }
.scan-modal { background: var(--surface); border: 1px solid var(--border-strong); border-radius: 18px; width: 100%; max-width: 420px; overflow: hidden; animation: riseIn .3s var(--ease-out) both; }
.scan-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border); font-weight: 600; }
.scan-x { background: var(--surface-2); border: none; color: var(--text); width: 30px; height: 30px; border-radius: 50%; font-size: 1.3rem; line-height: 1; cursor: pointer; }
.scan-view { position: relative; background: #000; aspect-ratio: 4 / 3; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.scan-video { width: 100%; height: 100%; object-fit: cover; }
.scan-frame { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 72%; height: 42%; border: 2px solid var(--accent); border-radius: 12px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.35); overflow: hidden; }
.scan-line { position: absolute; left: 0; right: 0; height: 2px; background: var(--accent); box-shadow: 0 0 8px var(--accent); animation: scanline 2s ease-in-out infinite; }
@keyframes scanline { 0%, 100% { top: 8%; } 50% { top: 92%; } }
.scan-hint { position: absolute; bottom: 12px; left: 0; right: 0; text-align: center; color: #fff; font-size: .82rem; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
.scan-fallback { padding: 18px 16px 4px; }
.scan-err { color: var(--bad); font-size: .85rem; line-height: 1.5; margin-bottom: 12px; }
.scan-manual { display: flex; gap: 8px; padding: 0 16px 18px; }
.scan-manual input { flex: 1; }
.bc-portion { margin-bottom: 12px; }
@media (prefers-reduced-motion: reduce) { .scan-line { animation: none; top: 50%; } }
`;
