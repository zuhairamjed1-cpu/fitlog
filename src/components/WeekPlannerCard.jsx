import { useState, useMemo } from "react";
import { buildPlanFromPrompt } from "../api/client";
import { Card, toast } from "../components/primitives";
import { defaultPlan } from "../config";
import { computeRecovery } from "../engines/recovery";
import { WEEKDAYS } from "../lib/dates";
import { haptic } from "../lib/fx";

// ─── WEEK PLANNER ───────────────────────────────────────────────────────────
// The old "✦ Build my week" + "Your week" cards merged into one: the week view
// on top, the AI builder behind a toggle underneath. Same store path
// (goals.plan via onSaveGoals) — no second source of truth.
export function WeekPlannerCard({ data, goals, onSaveGoals }) {
  const plan = goals.plan || defaultPlan;
  const [split, setSplit] = useState(plan.split);
  const [trainingDays, setTrainingDays] = useState(plan.trainingDays);
  const [assignments, setAssignments] = useState(plan.assignments || {});
  const [dayReasons, setDayReasons] = useState(plan.dayReasons || {});

  const [prompt, setPrompt] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState(null);
  const [buildErr, setBuildErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [openDay, setOpenDay] = useState(null);
  const [builderOpen, setBuilderOpen] = useState(false);

  const recovery = useMemo(() => computeRecovery(data, goals), [data, goals]);
  const todayName = WEEKDAYS[(new Date().getDay() + 6) % 7];
  const hasPlan = trainingDays.length > 0 && Object.keys(assignments).length > 0;
  const consecWarning = recovery.reasons.find(r => /days straight|in a row/i.test(r.text));

  async function buildPlan() {
    if (!prompt.trim() || building) return;
    setBuilding(true); setBuildErr(""); setBuildResult(null);
    // Try up to twice — models occasionally return malformed JSON; a retry usually fixes it.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await buildPlanFromPrompt(prompt, goals, { split, trainingDays }, data);
        if (!r || !Array.isArray(r.trainingDays) || r.trainingDays.length === 0) throw new Error("no-days");
        r.trainingDays = r.trainingDays.filter(d => WEEKDAYS.includes(d));
        if (r.trainingDays.length === 0) throw new Error("bad-days");
        setBuildResult(r); setBuilding(false);
        return;
      } catch (e) { /* retry */ }
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
    setBuildResult(null); setPrompt(""); setBuilderOpen(false);
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

  return (
    <Card
      title="▦ My week"
      sub={hasPlan ? split : "No plan yet — let the AI design one"}
      action={hasPlan ? <button className="link-btn" onClick={() => editing ? saveEdits() : setEditing(true)}>{editing ? "Done" : "Edit"}</button> : null}
    >
      {/* ── the week itself ── */}
      {hasPlan && !buildResult && (
        <>
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
        </>
      )}

      {/* ── AI builder (collapsed once a plan exists) ── */}
      {hasPlan && !buildResult && !editing && (
        <button className="btn-ghost full" style={{ marginTop: 12 }} onClick={() => setBuilderOpen(o => !o)}>
          {builderOpen ? "− Hide the AI builder" : "✦ Rebuild my week with AI"}
        </button>
      )}

      {(!hasPlan || builderOpen || buildResult) && (
        <div style={{ marginTop: hasPlan ? 12 : 0 }}>
          {!buildResult && (
            <>
              <p className="muted small" style={{ marginBottom: 8 }}>Tell the AI what you want — typos and all — it designs your week.</p>
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
            </>
          )}

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
        </div>
      )}
    </Card>
  );
}

export default WeekPlannerCard;
