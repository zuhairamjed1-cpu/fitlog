import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { ANTERIOR_POLY, POSTERIOR_POLY } from "../anatomyData";
import { estimateSportsCalories } from "../api/client";
import { Card, Empty, toast } from "../components/primitives";
import { RecentList } from "../components/RecentList";
import { TierBadge } from "../components/TierBadge";
import { sportsOptions, intensityLevels } from "../config";
import { SESSION_TYPES } from "../engines/fueling";
import { PRIO_TARGETS, computeMusclePrio, PRIO_DEFAULT_SETS, PRIO_MIN, PRIO_MAX_COUNT, RIR_TARGET } from "../engines/musclePrio";
import { computeVolume, STATUS_LEGEND, MUSCLES, MUSCLE_KEYS, resolveMuscle, listExerciseMappings, normExercise } from "../engines/volume";
import { MUSCLE_GROUPS, GROUP_BY_ID, SUBGROUP_BY_ID, categoryForExercise, guessSubForExercise, assignSubgroup, clearSubgroup } from "../engines/muscleGroups";
import { parseWorkout, bestSet, detectPRs } from "../engines/workout";
import { getTodayStr, formatShortDate } from "../lib/dates";
import { haptic, SFX } from "../lib/fx";

// ===== extracted body =====
const ANATOMY_DATA = { front: ANTERIOR_POLY, back: POSTERIOR_POLY };
const POLY_TO_REGION = {
  CHEST: "CHEST", FRONT_DELTOIDS: "FRONT_DELTOIDS", BICEPS: "BICEPS", TRICEPS: "TRICEPS",
  FOREARM: "FOREARM", ABS: "ABS", OBLIQUES: "OBLIQUES", QUADRICEPS: "QUADRICEPS",
  CALVES: "CALVES", LEFT_SOLEUS: "CALVES", RIGHT_SOLEUS: "CALVES", TRAPEZIUS: "TRAPEZIUS",
  BACK_DELTOIDS: "BACK_DELTOIDS", UPPER_BACK: "UPPER_BACK", LOWER_BACK: "LOWER_BACK",
  GLUTEAL: "GLUTEAL", HAMSTRING: "HAMSTRING", ABDUCTOR: "ABDUCTORS", ABDUCTORS: "ABDUCTORS", NECK: "NECK",
};

function AnatomyBody({ view, regions, active, onPick }) {
  const data = ANATOMY_DATA[view];
  const tr = { transition: "fill .35s ease, fill-opacity .35s ease, stroke .12s ease", cursor: "pointer" };
  const colorOf = rk => { const r = rk ? regions[rk] : null; const s = r ? r.status : null; return { fill: s ? s.color : "#3a4150", op: s ? s.opacity : 0.4 }; };
  return (
    <svg viewBox="0 0 100 200" style={{ width: "100%", maxWidth: 270, display: "block", margin: "0 auto" }}>
      <g>{Object.entries(data).map(([m, polys]) => polys.map((p, i) => (
        <polygon key={"b" + m + i} points={p} fill="#242932" stroke="#0e1118" strokeWidth="0.35" />
      )))}</g>
      {Object.entries(data).map(([m, polys]) => {
        const rk = POLY_TO_REGION[m]; if (!rk || !regions[rk]) return null;
        const c = colorOf(rk), on = active === rk;
        return polys.map((p, i) => (
          <polygon key={m + i} points={p} fill={c.fill} fillOpacity={c.op} stroke={on ? "#fff" : "#0e1118"} strokeWidth={on ? 0.9 : 0.35} style={tr}
            onMouseEnter={() => onPick(rk)} onClick={() => onPick(rk)} />
        ));
      })}
    </svg>
  );
}

// ─── MUSCLE PRIORITIZATION — shared UI (Goal Plan card + Workout Sets section) ──
const PRIO_RISK_COLOR = { green: "#8fd989", amber: "#f9c97e", red: "#f47e6e", grey: "#5a6472" };
const PRIO_RISK_LABEL = { green: "Green", amber: "Amber", red: "Red" };

function savePrioTarget(goals, onSaveGoals, id, val) {
  const map = { ...(goals.musclePriorities || {}) };
  if (val == null || val === PRIO_DEFAULT_SETS) delete map[id];
  else {
    const v = Math.max(6, Math.min(20, val));
    if (v >= PRIO_MIN) { const others = Object.entries(map).filter(([k, s]) => k !== id && s >= PRIO_MIN).length; if (others >= PRIO_MAX_COUNT) { toast(`Max ${PRIO_MAX_COUNT} prioritised muscles`); return; } }
    map[id] = v;
  }
  onSaveGoals({ ...goals, musclePriorities: map });
  haptic(6);
}

function SetStepper({ value, min, max, onDec, onInc }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 0, background: "var(--bg-2)", borderRadius: 8, overflow: "hidden" }}>
      <button onClick={onDec} disabled={value <= min} style={{ width: 28, height: 28, border: "none", background: "none", color: value <= min ? "var(--text-2)" : "var(--text)", fontSize: 16, cursor: value <= min ? "default" : "pointer" }}>−</button>
      <span style={{ minWidth: 26, textAlign: "center", fontWeight: 700, fontSize: 14 }}>{value}</span>
      <button onClick={onInc} disabled={value >= max} style={{ width: 28, height: 28, border: "none", background: "none", color: value >= max ? "var(--text-2)" : "var(--text)", fontSize: 16, cursor: value >= max ? "default" : "pointer" }}>+</button>
    </span>
  );
}

