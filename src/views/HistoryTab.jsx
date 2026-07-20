import { useState, useMemo, useEffect } from "react";
import { MacroDonut, MiniChart, Card, Empty, toast, useConfirm } from "../components/primitives";
import { StatusPill } from "../components/StatusPill";
import { ProgressionCard } from "../components/ProgressionCard";
import { StreakCard } from "../components/StreakCard";
import { NoteRow } from "./NotesScreen";
import { searchNotes } from "../lib/notes";
import { ExperimentBands } from "../components/ExperimentBands";
import { ExperimentsInline } from "../components/ExperimentTimelineCard";
import { WorkoutAnalysis } from "./WorkoutScreen";
import { CreatineSaturationCard } from "../components/CreatineSaturationCard";
import { NIC_TYPES, TYPE_DOT } from "../config";
import { getDayContext } from "../engines/dayContext";
import { computeEnergyBalance } from "../engines/energy";
import { estimateSleepNeed } from "../engines/sleep";
import { parseWorkout, bestSet, e1rm } from "../engines/workout";
import { formatShortDate, daysAgo, getTodayStr } from "../lib/dates";
import { ledgerSVG, ringSVG as nutRingSVG, weightSVG, proteinSVG, waterColSVG, smooth as nutSmooth } from "../lib/nutritionViz";

const NutSvg = ({ html, className, style }) => <div className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
const KCAL_PER_KG = 7700;
import { WeekPlannerCard } from "../components/WeekPlannerCard";
import { UrgeTracker } from "../components/UrgeTracker";
import { NicotineTab } from "./NicotineTab";
import { SleepSection } from "./SleepSection";
import { SkinSection } from "./skin/SkinSection";


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

const MACROS = [
  { key: "protein", label: "Protein", color: "var(--nut-protein)", kcal: 4 },
  { key: "carbs", label: "Carbs", color: "var(--nut-carb)", kcal: 4 },
  { key: "fat", label: "Fat", color: "var(--nut-fat)", kcal: 9 },
];
const sgn = x => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(2);

