import { useState, useEffect } from "react";
import { WEEKDAYS, getTodayStr } from "../lib/dates";
import { haptic, SFX } from "../lib/fx";

// ===== extracted body =====
// App-entry screen. On a TRAINING day with no gym time logged yet, it asks when
// you're training today and saves it (so the meal-partitioning floors + post-
// workout quick-log build around it). Otherwise it's a brief auto-dismiss greet.
export function WelcomeSplash({ session, goals, data, addEntry, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const close = () => { if (leaving) return; setLeaving(true); setTimeout(onDone, 420); };

  const today = getTodayStr();
  const dow = WEEKDAYS[(new Date().getDay() + 6) % 7];
  const plan = goals?.plan || {};
  const isTraining = (plan.trainingDays || []).includes(dow);
  const alreadySet = (data?.plannedSessions || []).some(s => s.date === today);
  const askGym = isTraining && !alreadySet;

  const [time, setTime] = useState("17:00");

  // Only the greeting auto-dismisses; the gym question waits for an answer.
  useEffect(() => {
    if (askGym) return;
    const t = setTimeout(close, 1800);
    return () => clearTimeout(t);
  }, [askGym]);

  const h = new Date().getHours();
  const part = h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Late night grind";
  const raw = (session?.user?.email || "").split("@")[0] || "";
  const name = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "";
  const splitLabel = plan.assignments?.[dow] || "Training";

  const saveGym = (t) => {
    addEntry?.("plannedSessions")({ id: Date.now(), date: today, type: "gym", time: t, durationMin: 60, intensity: "moderate" });
    haptic(10); SFX.tap();
    close();
  };

  if (askGym) {
    const QUICK = [["Morning", "08:00"], ["Midday", "12:30"], ["Afternoon", "16:00"], ["Evening", "18:30"]];
    return (
      <div className={`welcome-splash${leaving ? " leaving" : ""}`}>
        <div className="welcome-inner" style={{ maxWidth: 360, padding: "0 24px" }}>
          <div className="welcome-logo">FitLog</div>
          <div className="welcome-greet" style={{ marginTop: 6 }}>{part}{name ? `, ${name}` : ""} 👋</div>
          <div className="welcome-sub" style={{ marginBottom: 22 }}>Today's a <b style={{ color: "var(--text)" }}>{splitLabel}</b> day. When are you hitting the gym?</div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 16 }}>
            {QUICK.map(([lab, t]) => (
              <button key={t} onClick={() => saveGym(t)}
                style={{ padding: "9px 14px", borderRadius: 999, background: "rgba(120,180,200,0.14)", border: "1px solid var(--accent)", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {lab} <span style={{ color: "var(--text-2)", fontWeight: 400 }}>{t}</span>
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
            <input type="time" value={time} onChange={e => setTime(e.target.value)}
              style={{ background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 15 }} />
            <button className="btn" onClick={() => saveGym(time)} style={{ padding: "0 18px" }}>Set</button>
          </div>

          <button onClick={close} style={{ background: "none", border: "none", color: "var(--text-2)", fontSize: 13, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>Not sure yet / skip</button>
        </div>
      </div>
    );
  }

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
