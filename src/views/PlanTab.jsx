import { useState, useMemo } from "react";
import { buildPlanFromPrompt, recommendRest } from "../api/client";
import { Card, toast } from "../components/primitives";
import { defaultPlan } from "../config";
import { computeRecovery } from "../engines/recovery";
import { WEEKDAYS } from "../lib/dates";
import { haptic } from "../lib/fx";

// ===== extracted body =====
// ─── PLAN TAB ──
export function PlanTab({ data, goals, onSaveGoals }) {
  const plan = goals.plan || defaultPlan;
  const [split, setSplit] = useState(plan.split);
  const [trainingDays, setTrainingDays] = useState(plan.trainingDays);
  const [assignments, setAssignments] = useState(plan.assignments || {});
  const [dayReasons, setDayReasons] = useState(plan.dayReasons || {});

  // AI plan builder
  const [prompt, setPrompt] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState(null);
  const [buildErr, setBuildErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [openDay, setOpenDay] = useState(null); // which day's "why" is expanded

  // Recovery card — instant rule-based + optional AI elaboration
  const recovery = useMemo(() => computeRecovery(data, goals), [data, goals]);
  const [aiTake, setAiTake] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  const todayName = WEEKDAYS[(new Date().getDay() + 6) % 7];
  const hasPlan = trainingDays.length > 0 && Object.keys(assignments).length > 0;

  async function buildPlan() {
    if (!prompt.trim() || building) return;
    setBuilding(true); setBuildErr(""); setBuildResult(null);
    let lastErr = null;
    // Try up to twice — models occasionally return malformed JSON; a retry usually fixes it.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await buildPlanFromPrompt(prompt, goals, { split, trainingDays }, data);
        if (!r || !Array.isArray(r.trainingDays) || r.trainingDays.length === 0) {
          throw new Error("no-days");
        }
        // Validate day keys
        r.trainingDays = r.trainingDays.filter(d => WEEKDAYS.includes(d));
        if (r.trainingDays.length === 0) throw new Error("bad-days");
        setBuildResult(r);
        setBuilding(false);
        return;
      } catch (e) { lastErr = e; }
    }
    setBuildErr("The AI's response didn't come back cleanly. Tap the button once more — it usually works on the next try.");
    setBuilding(false);
  }

  function applyBuiltPlan() {
    if (!buildResult) return;
    setSplit(buildResult.split || split);
    setTrainingDays(buildResult.trainingDays);
    setAssignments(buildResult.assignments || {});
    setDayReasons(buildResult.dayReasons || {});
    onSaveGoals({ ...goals, plan: { split: buildResult.split || split, trainingDays: buildResult.trainingDays, assignments: buildResult.assignments || {}, dayReasons: buildResult.dayReasons || {}, notes: "" } });
    setBuildResult(null); setPrompt("");
    toast("✓ Plan saved"); haptic([12, 30, 12]);
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
    onSaveGoals({ ...goals, plan: { split, trainingDays, assignments, dayReasons, notes: "" } });
    setEditing(false);
    toast("✓ Plan saved");
  }

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

  // Recovery-aware flag for the week view (consecutive-day warning)
  const consecWarning = recovery.reasons.find(r => /days straight|in a row/i.test(r.text));

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

      {/* ── CARD 2: AI PLAN BUILDER ── */}
      <Card title="✦ Build my week" sub="Tell the AI what you want — typos and all — it designs your week">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={3}
          placeholder={'e.g. "i can trian 4 days, chest n arms focus, play futbol sundays so keep legs away from then"'}
        />
        <div className="prompt-chips">
          {[
            "5 days, push/pull/legs, weekends off",
            "4 days, focus on arms & shoulders",
            "3 full-body days, max recovery",
            "let the AI decide what's best for me",
          ].map((p, i) => (
            <button key={i} className="prompt-chip" onClick={() => setPrompt(p)}>{p}</button>
          ))}
        </div>
        <button className="btn full" style={{ marginTop: 10 }} onClick={buildPlan} disabled={building || !prompt.trim()}>
          {building ? <><span className="spinner" />Designing your week…</> : (hasPlan ? "✦ Rebuild my week" : "✦ Design my week")}
        </button>
        {buildErr && <div className="err">{buildErr}</div>}

        {buildResult && (
          <div className="build-result">
            <div className="build-split-tag">{buildResult.split}</div>
            <div className="build-week">
              {WEEKDAYS.map(d => {
                const w = buildResult.assignments?.[d];
                const training = buildResult.trainingDays.includes(d);
                const why = buildResult.dayReasons?.[d];
                return (
                  <div key={d}
                    className={`build-day ${training ? "on" : ""} ${d === todayName ? "today" : ""} ${why ? "has-why" : ""}`}
                    onClick={() => why && setOpenDay(openDay === "b" + d ? null : "b" + d)}>
                    <span className="build-day-name">{d}</span>
                    <span className="build-day-w">{training ? (w || "Train") : "Rest"}</span>
                    {why && <span className="build-day-why-chev">{openDay === "b" + d ? "▲" : "ⓘ"}</span>}
                    {openDay === "b" + d && why && <div className="build-day-why">{why}</div>}
                  </div>
                );
              })}
            </div>
            {buildResult.alternativeNote && (
              <div className="build-alt"><strong>Coach's note:</strong> {buildResult.alternativeNote}</div>
            )}
            {buildResult.summary && <p className="build-summary">{buildResult.summary}</p>}
            {buildResult.tips?.length > 0 && (
              <ul className="build-tips">{buildResult.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            )}
            <p className="muted small" style={{ marginTop: 8 }}>Tap any day to see why it's set that way. You can fine-tune rest days after applying.</p>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn flex" onClick={applyBuiltPlan}>✓ Use this plan</button>
              <button className="btn-ghost" onClick={() => setBuildResult(null)}>Discard</button>
            </div>
          </div>
        )}
      </Card>

      {/* ── CARD 3: EDITABLE, RECOVERY-AWARE WEEK VIEW ── */}
      {hasPlan && !buildResult && (
        <Card title="Your week" sub={split} action={<button className="link-btn" onClick={() => editing ? saveEdits() : setEditing(true)}>{editing ? "Done" : "Edit"}</button>}>
          {consecWarning && !editing && (
            <div className="week-flag">⚠ {consecWarning.text}. Consider making today or tomorrow a rest day.</div>
          )}
          <div className="build-week">
            {WEEKDAYS.map(d => {
              const training = trainingDays.includes(d);
              const why = dayReasons[d];
              if (editing) {
                return (
                  <div key={d} className={`build-day ${d === todayName ? "today" : ""}`}>
                    <span className="build-day-name">{d}</span>
                    <input className="wo-input" value={assignments[d] || ""} placeholder="Rest — type to add"
                      onChange={e => editDay(d, e.target.value)} />
                  </div>
                );
              }
              return (
                <div key={d}
                  className={`build-day ${training ? "on" : ""} ${d === todayName ? "today" : ""} ${why ? "has-why" : ""}`}
                  onClick={() => why && setOpenDay(openDay === d ? null : d)}>
                  <span className="build-day-name">{d}</span>
                  <span className="build-day-w">{training ? (assignments[d] || "Train") : "Rest"}</span>
                  {d === todayName && <span className="wo-today-tag">today</span>}
                  {why && <span className="build-day-why-chev">{openDay === d ? "▲" : "ⓘ"}</span>}
                  {openDay === d && why && <div className="build-day-why">{why}</div>}
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
