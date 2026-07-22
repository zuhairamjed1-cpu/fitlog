import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { supabase, hasSupabase } from "./supabase";
import { ErrorBoundary } from "./ui/ErrorBoundary";
const CoachTab = lazy(() => import("./views/CoachTab"));
const HistoryTab = lazy(() => import("./views/HistoryTab"));
import { HomeTab } from "./views/HomeTab";
import { AuthScreen } from "./views/AuthScreen";
import { Onboarding } from "./views/Onboarding";
import { WelcomeSplash } from "./views/WelcomeSplash";
import { LogOverlay } from "./views/LogOverlay";
import { MeTab } from "./views/MeTab";
import { NicotineTab } from "./views/NicotineTab";
import { IntakeTab, WaterForm, WeightForm } from "./views/IntakeTab";
import { SleepForm, SleepSection } from "./views/SleepSection";
import { WorkoutScreen, WorkoutAnalysis, V3MusclePrioCard, ExerciseForm, SportsForm } from "./views/WorkoutScreen";
import { PlanTab } from "./views/PlanTab";
import { DietForm } from "./views/DietForm";
import { STORAGE_KEY } from "./lib/keys";
import { isTimed, decorateWithTime, nowHHMM, addMinutesHHMM } from "./lib/activityTime";
import { TABS, defaultData, defaultProfile, defaultStrategy, defaultGoals, fitnessGoals, mealTypes, sportsOptions, sleepQuality, intensityLevels, NIC_TYPES, NIC_CONTEXTS, NIC_QUICK, SPLIT_TYPES, defaultPlan, TYPE_DOT, TYPE_ICON, MODELS, loadModelPref, saveModelPref, currentModelId } from "./config";
import { loadData, loadGoals, saveData, saveGoals, setCurrentUser, cloudSync, cloudPull, cloudPushNow, flushSync } from "./state/store";
import { haptic, SFX, soundEnabled, setSoundPref } from "./lib/fx";
import { Ring, MacroDonut, MiniChart, Card, Empty, toast, ToastHost, ConfirmModal, TimeRangeModal, useConfirm } from "./components/primitives";
import { styles } from "./styles";
import { localDateStr, getTodayStr, formatDate, formatShortDate, daysAgo, daysAgoFrom, WEEKDAYS } from "./lib/dates";
import { PHASE_TEMPLATES, TEMPLATE_LIST, templateFor, newPhase, derivedPhases, activePhase as activePhaseV3, lensFor, alignmentFor, planSpanWeeks, planEndDate, addPhaseOp, insertPhaseOp, deletePhaseOp, duplicatePhaseOp, movePhaseOp, updatePhaseOp } from "./engines/phaseV3";

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
      {sub === "exercise" && <ExerciseForm onAdd={addEntry("exercise")} recent={data.exercise} goals={goals} onSaveGoals={onSaveGoals} notes={data.notes} />}
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

  // Cross-device durability: flush pending writes when the app is backgrounded/
  // closed (so a phone log actually reaches the cloud), and re-pull when it comes
  // back to the foreground (so the laptop picks up what the phone just logged).
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    const flush = () => { flushSync(uid); };
    const onVisible = async () => {
      if (document.visibilityState === "hidden") { flush(); return; }
      // foregrounded → pull latest, then reload derived state if cloud had data
      try { const pulled = await cloudPull(uid); if (pulled) setBootKey(k => k + 1); } catch (e) {}
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
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


// ─── APP SHELL (the actual app once authed) ───────────────────────────────────







// Display-only tab labels. Internal keys stay stable so routing, deep-links
// (navTo) and stored state don't churn when a tab is renamed.
const TAB_LABEL = { Insights: "Goals" };

function AppShell({ session, syncing }) {
  const [activeTab, setActiveTab] = useState("Home");
  const [logOpen, setLogOpen] = useState(false);
  const [logInitial, setLogInitial] = useState(null);
  const [insightsCat, setInsightsCat] = useState(null);
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

  // Google Health OAuth is brokered server-side (api/google-health). The callback
  // redirects back with ?gh=connected; the Sleep card's useGoogleHealth hook picks
  // up connection status and the sleep import from there. Clean the marker param.
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    if (u.get("gh") || u.get("gh_error")) {
      const url = new URL(window.location.href);
      ["gh", "gh_error"].forEach(k => url.searchParams.delete(k));
      window.history.replaceState({}, "", url.pathname + (url.search || "") + url.hash);
    }
  }, []);

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

  // Meals, workouts, and sports get a "from/to time" prompt before they're saved
  // so every activity carries a real time range (timeStart/timeEnd/durationMin).
  const [timePrompt, setTimePrompt] = useState(null); // { type, entry }
  const commit = (type, entry) => setData(d => ({ ...d, [type]: [entry, ...(d[type] || [])] }));
  const addEntry = type => entry => { if (isTimed(type)) setTimePrompt({ type, entry }); else commit(type, entry); };
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
    const t = tab === "History" ? "Insights" : tab;
    if (t === "Insights") setInsightsCat(sub || null);
    setActiveTab(t);
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
      {showWelcome && <WelcomeSplash session={session} goals={goals} data={data} addEntry={addEntry} onDone={() => setShowWelcome(false)} />}
      <div className="app">
        <header className="topbar">
          <h1 className="brand">FitLog</h1>
          {syncing && <span className="sync-badge"><span className="spinner" />syncing</span>}
        </header>

        <main className="main">
          {activeTab === "Home" && <ErrorBoundary compact label="Home"><HomeTab data={data} goals={goals} onAddWater={addEntry("water")} onAddNicotine={addEntry("nicotine")} onNav={navTo} addEntry={addEntry} deleteEntry={deleteEntry} setData={setData} /></ErrorBoundary>}
          {activeTab === "Insights" && <ErrorBoundary compact label="Goals"><Suspense fallback={<div className="muted-center" style={{ padding: 40 }}><span className="spinner" /></div>}><HistoryTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} onSaveGoals={setGoals} initialCat={insightsCat} /></Suspense></ErrorBoundary>}
          {activeTab === "Coach" && <ErrorBoundary compact label="Coach"><Suspense fallback={<div className="muted-center" style={{ padding: 40 }}><span className="spinner" /></div>}><CoachTab data={data} goals={goals} /></Suspense></ErrorBoundary>}
          {activeTab === "Me" && <ErrorBoundary compact label="Me"><MeTab data={data} goals={goals} onSaveGoals={setGoals} onClearAll={clearAll} onImport={importData} session={session} onSignOut={signOut} addEntry={addEntry} deleteEntry={deleteEntry} /></ErrorBoundary>}
        </main>

        {logOpen && (
          <ErrorBoundary compact label="Log"><LogOverlay data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} onSaveGoals={setGoals} setData={setData} initial={logInitial} onClose={closeLog} /></ErrorBoundary>
        )}

        <TimeRangeModal
          open={!!timePrompt}
          kind={timePrompt?.type}
          defaultStart={timePrompt?.entry?.time || nowHHMM()}
          defaultEnd={addMinutesHHMM(timePrompt?.entry?.time || nowHHMM(), 45)}
          onSave={({ timeStart, timeEnd }) => { const { type, entry } = timePrompt; commit(type, decorateWithTime(entry, { timeStart, timeEnd })); setTimePrompt(null); }}
          onSkip={() => { commit(timePrompt.type, timePrompt.entry); setTimePrompt(null); }}
        />

        <nav className="tabbar tabbar-5">
          {["Home", "Insights"].map(tab => (
            <button key={tab} className={`tabbtn ${activeTab === tab ? "active" : ""}`} onClick={() => go(tab)}>
              <TabIcon name={tab} active={activeTab === tab} />
              <span className="tabbtn-label">{TAB_LABEL[tab] || tab}</span>
            </button>
          ))}
          <button className="tab-plus" onClick={() => openLog(null)} aria-label="Log"><span className="tab-plus-glyph">＋</span></button>
          {["Coach", "Me"].map(tab => (
            <button key={tab} className={`tabbtn ${activeTab === tab ? "active" : ""}`} onClick={() => go(tab)}>
              <TabIcon name={tab} active={activeTab === tab} />
              <span className="tabbtn-label">{TAB_LABEL[tab] || tab}</span>
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

