import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { computeStreaks, buildMonth, WEEKDAYS } from "../engines/streaks";
import { localDateStr, formatShortDate } from "../lib/dates";

// ─── Consistency: weekly-volume streak + schedule-adherence streak ───────────
// Popup lets you plan gym days + set the weekly goal, and shows a month calendar
// of when you trained vs missed a planned day.

const C = { teal: "#4fb3bd", good: "#5fcf80", orange: "#ff9f43", bad: "#f4776a", text: "#eef2f6" };
const CAL = {
  hit: { bg: "rgba(255,159,67,0.9)", fg: "#1a1108", label: "Trained (planned)" },
  extra: { bg: "rgba(79,179,189,0.85)", fg: "#04191b", label: "Trained (extra)" },
  missed: { bg: "rgba(244,119,106,0.85)", fg: "#2a0f0c", label: "Missed a planned day" },
  planned: { bg: "transparent", fg: "#c9974e", border: "1.5px dashed rgba(255,159,67,0.5)", label: "Planned (upcoming)" },
  today: { bg: "rgba(255,255,255,0.06)", fg: "#eef2f6", border: "1.5px solid #4fb3bd", label: "Today" },
  rest: { bg: "rgba(255,255,255,0.03)", fg: "#5a636e", label: "Rest / off" },
  future: { bg: "transparent", fg: "#3a4149" },
};