function NutritionTrends({ data, goals, addEntry, range, setRange, calPts, proteinPts, waterPts, series }) {
  const en = useMemo(() => computeEnergyBalance(data, goals), [data, goals]);
  const fmtN = n => Math.round(n).toLocaleString("en-US");

  // per-day arrays over the selected range
  const intake = calPts.map(p => (p.value != null ? p.value : 0));
  const proteinArr = proteinPts.map(p => (p.value != null ? p.value : 0));
  const today = getTodayStr();

  // weight aligned to the range dates (carry-forward last known)
  const wByDate = useMemo(() => {
    const m = {}; (data.weight || []).forEach(w => { const v = w.kg ?? w.weight ?? w.weightKg; if (w.date && v != null) m[w.date] = +v; });
    return m;
  }, [data.weight]);
  const weightRaw = useMemo(() => {
    let last = null; const out = [];
    for (const d of series) { if (wByDate[d] != null) last = wByDate[d]; out.push(last); }
    // back-fill leading nulls with the first known value
    const first = out.find(v => v != null);
    return out.map(v => (v != null ? v : first));
  }, [series, wByDate]);
  const hasWeight = weightRaw.some(v => v != null);

  // today's macros
  const todayMac = useMemo(() => {
    const t = { protein: 0, carbs: 0, fat: 0, calories: 0 };
    (data.diet || []).filter(e => e.date === today && !e.cheat).forEach(e => {
      t.protein += e.protein || 0; t.carbs += e.carbs || 0; t.fat += e.fat || 0; t.calories += e.calories || 0;
    });
    return t;
  }, [data.diet, today]);
  const eaten = Math.round(todayMac.calories || (todayMac.protein * 4 + todayMac.carbs * 4 + todayMac.fat * 9));
  const calLeft = goals.calories - eaten;

  // logging consistency (2 full / 1 partial / 0 missed)
  const logging = calPts.map(p => (p.value == null ? 0 : p.value >= goals.calories * 0.6 ? 2 : 1));
  const partialN = logging.filter(x => x === 1).length;

  // supplements → per-name presence over the last 21 days
  const supps = useMemo(() => {
    const days = Array.from({ length: 21 }, (_, i) => daysAgo(20 - i));
    const byName = {};
    (data.supplements || []).forEach(s => { if (!s.name) return; (byName[s.name] ||= { name: s.name, dose: s.dose || "", set: new Set() }).set.add(s.date); });
    return Object.values(byName).map(s => ({ name: s.name, dose: s.dose, log: days.map(d => (s.set.has(d) ? 1 : 0)) }));
  }, [data.supplements]);

  if (!en.ready) {
    return (
      <div className="nutx">
        <div className="connect show">
          <div className="card" style={{ padding: "34px 20px" }}>
            <div className="ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--nut-accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4" /></svg></div>
            <h2>Log a few days to measure maintenance</h2>
            <p>{en.reason}</p>
            <div className="fine">{en.loggedDays || 0} of ~14 days logged · estimate unlocks soon</div>
          </div>
        </div>
      </div>
    );
  }

  const realDelta = en.realDelta;                       // meanIntake − tdee
  const predictedRate = (realDelta * 7) / KCAL_PER_KG;  // kg/wk from logged deficit
  const actualRate = en.weightRateKgWk;                 // kg/wk from the scale
  const impliedIntake = en.tdee + (actualRate * KCAL_PER_KG) / 7;
  const underLogGap = Math.max(0, Math.round(impliedIntake - en.meanIntake));
  const predArr = weightRaw.length ? weightRaw.map((_, i) => (nutSmooth(weightRaw)[0] + (predictedRate / 7) * i)) : [];

  const RangeSegHead = (
    <div className="seg">
      {[7, 14, 30].map(r => <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}d</button>)}
    </div>
  );

  return (
    <div className="nutx">
      {/* HERO — ENERGY BALANCE */}
      <section className="card energy">
        <div className="card-head"><p className="eyebrow">Energy balance · measured</p>{RangeSegHead}</div>
        <div className="maintrow">
          <div>
            <div className="maintlbl">Real maintenance</div>
            <div className="big num">{fmtN(en.tdee)}<u> kcal</u></div>
          </div>
          <div className="intent">
            <div className="b" style={{ textTransform: "capitalize" }}>{en.intent === "cut" ? "Cutting" : en.intent === "bulk" ? "Bulking" : "Maintaining"}</div>
            <div className="s">target {fmtN(en.recommendedIntake)} kcal</div>
          </div>
        </div>
        <div className="subrow">
          <span>logged intake <b>{fmtN(en.meanIntake)}</b></span>
          <span>real {realDelta < 0 ? "deficit" : "surplus"} <b style={{ color: realDelta < 0 ? "var(--nut-good)" : "var(--nut-amber)" }}>{realDelta < 0 ? "−" : "+"}{fmtN(Math.abs(realDelta))}</b>/day</span>
          <span><span className={`pill ${en.confidence === "High" ? "good" : "amber"}`} style={{ padding: "2px 7px" }}>{en.confidence} confidence</span></span>
        </div>
        <NutSvg html={ledgerSVG(intake, nutSmooth(hasWeight ? weightRaw : intake.map(() => en.tdee)), en.tdee)} />
        <div className="ledger-legend">
          <span className="li"><i style={{ background: "rgba(79,179,189,.5)" }} />intake</span>
          <span className="li"><i style={{ background: "var(--nut-amber)" }} />over maintenance</span>
          <span className="li"><span className="ln" style={{ borderColor: "var(--nut-teal)" }} />maintenance</span>
          {hasWeight && <span className="li"><span className="ln" style={{ borderColor: "var(--nut-text)" }} />weight trend</span>}
        </div>
        <div className="reconcile">
          Plan vs reality — logged deficit predicts <b>{sgn(predictedRate)} kg/wk</b>{hasWeight && <>, scale shows <b className="warn">{sgn(actualRate)}</b></>}.{" "}
          {en.underLogging ? <span className="warn">Likely under-logging ~{underLogGap} kcal/day.</span> : en.plateau ? <span className="warn">Fat loss has stalled — adaptation or unlogged food.</span> : <span className="ok">On track.</span>}
        </div>
      </section>

      {/* FLAG */}
      {(en.underLogging || en.plateau) && (
        <section className="card flag">
          <div className="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--nut-amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg></div>
          <div className="body">
            <div className="k">{en.underLogging ? "Under-logging likely" : "Plateau"}</div>
            {en.underLogging
              ? <><p className="t">The scale is dropping <b>slower than your logged deficit predicts</b> — you're likely eating ~<b>{underLogGap}</b> kcal/day more than recorded.</p><div className="why">Weigh oils, dressings and snacks, or trust measured maintenance over the log. Real intake ≈ {fmtN(impliedIntake)} kcal.</div></>
              : <p className="t">Fat loss has stalled despite an apparent deficit — adaptation or unlogged food. A diet break or a small further cut restarts it.</p>}
          </div>
        </section>
      )}

      <div className="section-tag">Today</div>

      {/* TODAY macro ring */}
      <section className="card today">
        <div className="toprow">
          <div className="ring-wrap">
            <NutSvg html={nutRingSVG(MACROS.map(m => ({ kcal: todayMac[m.key] * m.kcal, color: m.color })), goals.calories)} />
            <div className="mid"><b className="num">{fmtN(Math.max(0, calLeft))}</b><small>kcal left</small><span className="eat">{fmtN(eaten)} / {fmtN(goals.calories)}</span></div>
          </div>
          <div className="macros">
            {MACROS.map(m => {
              const g = Math.round(todayMac[m.key]), goal = goals[m.key] || 1;
              return (
                <div className="macro" key={m.key}>
                  <div className="l"><span className="nm"><i style={{ background: m.color }} />{m.label}</span><span className="g">{g}<u>/{goal}g</u></span></div>
                  <div className="track"><span style={{ background: m.color, transform: `scaleX(${Math.min(g / goal, 1)})` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="section-tag">Patterns</div>

      {/* WEIGHT TREND */}
      {hasWeight && (
        <section className="card">
          <div className="wt-head">
            <div>
              <p className="eyebrow" style={{ marginBottom: 7 }}>Weight trend · {range} days</p>
              <div className="big num">{weightRaw[weightRaw.length - 1]?.toFixed(1)}<u> kg</u></div>
            </div>
            <div className="rate">actual rate<b style={{ color: actualRate <= 0 ? "var(--nut-good)" : "var(--nut-amber)" }}>{sgn(actualRate)} kg/wk</b>predicted {sgn(predictedRate)}</div>
          </div>
          <NutSvg html={weightSVG(weightRaw, predArr)} />
          <div className="wt-legend">
            <span className="li"><span className="ln" style={{ borderTop: "2px solid var(--nut-text)", width: 15 }} />actual trend</span>
            <span className="li"><span className="ln" style={{ borderTop: "2px dashed var(--nut-muted)", width: 15 }} />predicted</span>
          </div>
        </section>
      )}

      {/* PROTEIN ADHERENCE */}
      <section className="card">
        <div className="pa-head">
          <p className="eyebrow">Protein adherence · {range} days</p>
          <span className="pill" style={{ color: "var(--nut-protein)", borderColor: "rgba(249,201,126,.28)" }}>goal {goals.protein}g</span>
        </div>
        <NutSvg html={proteinSVG(proteinArr, goals.protein)} />
        <div className="pa-foot">avg <b>{Math.round(nutSmooth(proteinArr, 30).length ? proteinArr.reduce((a, b) => a + b, 0) / (proteinArr.length || 1) : 0)}g</b> · <b>{Math.round(proteinArr.filter(g => g >= goals.protein).length / (proteinArr.length || 1) * 100)}%</b> of days hit goal · protein protects muscle while cutting</div>
      </section>

      {/* LOGGING CONSISTENCY */}
      <section className="card">
        <div className="pa-head"><p className="eyebrow">Logging consistency · {range} days</p><span className="pill amber">{partialN} partial days</span></div>
        <div className="heat">
          {logging.map((s, i) => <div key={i} className="cell" title={["missed", "partial", "full"][s]} style={{ background: s === 2 ? "var(--nut-good)" : s === 1 ? "rgba(249,201,126,.55)" : "var(--nut-hair)" }} />)}
        </div>
        <div className="heat-legend">
          <span><span className="sw" style={{ background: "var(--nut-good)" }} />full</span>
          <span><span className="sw" style={{ background: "rgba(249,201,126,.55)" }} />partial</span>
          <span><span className="sw" style={{ background: "var(--nut-hair)" }} />missed</span>
        </div>
      </section>

      <div className="section-tag">Habits</div>

      <div className="habits">
        <section className="card water">
          <p className="eyebrow" style={{ marginBottom: 12 }}>Water</p>
          <div className="wtop">
            <NutSvg html={waterColSVG(waterPts[waterPts.length - 1]?.value || 0, goals.waterGoalMl)} />
            <div className="info">
              <div className="big num">{((waterPts[waterPts.length - 1]?.value || 0) / 1000).toFixed(1)}<u> L</u></div>
              <div className="s">of <b>{(goals.waterGoalMl / 1000).toFixed(1)} L</b> goal</div>
            </div>
          </div>
        </section>
        <section className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <p className="eyebrow" style={{ marginBottom: 10 }}>This range</p>
          <div className="num" style={{ fontSize: 26, fontWeight: 640, letterSpacing: "-.02em" }}>{logging.filter(x => x > 0).length}<span style={{ fontSize: 13, color: "var(--nut-muted)" }}>/{range}</span></div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--nut-muted)", marginTop: 4 }}>days logged</div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--nut-muted)", marginTop: 10 }}>avg <b style={{ color: "var(--nut-text)" }}>{fmtN(en.meanIntake)}</b> kcal</div>
        </section>
      </div>

      {/* SUPPLEMENTS */}
      {supps.length > 0 && (
        <section className="card" style={{ marginTop: 14 }}>
          <div className="pa-head" style={{ marginBottom: 6 }}><p className="eyebrow">Supplements</p></div>
          <div className="supp-note">Every supplement you track gets its own streak.</div>
          {supps.map(s => {
            let streak = 0; for (let i = s.log.length - 1; i >= 0; i--) { if (s.log[i]) streak++; else break; }
            const adher = Math.round(s.log.filter(x => x).length / s.log.length * 100);
            return (
              <div className="supp" key={s.name}>
                <div className="top"><div className="nm">{s.name}{s.dose && <u> {s.dose}</u>}</div><div className="streak"><b>🔥 {streak}</b> day streak · {adher}%</div></div>
                <div className="dots">{s.log.map((v, i) => <i key={i} className={`${v ? "on" : ""} ${i === s.log.length - 1 ? "today" : ""}`} />)}</div>
              </div>
            );
          })}
        </section>
      )}

      <CreatineSaturationCard data={data} addEntry={addEntry} />
    </div>
  );
}

function TrainingTrends({ data, goals, range, setRange, workoutPts, onSaveGoals, series }) {
  const totalWorkouts = workoutPts.reduce((a, p) => a + p.value, 0);

  return (
    <>
      <StreakCard data={data} goals={goals} onSaveGoals={onSaveGoals} />

      <WeekPlannerCard data={data} goals={goals} onSaveGoals={onSaveGoals} />

      <ProgressionCard data={data} goals={goals} />

      <WorkoutAnalysis data={data} goals={goals} />

      <RangeSeg range={range} setRange={setRange} />

      <Card title="💪 Workouts">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Total</span><span className="ts-v">{totalWorkouts}</span></div>
        </div>
        <div className="bars-row" style={{ position: "relative" }}>
          <ExperimentBands dates={series} source="exercise" experiments={data.experiments} />
          {workoutPts.map((p, i) => (
            <div key={i} className="bar-col" title={`${p.value} workout${p.value === 1 ? "" : "s"}`}>
              <div className="bar-fill" style={{ height: `${Math.min(100, p.value * 33)}%`, opacity: p.value === 0 ? 0.15 : 1 }} />
            </div>
          ))}
        </div>
      </Card>

      <ExperimentsInline data={data} />
    </>
  );
}

function SleepTrends({ data, goals, range, setRange, sleepPts, series }) {
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
        <div style={{ position: "relative" }}><MiniChart points={sleepPts} showGoal={sleepNeed} rollingAvg unit="h" /><ExperimentBands dates={series} source="sleep" experiments={data.experiments} /></div>
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
  { key: "nutrition", icon: "🍎", label: "Nutrition" },
  { key: "training", icon: "💪", label: "Training" },
  { key: "sleep", icon: "😴", label: "Sleep" },
  { key: "ejac", icon: "🌊", label: "Urges" },
  { key: "nicotine", icon: "🚬", label: "Nicotine" },
  { key: "skin", icon: "✦", label: "Skin" },
];

function TrendsView({ data, goals, addEntry, deleteEntry, onSaveGoals, initialCat }) {
  const [cat, setCat] = useState(initialCat || "nutrition");
  useEffect(() => { if (initialCat) setCat(initialCat); }, [initialCat]);
  const [range, setRange] = useState(14); // lifted so it persists across sub-tab switches
  const { series, sleepPts, calPts, proteinPts, workoutPts, waterPts } = useSeries(data, goals, range);

  return (
    <>
      <div className="subtabs subtabs-nested subtabs-emoji">
        {TREND_CATS.map(c => (
          <button key={c.key} className={`subtab ${cat === c.key ? "active" : ""}`} onClick={() => setCat(c.key)} title={c.label} aria-label={c.label}>
            <span className="subtab-emoji">{c.icon}</span><span className="subtab-name">{c.label}</span>
          </button>
        ))}
      </div>

      {cat === "nutrition" && <NutritionTrends data={data} goals={goals} addEntry={addEntry} range={range} setRange={setRange} calPts={calPts} proteinPts={proteinPts} waterPts={waterPts} series={series} />}
      {cat === "training" && <TrainingTrends data={data} goals={goals} range={range} setRange={setRange} workoutPts={workoutPts} onSaveGoals={onSaveGoals} series={series} />}
      {cat === "sleep" && <SleepSection data={data} goals={goals} addEntry={addEntry} onSaveGoals={onSaveGoals} />}
      {cat === "ejac" && <UrgeTracker data={data} addEntry={addEntry} deleteEntry={deleteEntry} />}
      {cat === "nicotine" && <NicotineTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} />}
      {cat === "skin" && <SkinSection data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} onSaveGoals={onSaveGoals} />}
    </>
  );
}

export function ListsView({ data, deleteEntry }) {
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

// Lists moved to the Me tab; Goals is trends-only now.
export function HistoryTab({ data, goals, addEntry, deleteEntry, onSaveGoals, initialCat }) {
  return (
    <div className="stack">
      <TrendsView data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} onSaveGoals={onSaveGoals} initialCat={initialCat} />
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
