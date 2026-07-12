import { useMemo } from "react";
import { localDateStr } from "../lib/dates";

// ─── Consistency / weekly streak (flame) card ────────────────────────────────
// A week "counts" when logged training sessions ≥ weekly goal. Streak = run of
// consecutive completed weeks, + the current week if already hit. Read-only.

const C = { teal: "#4fb3bd", good: "#5fcf80", orange: "#ff9f43", orangeDim: "#c9974e", text: "#eef2f6" };

function mondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const off = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - off);
  return localDateStr(d);
}
const shiftWeeks = (mon, w) => { const d = new Date(mon + "T00:00:00"); d.setDate(d.getDate() - w * 7); return localDateStr(d); };

export function StreakCard({ data, goals }) {
  const goal = Math.max(1, Math.round((goals && goals.plannedSessions) || 4));
  const N = 8;

  const view = useMemo(() => {
    const today = localDateStr(new Date());
    const curMon = mondayOf(today);
    // sessions = distinct training days per week (exercise + sports)
    const dayHas = {};
    [...(data.exercise || []), ...(data.sports || [])].forEach(e => { if (e && e.date) dayHas[e.date] = true; });
    const weekStart = i => shiftWeeks(curMon, (N - 1) - i); // i=0 oldest … i=N-1 current
    const weeks = Array.from({ length: N }, (_, i) => {
      const ws = weekStart(i);
      let c = 0;
      Object.keys(dayHas).forEach(d => { if (d >= ws && d < shiftWeeks(ws, -1)) c++; });
      return c;
    });

    const weekDone = weeks[N - 1];
    const hit = weekDone >= goal;
    let prior = 0;
    for (let i = N - 2; i >= 0; i--) { if (weeks[i] >= goal) prior++; else break; }
    const streak = prior + (hit ? 1 : 0);

    // best streak across full window
    let best = 0, run = 0;
    weeks.forEach((c, i) => { const done = c >= goal || (i === N - 1 && false); if (done) { run++; best = Math.max(best, run); } else run = 0; });
    best = Math.max(best, streak);

    const tagline = hit ? "On fire — the streak is safe this week." : `${goal - weekDone} more session${goal - weekDone === 1 ? "" : "s"} keeps it burning.`;

    const labels = [];
    for (let i = N - 1; i >= 0; i--) labels.unshift(i === N - 1 ? "now" : `${N - 1 - i}w`);
    const trail = weeks.map((c, i) => {
      const isCur = i === N - 1;
      const h = c >= goal;
      return {
        icon: h ? "🔥" : (isCur ? "🔥" : "·"),
        filter: h ? "none" : (isCur ? "grayscale(0.3) opacity(0.8)" : "grayscale(1) opacity(0.35)"),
        bg: h ? "rgba(255,159,67,0.14)" : isCur ? "rgba(255,159,67,0.06)" : "rgba(255,255,255,0.02)",
        border: h ? "#ff9f43" : isCur ? "rgba(255,159,67,0.4)" : "#2a2119",
        label: labels[i],
        labelColor: isCur ? "#ff9f43" : h ? "#c9974e" : "#6b5638",
      };
    });

    const weekPct = Math.min(100, Math.round((weekDone / goal) * 100));
    const weekColor = hit ? C.good : C.orange;
    const weekMsg = hit ? `✓ Target hit — streak extended to ${streak} week${streak === 1 ? "" : "s"}.` : "Miss it and the streak resets to zero.";

    const last4 = weeks.slice(-4);
    const sessions = last4.reduce((a, b) => a + b, 0);
    const hitRate = Math.round((weeks.filter(w => w >= goal).length / N) * 100);
    const stats = [
      { value: String(sessions), unit: "", label: "sessions / 30d", color: C.text },
      { value: (sessions / 4).toFixed(1), unit: "/wk", label: "weekly average", color: C.teal },
      { value: String(hitRate), unit: "%", label: "target hit-rate", color: hitRate >= 60 ? C.good : C.text },
    ];

    return { streak, best, tagline, trail, weekDone, weekPct, weekColor, weekMsg, stats };
  }, [data.exercise, data.sports, goal]);

  const { streak, best, tagline, trail, weekDone, weekPct, weekColor, weekMsg, stats } = view;

  return (
    <div style={{ width: "100%", padding: "28px 26px", borderRadius: 26, border: "1px solid #2a2119", background: "radial-gradient(120% 80% at 20% -10%, #3a2814 0%, #241a12 34%, #12161d 72%)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
        <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "#c9974e", fontWeight: 700, flex: 1 }}>Current streak</span>
        <span style={{ fontSize: 12, color: "#8a7350", fontWeight: 600 }}>🏆 best {best}</span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 6 }}>
        <span style={{ fontSize: 26, filter: "drop-shadow(0 0 14px rgba(255,159,67,0.55))", animation: "flame-flick 1.8s ease-in-out infinite" }}>🔥</span>
        <span style={{ fontSize: 82, fontWeight: 800, color: "#ff9f43", lineHeight: 0.8, letterSpacing: "-0.05em", fontVariantNumeric: "tabular-nums", textShadow: "0 0 34px rgba(255,159,67,0.4)" }}>{streak}</span>
        <span style={{ fontSize: 20, fontWeight: 700, color: "#c9974e", paddingBottom: 6 }}>week{streak === 1 ? "" : "s"}</span>
      </div>
      <div style={{ fontSize: 14, color: "#9a8156", marginBottom: 26 }}>{tagline}</div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {trail.map((f, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
            <div style={{ width: "100%", aspectRatio: "1", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, background: f.bg, border: `1.5px solid ${f.border}`, filter: f.filter }}>{f.icon}</div>
            <span style={{ fontSize: 10, color: f.labelColor, fontWeight: 600 }}>{f.label}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#6b5638", marginBottom: 26, textAlign: "center" }}>each 🔥 = a week you hit your target</div>

      <div style={{ padding: "16px 18px", borderRadius: 16, background: "rgba(0,0,0,0.28)", border: "1px solid #2a2119", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#dbe1e8", flex: 1 }}>This week — keep it lit</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: weekColor, fontVariantNumeric: "tabular-nums" }}>{weekDone}/{goal}</span>
        </div>
        <div style={{ height: 9, borderRadius: 999, background: "#1c140c", border: "1px solid #3a2c1c", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${weekPct}%`, borderRadius: 999, background: "linear-gradient(90deg, #e07b2e, #ff9f43)" }} />
        </div>
        <div style={{ fontSize: 12, color: "#9a8156", marginTop: 10 }}>{weekMsg}</div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        {stats.map((s, i) => (
          <div key={i} style={{ flex: 1, padding: "13px 14px", borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid #2a2119" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.value}</span>
              <span style={{ fontSize: 11, color: "#8a7350", fontWeight: 600 }}>{s.unit}</span>
            </div>
            <div style={{ fontSize: 10.5, color: "#8a7350", marginTop: 7 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default StreakCard;
