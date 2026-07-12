import { useState, useMemo } from "react";
import { ANTERIOR_POLY, POSTERIOR_POLY } from "../anatomyData";
import { estimateSportsCalories } from "../api/client";
import { Card, Empty, toast } from "../components/primitives";
import { ProgressionCard } from "../components/ProgressionCard";
import { RecentList } from "../components/RecentList";
import { TierBadge } from "../components/TierBadge";
import { sportsOptions, intensityLevels } from "../config";
import { SESSION_TYPES } from "../engines/fueling";
import { PRIO_TARGETS, computeMusclePrio, PRIO_DEFAULT_SETS, PRIO_MIN, PRIO_MAX_COUNT, RIR_TARGET } from "../engines/musclePrio";
import { computeVolume, STATUS_LEGEND, MUSCLES, MUSCLE_KEYS, resolveMuscle, listExerciseMappings } from "../engines/volume";
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
  const [weekOffset, setWeekOffset] = useState(0);
  const [tab, setTab] = useState("summary");
  const [view, setView] = useState("front");
  const [active, setActive] = useState(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });
  const vol = useMemo(() => computeVolume(data, goals, getTodayStr(), weekOffset), [data, goals, weekOffset]);
  const prio = useMemo(() => computeMusclePrio(data, goals, getTodayStr()), [data, goals]);
  const vmap = useMemo(() => { const o = {}; (vol.muscles || []).forEach(m => (o[m.key] = m)); return o; }, [vol]);

  if (!vol.ready) return <Card title="Training Analysis"><Empty icon="◫" title="No workouts logged yet" hint="Log a workout above — your weekly training analysis and muscle map appear here." /></Card>;

  const ar = active ? vol.regions[active] : null;
  const s = vol.summary, b = vol.balance;
  const s$ = n => (n > 0 ? "+" : "") + n;
  const intelGroups = useMemo(() => {
    const g = {};
    vol.muscles.forEach(m => { const rk = MUSCLES[m.key].region; (g[rk] = g[rk] || { region: rk, label: vol.regions[rk].label, total: vol.regions[rk].thisWeek, status: vol.regions[rk].status, items: [] }).items.push(m); });
    Object.values(g).forEach(x => x.items.sort((a, c) => c.thisWeek - a.thisWeek));
    return Object.values(g).sort((a, c) => c.total - a.total);
  }, [vol]);

  return (
    <>
      <Card title="Training Analysis" sub={vol.weekOffset === 0 ? `This week · from ${formatShortDate(vol.weekStart)}` : `Previous week · from ${formatShortDate(vol.weekStart)}`} action={<TierBadge tier="estimate" />}>
        <div className="seg" style={{ marginBottom: 10 }}>
          <button className={`seg-btn ${weekOffset === 0 ? "active" : ""}`} onClick={() => { setWeekOffset(0); setActive(null); }}>This Week</button>
          <button className={`seg-btn ${weekOffset === 1 ? "active" : ""}`} onClick={() => { setWeekOffset(1); setActive(null); }}>Previous Week</button>
        </div>
        <div className="skin-tabs" style={{ marginBottom: 12 }}>
          {[["summary", "Summary"], ["sets", "Sets"], ["intel", "Intelligence"], ["weak", "Weak Points"]].map(([k, l]) => (
            <button key={k} className={`skin-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {tab === "summary" && (
          <>
            <div className="gp-stat-row"><span className="muted small">Total hard sets</span><span>{s.totalSets}</span></div>
            <div className="gp-stat-row"><span className="muted small">Total exercises</span><span>{s.totalExercises}</span></div>
            <div className="gp-stat-row"><span className="muted small">Sessions</span><span>{s.totalSessions}</span></div>
            <div className="gp-stat-row"><span className="muted small">Training days</span><span>{s.trainingDays} / 7</span></div>
            <div className="gp-stat-row"><span className="muted small">Most trained</span><span>{s.highest ? `${s.highest.label} (${s.highest.sets})` : "—"}</span></div>
            <div className="gp-stat-row"><span className="muted small">Least trained</span><span>{s.lowest ? `${s.lowest.label} (${s.lowest.sets})` : "—"}</span></div>
            <div className="gp-stat-row"><span className="muted small">Volume vs previous week</span><span style={{ color: s.volumeTrendPct == null ? "var(--text-2)" : s.volumeTrendPct >= 0 ? "#8fd989" : "#f47e6e" }}>{s.volumeTrendPct == null ? "—" : `${s$(s.volumeTrendPct)}%`}</span></div>
            <p className="muted small" style={{ marginTop: 8, lineHeight: 1.4 }}>Session duration isn't logged, so it isn't shown. Counts are hard working sets (warmups excluded).</p>
          </>
        )}

        {tab === "sets" && <MuscleSetsSection prio={prio} goals={goals} onSaveGoals={onSaveGoals} />}

        {tab === "intel" && (
          <>
            {intelGroups.map(g => (
              <div key={g.region} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{g.label}</span>
                  <span className="small" style={{ color: g.status.color, fontWeight: 600 }}>{g.total} · {g.status.label}</span>
                </div>
                {g.items.map(m => (
                  <div key={m.key} className="gp-stat-row" style={{ padding: "2px 0" }}>
                    <span className="small" style={{ flex: 1, paddingLeft: 10, color: "var(--text-2)" }}>{m.label}</span>
                    <span className="small" style={{ width: 48, textAlign: "right" }}>{m.thisWeek} set{m.thisWeek === 1 ? "" : "s"}</span>
                    <span className="small" style={{ width: 56, textAlign: "right", color: "var(--text-2)" }}>{m.recommended}</span>
                    <span className="small" style={{ width: 84, textAlign: "right", color: m.status.color, fontWeight: 600 }}>{m.status.label}</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 10 }}>
              <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Volume balance <span className="muted" style={{ fontWeight: 400 }}>(hard sets)</span></div>
              <div className="gp-stat-row"><span className="muted small">Push / Pull</span><span>{b.push} / {b.pull}</span></div>
              <div className="gp-stat-row"><span className="muted small">Upper / Lower</span><span>{b.upper} / {b.lower}</span></div>
              <div className="gp-stat-row"><span className="muted small">Anterior / Posterior</span><span>{b.anterior} / {b.posterior}</span></div>
            </div>
          </>
        )}

        {tab === "weak" && (
          vol.weakPoints.length === 0
            ? <Empty icon="✓" title="Nothing under-trained" hint="Every muscle hit its recommended weekly minimum this week." />
            : vol.weakPoints.map((w, i) => (
              <div key={w.key} style={{ padding: "8px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Weak point #{i + 1} · {w.label}</div>
                <p className="muted small" style={{ margin: "3px 0", lineHeight: 1.45 }}>{w.reason}</p>
                <div className="gp-stat-row"><span className="muted small">Suggested target</span><span>{w.suggestedTarget} sets/wk</span></div>
                {w.exercises.length > 0 && <div className="gp-stat-row"><span className="muted small">Try</span><span>{w.exercises.join(" · ")}</span></div>}
              </div>
            ))
        )}
      </Card>

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <ProgressionCard data={data} goals={goals} />
      <ExerciseForm onAdd={addEntry("exercise")} recent={data.exercise} hideRecent header={header} />
      <WorkoutAnalysis data={data} goals={goals} onSaveGoals={onSaveGoals} />
      <ExerciseMappingCard data={data} goals={goals} onSaveGoals={onSaveGoals} />
      <RecentWorkoutsCard recent={data.exercise} />
    </div>
  );
}

// ─── CARD 4 — Exercise Mapping (one exercise → one primary muscle, editable) ──
function ExerciseMappingCard({ data, goals, onSaveGoals }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null); // { norm, sel }
  const list = useMemo(() => listExerciseMappings(data, goals), [data, goals]);
  const filtered = q.trim() ? list.filter(x => x.name.toLowerCase().includes(q.toLowerCase())) : list;
  const save = () => { const em = { ...(goals.exerciseMap || {}) }; em[edit.norm] = edit.sel; onSaveGoals({ ...goals, exerciseMap: em }); setEdit(null); haptic(8); };
  const reset = norm => { const em = { ...(goals.exerciseMap || {}) }; delete em[norm]; onSaveGoals({ ...goals, exerciseMap: em }); setEdit(null); haptic(6); };

  return (
    <Card title="Exercise Mapping" sub="Your logged exercises — categorized" action={list.length > 0 && <button className="btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>{open ? "Hide ▾" : "Show ▸"}</button>}>
      {list.length === 0 ? (
        <Empty icon="◌" title="No exercises logged yet" hint="Log workouts and FitLog automatically builds your exercise mapping database — only the exercises you actually use." />
      ) : open ? <>
      <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search exercises…"
        style={{ width: "100%", background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 14, margin: "10px 0" }} />
      <div style={{ maxHeight: 360, overflowY: "auto", margin: "0 -4px" }}>
        {filtered.length === 0 && <p className="muted small" style={{ padding: "8px 4px" }}>No exercises match “{q}”.</p>}
        {filtered.map(x => edit && edit.norm === x.norm ? (
          <div key={x.norm} style={{ padding: "10px 8px", borderRadius: 10, background: "var(--bg-2)", margin: "4px 0" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{x.name}</div>
            <div className="muted small" style={{ marginBottom: 6 }}>Primary muscle</div>
            <select value={edit.sel} onChange={e => setEdit({ ...edit, sel: e.target.value })}
              style={{ width: "100%", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 10px", fontSize: 14 }}>
              {MUSCLE_KEYS.map(k => <option key={k} value={k}>{MUSCLES[k].label}</option>)}
            </select>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn-primary btn-sm" style={{ flex: 1 }} onClick={save}>Save changes</button>
              {x.overridden && <button className="btn-ghost btn-sm" onClick={() => reset(x.norm)}>Reset</button>}
              <button className="btn-ghost btn-sm" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button key={x.norm} onClick={() => setEdit({ norm: x.norm, sel: x.muscle || MUSCLE_KEYS[0] })}
            style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 8px", borderRadius: 8, background: "transparent", border: "none", borderBottom: "1px solid var(--line)", cursor: "pointer", textAlign: "left" }}>
            <span className="small" style={{ color: "var(--text)" }}>{x.name}{x.overridden ? " ✎" : ""}</span>
            <span className="small" style={{ color: x.muscle ? "var(--text-2)" : "#f9c97e", whiteSpace: "nowrap" }}>{x.muscle ? MUSCLES[x.muscle].label : "Set muscle"} ›</span>
          </button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>This list grows as you log new exercises — each gets an auto-suggested muscle you can change. Every workout metric (Training Analysis, Weak Points, the Muscle Map, Goal-Plan volume) reads from it.</p>
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

  return (
    <>
    <Card title="Log workout" sub="Paste from Strong, or write your own">
      {header}
      <div className="field-grid three">
        <label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Time<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
        <label>Label<input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Push Day A" /></label>
      </div>
      <label>Workout details
        <textarea value={text} onChange={e => setText(e.target.value)} rows={9}
          placeholder={"Push Day A\n1h 12m\n\nBench Press (Barbell)\nSet 1: 60 kg × 10\nSet 2: 80 kg × 8"}
          style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.84rem" }} />
      </label>

      {parsed.exercises.length > 0 && (
        <div className="parse-preview">
          <div className="parse-head">
            <span>Detected {parsed.exercises.length} exercise{parsed.exercises.length === 1 ? "" : "s"}</span>
            <span className="parse-vol">{parsed.totalSets} sets · {parsed.totalVolume.toLocaleString()} kg volume</span>
          </div>
          <div className="parse-list">
            {parsed.exercises.map((ex, i) => {
              const bs = bestSet(ex.sets);
              return (
                <div key={i} className="parse-ex">
                  <span className="parse-ex-name">{ex.name}</span>
                  <span className="parse-ex-detail">{ex.sets.length} sets{bs ? ` · top ${bs.weight}${bs.unit}×${bs.reps}` : ""}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button className="btn full" onClick={save} disabled={!text.trim()}>Save workout</button>
    </Card>
    {!hideRecent && <RecentList entries={recent} render={w => <><span className="ra-main">{w.label}{w.prs?.length ? " 🏆" : ""}</span><span className="ra-date">{formatShortDate(w.date)}</span></>} />}
    </>
  );
}

// ─── SPORTS ──
