import { useState, useMemo, useEffect } from "react";
import { MacroDonut, MiniChart, Card, Empty, toast, useConfirm } from "../components/primitives";
import { StatusPill } from "../components/StatusPill";
import { ProgressionCard } from "../components/ProgressionCard";
import { StreakCard } from "../components/StreakCard";
import { NoteRow } from "./NotesScreen";
import { searchNotes } from "../lib/notes";
import { WorkoutAnalysis } from "./WorkoutScreen";
import { CreatineSaturationCard } from "../components/CreatineSaturationCard";
import { NIC_TYPES, TYPE_DOT } from "../config";
import { getDayContext } from "../engines/dayContext";
import { computeEnergyBalance } from "../engines/energy";
import { estimateSleepNeed } from "../engines/sleep";
import { parseWorkout, bestSet, e1rm } from "../engines/workout";
import { formatShortDate, daysAgo } from "../lib/dates";


// Shared per-day series builders. Nutrition series bucket by the ACTIVE day
// (bio keys share the calendar-date format, so the x-axis stays aligned with the
// calendar-day sleep/workout/water series).
function useSeries(data, goals, range) {
  return useMemo(() => {
    const series = Array.from({ length: range }, (_, i) => daysAgo(range - 1 - i));
    const dietBucket = getDayContext(data, goals).bucket();
    const sleepPts = series.map(d => { const s = data.sleep.find(x => x.date === d); return { value: s ? s.duration : null, label: d }; });
    const calPts = series.map(d => { const day = dietBucket[d] || []; return { value: day.length ? day.reduce((a, m) => a + (m.calories || 0), 0) : null, label: d }; });
    const proteinPts = series.map(d => { const day = dietBucket[d] || []; return { value: day.length ? day.reduce((a, m) => a + (m.protein || 0), 0) : null, label: d }; });
    const workoutPts = series.map(d => ({ value: data.exercise.filter(x => x.date === d).length + data.sports.filter(x => x.date === d).length, label: d }));
    const waterPts = series.map(d => { const ml = data.water.filter(x => x.date === d).reduce((a, w) => a + w.ml, 0); return { value: ml || null, label: d }; });
    const ejacPts = series.map(d => ({ value: (data.ejac || []).filter(x => x.date === d).length, label: d }));
    return { series, sleepPts, calPts, proteinPts, workoutPts, waterPts, ejacPts };
  }, [data, goals, range]);
}

function RangeSeg({ range, setRange }) {
  return (
    <div className="seg">
      {[7, 14, 30].map(r => (
        <button key={r} className={`seg-btn ${range === r ? "active" : ""}`} onClick={() => setRange(r)}>{r} days</button>
      ))}
    </div>
  );
}

function NutritionTrends({ data, goals, addEntry, range, setRange, calPts, proteinPts, waterPts }) {
  const calVals = calPts.map(p => p.value).filter(v => v != null);
  const avgCal = calVals.length ? Math.round(calVals.reduce((a, b) => a + b, 0) / calVals.length) : null;
  const proteinHits = proteinPts.filter(p => p.value != null && p.value >= goals.protein).length;
  const proteinLogged = proteinPts.filter(p => p.value != null).length;

  return (
    <>
      <EnergyBalanceCard data={data} goals={goals} />

      <RangeSeg range={range} setRange={setRange} />

      <Card title="🍎 Calories">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Average</span><span className="ts-v">{avgCal ?? "—"}</span></div>
          <div className="ts"><span className="ts-l">Target</span><span className="ts-v muted">{goals.calories}</span></div>
        </div>
        <MiniChart points={calPts} showGoal={goals.calories} rollingAvg />
      </Card>

      <Card title="🥩 Protein">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Target hit</span><span className={`ts-v ${proteinLogged && proteinHits >= proteinLogged * 0.7 ? "good" : "neutral"}`}>{proteinLogged ? `${proteinHits}/${proteinLogged} days` : "—"}</span></div>
        </div>
        <MiniChart points={proteinPts} showGoal={goals.protein} unit="g" />
      </Card>

      <Card title="💧 Water">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Daily target</span><span className="ts-v">{goals.waterGoalMl}ml</span></div>
        </div>
        <MiniChart points={waterPts} showGoal={goals.waterGoalMl} unit="ml" />
      </Card>

      <CreatineSaturationCard data={data} addEntry={addEntry} />
    </>
  );
}