function MuscleSetsSection({ prio, goals, onSaveGoals }) {
  if (!prio.ready) return <Empty icon="◫" title="No workouts logged yet" hint="Log a workout — your weekly sets vs targets and stall-risk diagnosis appear here." />;
  const sorted = [...prio.targets].sort((a, b) => (b.prioritized ? 1 : 0) - (a.prioritized ? 1 : 0) || b.current - a.current);
  const recTxt = prio.recVerdict === "good" ? "Recovery looks good" : prio.recVerdict === "poor" ? "Recovery is compromised" : "Recovery: not enough data";
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 10px", borderRadius: 8, background: "var(--bg-2)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: prio.recVerdict === "good" ? PRIO_RISK_COLOR.green : prio.recVerdict === "poor" ? PRIO_RISK_COLOR.red : PRIO_RISK_COLOR.grey }} />
        <span className="small">{recTxt}. {prio.riskTargets.length ? `${prio.riskTargets.length} muscle${prio.riskTargets.length > 1 ? "s" : ""} need attention.` : "All prioritised muscles progressing."}</span>
      </div>
      {sorted.map(t => {
        const pct = Math.min(100, t.pct || 0);
        return (
          <div key={t.id} style={{ padding: "9px 0", borderTop: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: PRIO_RISK_COLOR[t.risk], flexShrink: 0 }} title={PRIO_RISK_LABEL[t.risk]} />
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{t.label}{t.prioritized && <span style={{ fontSize: 9, marginLeft: 6, padding: "1px 6px", borderRadius: 999, background: "rgba(92,200,223,0.15)", color: "#5cc8df", fontWeight: 700 }}>PRIORITY</span>}</span>
              <span className="small" style={{ color: t.current >= t.target ? "#8fd989" : "var(--text)" }}>{t.current}/{t.target}</span>
              <SetStepper value={t.target} min={6} max={20} onDec={() => savePrioTarget(goals, onSaveGoals, t.id, t.target - 1)} onInc={() => savePrioTarget(goals, onSaveGoals, t.id, t.target + 1)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, paddingLeft: 16 }}>
              <div style={{ flex: 1, height: 5, borderRadius: 5, background: "var(--bg-2)", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", borderRadius: 5, background: t.current >= t.target ? "#8fd989" : "var(--accent)" }} /></div>
              <span className="muted small" style={{ width: 86, textAlign: "right" }}>{t.status}</span>
            </div>
            {t.diagnosis && (
              <div style={{ marginLeft: 16, marginTop: 6, padding: "7px 10px", borderRadius: 8, background: t.risk === "red" ? "rgba(244,126,110,0.1)" : "rgba(249,201,126,0.1)", border: `1px solid ${PRIO_RISK_COLOR[t.risk]}44` }}>
                <div className="small" style={{ fontWeight: 700, color: PRIO_RISK_COLOR[t.risk] }}>{t.risk === "red" ? "⚠ " : ""}{t.diagnosis}</div>
                <div className="muted small" style={{ marginTop: 1, lineHeight: 1.4 }}>{t.recommendation}</div>
              </div>
            )}
          </div>
        );
      })}
      <p className="muted small" style={{ marginTop: 6, lineHeight: 1.45 }}>Target {RIR_TARGET} on every working set. Sets count hard sets only (warmups excluded). Prioritised muscles use your chosen 12–16; everything else targets {PRIO_DEFAULT_SETS}. These are recommendations — you always choose the volume.</p>
    </>
  );
}

