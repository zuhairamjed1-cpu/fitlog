// ─── APP CONFIG / CONSTANTS ─────────────────────────────────────────────────────
// Pure, dependency-light constants shared across views. Extracted from App.jsx so
// lazily-loaded view modules can import these directly without pulling in App.jsx.
import { STORAGE_KEY } from "./lib/keys";

export const TABS = ["Home", "Log", "History", "Coach", "Journal", "Settings", "Ejac"];

// Single source of truth for the fallback sleep need (hours) when nothing is
// learned or set. Imported by sleep.js, sleepScore.js, and GoalPlan.jsx.
export const DEFAULT_SLEEP_NEED_H = 8;

export const defaultData = { sleep: [], sleepArchive: [], diet: [], exercise: [], sports: [], water: [], supplements: [], supplementLib: [], nicotine: [], nicotinePlans: [], journal: [], weight: [], ejac: [], tasks: [], notes: [], experiments: [], skin: [], stool: [], skinResearch: [], skinProcedures: [], plannedSessions: [], skinRoutineLogs: [], skinProductIntros: [], skinRoutineChanges: [], skinCoachPlans: [], goalSnapshots: [], goalReports: [], completedPhases: [], decisionLog: [], constraintSnapshots: [] };

export const defaultProfile = {
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

export const defaultStrategy = {
  phase: "", // bulk | cut | maintenance | recomp | performance | (empty)
  focus: "", // strength | hypertrophy | conditioning | fat loss | general
  blockStarted: "", // YYYY-MM-DD when current block started
  blockWeeks: "", // target length of current block, e.g. "6"
  notes: "", // free text — anything else the AI should know about strategy right now
};

export const defaultGoals = { calories: 2500, protein: 180, carbs: 250, fat: 80, goal: "Build Muscle", waterGoalMl: 2500, profile: defaultProfile, strategy: defaultStrategy, sleepScreen: null, sleepExperiment: null, skinRoutine: { am: [], pm: [] }, skinExperiment: null, goalPlan: null, macroMode: "manual", nutrition: { biologicalDay: true } };
export const fitnessGoals = ["Build Muscle", "Lose Fat", "Improve Endurance", "Maintain Weight", "Athletic Performance"];
export const mealTypes = ["Breakfast", "Pre-workout", "Post-workout", "Lunch", "Dinner", "Snack"];
export const sportsOptions = ["Running","Football","Basketball","Tennis","Swimming","Cycling","Yoga","Boxing","Soccer","Volleyball","Badminton","Table Tennis","Golf","Martial Arts","Hiking","Walking","Rowing","Climbing","Other"];
export const sleepQuality = ["Poor", "Fair", "Good", "Great", "Excellent"];
export const intensityLevels = ["Light", "Moderate", "Intense", "All-out"];

// ─── NICOTINE ─────────────────────────────────────────────────────────────────
export const NIC_TYPES = [
  { key: "cigarette", label: "Cigarette", icon: "🚬", unit: "cigarettes", combustion: true },
  { key: "vape", label: "Vape", icon: "💨", unit: "puffs", combustion: false },
  { key: "pouch", label: "Pouch", icon: "⬜", unit: "pouches", combustion: false },
];
export const NIC_CONTEXTS = ["craving", "stress", "social", "post-meal", "post-workout", "boredom", "drinking", "after waking"];
// One-tap defaults shown as quick-add chips. User's common entries.
export const NIC_QUICK = [
  { type: "cigarette", amount: 1, label: "1 cig" },
  { type: "vape", amount: 10, label: "Vape (10 puffs)" },
  { type: "vape", amount: 1, label: "1 puff" },
  { type: "pouch", amount: 1, mg: 6, label: "Pouch 6mg" },
];

// ─── WORKOUT PLANNING ─────────────────────────────────────────────────────────
export const SPLIT_TYPES = [
  "Push / Pull / Legs",
  "Upper / Lower",
  "Full Body",
  "Bro Split (1 muscle/day)",
  "Arnold Split",
  "Custom",
];
export const defaultPlan = { split: "Push / Pull / Legs", trainingDays: ["Mon", "Tue", "Thu", "Fri", "Sat"], assignments: {}, notes: "" };

export const TYPE_DOT = { sleep: "#6ee7f7", diet: "#f9c97e", exercise: "#f47e6e", sports: "#8fd989", water: "#5cc8df", supplements: "#b4a8e8", nicotine: "#d98fa8", weight: "#e8c97e", ejac: "#9aa8e8" };
export const TYPE_ICON = { sleep: "◐", diet: "◉", exercise: "◆", sports: "◇", water: "◊", supplements: "⊕" };

// ─── AI MODEL PREFERENCE ──────────────────────────────────────────────────────
export const MODELS = {
  haiku: { id: "claude-haiku-4-5", label: "Haiku", desc: "Fast & cheap — great for everyday logging" },
  sonnet: { id: "claude-sonnet-5", label: "Sonnet", desc: "Smartest — best accuracy, costs ~12x more" },
};
let _currentModel = (() => { try { return localStorage.getItem(STORAGE_KEY + "_model") === "sonnet" ? "sonnet" : "haiku"; } catch { return "haiku"; } })();
export function loadModelPref() {
  try { return localStorage.getItem(STORAGE_KEY + "_model") === "sonnet" ? "sonnet" : "haiku"; } catch { return "haiku"; }
}
export function saveModelPref(key) { localStorage.setItem(STORAGE_KEY + "_model", key); _currentModel = key; }
export function currentModelId() { return MODELS[_currentModel]?.id || MODELS.haiku.id; }