function TrainingTrends({ data, goals, range, setRange, workoutPts, onSaveGoals }) {
  const totalWorkouts = workoutPts.reduce((a, p) => a + p.value, 0);

  return (
    <>
      <StreakCard data={data} goals={goals} onSaveGoals={onSaveGoals} />

      <ProgressionCard data={data} goals={goals} />

      <WorkoutAnalysis data={data} goals={goals} />

      <RangeSeg range={range} setRange={setRange} />

      <Card title="💪 Workouts">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Total</span><span className="ts-v">{totalWorkouts}</span></div>
        </div>
        <div className="bars-row">
          {workoutPts.map((p, i) => (
            <div key={i} className="bar-col" title={`${p.value} workout${p.value === 1 ? "" : "s"}`}>
              <div className="bar-fill" style={{ height: `${Math.min(100, p.value * 33)}%`, opacity: p.value === 0 ? 0.15 : 1 }} />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function SleepTrends({ data, goals, range, setRange, sleepPts }) {
  const sleepVals = sleepPts.map(p => p.value).filter(v => v != null);
  const avgSleep = sleepVals.length ? +(sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length).toFixed(1) : null;
  const sleepNeed = estimateSleepNeed(data, goals).hours;
  const sleepDebt = sleepVals.length ? sleepVals.reduce((debt, v) => debt + (sleepNeed - v), 0) : null;

  // Sleep × workout correlation (kept local for now).
  const corr = (() => {
    const series = Array.from({ length: range }, (_, i) => daysAgo(range - 1 - i));
    const days = series.map(d => {
      const s = data.sleep.find(x => x.date === d);
      const w = data.exercise.filter(x => x.date === d).length + data.sports.filter(x => x.date === d).length;
      return s ? { sleep: s.duration, w } : null;
    }).filter(Boolean);
    if (days.length < 4) return null;
    const good = days.filter(d => d.sleep >= 7);
    const poor = days.filter(d => d.sleep < 7);
    if (!good.length || !poor.length) return null;
    return {
      goodAvg: +(good.reduce((a, d) => a + d.w, 0) / good.length).toFixed(2),
      poorAvg: +(poor.reduce((a, d) => a + d.w, 0) / poor.length).toFixed(2),
      goodN: good.length, poorN: poor.length
    };
  })();

  return (
    <>
      <RangeSeg range={range} setRange={setRange} />

      <Card title="😴 Sleep">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Average</span><span className="ts-v">{avgSleep ?? "—"}h</span></div>
          <div className="ts"><span className="ts-l">Sleep debt</span><span className={`ts-v ${sleepDebt == null ? "" : sleepDebt > 5 ? "warn" : sleepDebt > 0 ? "neutral" : "good"}`}>{sleepDebt == null ? "—" : `${sleepDebt > 0 ? "+" : ""}${Math.round(sleepDebt*10)/10}h`}</span></div>
        </div>
        <MiniChart points={sleepPts} showGoal={sleepNeed} rollingAvg unit="h" />
      </Card>

      {corr && (
        <Card title="🔬 Sleep ↔ Training" className="insight-card">
          <p className="md-p">
            On nights with <strong>7+ hours sleep</strong> ({corr.goodN} days), you averaged <strong>{corr.goodAvg}</strong> workout{corr.goodAvg === 1 ? "" : "s"}/day.
            On nights with less ({corr.poorN} days), you averaged <strong>{corr.poorAvg}</strong>.
          </p>
          <p className="muted small" style={{ marginTop: 6 }}>
            {corr.goodAvg > corr.poorAvg ? "→ Better sleep correlates with more training. Prioritize rest." : corr.goodAvg < corr.poorAvg ? "→ You train more on less sleep. Watch for burnout." : "→ No strong difference yet. Keep logging."}
          </p>
        </Card>
      )}
    </>
  );
}

const TREND_CATS = [
  { key: "nutrition", label: "🍎 Nutrition" },
  { key: "training", label: "💪 Training" },
  { key: "sleep", label: "😴 Sleep" },
];

function TrendsView({ data, goals, addEntry, deleteEntry, onSaveGoals, initialCat }) {
  const [cat, setCat] = useState(initialCat || "nutrition");
  useEffect(() => { if (initialCat) setCat(initialCat); }, [initialCat]);
  const [range, setRange] = useState(14); // lifted so it persists across sub-tab switches
  const { sleepPts, calPts, proteinPts, workoutPts, waterPts } = useSeries(data, goals, range);

  return (
    <>
      <div className="subtabs subtabs-nested">
        {TREND_CATS.map(c => (
          <button key={c.key} className={`subtab ${cat === c.key ? "active" : ""}`} onClick={() => setCat(c.key)}>{c.label}</button>
        ))}
      </div>

      {cat === "nutrition" && <NutritionTrends data={data} goals={goals} addEntry={addEntry} range={range} setRange={setRange} calPts={calPts} proteinPts={proteinPts} waterPts={waterPts} />}
      {cat === "training" && <TrainingTrends data={data} goals={goals} range={range} setRange={setRange} workoutPts={workoutPts} onSaveGoals={onSaveGoals} />}
      {cat === "sleep" && <SleepTrends data={data} goals={goals} range={range} setRange={setRange} sleepPts={sleepPts} />}
    </>
  );
}

function ListsView({ data, deleteEntry }) {
  const [cat, setCat] = useState("diet");
  const [limit, setLimit] = useState(50);
  const [confirm, confirmModal] = useConfirm();
  const cats = [
    { key: "diet", label: "Meals", icon: "◉" },
    { key: "sleep", label: "Sleep", icon: "◐" },
    { key: "exercise", label: "Workouts", icon: "◆" },
    { key: "sports", label: "Sports", icon: "◇" },
    { key: "water", label: "Water", icon: "◊" },
    { key: "supplements", label: "Supplements", icon: "⊕" },
    { key: "nicotine", label: "Nicotine", icon: "🚬" },
    { key: "weight", label: "Weight", icon: "⚖" },
    { key: "ejac", label: "Ejac", icon: "💧" },
    { key: "notes", label: "Notes", icon: "✐" },
  ];
  const entries = data[cat] || [];
  const shown = entries.slice(0, limit);
  const label = cats.find(c => c.key === cat).label;

  async function handleDelete(item) {
    const ok = await confirm({ title: "Delete this entry?", body: "This can't be undone.", confirmLabel: "Delete", danger: true });
    if (ok) { deleteEntry(cat)(item.id); toast("Entry deleted"); }
  }

  return (
    <>
      {confirmModal}
      <div className="subtabs">
        {cats.map(c => (
          <button key={c.key} className={`subtab ${cat === c.key ? "active" : ""}`} onClick={() => { setCat(c.key); setLimit(50); }}>
            <span className="subtab-icon">{c.icon}</span>{c.label}
          </button>
        ))}
      </div>
      {cat === "notes" ? (
        <NotesList data={data} onDelete={id => { deleteEntry("notes")(id); toast("Note deleted"); }} />
      ) : (
      <Card title={label} sub={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}>
        {entries.length === 0 ? (
          <Empty title={`No ${label.toLowerCase()} logged yet`} hint="Tap the ＋ button to add some" />
        ) : (
          <>
            <div className="hist-list">
              {shown.map(item => <HistItem key={item.id} item={item} type={cat} onDelete={() => handleDelete(item)} />)}
            </div>
            {entries.length > limit && (
              <button className="btn-ghost full" style={{ marginTop: 10 }} onClick={() => setLimit(l => l + 50)}>Show more ({entries.length - limit} remaining)</button>
            )}
          </>
        )}
      </Card>
      )}
    </>
  );
}

function NotesList({ data, onDelete }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState(null);
  const notes = data.notes || [];
  const filtered = useMemo(() => searchNotes(notes, query, { tag }), [notes, query, tag]);
  const allTags = useMemo(() => [...new Set(notes.flatMap(n => n.tags || []))].sort(), [notes]);
  const chip = (active, label, onClick) => <button key={label} onClick={onClick} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, cursor: "pointer", border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`, background: active ? "rgba(120,180,200,0.14)" : "var(--bg-2)", color: active ? "var(--text)" : "var(--text-2)" }}>{label}</button>;
  return (
    <Card title="Notes" sub={`${notes.length} note${notes.length === 1 ? "" : "s"}`}>
      {notes.length === 0 ? (
        <Empty title="No notes yet" hint="Add notes from the ＋ → Notes tile." />
      ) : (
        <>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search notes…"
            style={{ width: "100%", background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 14, marginBottom: 10 }} />
          {allTags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {tag ? chip(true, `#${tag} ✕`, () => setTag(null)) : allTags.slice(0, 12).map(t => chip(false, `#${t}`, () => setTag(t)))}
            </div>
          )}
          {filtered.length === 0 ? <p className="muted small">No notes match.</p> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filtered.map(n => <NoteRow key={n.id} n={n} onDelete={onDelete} onTag={setTag} />)}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function HistItem({ item, type, onDelete }) {
  const [open, setOpen] = useState(false);
  let main = "", tags = [], detail = null;
  if (type === "sleep") {
    main = `${item.duration}h · ${item.quality}`;
    tags = [`${item.bedtime} → ${item.wakeTime}`];
    detail = item.notes;
  } else if (type === "diet") {
    main = `${item.meal} · ${item.food}`;
    tags = [item.time, `${item.calories} kcal`, `P ${item.protein}g`].filter(Boolean);
    detail = (
      <div className="diet-detail">
        <MacroDonut protein={item.protein} carbs={item.carbs} fat={item.fat} size={72} />
        <div className="diet-detail-macros">
          <div><span style={{ color: "#b4a8e8" }}>●</span> Protein {item.protein}g</div>
          <div><span style={{ color: "#f9c97e" }}>●</span> Carbs {item.carbs}g</div>
          <div><span style={{ color: "#f47e6e" }}>●</span> Fat {item.fat}g</div>
          {item.notes && <div className="muted small" style={{ marginTop: 4 }}>{item.notes}</div>}
        </div>
      </div>
    );
  } else if (type === "exercise") {
    const p = item._parsed || parseWorkout(item.text);
    main = item.label;
    tags = [p.exercises.length ? `${p.exercises.length} ex` : `${item.text.split("\n").filter(Boolean).length} lines`, p.totalVolume ? `${p.totalVolume.toLocaleString()}kg` : null, item.prs?.length ? `🏆 ${item.prs.length}` : null].filter(Boolean);
    detail = (
      <div>
        {item.prs?.length > 0 && (
          <div className="pr-banner">🏆 {item.prs.map(pr => `${pr.name} ${pr.weight}${pr.unit}×${pr.reps}`).join(" · ")}</div>
        )}
        {p.exercises.length > 0 && (
          <div className="ex-detail-list">
            {p.exercises.map((ex, i) => {
              const bs = bestSet(ex.sets);
              return <div key={i} className="ex-detail-row"><span>{ex.name}</span><span className="muted">{ex.sets.length}×{bs ? ` top ${bs.weight}${bs.unit}×${bs.reps}` : ""}</span></div>;
            })}
          </div>
        )}
        <pre className="raw-text">{item.text}</pre>
      </div>
    );
  } else if (type === "sports") {
    main = `${item.sport} · ${item.duration}min`;
    tags = [item.intensity, item.result || "Practice", `${item.calories} kcal`].filter(Boolean);
    detail = [item.opponent && `vs ${item.opponent}`, item.score && `Score: ${item.score}`, item.notes].filter(Boolean).join(" · ");
  } else if (type === "water") {
    main = `${item.ml}ml`;
    tags = item.ts ? [new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })] : [];
  } else if (type === "supplements") {
    main = item.name;
    tags = [item.dose, item.ts && new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })].filter(Boolean);
  } else if (type === "nicotine") {
    const ti = NIC_TYPES.find(t => t.key === item.type);
    main = `${ti?.icon || ""} ${item.amount} ${ti?.unit || item.type}${item.type === "pouch" && item.mg ? ` · ${item.mg}mg` : ""}`.trim();
    tags = [item.ts && new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), ...(item.contexts || [])].filter(Boolean);
  } else if (type === "weight") {
    main = `${item.kg}kg`;
    tags = item.ts ? [new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })] : [];
  } else if (type === "ejac") {
    const flags = [item.porn ? "porn" : null, item.gooning ? "gooning" : null].filter(Boolean);
    main = "Session" + (flags.length ? ` · ${flags.join(", ")}` : "");
    tags = item.ts ? [new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })] : [];
  }

  const hasDetail = detail && (typeof detail === "string" ? detail.trim() : true);

  return (
    <div className={`hist ${open ? "open" : ""}`}>
      <div className="hist-head" onClick={() => hasDetail && setOpen(o => !o)}>
        <div className="hist-l">
          <span className="hist-dot" style={{ background: TYPE_DOT[type] }} />
          <div className="hist-text">
            <div className="hist-main">{main}</div>
            <div className="hist-date">{formatShortDate(item.date)}</div>
          </div>
        </div>
        <div className="hist-tags">
          {tags.map((t, i) => <span key={i} className="hist-tag">{t}</span>)}
          {hasDetail && <span className="muted">{open ? "▲" : "▼"}</span>}
          <button className="x" onClick={(e) => { e.stopPropagation(); onDelete(); }}>×</button>
        </div>
      </div>
      {open && hasDetail && (
        <div className="hist-detail">{detail}</div>
      )}
    </div>
  );
}