export function V3MusclePrioCard({ data, goals, onSaveGoals }) {
  const [sel, setSel] = useState("");
  const prio = useMemo(() => computeMusclePrio(data, goals, getTodayStr()), [data, goals]);
  const byId = {}; prio.targets.forEach(t => (byId[t.id] = t));
  const chosen = prio.targets.filter(t => t.prioritized);
  const atMax = chosen.length >= PRIO_MAX_COUNT;
  const available = PRIO_TARGETS.filter(t => !(byId[t.id] && byId[t.id].prioritized));
  const add = () => { if (!sel || atMax) return; savePrioTarget(goals, onSaveGoals, sel, 14); setSel(""); };
  return (
    <Card title="Muscle Prioritization" sub={`Choose up to ${PRIO_MAX_COUNT} muscles you want to prioritize during this phase.`}>
      {atMax ? (
        <p className="small" style={{ color: "#f9c97e", margin: "0 0 4px" }}>Maximum {PRIO_MAX_COUNT} muscles prioritized. Remove one to add another.</p>
      ) : (
        <div style={{ display: "flex", gap: 8, marginBottom: chosen.length ? 16 : 0 }}>
          <select value={sel} onChange={e => setSel(e.target.value)} style={{ flex: 1, background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 11px", fontSize: 14 }}>
            <option value="">Select muscle…</option>
            {available.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button onClick={add} disabled={!sel} className="btn-primary" style={{ padding: "0 20px", opacity: sel ? 1 : 0.45 }}>Add</button>
        </div>
      )}

      {chosen.length === 0 ? (
        <Empty icon="◎" title="No muscles prioritized yet" hint="Pick a muscle above to give it extra weekly volume this phase. Everything else trains at 10 sets/week." />
      ) : chosen.map(t => <PrioMuscleCard key={t.id} t={t} goals={goals} onSaveGoals={onSaveGoals} />)}

      {chosen.length > 0 && <p className="muted small" style={{ marginTop: 6, lineHeight: 1.45 }}>These targets drive your set goals in Workout → Muscle Analysis. Non-prioritized muscles hold at {PRIO_DEFAULT_SETS} sets. All sets assume {RIR_TARGET}. The system advises — you always choose the volume.</p>}
    </Card>
  );
}

function PrioMuscleCard({ t, goals, onSaveGoals }) {
  const pct = Math.min(100, t.pct || 0);
  const rc = PRIO_RISK_COLOR[t.risk];
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: ".02em" }}>{t.label}</span>
        <button onClick={() => savePrioTarget(goals, onSaveGoals, t.id, PRIO_DEFAULT_SETS)} style={{ background: "none", border: "none", color: "var(--text-2)", fontSize: 12, cursor: "pointer", padding: 0 }}>Remove</button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 12, marginBottom: 5 }}>
        <span className="muted small">Current Weekly Sets</span>
        <span style={{ fontWeight: 800, fontSize: 15 }}>{t.current} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>/ {t.target}</span></span>
      </div>
      <div style={{ height: 8, borderRadius: 8, background: "var(--bg-2)", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", borderRadius: 8, background: t.current >= t.target ? "#8fd989" : "var(--accent)" }} /></div>

      <div className="muted small" style={{ marginTop: 13, marginBottom: 6 }}>Target sets / week</div>
      <div style={{ display: "flex", gap: 6 }}>
        {[12, 13, 14, 15, 16].map(v => (
          <button key={v} onClick={() => savePrioTarget(goals, onSaveGoals, t.id, v)} style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1.5px solid ${t.target === v ? "#5cc8df" : "var(--line)"}`, background: t.target === v ? "rgba(92,200,223,0.16)" : "transparent", color: t.target === v ? "#5cc8df" : "var(--text)", fontWeight: t.target === v ? 800 : 500, fontSize: 14, cursor: "pointer" }}>{v}</button>
        ))}
      </div>
      <div className="muted small" style={{ marginTop: 7 }}>Current target: <b style={{ color: "var(--text)" }}>{t.target} sets/week</b></div>

      <div style={{ marginTop: 13, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: rc, flexShrink: 0 }} />
          <span className="small" style={{ fontWeight: 700 }}>Stall Risk: <span style={{ color: rc }}>{PRIO_RISK_LABEL[t.risk]}</span></span>
        </div>
        {t.diagnosis && <div className="small" style={{ marginTop: 6 }}><span className="muted">Diagnosis: </span><b>{t.diagnosis}</b></div>}
        <div className="small" style={{ marginTop: 6, lineHeight: 1.45 }}><span className="muted">Recommendation: </span>{t.recommendation}</div>
      </div>
    </div>
  );
}

export function WorkoutAnalysis({ data, goals, onSaveGoals }) {
  const [weekOffset] = useState(0);
  const [view, setView] = useState("front");
  const [active, setActive] = useState(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });
  const vol = useMemo(() => computeVolume(data, goals, getTodayStr(), weekOffset), [data, goals, weekOffset]);
  const vmap = useMemo(() => { const o = {}; (vol.muscles || []).forEach(m => (o[m.key] = m)); return o; }, [vol]);

  if (!vol.ready) return <Card title="Muscle Map"><Empty icon="◫" title="No workouts logged yet" hint="Log a workout above — your muscle map appears here." /></Card>;

  const ar = active ? vol.regions[active] : null;
  const s = vol.summary;
  const s$ = n => (n > 0 ? "+" : "") + n;

  return (
    <>
      <Card title="Muscle Map" sub="weekly volume by muscle group" action={<span style={{ display: "flex", gap: 6 }}>
        <button className={`seg-btn ${view === "front" ? "active" : ""}`} style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => { setView("front"); setActive(null); }}>Front</button>
        <button className={`seg-btn ${view === "back" ? "active" : ""}`} style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => { setView("back"); setActive(null); }}>Back</button>
      </span>}>
        <div style={{ position: "relative" }} onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top }); }} onMouseLeave={() => setActive(null)}>
          <AnatomyBody view={view} regions={vol.regions} active={active} onPick={setActive} />
          {ar && (
            <div style={{ position: "absolute", left: Math.min(tip.x + 14, 200), top: Math.max(tip.y - 8, 0), pointerEvents: "none", background: "rgba(16,19,26,0.97)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", minWidth: 164, boxShadow: "0 10px 30px rgba(0,0,0,0.55)", zIndex: 5, backdropFilter: "blur(8px)" }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 5 }}>{ar.label}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-2)", gap: 16 }}><span>This week</span><b style={{ color: "var(--text)" }}>{ar.thisWeek} sets</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-2)", gap: 16 }}><span>Previous</span><span>{ar.lastWeek}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-2)", gap: 16 }}><span>Change</span><span style={{ color: (ar.changePct ?? ar.change) > 0 ? "#8fd989" : (ar.changePct ?? ar.change) < 0 ? "#f47e6e" : "var(--text-2)" }}>{ar.changePct != null ? `${s$(ar.changePct)}%` : `${s$(ar.change)} sets`}</span></div>
              <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: ar.status.color }}>{ar.status.label} · rec {ar.recommended}</div>
              {ar.muscles.length > 1 && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--line)" }}>
                  {ar.muscles.map(m => (
                    <div key={m.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-2)", gap: 14 }}><span style={{ color: m.thisWeek ? m.status.color : "var(--text-2)" }}>{m.label}</span><span>{m.thisWeek}</span></div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <p className="muted small" style={{ textAlign: "center", margin: "4px 0 10px" }}>{active ? vol.regions[active].label : "Hover or tap a muscle"}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          {STATUS_LEGEND.map(l => (
            <span key={l.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-2)" }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: l.color, opacity: l.opacity, display: "inline-block" }} />{l.label}
            </span>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 10, lineHeight: 1.4 }}>Colored by weekly volume vs each muscle's recommended range (estimated — individual tolerance varies). Map is a stylized anatomy, not a medical render.{s.unmappedSets > 0 ? ` ${s.unmappedSets} set${s.unmappedSets > 1 ? "s" : ""} couldn't be matched to a muscle.` : ""}</p>
      </Card>
    </>
  );
}

// ─── WORKOUT SCREEN — composes the 5 cards in order ─────────────────────────
export function WorkoutScreen({ data, goals, addEntry, onSaveGoals }) {
  const today = getTodayStr();
  const sessionHeader = useMemo(() => {
    const todayEntries = (data.exercise || []).filter(e => e.date === today);
    let sets = 0, volume = 0, ant = 0, post = 0; const muscles = new Set();
    todayEntries.forEach(e => {
      const p = e._parsed || parseWorkout(e.text || "");
      volume += p.totalVolume || 0;
      (p.exercises || []).forEach(ex => {
        const w = (ex.sets || []).filter(s => !(s && s.rpe != null && s.rpe < 5)).length;
        if (!w) return; sets += w;
        const m = resolveMuscle(ex.name, goals.exerciseMap);
        if (m) { muscles.add(MUSCLES[m].label); (MUSCLES[m].side === "front" ? (ant += w) : (post += w)); }
      });
    });
    const planned = (data.plannedSessions || []).find(s => s.date === today);
    const plannedName = planned ? ((SESSION_TYPES[planned.type] || {}).label || planned.type) : null;
    const labeled = todayEntries.find(e => e.label && e.label !== "Workout");
    const name = plannedName || (labeled && labeled.label) || (sets > 0 ? (ant >= post ? "Anterior day" : "Posterior day") : "New session");
    return { name, sets, volume: Math.round(volume), muscles: [...muscles], any: todayEntries.length > 0, planned: !!plannedName };
  }, [data.exercise, data.plannedSessions, goals.exerciseMap, today]);

  const header = (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em" }}>{sessionHeader.name}</div>
        <div className="muted small">{sessionHeader.planned ? "from your plan" : sessionHeader.any ? "today" : "nothing logged yet today"}</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 90, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px" }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>Sets</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{sessionHeader.sets}</div>
        </div>
        <div style={{ flex: 1, minWidth: 90, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px" }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>Volume</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{sessionHeader.volume.toLocaleString()}<span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> kg</span></div>
        </div>
      </div>
      {sessionHeader.muscles.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {sessionHeader.muscles.map(m => <span key={m} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "rgba(92,200,223,0.12)", border: "1px solid rgba(92,200,223,0.3)", color: "#9fe0ee" }}>{m}</span>)}
        </div>
      )}
    </div>
  );

  // Queue of never-before-logged exercises to categorize after a save.
  const [newQueue, setNewQueue] = useState([]);

  function handleAdd(entry) {
    // Snapshot the exercises we already know BEFORE adding this entry.
    const known = new Set();
    (data.exercise || []).forEach(e => {
      const p = e._parsed || parseWorkout(e.text || "");
      (p.exercises || []).forEach(ex => { const n = normExercise(ex.name); if (n) known.add(n); });
    });
    Object.keys(goals.exerciseMap || {}).forEach(n => known.add(n));
    Object.keys(goals.exerciseSubgroup || {}).forEach(n => known.add(n));

    addEntry("exercise")(entry);

    const p = entry._parsed || parseWorkout(entry.text || "");
    const fresh = [];
    (p.exercises || []).forEach(ex => {
      const n = normExercise(ex.name);
      if (!n || known.has(n) || fresh.some(f => f.norm === n)) return;
      fresh.push({ norm: n, name: ex.name });
    });
    if (fresh.length) setNewQueue(fresh);
  }

  function categorizeNext(subId) {
    const cur = newQueue[0];
    if (cur && subId) onSaveGoals(assignSubgroup(goals, cur.name, subId));
    setNewQueue(q => q.slice(1));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <ExerciseForm onAdd={handleAdd} recent={data.exercise} hideRecent header={header} />
      <WorkoutAnalysis data={data} goals={goals} onSaveGoals={onSaveGoals} />
      <ExerciseMappingCard data={data} goals={goals} onSaveGoals={onSaveGoals} />
      <RecentWorkoutsCard recent={data.exercise} />
      {newQueue.length > 0 && (
        <NewExerciseModal
          entry={newQueue[0]}
          remaining={newQueue.length}
          onSave={categorizeNext}
          onSkip={() => categorizeNext(null)}
        />
      )}
    </div>
  );
}

// ─── New-exercise categorization popup (group → subgroup) ────────────────────
function NewExerciseModal({ entry, remaining, onSave, onSkip }) {
  const guess = guessSubForExercise(entry.name);
  const guessGroup = guess ? SUBGROUP_BY_ID[guess].groupId : MUSCLE_GROUPS[0].id;
  const [groupId, setGroupId] = useState(guessGroup);
  const [subId, setSubId] = useState(guess || GROUP_BY_ID[guessGroup].subs[0].id);
  const group = GROUP_BY_ID[groupId];

  function pickGroup(gid) {
    setGroupId(gid);
    setSubId(GROUP_BY_ID[gid].subs[0].id); // reset subgroup to first of the new group
  }

  return createPortal(
    <div className="nex-overlay" onClick={onSkip}>
      <div className="nex-modal" onClick={e => e.stopPropagation()}>
        <div className="nex-kicker">New exercise{remaining > 1 ? ` · ${remaining} to sort` : ""}</div>
        <div className="nex-q">What does this train?</div>
        <div className="nex-name">{entry.name}</div>

        <label className="nex-lbl">Muscle group
          <select value={groupId} onChange={e => pickGroup(e.target.value)}>
            {MUSCLE_GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>

        <label className="nex-lbl">Subgroup
          <select value={subId} onChange={e => setSubId(e.target.value)}>
            {group.subs.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>

        <div className="nex-actions">
          <button className="btn full" onClick={() => onSave(subId)}>Save</button>
          <button className="btn-ghost btn-sm" onClick={onSkip}>Skip</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── CARD 4 — Exercise Mapping (grouped by muscle group → subgroup, editable) ──
function ExerciseMappingCard({ data, goals, onSaveGoals }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState({}); // groupId → bool
  const [edit, setEdit] = useState(null); // { norm, name, groupId, subId }

  // Every distinct logged exercise with its resolved category.
  const list = useMemo(() => {
    const raw = listExerciseMappings(data, goals); // [{ name, norm, ... }]
    return raw.map(x => ({ name: x.name, norm: x.norm, cat: categoryForExercise(x.name, goals), overridden: !!(goals.exerciseSubgroup || {})[x.norm] }));
  }, [data, goals]);

  const filtered = q.trim() ? list.filter(x => x.name.toLowerCase().includes(q.toLowerCase())) : list;

  // Bucket into group → subgroup, in taxonomy order. Plus an Uncategorized tail.
  const groups = MUSCLE_GROUPS.map(g => {
    const subs = g.subs.map(s => ({ s, items: filtered.filter(x => x.cat && x.cat.subId === s.id) })).filter(sub => sub.items.length);
    const count = subs.reduce((a, sub) => a + sub.items.length, 0);
    return { g, subs, count };
  }).filter(gr => gr.count);
  const uncategorized = filtered.filter(x => !x.cat);

  const startEdit = (x) => setEdit({ norm: x.norm, name: x.name, groupId: x.cat ? x.cat.groupId : MUSCLE_GROUPS[0].id, subId: x.cat ? x.cat.subId : GROUP_BY_ID[MUSCLE_GROUPS[0].id].subs[0].id });
  const pickGroup = (gid) => setEdit(e => ({ ...e, groupId: gid, subId: GROUP_BY_ID[gid].subs[0].id }));
  const save = () => { onSaveGoals(assignSubgroup(goals, edit.name, edit.subId)); setEdit(null); haptic(8); };
  const reset = () => { onSaveGoals(clearSubgroup(goals, edit.name)); setEdit(null); haptic(6); };

  const editor = (x) => (
    <div key={x.norm} style={{ padding: "10px 8px", borderRadius: 10, background: "var(--bg-2)", margin: "4px 0" }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{x.name}</div>
      <div className="muted small" style={{ marginBottom: 4 }}>Muscle group</div>
      <select value={edit.groupId} onChange={e => pickGroup(e.target.value)}
        style={{ width: "100%", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 10px", fontSize: 14, marginBottom: 8 }}>
        {MUSCLE_GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
      </select>
      <div className="muted small" style={{ marginBottom: 4 }}>Subgroup</div>
      <select value={edit.subId} onChange={e => setEdit({ ...edit, subId: e.target.value })}
        style={{ width: "100%", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 10px", fontSize: 14 }}>
        {GROUP_BY_ID[edit.groupId].subs.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn-primary btn-sm" style={{ flex: 1 }} onClick={save}>Save changes</button>
        {x.overridden && <button className="btn-ghost btn-sm" onClick={reset}>Reset</button>}
        <button className="btn-ghost btn-sm" onClick={() => setEdit(null)}>Cancel</button>
      </div>
    </div>
  );

  const row = (x, label, amber) => (
    <button key={x.norm} onClick={() => startEdit(x)}
      style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 8px", borderRadius: 8, background: "transparent", border: "none", borderBottom: "1px solid var(--line)", cursor: "pointer", textAlign: "left" }}>
      <span className="small" style={{ color: "var(--text)" }}>{x.name}{x.overridden ? " ✎" : ""}</span>
      <span className="small" style={{ color: amber ? "#f9c97e" : "var(--text-2)", whiteSpace: "nowrap" }}>{label} ›</span>
    </button>
  );

  return (
    <Card title="Exercise Mapping" sub="Your logged exercises — grouped by muscle" action={list.length > 0 && <button className="btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>{open ? "Hide ▾" : "Show ▸"}</button>}>
      {list.length === 0 ? (
        <Empty icon="◌" title="No exercises logged yet" hint="Log workouts and FitLog automatically builds your exercise mapping database — only the exercises you actually use." />
      ) : open ? <>
      <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search exercises…"
        style={{ width: "100%", background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 14, margin: "10px 0" }} />
      <div style={{ maxHeight: 420, overflowY: "auto", margin: "0 -4px" }}>
        {groups.length === 0 && uncategorized.length === 0 && <p className="muted small" style={{ padding: "8px 4px" }}>No exercises match “{q}”.</p>}
        {groups.map(({ g, subs, count }) => {
          const isCollapsed = !!collapsed[g.id];
          return (
            <div key={g.id} style={{ marginBottom: 4 }}>
              <button onClick={() => setCollapsed(c => ({ ...c, [g.id]: !c[g.id] }))}
                style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 8px", background: "var(--bg-2)", border: "none", borderRadius: 8, cursor: "pointer", color: "var(--text)" }}>
                <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".02em" }}>{g.label}</span>
                <span className="muted small">{count} <span style={{ opacity: .7 }}>{isCollapsed ? "▸" : "▾"}</span></span>
              </button>
              {!isCollapsed && subs.map(({ s, items }) => (
                <div key={s.id} style={{ paddingLeft: 4 }}>
                  <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", padding: "8px 4px 2px" }}>{s.label}</div>
                  {items.map(x => edit && edit.norm === x.norm ? editor(x) : row(x, s.label, false))}
                </div>
              ))}
            </div>
          );
        })}
        {uncategorized.length > 0 && (
          <div style={{ marginBottom: 4 }}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", padding: "10px 4px 2px", color: "#f9c97e" }}>Uncategorized</div>
            {uncategorized.map(x => edit && edit.norm === x.norm ? editor(x) : row(x, "Set muscle", true))}
          </div>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>Grouped by muscle group → subgroup. New exercises prompt you to categorize on log; each subgroup feeds the existing muscle model, so Training Analysis, Weak Points, the Muscle Map and Goal-Plan volume all read from it.</p>
      </> : null}
    </Card>
  );
}

// ─── CARD 5 — Recent Workouts (timeline) ────────────────────────────────────
function RecentWorkoutsCard({ recent }) {
  const [open, setOpen] = useState(false);
  const items = useMemo(() => (recent || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0) || (b.date || "").localeCompare(a.date || "")).slice(0, 10), [recent]);
  if (!items.length) return null;
  const durOf = txt => { const m = (txt || "").match(/(\d+)\s*h\s*(\d+)?\s*m|\b(\d+)\s*min/i); if (!m) return null; if (m[3]) return `${m[3]}m`; return `${m[1]}h${m[2] ? " " + m[2] + "m" : ""}`; };
  return (
    <Card title="Recent Workouts" sub="View previous training sessions" action={<button className="btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>{open ? "Hide ▾" : "Show ▸"}</button>}>
      {open && items.map((w, i) => {
        const p = w._parsed || parseWorkout(w.text || "");
        const dur = durOf(w.text);
        return (
          <div key={w.id || i} style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <div style={{ width: 3, borderRadius: 3, background: w.prs && w.prs.length ? "#f9c97e" : "var(--line)", alignSelf: "stretch" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{w.label || "Workout"}{w.prs && w.prs.length ? " 🏆" : ""}</span>
                <span className="muted small" style={{ whiteSpace: "nowrap" }}>{formatShortDate(w.date)}</span>
              </div>
              <div className="muted small" style={{ marginTop: 2 }}>
                {p.totalSets} sets · {Math.round(p.totalVolume || 0).toLocaleString()} kg{dur ? ` · ${dur}` : ""}{w.prs && w.prs.length ? ` · ${w.prs.length} PR${w.prs.length > 1 ? "s" : ""}` : ""}
              </div>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

export function SportsForm({ onAdd, recent }) {
  const [form, setForm] = useState(() => {
    const d = new Date();
    return { date: getTodayStr(), time: `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`, sport: "Basketball", duration: "60", intensity: "Moderate", result: "", opponent: "", score: "", notes: "" };
  });
  const [weight, setWeight] = useState("75");
  const [est, setEst] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setEst(null); };

  return (
    <>
    <Card title="Log sport">
      <div className="field-grid">
        <label>Date<input type="date" value={form.date} onChange={e => set("date", e.target.value)} /></label>
        <label>Time<input type="time" value={form.time} onChange={e => set("time", e.target.value)} /></label>
        <label>Sport<select value={form.sport} onChange={e => set("sport", e.target.value)}>{sportsOptions.map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Duration (min)<input type="number" value={form.duration} onChange={e => set("duration", e.target.value)} /></label>
        <label>Intensity<select value={form.intensity} onChange={e => set("intensity", e.target.value)}>{intensityLevels.map(l => <option key={l}>{l}</option>)}</select></label>
        <label>Your weight (kg)<input type="number" value={weight} onChange={e => { setWeight(e.target.value); setEst(null); }} /></label>
        <label>Result<select value={form.result} onChange={e => set("result", e.target.value)}><option value="">—</option><option>Win</option><option>Loss</option><option>Draw</option><option>Practice</option></select></label>
        <label>Opponent<input type="text" value={form.opponent} onChange={e => set("opponent", e.target.value)} placeholder="Optional" /></label>
        <label>Score<input type="text" value={form.score} onChange={e => set("score", e.target.value)} placeholder="Optional" /></label>
      </div>
      <label>Notes<textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} placeholder="How did it go?" /></label>

      {!est && (
        <button className="btn-ghost full" onClick={async () => {
          if (!form.duration) return;
          setEstimating(true);
          const r = await estimateSportsCalories(form.sport, +form.duration, form.intensity, +weight || 75);
          setEst(r); setEstimating(false);
        }} disabled={estimating || !form.duration}>
          {estimating ? <><span className="spinner" />Calculating (MET-based)…</> : "✦ Estimate calories with AI"}
        </button>
      )}

      {est && (
        <div className="ai-card">
          <div className="ai-card-label">AI estimate</div>
          <div className="ai-card-big">{est.calories}<span> kcal</span></div>
          <p className="ai-card-note">{est.note}</p>
          <div className="row">
            <button className="btn flex" onClick={() => { onAdd({ ...form, id: Date.now(), duration: +form.duration || 0, calories: est.calories }); toast("◇ " + form.sport + " logged"); setForm(f => ({ ...f, opponent: "", score: "", result: "", notes: "" })); setEst(null); }}>+ Save sport</button>
            <button className="btn-ghost" onClick={() => setEst(null)}>Redo</button>
          </div>
        </div>
      )}
    </Card>
    <RecentList entries={recent} render={s => <><span className="ra-main">{s.sport} · {s.duration}min · {s.calories} kcal</span><span className="ra-date">{formatShortDate(s.date)}</span></>} />
    </>
  );
}



// ─── HISTORY TAB ──────────────────────────────────────────────────────────────

const WL_SAMPLE = "Push Day A\n1h 12m\n\nBench Press (Barbell)\nSet 1: 60 kg x 10\nSet 2: 80 kg x 8\nSet 3: 80 kg x 7\n\nIncline Dumbbell Press\nSet 1: 30 kg x 10\nSet 2: 30 kg x 9\n\nOverhead Press (Barbell)\nSet 1: 45 kg x 6\nSet 2: 45 kg x 6\n\nCable Fly\nSet 1: 15 kg x 15\nSet 2: 15 kg x 14";
const wlDur = txt => { const m = (txt || "").match(/(\d+)\s*h\s*(\d+)?\s*m|\b(\d+)\s*min/i); if (!m) return null; if (m[3]) return `${m[3]} min`; return `${m[1]}h${m[2] ? " " + m[2] + "m" : ""}`; };

export function ExerciseForm({ onAdd, recent, hideRecent, header }) {
  const [date, setDate] = useState(getTodayStr());
  const [time, setTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");

  const parsed = useMemo(() => parseWorkout(text), [text]);

  function save() {
    if (!text.trim()) return;
    const p = parseWorkout(text);
    const prs = detectPRs(p, recent || []);
    onAdd({ id: Date.now(), date, time, label: label.trim() || "Workout", text: text.trim(), _parsed: p, prs });
    if (prs.length) {
      haptic([18, 40, 18]);
      SFX.pr();
      toast(`🏆 New PR: ${prs[0].name} ${prs[0].weight}${prs[0].unit} × ${prs[0].reps}`, { silent: true });
    } else {
      toast("◆ Workout saved");
    }
    setText(""); setLabel("");
  }

  const C = { teal: "#4fb3bd", good: "#5fcf80", text: "#eef2f6", muted: "#5a636e" };
  const isEmpty = text.trim().length === 0;
  const hasParse = parsed.exercises.length > 0;
  const totalReps = parsed.exercises.reduce((a, ex) => a + ex.sets.reduce((b, s) => b + (s.reps || 0), 0), 0);
  const totalVol = parsed.totalVolume || 0;
  const fmtVol = totalVol >= 1000 ? (totalVol / 1000).toFixed(1) + "k" : String(Math.round(totalVol));
  const stats = [
    { label: "Exercises", value: String(parsed.exercises.length), unit: "", color: hasParse ? C.text : C.muted },
    { label: "Sets", value: String(parsed.totalSets || 0), unit: "", color: hasParse ? C.text : C.muted },
    { label: "Reps", value: String(totalReps), unit: "", color: hasParse ? C.text : C.muted },
    { label: "Volume", value: fmtVol, unit: "kg", color: hasParse ? C.teal : C.muted },
  ];
  const dur = wlDur(text);
  const metaChips = [label.trim() || null, dur].filter(Boolean);
  const statusText = isEmpty ? "nothing logged yet" : hasParse ? "parsed live" : "waiting for sets";
  const statusColor = isEmpty ? C.muted : hasParse ? C.good : "#b98a4a";
  const iuStyle = { width: "100%", padding: "10px 12px", background: "#0d1116", border: "1px solid #262d38", borderRadius: 10, color: "#dbe1e8", fontSize: 14 };
  const capLabel = { fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.09em", color: "#5a636e", fontWeight: 600 };

  return (
    <>
    <div style={{ width: "100%", background: "#12161d", border: "1px solid #232a33", borderRadius: 22, overflow: "hidden" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 22px", borderBottom: "1px solid #1e242c" }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: "linear-gradient(150deg, #4fb3bd, #2f7d84)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <span style={{ fontSize: 19 }}>🏋️</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#eef2f6", letterSpacing: "-0.01em" }}>Log workout</div>
          <div style={{ fontSize: 12.5, color: "#6b7480", marginTop: 2 }}>Paste from Strong, or write your own — parses as you type</div>
        </div>
        <span style={{ fontSize: 12, color: statusColor, fontWeight: 600, display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: statusColor }} />{statusText}
        </span>
      </div>

      {header && <div style={{ padding: "14px 22px 0" }}>{header}</div>}

      {/* stat strip */}
      <div style={{ display: "flex", borderBottom: "1px solid #1e242c" }}>
        {stats.map((s, i) => (
          <div key={i} style={{ flex: 1, padding: "14px 20px", borderRight: i < stats.length - 1 ? "1px solid #1e242c" : "none" }}>
            <div style={capLabel}>{s.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 6 }}>
              <span style={{ fontSize: 25, fontWeight: 800, color: s.color, letterSpacing: "-0.03em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.value}</span>
              {s.unit && <span style={{ fontSize: 12, color: "#6b7480", fontWeight: 600 }}>{s.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* meta row */}
      <div style={{ display: "flex", gap: 14, padding: "18px 22px 4px", flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 120px" }}>
          <div style={{ ...capLabel, marginBottom: 7 }}>Date</div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={iuStyle} />
        </label>
        <label style={{ flex: "1 1 120px" }}>
          <div style={{ ...capLabel, marginBottom: 7 }}>Time</div>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} style={iuStyle} />
        </label>
        <label style={{ flex: "1.4 1 160px" }}>
          <div style={{ ...capLabel, marginBottom: 7 }}>Label</div>
          <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Push Day A" style={iuStyle} />
        </label>
      </div>

      {/* split: editor | preview */}
      <div style={{ display: "flex", gap: 0, padding: "14px 22px 0", alignItems: "stretch", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 280px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={capLabel}>Paste log</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setText(WL_SAMPLE)} style={{ fontSize: 11, color: "#6b7480", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>try sample</button>
            <button onClick={() => setText("")} style={{ fontSize: 11, color: "#6b7480", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>clear</button>
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} spellCheck={false}
            placeholder={"Bench Press (Barbell)\nSet 1: 60 kg x 10\nSet 2: 80 kg x 8\n…"}
            style={{ flex: 1, minHeight: 260, resize: "none", padding: 14, background: "#0d1116", border: "1px solid #262d38", borderRadius: "12px 0 0 12px", color: "#c8d0da", fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: 13, lineHeight: 1.65 }} />
        </div>

        <div className="wl-scroll" style={{ flex: "1 1 280px", minHeight: 260, maxHeight: 380, overflowY: "auto", background: "#10141b", border: "1px solid #262d38", borderRadius: "0 12px 12px 0", padding: "14px 16px" }}>
          <div style={{ ...capLabel, marginBottom: 12 }}>Parsed preview</div>

          {isEmpty ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 200, textAlign: "center", gap: 8 }}>
              <span style={{ fontSize: 26, opacity: 0.5 }}>📋</span>
              <div style={{ fontSize: 13, color: "#4a535f", maxWidth: 190, lineHeight: 1.5 }}>Your sets will appear here, grouped by exercise, as you paste.</div>
            </div>
          ) : hasParse ? (
            <>
              {metaChips.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                  {metaChips.map((m, i) => (
                    <span key={i} style={{ fontSize: 11.5, color: "#9fb0b3", background: "rgba(79,179,189,0.1)", border: "1px solid rgba(79,179,189,0.22)", borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>{m}</span>
                  ))}
                </div>
              )}
              {parsed.exercises.map((ex, i) => (
                <div key={i} style={{ marginBottom: 12, border: "1px solid #232a33", borderRadius: 12, overflow: "hidden", background: "#131820" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "#171d26" }}>
                    <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "#e6ebf1", letterSpacing: "-0.01em" }}>{ex.name}</span>
                    <span style={{ fontSize: 11, color: "#6b7480", fontVariantNumeric: "tabular-nums" }}>{ex.sets.length} × sets</span>
                  </div>
                  {ex.sets.map((st, j) => {
                    const vol = (st.weight || 0) * (st.reps || 0);
                    const w = st.weight % 1 === 0 ? String(st.weight) : Number(st.weight).toFixed(1);
                    return (
                      <div key={j} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderTop: "1px solid #1c222b", fontVariantNumeric: "tabular-nums", opacity: st.warmup ? 0.6 : 1 }}>
                        <span style={{ width: 20, fontSize: 11, color: "#545d68", fontWeight: 700, fontFamily: "ui-monospace, Menlo, monospace" }}>{st.warmup ? "W" : j + 1}</span>
                        <span style={{ fontSize: 13, color: "#dbe1e8", fontWeight: 600 }}>{w}<span style={{ fontSize: 11, color: "#6b7480", fontWeight: 500 }}> {st.unit}</span></span>
                        <span style={{ fontSize: 12, color: "#545d68" }}>×</span>
                        <span style={{ fontSize: 13, color: "#dbe1e8", fontWeight: 600 }}>{st.reps}<span style={{ fontSize: 11, color: "#6b7480", fontWeight: 500 }}> reps</span></span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 11, color: "#4fb3bd", fontVariantNumeric: "tabular-nums" }}>{vol > 0 ? Math.round(vol) + " " + st.unit : "—"}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 200, textAlign: "center", gap: 8 }}>
              <span style={{ fontSize: 22, color: "#b98a4a" }}>⚠</span>
              <div style={{ fontSize: 13, color: "#8a7550", maxWidth: 200, lineHeight: 1.5 }}>No sets read yet — check the formatting (e.g. <span style={{ fontFamily: "ui-monospace, monospace" }}>80 kg x 8</span>).</div>
            </div>
          )}
        </div>
      </div>

      {/* save */}
      <div style={{ padding: "16px 22px 20px" }}>
        <button onClick={save} disabled={!hasParse}
          style={{ width: "100%", padding: 15, borderRadius: 13, border: "none", fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em", cursor: hasParse ? "pointer" : "not-allowed", color: hasParse ? "#04191b" : "#4a535f", background: hasParse ? "linear-gradient(150deg, #4fb3bd, #2f7d84)" : "#1a2029", transition: "background 0.15s" }}>
          {hasParse ? `Save workout · ${parsed.totalSets} sets` : "Add some sets to save"}
        </button>
      </div>
    </div>
    {!hideRecent && <RecentList entries={recent} render={w => <><span className="ra-main">{w.label}{w.prs?.length ? " 🏆" : ""}</span><span className="ra-date">{formatShortDate(w.date)}</span></>} />}
    </>
  );
}

// ─── SPORTS ──
