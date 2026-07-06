// ─── NICOTINE TAB (single view) ──
// Layout top→bottom: Quick add · Timing readout · Intake+trend (bottom).
import { useState } from "react";
import { getTodayStr, WEEKDAYS } from "../lib/dates";
import { haptic, SFX } from "../lib/fx";
import { Card, Empty, MiniChart, toast } from "../components/primitives";
import { NIC_TYPES, NIC_QUICK } from "../config";
import { computeNicotineStats, computeNicotineTiming } from "../engines/nicotine";

export function NicotineTab({ data, goals, addEntry, deleteEntry }) {
  const onAdd = addEntry("nicotine");
  const onDelete = deleteEntry("nicotine");
  const today = getTodayStr();
  const todayNic = (data.nicotine || []).filter(n => n.date === today);

  function quickAdd(q) {
    const ts = Date.now();
    onAdd({ id: ts, date: getTodayStr(), ts, type: q.type, amount: q.amount, mg: q.mg, contexts: [] });
    haptic(12); SFX.tap();
    const ti = NIC_TYPES.find(t => t.key === q.type);
    toast(`${ti?.icon || ""} ${q.label} logged`.trim(), { silent: true });
  }

  const todayCount = todayNic.length;
  const todayUnits = todayNic.reduce((a, n) => a + (n.amount || 0), 0);

  return (
    <div className="stack">
      {/* 1 — QUICK ADD */}
      <Card title="Quick add" sub="One tap to log">
        <div className="nic-quick">
          {NIC_QUICK.map((q, i) => {
            const ti = NIC_TYPES.find(t => t.key === q.type);
            return (
              <button key={i} className="nic-quick-btn" onClick={() => quickAdd(q)}>
                <span className="nic-quick-icon">{ti?.icon}</span>
                <span>{q.label}</span>
              </button>
            );
          })}
        </div>
        {todayCount > 0 && (
          <p className="muted small" style={{ marginTop: 12, textAlign: "center" }}>
            Today: {todayCount} {todayCount === 1 ? "entry" : "entries"} · {todayUnits} units
          </p>
        )}
      </Card>

      {/* today's list — compact, with delete */}
      {todayNic.length > 0 && (
        <Card title="Today">
          <div className="list">
            {todayNic.slice().reverse().map(n => {
              const ti = NIC_TYPES.find(t => t.key === n.type);
              const t = new Date(n.ts || Date.now());
              return (
                <div key={n.id} className="list-row">
                  <div className="list-main"><div>{ti?.icon} {n.amount} {ti?.unit}{n.type === "pouch" && n.mg ? ` · ${n.mg}mg` : ""}</div></div>
                  <span className="muted">{t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <button className="x" onClick={() => onDelete(n.id)}>×</button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* 2 — TIMING READOUT */}
      <NicotineTiming data={data} goals={goals} />

      {/* 3 — INTAKE + 30-DAY TREND (bottom) */}
      <NicotineIntakeCard data={data} />
    </div>
  );
}

function NicotineTiming({ data, goals }) {
  const [open, setOpen] = useState(false);
  const t = computeNicotineTiming(data, goals);

  const bandMeta = {
    lower:    { label: "Lower-impact window", cls: "lower",    note: "Conditions stack less against recovery right now — this is not a green light, just less compounding." },
    moderate: { label: "Moderate-impact window", cls: "moderate", note: "Some recovery factors are working against you right now." },
    higher:   { label: "Higher-impact window", cls: "higher",  note: "Several recovery factors are stacked against you right now." },
  };
  const meta = bandMeta[t.band];

  const activeName = WEEKDAYS[(new Date(t.activeDay + "T00:00:00").getDay() + 6) % 7];
  const isTraining = goals.plan?.trainingDays?.includes(activeName);
  const contextLine = t.crossedMidnight
    ? `${isTraining ? "Training day" : "Rest day"} (${activeName}, still up) · ${t.time}`
    : `${isTraining ? "Training day" : "Rest day"} · ${t.time}`;

  return (
    <Card title="If you smoke now" sub="How today's conditions stack — not a recommendation">
      <button className={`nic-band nic-band-${meta.cls}`} onClick={() => { setOpen(o => !o); haptic(8); }}>
        <div className="nic-band-main">
          <span className="nic-band-dot" />
          <div>
            <div className="nic-band-label">{meta.label}</div>
            <div className="nic-band-ctx">{contextLine}</div>
          </div>
        </div>
        <span className="nic-band-chev">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="nic-band-detail">
          <p className="nic-band-note">{t.insufficientData ? "Not enough logged today to read your conditions — so this can't be called a lower-impact window. Log last night's sleep for a real read." : meta.note}</p>

          {t.raising.length > 0 && (
            <div className="nic-reasons">
              <div className="nic-reasons-h raising">What's raising impact now</div>
              <ul>{t.raising.map((r, i) => <li key={i}>{r.text}</li>)}</ul>
            </div>
          )}

          {t.easing.length > 0 && (
            <div className="nic-reasons">
              <div className="nic-reasons-h easing">Currently in your favor</div>
              <ul>{t.easing.map((r, i) => <li key={i}>{r.text}</li>)}</ul>
            </div>
          )}

          {t.unknown.length > 0 && (
            <p className="muted small" style={{ marginTop: 10 }}>
              Missing from today's read (not logged): {t.unknown.join(", ")}.
            </p>
          )}

          <p className="nic-band-disclaimer">
            This is a labeled composite of real factors from your logs — like a UV index, not a measurement. It describes how today's conditions stack <em>if</em> you use nicotine. It is never advice to smoke.
          </p>
        </div>
      )}
    </Card>
  );
}

function NicotineIntakeCard({ data }) {
  const hasData = (data.nicotine || []).length > 0;
  if (!hasData) {
    return <Card title="Your intake"><Empty title="No nicotine logged yet" hint="Use quick add above and your totals + 30-day trend will show here." /></Card>;
  }
  const stats = computeNicotineStats(data);
  const typeOrder = ["cigarette", "vape", "pouch"];
  return (
    <Card title="Your intake" sub="Totals, averages & 30-day trend">
      <div className="nic-stat-grid">
        <div className="nic-stat"><span className="nic-stat-v">{stats.today.count}</span><span className="nic-stat-l">today</span></div>
        <div className="nic-stat"><span className="nic-stat-v">{stats.avgCount7}</span><span className="nic-stat-l">/day (7d)</span></div>
        <div className="nic-stat"><span className="nic-stat-v">{stats.w7.count}</span><span className="nic-stat-l">last 7d</span></div>
        <div className="nic-stat"><span className="nic-stat-v">{stats.w30.count}</span><span className="nic-stat-l">last 30d</span></div>
      </div>
      <div className="nic-types-breakdown">
        {typeOrder.filter(t => stats.typeTotals[t] > 0).map(t => {
          const ti = NIC_TYPES.find(x => x.key === t);
          return <span key={t} className="nic-type-pill">{ti?.icon} {stats.typeTotals[t]} {ti?.unit} <span className="muted">(30d)</span></span>;
        })}
      </div>
      <div className="nic-trend-wrap">
        <div className="weekgrid-label">30-day trend — entries/day</div>
        <MiniChart points={stats.seriesCount30} height={84} rollingAvg />
      </div>
    </Card>
  );
}