export function HistoryTab({ data, goals, addEntry, deleteEntry, onSaveGoals, initialCat }) {
  const [view, setView] = useState("trends"); // trends | lists
  useEffect(() => { if (initialCat) setView("trends"); }, [initialCat]);
  return (
    <div className="stack">
      <div className="subtabs">
        <button className={`subtab ${view === "trends" ? "active" : ""}`} onClick={() => setView("trends")}>📊 Trends</button>
        <button className={`subtab ${view === "lists" ? "active" : ""}`} onClick={() => setView("lists")}>≡ Lists</button>
      </div>
      {view === "trends" && <TrendsView data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} onSaveGoals={onSaveGoals} initialCat={initialCat} />}
      {view === "lists" && <ListsView data={data} deleteEntry={deleteEntry} />}
    </div>
  );
}

function EnergyBalanceCard({ data, goals }) {
  const en = useMemo(() => computeEnergyBalance(data, goals), [data, goals]);

  if (!en.ready) {
    return (
      <Card title="Energy balance" sub="Your real maintenance, measured — not guessed">
        <div className="eb-building">
          <div className="muted small" style={{ lineHeight: 1.5 }}>{en.reason}</div>
          {en.haveWeight && (
            <div style={{ marginTop: 10 }}>
              <div className="rt-bar" style={{ margin: "0 0 6px" }}>
                <div className="rt-bar-fill" style={{ width: `${Math.min(100, (en.loggedDays / 14) * 100)}%` }} />
              </div>
              <div className="muted small">{en.loggedDays} of 14 days logged</div>
            </div>
          )}
        </div>
      </Card>
    );
  }

  const deficit = en.realDelta < 0;
  const deltaColor = en.intent === "cut" ? (deficit ? "var(--good)" : "var(--bad)") : en.intent === "bulk" ? (deficit ? "var(--bad)" : "var(--good)") : "var(--text)";
  const flag = en.underLogging
    ? { c: "var(--bad)", t: "Measured maintenance looks implausibly low — your food logs are likely incomplete. Tighten logging before trusting the deficit." }
    : en.plateau
      ? { c: "#f9c97e", t: "Fat loss has stalled despite an apparent deficit — adaptation or unlogged food. A diet break or a small further cut restarts it." }
      : null;

  return (
    <Card title="Energy balance" sub="Measured from your intake + weight trend" action={<StatusPill status={en.confidence === "High" ? "good" : en.confidence === "Moderate" ? "warn" : null} label={en.confidence} />}>
      <div className="center-stack" style={{ marginBottom: 8 }}>
        <div className="muted small">Your real maintenance</div>
        <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{en.tdee}<span className="muted" style={{ fontSize: 16, marginLeft: 4 }}>kcal</span></div>
        <div className="muted small" style={{ marginTop: 2 }}>
          eating ~{en.meanIntake}/day · <span style={{ color: deltaColor, fontWeight: 600 }}>{en.realDelta === 0 ? "at maintenance" : `${Math.abs(en.realDelta)} ${deficit ? "deficit" : "surplus"}`}</span>
        </div>
      </div>

      <div className="eb-grid">
        <div className="eb-cell"><span className="eb-l">Trend weight</span><span className="eb-v">{en.weightRateKgWk > 0 ? "+" : ""}{en.weightRateKgWk}<span className="muted" style={{ fontSize: 12 }}>kg/wk</span></span></div>
        <div className="eb-cell"><span className="eb-l">Your target</span><span className="eb-v">{en.currentTarget ?? "—"}</span></div>
        <div className="eb-cell"><span className="eb-l">Suggested ({en.intent})</span><span className="eb-v">{en.recommendedIntake}</span></div>
      </div>

      {flag && <div className="eb-flag" style={{ borderColor: flag.c, color: flag.c }}>{flag.t}</div>}

      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>
        Based on {en.loggedDays} logged days ({Math.round(en.completeness * 100)}% complete). This measures your actual metabolism, so it already accounts for any adaptation — trust it over any formula.
      </p>
    </Card>
  );
}

// ─── ANATOMICAL MUSCLE MAP ───────────────────────────────────────────────────
// Real anatomical muscle polygons (react-body-highlighter, MIT — see anatomyData.js).
// The art has broad regions, so each polygon is colored by the AGGREGATE volume of
// the detailed muscles that roll up to it; the tooltip and Training Analysis show

export default HistoryTab;
