// ─── PERSISTED DATA MODEL ───────────────────────────────────────────────────
// Types for everything FitLog stores in localStorage (keys `fitlog_v5*`) and
// mirrors to Supabase. Hand-derived from the write paths in the log forms and
// the defaults in config.js. Fields are marked optional where legacy rows (or
// certain code paths) may omit them — the goal is to describe reality, not to
// force a shape the running app doesn't already produce.

/** `YYYY-MM-DD` in the user's LOCAL timezone (see lib/dates.localDateStr). */
export type ISODate = string;
/** Epoch milliseconds (Date.now()). */
export type Millis = number;

/** Common fields on every log row. `id` is Date.now() at creation time. */
export interface BaseEntry {
  id: number;
  date: ISODate;
  /** Wall-clock creation timestamp. For meals this equals `consumedAt`. */
  ts?: Millis;
}

// ─── NUTRITION ──────────────────────────────────────────────────────────────
/** One resolved food line inside a multi-item meal capture. */
export interface DietItem {
  food: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * A logged meal.
 *
 * TIMESTAMP CONTRACT (the known silent-corruption risk — see report):
 *  - `consumedAt` = when the food was actually eaten. AUTHORITATIVE for all
 *    biological-day bucketing and protein-feeding ordering.
 *  - `ts`         = legacy/compat timestamp. New rows are written with
 *    `ts === consumedAt`; older rows may have `ts` but no `consumedAt`.
 *  - `loggedAt`   = when Save was pressed. Audit-only; never used for bucketing.
 *  Always resolve a meal's real time through engines/dayContext.mealTs(), which
 *  falls back consumedAt → ts → epoch(id). Reading `.ts` directly is only safe
 *  when the row is known to be new (ts === consumedAt).
 */
export interface DietEntry extends BaseEntry {
  meal: string;                 // meal type, e.g. "Breakfast" (see config.mealTypes)
  food: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  time?: string;                // "HH:MM" clock time
  consumedAt?: Millis;          // authoritative — may be absent on legacy rows
  loggedAt?: Millis;            // audit-only
  when?: string;                // the "When" selector choice at log time
  affectCoach?: boolean;
  excludeFromCoach?: boolean;
  items?: DietItem[];           // multi-item editable capture
  confidence?: "high" | "medium" | "low";
  notes?: string;
}

export interface WaterEntry extends BaseEntry {
  ml: number;
}

export interface SupplementEntry extends BaseEntry {
  name: string;
  dose: string;
  brand?: string;               // set when logged from a library item
}

/** A saved supplement definition (the "library"), added via AI product lookup. */
export interface SupplementLibItem {
  id: number;
  name: string;
  brand?: string;
  dose?: string;                // default single serving
  form?: string;                // powder | capsule | tablet | liquid | gummy | other
  serving?: string;             // serving-size text from the label
  notes?: string;               // key active + amount per serving
}

// ─── TRAINING ───────────────────────────────────────────────────────────────
export interface PR {
  name: string;
  weight: number;
  unit: string;
  reps: number;
}

/** One set within a parsed exercise. `rpe` present only when the user logged it. */
export interface ParsedSet {
  weight?: number;
  unit?: string;
  reps?: number;
  rpe?: number | null;
}

export interface ParsedExercise {
  name: string;
  sets: ParsedSet[];
}

/** Output of engines/workout.parseWorkout(), cached on the entry as `_parsed`. */
export interface ParsedWorkout {
  exercises: ParsedExercise[];
  totalVolume?: number;
  avgRPE?: number | null;
}

export interface ExerciseEntry extends BaseEntry {
  time?: string;
  label?: string;               // session label, e.g. "Push day"
  text: string;                 // raw pasted Strong-format text
  _parsed?: ParsedWorkout;      // cached parse
  prs?: PR[];
}

export interface SportsEntry extends BaseEntry {
  sport: string;
  duration: number;             // minutes
  intensity?: string;           // see config.intensityLevels
  calories?: number;
  time?: string;
  opponent?: string;
  score?: string;
  result?: string;
  notes?: string;
}

// ─── WELLNESS ───────────────────────────────────────────────────────────────
export interface SleepEntry extends BaseEntry {
  duration: number;             // hours in bed (TIB), NOT sleep time
  quality?: string;             // see config.sleepQuality
  bedtime?: string;             // "HH:MM"
  wakeTime?: string;            // "HH:MM"
  latencyMin?: number;          // mins to fall asleep (optional detail)
  wakeMin?: number;             // mins awake in the night (optional detail)
  notes?: string;
  alarmUsed?: boolean;          // true/false only if the user tapped; omitted when untouched
}

export type NicotineType = "cigarette" | "vape" | "pouch";

export interface NicotineEntry extends BaseEntry {
  type: NicotineType;
  amount: number;
  mg?: number;                  // pouch strength
  contexts?: string[];          // see config.NIC_CONTEXTS
}

export interface WeightEntry extends BaseEntry {
  kg: number;
}

export interface EjacEntry extends BaseEntry {
  porn: boolean;
  gooning: boolean;
}

// ─── GOALS / PROFILE / STRATEGY ─────────────────────────────────────────────
export interface Profile {
  sex: string;
  age: string | number;
  heightCm: string | number;
  weightKg: string | number;
  trainingExp: string;          // beginner | intermediate | advanced
  liftingBackground: string;
  injuries: string;
  allergies: string;
  equipment: string;            // gym | home | minimal | other
  preferences: string;
  lifeContext: string;
  sleepNeedH: string | number;
}

export interface Strategy {
  phase: string;                // bulk | cut | maintenance | recomp | performance | ""
  focus: string;
  blockStarted: string;         // YYYY-MM-DD
  blockWeeks: string | number;
  notes: string;
}

export interface TrainingPlan {
  split: string;                // see config.SPLIT_TYPES
  trainingDays: string[];       // weekday abbreviations, e.g. "Mon"
  assignments: Record<string, unknown>;
  dayReasons?: Record<string, string>;
  notes: string;
}

export interface NutritionSettings {
  biologicalDay: boolean;
}

/**
 * The Goal Plan V3 phase-based planner. Its internal phase shape is large and
 * lives in engines/phaseV3; kept loose here since it is not part of the
 * timestamp-correctness surface this migration targets.
 */
export interface GoalPlanV3 {
  active?: boolean;
  phases?: unknown[];
  [key: string]: unknown;
}

export interface Goals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  goal: string;                 // see config.fitnessGoals
  waterGoalMl: number;
  macroMode: "manual" | "auto";
  nutritionOverride?: boolean;
  profile: Profile;
  strategy: Strategy;
  plan?: TrainingPlan;
  nutrition: NutritionSettings;
  sleepScreen?: unknown | null;
  sleepExperiment?: unknown | null;
  skinRoutine?: { am: unknown[]; pm: unknown[] };
  skinExperiment?: unknown | null;
  goalPlan?: unknown | null;    // legacy V1 plan
  goalPlanV3?: GoalPlanV3 | null;
  exerciseMap?: Record<string, string>;
  onboarded?: boolean;
  sleepNeedH?: number;
}

// ─── TOP-LEVEL STORE SHAPE ──────────────────────────────────────────────────
/** Everything under the `fitlog_v5` localStorage key (see config.defaultData). */
export interface AppData {
  sleep: SleepEntry[];
  diet: DietEntry[];
  exercise: ExerciseEntry[];
  sports: SportsEntry[];
  water: WaterEntry[];
  supplements: SupplementEntry[];
  /** User's saved supplement library (definitions), populated via AI product lookup. */
  supplementLib: SupplementLibItem[];
  nicotine: NicotineEntry[];
  nicotinePlans: unknown[];
  journal: unknown[];
  weight: WeightEntry[];
  ejac: EjacEntry[];
  skin: unknown[];
  skinResearch: unknown[];
  skinProcedures: unknown[];
  plannedSessions: unknown[];
  skinRoutineLogs: unknown[];
  skinProductIntros: unknown[];
  skinRoutineChanges: unknown[];
  skinCoachPlans: unknown[];
  goalSnapshots: unknown[];
  goalReports: unknown[];
  completedPhases: unknown[];
  decisionLog: unknown[];
  constraintSnapshots: unknown[];
}

/** A key of AppData whose value is an array of log rows. */
export type EntryType = keyof AppData;