function PlanCalendarModal({ data, goals, onSaveGoals, onClose }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const planned = (goals && Array.isArray(goals.plannedDays) ? goals.plannedDays : []);
  const goal = Math.max(1, Math.round((goals && goals.plannedSessions) || planned.length || 4));

  const grid = useMemo(() => buildMonth(data, goals, ym.y, ym.m), [data, goals, ym]);
  const monthName = new Date(ym.y, ym.m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });

  const toggleDay = d => {
    const set = new Set(planned);
    set.has(d) ? set.delete(d) : set.add(d);
    onSaveGoals({ ...goals, plannedDays: [...set].sort((a, b) => a - b) });
  };
  const setGoal = v => onSaveGoals({ ...goals, plannedSessions: Math.max(1, Math.min(7, Math.round(v))) });
  const shift = n => setYm(s => { const d = new Date(s.y, s.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(6,9,13,0.72)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000, animation: "pc-fade 0.18s ease" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", background: "#12161d", border: "1px solid #2a2119", borderBottom: "none", borderRadius: "22px 22px 0 0", padding: "8px 20px 26px", animation: "pc-rise 0.24s cubic-bezier(0.22,1,0.36,1)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 12px" }}><span style={{ width: 38, height: 4, borderRadius: 999, background: "#333c47" }} /></div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Gym plan & history</div>
            <div className="muted small" style={{ marginTop: 2 }}>Pick your days, then see how you kept to them</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 999, background: "#1c232c", border: "none", color: "#aab3bf", fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>

        {/* plan editor */}
        <div className="title" style={{ marginBottom: 10 }}>Planned gym days</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {WEEKDAYS.map((w, i) => {
            const on = planned.includes(i);
            return (
              <button key={i} onClick={() => toggleDay(i)}
                style={{ flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  background: on ? "rgba(255,159,67,0.15)" : "rgba(255,255,255,0.03)", color: on ? "#ff9f43" : "#6b7480",
                  border: `1px solid ${on ? "rgba(255,159,67,0.5)" : "#232a33"}` }}>{w[0]}</button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0 18px", borderBottom: "1px solid #232a33", marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Weekly session goal</div>
            <div className="muted small">Hit this many any week to keep the volume streak</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button className="btn-ghost btn-sm" style={{ padding: "4px 10px" }} onClick={() => setGoal(goal - 1)}>−</button>
            <span style={{ width: 30, textAlign: "center", fontWeight: 800, fontSize: 16 }}>{goal}</span>
            <button className="btn-ghost btn-sm" style={{ padding: "4px 10px" }} onClick={() => setGoal(goal + 1)}>+</button>
          </div>
        </div>

        {/* month nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <button onClick={() => shift(-1)} style={navBtn}>‹</button>
          <span style={{ flex: 1, textAlign: "center", fontWeight: 700, fontSize: 14 }}>{monthName}</span>
          <button onClick={() => shift(1)} style={navBtn}>›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5, marginBottom: 4 }}>
          {WEEKDAYS.map((w, i) => <div key={i} className="muted" style={{ textAlign: "center", fontSize: 10, fontWeight: 600 }}>{w[0]}</div>)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {grid.map((row, ri) => (
            <div key={ri} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5 }}>
              {row.map((cell, ci) => {
                const st = CAL[cell.status] || CAL.future;
                return (
                  <div key={ci} title={cell.date}
                    style={{ aspectRatio: "1", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600,
                      opacity: cell.inMonth ? 1 : 0.32, background: st.bg, color: st.fg, border: st.border || "1px solid transparent" }}>
                    {cell.day}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* legend */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
          {["hit", "extra", "missed", "planned", "rest"].map(k => (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9aa4b2" }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: CAL[k].bg, border: CAL[k].border || "1px solid #2a2119" }} />{CAL[k].label}
            </span>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
const navBtn = { width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid #232a33", color: "#dbe1e8", fontSize: 16, cursor: "pointer" };

export function StreakCard({ data, goals, onSaveGoals }) {
  const [open, setOpen] = useState(false);
  const s = useMemo(() => computeStreaks(data, goals), [data, goals]);
  const canPlan = !!onSaveGoals;

  const goal = s.goal;
  const weekDone = s.weekDone;
  const hit = s.hit;
  const streak = s.volume.streak;

  const N = s.weeks.length;
  const labels = [];
  for (let i = N - 1; i >= 0; i--) labels.unshift(i === N - 1 ? "now" : `${N - 1 - i}w`);
  const trail = s.weeks.map((c, i) => {
    const isCur = i === N - 1, h = c >= goal;
    return { icon: h ? "🔥" : (isCur ? "🔥" : "·"),
      filter: h ? "none" : (isCur ? "grayscale(0.3) opacity(0.8)" : "grayscale(1) opacity(0.35)"),
      bg: h ? "rgba(255,159,67,0.14)" : isCur ? "rgba(255,159,67,0.06)" : "rgba(255,255,255,0.02)",
      border: h ? "#ff9f43" : isCur ? "rgba(255,159,67,0.4)" : "#2a2119",
      label: labels[i], lc: isCur ? "#ff9f43" : h ? "#c9974e" : "#6b5638" };
  });
  const weekPct = Math.min(100, Math.round((weekDone / goal) * 100));
  const ad = s.adherence;

  return (
    <div style={{ width: "100%", padding: "28px 26px", borderRadius: 26, border: "1px solid #2a2119", background: "radial-gradient(120% 80% at 20% -10%, #3a2814 0%, #241a12 34%, #12161d 72%)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
        <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "#c9974e", fontWeight: 700, flex: 1 }}>Current streak</span>
        <span style={{ fontSize: 12, color: "#8a7350", fontWeight: 600 }}>🏆 best {s.volume.best}</span>
        {canPlan && <button onClick={() => setOpen(true)} style={{ fontSize: 12, fontWeight: 600, color: "#ff9f43", background: "rgba(255,159,67,0.12)", border: "1px solid rgba(255,159,67,0.3)", borderRadius: 999, padding: "5px 11px", cursor: "pointer" }}>📅 Plan</button>}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 6 }}>
        <span style={{ fontSize: 26, filter: "drop-shadow(0 0 14px rgba(255,159,67,0.55))", animation: "flame-flick 1.8s ease-in-out infinite" }}>🔥</span>
        <span style={{ fontSize: 82, fontWeight: 800, color: "#ff9f43", lineHeight: 0.8, letterSpacing: "-0.05em", fontVariantNumeric: "tabular-nums", textShadow: "0 0 34px rgba(255,159,67,0.4)" }}>{streak}</span>
        <span style={{ fontSize: 20, fontWeight: 700, color: "#c9974e", paddingBottom: 6 }}>week{streak === 1 ? "" : "s"}</span>
      </div>
      <div style={{ fontSize: 14, color: "#9a8156", marginBottom: 22 }}>{hit ? "On fire — the weekly streak is safe." : `${goal - weekDone} more session${goal - weekDone === 1 ? "" : "s"} keeps it burning.`}</div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {trail.map((f, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
            <div style={{ width: "100%", aspectRatio: "1", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, background: f.bg, border: `1.5px solid ${f.border}`, filter: f.filter }}>{f.icon}</div>
            <span style={{ fontSize: 10, color: f.lc, fontWeight: 600 }}>{f.label}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#6b5638", marginBottom: 22, textAlign: "center" }}>each 🔥 = a week you hit your goal ({goal}/wk)</div>

      {/* this week */}
      <div style={{ padding: "16px 18px", borderRadius: 16, background: "rgba(0,0,0,0.28)", border: "1px solid #2a2119", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#dbe1e8", flex: 1 }}>This week — keep it lit</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: hit ? C.good : C.orange, fontVariantNumeric: "tabular-nums" }}>{weekDone}/{goal}</span>
        </div>
        <div style={{ height: 9, borderRadius: 999, background: "#1c140c", border: "1px solid #3a2c1c", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${weekPct}%`, borderRadius: 999, background: "linear-gradient(90deg, #e07b2e, #ff9f43)" }} />
        </div>
      </div>

      {/* schedule adherence */}
      <div style={{ padding: "16px 18px", borderRadius: 16, background: "rgba(0,0,0,0.28)", border: "1px solid #2a2119" }}>
        {ad ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#dbe1e8", flex: 1 }}>📅 Schedule streak</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: ad.streak > 0 ? C.teal : "#6b7480", fontVariantNumeric: "tabular-nums" }}>{ad.streak}</span>
              <span style={{ fontSize: 12, color: "#8a7350", fontWeight: 600 }}>day{ad.streak === 1 ? "" : "s"}</span>
            </div>
            <div style={{ fontSize: 12, color: "#9a8156", marginTop: 8 }}>
              {ad.todayPlanned && !ad.todayDone ? "Planned today — don't miss it."
                : ad.next ? `Next: ${ad.nextDow} (${formatShortDate(ad.next)}).`
                : "No upcoming planned days set."}
              {ad.best > ad.streak ? ` · best ${ad.best}` : ""}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, fontSize: 12.5, color: "#9a8156", lineHeight: 1.4 }}>Plan which days you train to unlock the schedule-adherence streak.</div>
            {canPlan && <button onClick={() => setOpen(true)} style={{ fontSize: 12, fontWeight: 700, color: "#ff9f43", background: "rgba(255,159,67,0.12)", border: "1px solid rgba(255,159,67,0.3)", borderRadius: 10, padding: "8px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>Set days</button>}
          </div>
        )}
      </div>

      {open && canPlan && <PlanCalendarModal data={data} goals={goals} onSaveGoals={onSaveGoals} onClose={() => setOpen(false)} />}
    </div>
  );
}

export default StreakCard;
