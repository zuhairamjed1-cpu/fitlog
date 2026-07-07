import { useState } from "react";
import { Ring, MiniChart, Card, Empty, toast } from "../components/primitives";
import { computeWeightTrend } from "../engines/weight";
import { getTodayStr, formatShortDate, daysAgo } from "../lib/dates";

// ─── WATER ──
export function IntakeTab({ data, goals, addEntry, deleteEntry }) {
  const [view, setView] = useState("water");
  return (
    <div className="stack">
      <div className="seg">
        <button className={`seg-btn ${view === "water" ? "active" : ""}`} onClick={() => setView("water")}>💧 Water</button>
        <button className={`seg-btn ${view === "weight" ? "active" : ""}`} onClick={() => setView("weight")}>⚖ Weight</button>
      </div>
      {view === "water" && <WaterForm data={data} goals={goals} onAdd={addEntry("water")} onDelete={deleteEntry("water")} />}
      {view === "weight" && <WeightForm data={data} goals={goals} onAdd={addEntry("weight")} onDelete={deleteEntry("weight")} />}
    </div>
  );
}

export function WaterForm({ data, goals, onAdd, onDelete }) {
  const today = getTodayStr();
  const todayWater = data.water.filter(w => w.date === today);
  const totalMl = todayWater.reduce((a, w) => a + w.ml, 0);
  const pct = Math.min(100, Math.round((totalMl / goals.waterGoalMl) * 100));
  const [custom, setCustom] = useState("");
  const [unit, setUnit] = useState("ml");

  const add = ml => { onAdd({ id: Date.now(), date: today, ml, ts: Date.now() }); toast(`💧 +${ml}ml water`); };
  const past7 = Array.from({ length: 7 }, (_, i) => {
    const d = daysAgo(6 - i);
    const ml = data.water.filter(w => w.date === d).reduce((a, w) => a + w.ml, 0);
    return { date: d, ml };
  });
  const maxPast = Math.max(goals.waterGoalMl, ...past7.map(p => p.ml));

  return (
    <div className="stack">
      <Card>
        <div className="center-stack">
          <Ring pct={pct} label={`of ${goals.waterGoalMl}ml`} value={totalMl} unit="ml" big />
        </div>
        <div className="quick-water">
          <button className="qa" onClick={() => add(250)}>+ Glass<br /><span>250ml</span></button>
          <button className="qa" onClick={() => add(500)}>+ Bottle<br /><span>500ml</span></button>
          <button className="qa" onClick={() => add(1000)}>+ 1L<br /><span>1000ml</span></button>
        </div>
      </Card>

      <Card title="Custom amount">
        <div className="seg">
          <button className={`seg-btn ${unit === "ml" ? "active" : ""}`} onClick={() => { setUnit("ml"); setCustom(""); }}>Milliliters</button>
          <button className={`seg-btn ${unit === "l" ? "active" : ""}`} onClick={() => { setUnit("l"); setCustom(""); }}>Liters</button>
        </div>
        <div className="row">
          <input type="number" step={unit === "l" ? "0.1" : "50"} value={custom} onChange={e => setCustom(e.target.value)} placeholder={unit === "l" ? "0.5" : "350"} />
          <button className="btn" onClick={() => { const v = parseFloat(custom); if (!v) return; add(unit === "l" ? Math.round(v * 1000) : Math.round(v)); setCustom(""); }} disabled={!custom}>Add</button>
        </div>
      </Card>

      {todayWater.length > 0 && (
        <Card title="Today's log" sub={`${todayWater.length} ${todayWater.length === 1 ? "entry" : "entries"}`}>
          <div className="list">
            {todayWater.slice().reverse().map(w => {
              const t = new Date(w.ts || Date.now());
              return (
                <div key={w.id} className="list-row">
                  <span className="muted">{t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="list-main">{w.ml}ml</span>
                  <button className="x" onClick={() => onDelete(w.id)}>×</button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Past 7 days">
        <div className="week">
          {past7.map(d => (
            <div key={d.date} className="week-col">
              <div className="week-bar-wrap">
                <div className="week-bar" style={{ height: `${(d.ml / maxPast) * 100}%`, background: d.ml >= goals.waterGoalMl ? "var(--accent)" : "var(--muted)" }} />
              </div>
              <div className="week-day">{new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" }).slice(0, 1)}</div>
              <div className="week-val">{d.ml >= 1000 ? (d.ml/1000).toFixed(1) + "L" : d.ml + "ml"}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}


// ─── BODYWEIGHT ──
export function WeightForm({ data, goals, onAdd, onDelete }) {
  const today = getTodayStr();
  const [kg, setKg] = useState("");
  const todayWeights = (data.weight || []).filter(w => w.date === today);
  const trend = computeWeightTrend(data);
  const hasAny = (data.weight || []).length > 0;
  const lastLogged = hasAny ? [...data.weight].sort((a, b) => (b.ts || 0) - (a.ts || 0))[0] : null;

  const save = () => {
    const v = parseFloat(kg);
    if (!v || v <= 0) return;
    onAdd({ id: Date.now(), date: today, kg: +v.toFixed(2), ts: Date.now() });
    toast(`⚖ ${v.toFixed(1)}kg logged`);
    setKg("");
  };

  // Chart: one point per day (earliest weigh-in) across the last 30 days.
  const points = Array.from({ length: 30 }, (_, i) => {
    const d = daysAgo(29 - i);
    const dayEntries = (data.weight || []).filter(w => w.date === d);
    let val = null;
    if (dayEntries.length) val = dayEntries.reduce((a, b) => ((a.ts || 0) <= (b.ts || 0) ? a : b)).kg;
    return { value: val, label: d };
  });

  const dirIcon = trend ? (trend.direction === "gaining" ? "↑" : trend.direction === "losing" ? "↓" : "→") : "";
  const rateLabel = trend && trend.ratePerWeekG != null
    ? `${trend.ratePerWeekG > 0 ? "+" : ""}${trend.ratePerWeekG} g/wk${trend.pctBWPerWeek != null ? ` · ${trend.pctBWPerWeek > 0 ? "+" : ""}${trend.pctBWPerWeek}%BW/wk` : ""}`
    : "Need a few more weigh-ins to estimate rate";

  return (
    <div className="stack">
      <Card title="Log weight" sub={lastLogged ? `Last: ${lastLogged.kg}kg on ${formatShortDate(lastLogged.date)}` : "Weigh in the morning, after the toilet, before eating — that's the most consistent reading"}>
        <div className="row">
          <input type="number" step="0.1" inputMode="decimal" value={kg} onChange={e => setKg(e.target.value)} placeholder={lastLogged ? String(lastLogged.kg) : "e.g. 80.5"} />
          <span className="muted">kg</span>
          <button className="btn" onClick={save} disabled={!kg}>Save</button>
        </div>
      </Card>

      {trend ? (
        <Card title="Trend" sub={`${trend.nDays} weigh-in${trend.nDays === 1 ? "" : "s"} · ${trend.confidence} confidence`}>
          <div className="center-stack">
            <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{trend.current}<span className="muted" style={{ fontSize: 18, marginLeft: 4 }}>kg</span></div>
            <div className="muted">{dirIcon} {trend.direction} · {rateLabel}</div>
          </div>
          <MiniChart points={points} height={96} rollingAvg unit="kg" />
          {Math.abs(trend.divergence) >= 0.6 && (
            <div className="muted small" style={{ marginTop: 8 }}>
              Today's scale ({trend.latestRaw}kg) is {Math.abs(trend.divergence)}kg {trend.divergence > 0 ? "above" : "below"} the trend — likely water, not fat. Trust the line, not the daily number.
            </div>
          )}
        </Card>
      ) : (
        <Empty icon="⚖" title="No weight logged yet" hint="Log your weight a few mornings this week and a smoothed trend line will appear here." />
      )}

      {todayWeights.length > 0 && (
        <Card title="Today's weigh-ins">
          <div className="list">
            {todayWeights.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).map(w => {
              const t = new Date(w.ts || Date.now());
              return (
                <div key={w.id} className="list-row">
                  <span className="list-main">{w.kg}kg</span>
                  <span className="muted">{t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <button className="x" onClick={() => onDelete(w.id)}>×</button>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
