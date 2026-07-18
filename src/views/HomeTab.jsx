import { useMemo, useState } from "react";
import { callClaude } from "../api/client";
import { buildBrain } from "../brain/brain";
import { Ring, MacroDonut, MiniChart, Card, Empty, toast, ToastHost, ConfirmModal, useConfirm } from "../components/primitives";
import { NIC_QUICK, TYPE_DOT } from "../config";
import { getDayContext } from "../engines/dayContext";
import { localDateStr, getTodayStr } from "../lib/dates";
import { ExperimentTimelineCard } from "../components/ExperimentTimelineCard";
import { haptic, SFX } from "../lib/fx";

// ===== extracted body =====
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
export function HomeTab({ data, goals, onAddWater, onAddNicotine, onNav, addEntry, deleteEntry, setData }) {
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
  const todayCarbs = todayDiet.reduce((a, m) => a + (m.carbs || 0), 0);
  const todayFat = todayDiet.reduce((a, m) => a + (m.fat || 0), 0);
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
      {(() => {
        const routine = (goals && goals.skinRoutine) || { am: [], pm: [] };
        const rlogs = (data.skinRoutineLogs || []).filter(l => l.date === today);
        const skinDone = slot => (routine[slot] || []).filter(s => rlogs.some(l => l.slot === slot && l.product === s.product)).length;
        const skinTotal = skinDone("am") + skinDone("pm");
        const skinCount = (routine.am || []).length + (routine.pm || []).length;
        const toggleSkin = (slot, product) => {
          const e = rlogs.find(l => l.slot === slot && l.product === product);
          if (e) deleteEntry("skinRoutineLogs")(e.id);
          else { addEntry("skinRoutineLogs")({ id: Date.now(), date: today, slot, product }); haptic(8); SFX.tap(); }
        };
        const tasks = data.tasks || [];
        const toggleTask = t => setData(d => ({ ...d, tasks: (d.tasks || []).map(x => x.id === t.id ? { ...x, done: !x.done } : x) }));
        const macros = [
          { name: "Protein", cur: todayProtein, goal: goals.protein, color: "#b4a8e8" },
          { name: "Carbs", cur: todayCarbs, goal: goals.carbs, color: "#f9c97e" },
          { name: "Fat", cur: todayFat, goal: goals.fat, color: "#f47e6e" },
        ];
        const kcalLeft = Math.max(0, goals.calories - todayCal);
        const calFrac = goals.calories ? Math.min(1, todayCal / goals.calories) : 0;
        const feed = [
          todaySleep && { icon: "◐", c: "#6ee7f7", text: `${todaySleep.duration}h sleep · ${todaySleep.quality.toLowerCase()}`, t: todaySleep.time || "" },
          ...todayDiet.map(m => ({ icon: "◉", c: "#4fb3bd", text: `${m.meal} · ${m.calories} kcal · ${(m.food || "").slice(0, 26)}${(m.food || "").length > 26 ? "…" : ""}`, t: m.time || "" })),
          todayWorkout && { icon: "◆", c: "#f47e6e", text: `Workout · ${todayWorkout.label}`, t: "" },
          todaySport && { icon: "◇", c: "#8fd989", text: `${todaySport.sport} · ${todaySport.duration}min`, t: "" },
        ].filter(Boolean);

        const CARD = { background: "linear-gradient(158deg,#161d27,#10141b)", border: "1px solid #232c38", borderRadius: 22, padding: "22px 20px", boxShadow: "0 24px 50px -30px rgba(0,0,0,.9)" };
        const H = { fontSize: 15, fontWeight: 800 };
        const SkinSlot = ({ slot, label, dot }) => {
          const steps = routine[slot] || [];
          if (!steps.length) return null;
          return (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <b style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#9aa4b2" }}>{dot} {label}</b>
                <span style={{ fontSize: 12, color: "#6b7480", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{skinDone(slot)}/{steps.length}</span>
              </div>
              {steps.map((s, i) => {
                const on = rlogs.some(l => l.slot === slot && l.product === s.product);
                return (
                  <button key={i} onClick={() => toggleSkin(slot, s.product)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "none", border: "none", borderTop: i ? "1px dashed #232c38" : "none", padding: "8px 0", cursor: "pointer" }}>
                    <span style={{ width: 20, height: 20, flex: "none", borderRadius: 6, border: `1.5px solid ${on ? "#5fcf80" : "#333c47"}`, background: on ? "#5fcf80" : "transparent", color: "#04191b", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? "✓" : ""}</span>
                    <span style={{ fontSize: 14, color: on ? "#6b7480" : "#eef2f6", textDecoration: on ? "line-through" : "none" }}>{s.product}</span>
                  </button>
                );
              })}
            </div>
          );
        };

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* HEADER */}
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 2px" }}>
              <div>
                <div style={{ fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "#6b7480", fontWeight: 700 }}>{now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
                <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-.025em", marginTop: 5 }}>{greeting}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: "#5fcf80", boxShadow: "0 0 9px #5fcf80" }} />
                  <span style={{ fontSize: 13, color: "#9aa4b2", fontWeight: 500 }}>{goals.goal}{ringsHit === 3 ? " · all goals hit" : " · day on track"}</span>
                </div>
              </div>
              <div style={{ width: 46, height: 46, borderRadius: 999, flex: "none", background: "linear-gradient(135deg,#4fb3bd,#b4a8e8)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, color: "#0e1116", boxShadow: "0 10px 24px -12px rgba(79,179,189,.8)" }}>{(goals.goal || "•")[0].toUpperCase()}</div>
            </header>

            {/* CALORIES + MACROS + STREAK */}
            <section style={{ ...CARD, position: "relative", overflow: "hidden", padding: "22px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={H}>Today</div>
                  {streak > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, background: "linear-gradient(100deg,rgba(249,201,126,.16),rgba(244,126,110,.12))", border: "1px solid rgba(249,201,126,.32)", borderRadius: 999, padding: "4px 10px 4px 8px" }}>
                      <span style={{ color: "#f9c97e" }}>🔥</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#f9c97e", fontVariantNumeric: "tabular-nums" }}>{streak}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#c9a36a" }}>day streak</span>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#9aa4b2", fontVariantNumeric: "tabular-nums", fontWeight: 600, background: "rgba(255,255,255,.04)", border: "1px solid #232c38", borderRadius: 999, padding: "5px 11px" }}>{todayCal.toLocaleString()} / {goals.calories.toLocaleString()} kcal</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
                <div style={{ width: 112, height: 112, flex: "none", position: "relative" }}>
                  <svg viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)", width: "100%", height: "100%" }}>
                    <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#4fb3bd" /><stop offset="100%" stopColor="#b4a8e8" /></linearGradient></defs>
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="9" />
                    <circle cx="50" cy="50" r="42" fill="none" stroke="url(#ringGrad)" strokeWidth="9" strokeLinecap="round" strokeDasharray="264" strokeDashoffset={264 * (1 - calFrac)} style={{ transition: "stroke-dashoffset .7s cubic-bezier(.5,0,.2,1)" }} />
                  </svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <b style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", fontVariantNumeric: "tabular-nums" }}>{kcalLeft.toLocaleString()}</b>
                    <span style={{ fontSize: 11, color: "#9aa4b2", fontWeight: 600 }}>kcal left</span>
                  </div>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 13 }}>
                  {macros.map(m => (
                    <div key={m.name} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 600 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: m.color }} />{m.name}</span>
                        <span style={{ color: "#9aa4b2", fontVariantNumeric: "tabular-nums" }}>{Math.round(m.cur)} / {m.goal}g</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,.055)", overflow: "hidden" }}><i style={{ display: "block", height: "100%", borderRadius: 999, width: `${m.goal ? Math.min(100, Math.round(m.cur / m.goal * 100)) : 0}%`, background: m.color }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* QUICK ACTIONS */}
            <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => onNav("Log", "diet")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 16, borderRadius: 16, border: "1px solid #4fb3bd", background: "linear-gradient(100deg,rgba(79,179,189,.26),rgba(180,168,232,.12))", color: "#eef2f6", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>◉ Log a meal</button>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
                {[
                  { label: "Workout", ico: "◆", c: "#f9c97e", on: () => onNav("Log", "exercise") },
                  { label: "Sleep", ico: "◐", c: "#b4a8e8", on: () => onNav("Log", "sleep") },
                  { label: "+250ml water", ico: "◊", c: "#4fb3bd", on: addWater },
                  { label: "Act tracker", ico: "🌊", c: "#5fcf80", on: () => onNav("Log", "ejac") },
                ].map(q => (
                  <button key={q.label} onClick={q.on} style={{ display: "flex", alignItems: "center", gap: 11, padding: 15, borderRadius: 15, border: "1px solid #232c38", background: "linear-gradient(158deg,#161d27,#12161d)", color: "#eef2f6", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                    <span style={{ width: 30, height: 30, flex: "none", borderRadius: 9, background: `${q.c}1a`, display: "flex", alignItems: "center", justifyContent: "center", color: q.c, fontSize: 15 }}>{q.ico}</span>
                    {q.label}
                  </button>
                ))}
              </div>
              <button onClick={() => onNav("Coach")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: 14, borderRadius: 15, border: "1px dashed #333c47", background: "transparent", color: "#9aa4b2", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✦ Ask coach</button>
            </section>

            {/* SKINCARE */}
            {skinCount > 0 ? (
              <section style={CARD}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div><div style={H}>Skincare</div><div style={{ fontSize: 12, color: "#6b7480", fontWeight: 500, marginTop: 2 }}>Tick off today's routine</div></div>
                  <div style={{ fontSize: 12, color: "#4fb3bd", fontWeight: 700, fontVariantNumeric: "tabular-nums", background: "rgba(79,179,189,.1)", border: "1px solid rgba(79,179,189,.3)", borderRadius: 999, padding: "5px 11px" }}>{skinTotal}/{skinCount}</div>
                </div>
                <SkinSlot slot="am" label="Morning" dot="☀" />
                <SkinSlot slot="pm" label="Evening" dot="☾" />
              </section>
            ) : (
              <section style={CARD}>
                <div style={H}>Skincare</div>
                <div style={{ fontSize: 13, color: "#9aa4b2", margin: "8px 0 12px" }}>No routine yet — add your AM & PM products, then tick them off here.</div>
                <button onClick={() => onNav("Log", "skin")} style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #232c38", background: "transparent", color: "#9aa4b2", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Set up routine</button>
              </section>
            )}

            {/* TASKS */}
            <section style={CARD}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                <div><div style={H}>Tasks &amp; improvements</div><div style={{ fontSize: 12, color: "#6b7480", fontWeight: 500, marginTop: 2 }}>{tasks.length ? `${tasks.filter(t => !t.done).length} open · ${tasks.filter(t => t.done).length} done` : "Small things to get better at"}</div></div>
              </div>
              {tasks.length === 0 && <div style={{ fontSize: 13, color: "#6b7480" }}>Nothing yet — add tasks from the old Tasks card below.</div>}
              {tasks.map((t, i) => (
                <button key={t.id} onClick={() => toggleTask(t)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "none", border: "none", borderTop: i ? "1px dashed #232c38" : "none", padding: "9px 0", cursor: "pointer" }}>
                  <span style={{ width: 18, height: 18, flex: "none", borderRadius: 5, border: `1.5px solid ${t.done ? "#4fb3bd" : "#333c47"}`, background: t.done ? "#4fb3bd" : "transparent", color: "#04191b", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{t.done ? "✓" : ""}</span>
                  <span style={{ fontSize: 14, color: t.done ? "#6b7480" : "#eef2f6", textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
                </button>
              ))}
            </section>

            {/* EXPERIMENTS (real, interactive) */}
            <ExperimentTimelineCard data={data} goals={goals} setData={setData} onNav={onNav} />

            {/* FEED */}
            <section style={CARD}>
              <div style={{ ...H, marginBottom: 10 }}>Logged today</div>
              {feed.length === 0 ? (
                <div style={{ fontSize: 13, color: "#6b7480" }}>Nothing logged yet — tap a quick action above.</div>
              ) : feed.map((f, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "11px 0", fontSize: 13.5, fontWeight: 500, borderTop: i ? "1px dashed #232c38" : "none" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 28, height: 28, flex: "none", borderRadius: 8, background: `${f.c}1a`, display: "flex", alignItems: "center", justifyContent: "center", color: f.c, fontSize: 14 }}>{f.icon}</span>{f.text}</span>
                  {f.t && <span style={{ color: "#6b7480", fontVariantNumeric: "tabular-nums", fontSize: 12, fontWeight: 600, flex: "none" }}>{f.t}</span>}
                </div>
              ))}
            </section>

            {/* keep the full Tasks editor + old add-flow available */}
            <TaskCard data={data} addEntry={addEntry} deleteEntry={deleteEntry} setData={setData} />
          </div>
        );
      })()}

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

// ─── Skincare AM/PM routine checklist ───────────────────────────────────────
// Ticks individual routine steps; each tick writes a skinRoutineLogs entry
// {date, slot, product} — the same store the Skin section's adherence reads.
function SkincareChecklistCard({ data, goals, addEntry, deleteEntry, onNav }) {
  const today = getTodayStr();
  const routine = (goals && goals.skinRoutine) || { am: [], pm: [] };
  const logs = (data.skinRoutineLogs || []).filter(l => l.date === today);
  const doneEntry = (slot, product) => logs.find(l => l.slot === slot && l.product === product);

  const toggle = (slot, product) => {
    const e = doneEntry(slot, product);
    if (e) { deleteEntry("skinRoutineLogs")(e.id); }
    else { addEntry("skinRoutineLogs")({ id: Date.now(), date: today, slot, product }); haptic(8); SFX.tap(); }
  };

  const hasRoutine = (routine.am || []).length + (routine.pm || []).length > 0;
  if (!hasRoutine) {
    return (
      <Card title="Skincare" sub="AM / PM routine">
        <Empty icon="✦" title="No routine set yet" hint="Add your AM & PM products in Log → Skin, then tick them off here each day." />
        <button className="btn-ghost full" style={{ marginTop: 10 }} onClick={() => onNav("Log", "skin")}>Set up routine</button>
      </Card>
    );
  }

  const Slot = ({ slot, label, icon }) => {
    const steps = routine[slot] || [];
    if (!steps.length) return null;
    const done = steps.filter(s => doneEntry(slot, s.product)).length;
    return (
      <div style={{ marginBottom: slot === "am" ? 14 : 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-2)" }}>{icon} {label}</span>
          <span className="muted small">{done}/{steps.length}</span>
        </div>
        {steps.map((s, i) => {
          const on = !!doneEntry(slot, s.product);
          return (
            <button key={i} onClick={() => toggle(slot, s.product)}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "none", border: "none", padding: "7px 0", cursor: "pointer", borderTop: i ? "1px dashed var(--line)" : "none" }}>
              <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 6, border: `1.5px solid ${on ? "var(--good)" : "var(--border-strong)"}`, background: on ? "var(--good)" : "transparent", color: "#04191b", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? "✓" : ""}</span>
              <span style={{ fontSize: 14, color: on ? "var(--muted)" : "var(--text)", textDecoration: on ? "line-through" : "none" }}>{s.product}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <Card title="Skincare" sub="Tick off today's routine">
      <Slot slot="am" label="Morning" icon="☀" />
      <Slot slot="pm" label="Evening" icon="☾" />
    </Card>
  );
}

// ─── Tasks / improvements (simple checklist) ────────────────────────────────
function TaskCard({ data, addEntry, deleteEntry, setData }) {
  const [text, setText] = useState("");
  const tasks = data.tasks || [];
  const open = tasks.filter(t => !t.done).length;

  const add = () => {
    const v = text.trim();
    if (!v) return;
    addEntry("tasks")({ id: Date.now(), text: v, done: false, ts: Date.now() });
    setText("");
    haptic(6);
  };
  const toggle = id => setData(d => ({ ...d, tasks: (d.tasks || []).map(t => t.id === id ? { ...t, done: !t.done } : t) }));

  return (
    <Card title="Tasks & improvements" sub={tasks.length ? `${open} open · ${tasks.length - open} done` : "Small things to get better at"}>
      <div style={{ display: "flex", gap: 8, marginBottom: tasks.length ? 12 : 0 }}>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }}
          placeholder="Add a task or improvement…"
          style={{ flex: 1, background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontSize: 14 }} />
        <button className="btn" onClick={add} disabled={!text.trim()} style={{ padding: "0 16px" }}>Add</button>
      </div>
      {tasks.length === 0 ? null : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {tasks.slice().sort((a, b) => (a.done - b.done) || (b.ts || 0) - (a.ts || 0)).map(t => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 2px", borderTop: "1px solid var(--line)" }}>
              <button onClick={() => toggle(t.id)} aria-label="toggle"
                style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 6, cursor: "pointer",
                  border: `1.5px solid ${t.done ? "var(--good)" : "var(--border-strong)"}`,
                  background: t.done ? "var(--good)" : "transparent", color: "#04191b", fontSize: 13, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {t.done ? "✓" : ""}
              </button>
              <span style={{ flex: 1, fontSize: 14, color: t.done ? "var(--muted)" : "var(--text)", textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
              <button onClick={() => deleteEntry("tasks")(t.id)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 17, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
