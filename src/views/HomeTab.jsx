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
        <button className="qa" onClick={() => onNav("Log", "ejac")}>
          <span className="qa-icon">🌊</span><span>Act tracker</span>
        </button>
      </div>
      <button className="qa-wide" onClick={() => onNav("Coach")}>
        <span className="qa-icon">✦</span><span>Ask coach</span>
      </button>

      <SkincareChecklistCard data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} onNav={onNav} />

      <TaskCard data={data} addEntry={addEntry} deleteEntry={deleteEntry} setData={setData} />

      <ExperimentTimelineCard data={data} goals={goals} setData={setData} onNav={onNav} />

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
