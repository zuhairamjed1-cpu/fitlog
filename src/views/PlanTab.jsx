import { useState, useMemo } from "react";
import { recommendRest } from "../api/client";
import { Card, toast } from "../components/primitives";
import { computeRecovery } from "../engines/recovery";
import { WEEKDAYS } from "../lib/dates";

// ===== extracted body =====
// ─── PLAN TAB ──
export function PlanTab({ data, goals, onSaveGoals }) {
  // Recovery card — instant rule-based + optional AI elaboration.
  // The week planner ("Build my week" + "Your week") now lives as a single
  // WeekPlannerCard under Goals → Training.
  const recovery = useMemo(() => computeRecovery(data, goals), [data, goals]);
  const [aiTake, setAiTake] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  const todayName = WEEKDAYS[(new Date().getDay() + 6) % 7];

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
    </div>
  );
}
