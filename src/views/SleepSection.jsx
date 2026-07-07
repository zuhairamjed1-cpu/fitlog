import { useState, useMemo } from "react";
import { MiniChart, Card, Empty, toast } from "../components/primitives";
import { StatusPill } from "../components/StatusPill";
import { RecentList } from "../components/RecentList";
import { sleepQuality } from "../config";
import { estimateSleepNeed, computeSleep } from "../engines/sleep";
import { computeWeightTrend } from "../engines/weight";
import { parseWorkout } from "../engines/workout";
import { getTodayStr, formatShortDate, daysAgo } from "../lib/dates";
import { haptic } from "../lib/fx";

// ─── SLEEP FORM ──
export function SleepForm({ onAdd, recent }) {
  const [form, setForm] = useState({ date: getTodayStr(), bedtime: "22:30", wakeTime: "06:30", quality: "Good", latencyMin: "", wakeMin: "", notes: "" });
  const [showDetail, setShowDetail] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const tibH = (() => {
    const [bh, bm] = form.bedtime.split(":").map(Number), [wh, wm] = form.wakeTime.split(":").map(Number);
    let m = (wh * 60 + wm) - (bh * 60 + bm); if (m < 0) m += 1440; return m / 60;
  })();
  const lat = parseFloat(form.latencyMin) || 0;
  const waso = parseFloat(form.wakeMin) || 0;
  const tstH = Math.max(0, tibH - lat / 60 - waso / 60);
  const hasDetail = lat > 0 || waso > 0;
  const eff = tibH > 0 ? Math.round((tstH / tibH) * 100) : 0;
  const fmt12 = t => { const [h, m] = t.split(":").map(Number); const ap = h < 12 ? "AM" : "PM"; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`; };
  const isToday = form.date === getTodayStr();
  function save() {
    const entry = { date: form.date, bedtime: form.bedtime, wakeTime: form.wakeTime, quality: form.quality, notes: form.notes, duration: +tibH.toFixed(1), id: Date.now() };
    if (form.latencyMin !== "") entry.latencyMin = Math.max(0, Math.round(parseFloat(form.latencyMin)) || 0);
    if (form.wakeMin !== "") entry.wakeMin = Math.max(0, Math.round(parseFloat(form.wakeMin)) || 0);
    onAdd(entry);
    toast("◐ Sleep logged");
    setForm(f => ({ ...f, latencyMin: "", wakeMin: "", notes: "" }));
    setShowDetail(false);
  }
  return (
    <>
      <Card title="Log sleep" action={
        <input type="date" className="sleep-date" value={form.date} onChange={e => set("date", e.target.value)} />
      }>
        {/* Hero — live duration readout */}
        <div className="sleep-hero">
          <div className="sleep-hero-moon">☾</div>
          <div className="sleep-hero-dur">{tibH.toFixed(1)}<span>h{hasDetail ? " in bed" : ""}</span></div>
          <div className="sleep-hero-range">
            {fmt12(form.bedtime)} → {fmt12(form.wakeTime)}
            {hasDetail && <> · <strong>{tstH.toFixed(1)}h asleep</strong> · {eff}%</>}
          </div>
        </div>

        {/* Times */}
        <div className="field-grid" style={{ marginTop: 4 }}>
          <label>Got in bed<input type="time" value={form.bedtime} onChange={e => set("bedtime", e.target.value)} /></label>
          <label>Got up<input type="time" value={form.wakeTime} onChange={e => set("wakeTime", e.target.value)} /></label>
        </div>

        {/* Quality — tappable */}
        <div className="sleep-field-label">How did you sleep?</div>
        <div className="sleep-q-chips">
          {sleepQuality.map(q => (
            <button key={q} className={`sleep-q-chip ${form.quality === q ? "on" : ""}`} onClick={() => { set("quality", q); haptic(8); }}>{q}</button>
          ))}
        </div>

        {/* Optional depth — tucked away */}
        <button className="sleep-detail-toggle" onClick={() => setShowDetail(s => !s)}>
          {showDetail ? "− Hide detail" : "+ Add fall-asleep time, wake-ups & notes"}
        </button>
        {showDetail && (
          <div className="sleep-detail">
            <div className="field-grid">
              <label>Mins to fall asleep<input type="number" inputMode="numeric" value={form.latencyMin} onChange={e => set("latencyMin", e.target.value)} placeholder="e.g. 15" /></label>
              <label>Mins awake in night<input type="number" inputMode="numeric" value={form.wakeMin} onChange={e => set("wakeMin", e.target.value)} placeholder="e.g. 0" /></label>
            </div>
            <label>Notes<textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Anything worth remembering about last night?" rows={2} /></label>
            <p className="muted small" style={{ lineHeight: 1.45 }}>These two numbers unlock your sleep-efficiency reading — add them when you have them, skip when you don't.</p>
          </div>
        )}

        <button className="btn full" style={{ marginTop: 14 }} onClick={save}>Save {isToday ? "last night" : "sleep"}</button>
      </Card>
      <RecentList entries={recent} render={s => <><span className="ra-main">{s.duration}h · {s.quality}</span><span className="ra-date">{formatShortDate(s.date)}</span></>} />
    </>
  );
}

// ─── SLEEP SECTION (the smartest section: log + full intelligence dashboard) ──


export function SleepSection({ data, goals, addEntry, onSaveGoals }) {
  const sleep = useMemo(() => computeSleep(data, goals), [data, goals]);
  const [editNeed, setEditNeed] = useState(false);
  const [needVal, setNeedVal] = useState(goals.profile?.sleepNeedH || "");

  function saveNeed() {
    const v = parseFloat(needVal);
    onSaveGoals({ ...goals, profile: { ...goals.profile, sleepNeedH: v > 0 ? v : "" } });
    setEditNeed(false);
    toast(v > 0 ? `Sleep need set to ${v}h` : "Back to auto-learned need");
  }

  const log = <SleepForm onAdd={addEntry("sleep")} recent={data.sleep} />;

  if (!sleep) {
    return (
      <div className="stack">
        {log}
        <Card title="Sleep intelligence">
          <Empty icon="◐" title="Log a few nights to wake this up" hint="Once you've logged sleep for several nights, this section learns your personal sleep need and starts reading how sleep is shaping your training, weight, and mood." />
        </Card>
      </div>
    );
  }

  const q = sleep.quantity, r = sleep.regularity, c = sleep.continuity;
  const needSrc = sleep.need.source === "override" ? "you set this" : sleep.need.source === "learned" ? `learned from ${sleep.need.nGood} of your best nights` : "provisional default — log more good nights to personalize";

  return (
    <div className="stack">
      {log}

      {/* NEED + CONFIDENCE */}
      <Card>
        <div className="sleep-need-row">
          <div>
            <div className="muted small">Your sleep need</div>
            <div className="sleep-need-v">{sleep.need.hours}<span>h</span></div>
            <div className="muted small" style={{ marginTop: 2 }}>{needSrc}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted small">Confidence</div>
            <div style={{ fontWeight: 600 }}>{sleep.confidence}</div>
            <button className="link-btn" style={{ marginTop: 4 }} onClick={() => { setNeedVal(goals.profile?.sleepNeedH || ""); setEditNeed(e => !e); }}>{editNeed ? "Cancel" : "Set manually"}</button>
          </div>
        </div>
        {editNeed && (
          <div className="row" style={{ marginTop: 10 }}>
            <input type="number" step="0.5" inputMode="decimal" value={needVal} onChange={e => setNeedVal(e.target.value)} placeholder="e.g. 8" />
            <span className="muted">h</span>
            <button className="btn" onClick={saveNeed}>Save</button>
          </div>
        )}
      </Card>

      {/* BIGGEST LEVER */}
      {sleep.topLever && (
        <Card title="Your biggest sleep lever" className="sleep-lever-card">
          <p className="sleep-lever-text">{sleep.topLever.text}</p>
        </Card>
      )}

      {/* CIRCADIAN ANCHOR */}
      {r.anchorWake && (
        <Card title="Circadian anchor" sub="The single most stabilizing habit is a fixed wake time">
          <div className="sleep-anchor">
            <div className="sleep-anchor-item"><span className="muted small">Anchor wake</span><span className="sleep-anchor-v">{r.anchorWake}</span></div>
            <div className="sleep-anchor-arrow">←</div>
            <div className="sleep-anchor-item"><span className="muted small">Target in bed by</span><span className="sleep-anchor-v">{r.bedTarget || "—"}</span></div>
          </div>
          <p className="muted small" style={{ marginTop: 4, lineHeight: 1.5 }}>Holding wake time within ~30 min every day — weekends included — anchors your body clock, which then pulls bedtime and sleep quality into line.</p>
        </Card>
      )}

      {/* THREE AXES */}
      <Card title="Duration" sub="vs your personal need" action={<StatusPill status={q.status} label={q.label} />}>
        <div className="center-stack" style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{q.avgTST7 ?? "—"}<span className="muted" style={{ fontSize: 15, marginLeft: 4 }}>h avg asleep (7d)</span></div>
          <div className="muted small">{q.debt7 > 0.5 ? `~${q.debt7}h short of your need this week` : q.debt7 < -0.5 ? `~${Math.abs(q.debt7)}h above need this week` : "On target this week"}</div>
        </div>
        <MiniChart points={sleep.series.tst} showGoal={q.need} rollingAvg unit="h" />
      </Card>

      <Card title="Regularity" sub="timing consistency & social jetlag" action={<StatusPill status={r.status} label={r.label} />}>
        <div className="sleep-axis-stats">
          <div className="ts"><span className="ts-l">Mid-sleep swing</span><span className="ts-v">{r.midSD != null ? `±${Math.round(r.midSD)}min` : "—"}</span></div>
          <div className="ts"><span className="ts-l">Social jetlag</span><span className={`ts-v ${r.socialJetlag != null && r.socialJetlag >= 1.5 ? "warn" : ""}`}>{r.socialJetlag != null ? `${r.socialJetlag}h` : "—"}</span></div>
        </div>
        <p className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>{r.status === "good" ? "Your timing is consistent — keep it." : "Variable timing is one of the highest-leverage things to tighten; the research ranks it alongside total hours."}</p>
      </Card>

      <Card title="Continuity & quality" sub="how consolidated your sleep is" action={<StatusPill status={c.status} label={c.label} />}>
        <div className="sleep-axis-stats">
          {c.hasEffData && <div className="ts"><span className="ts-l">Efficiency</span><span className={`ts-v ${c.avgEff != null && c.avgEff < 85 ? "warn" : ""}`}>{c.avgEff != null ? `${c.avgEff}%` : "—"}</span></div>}
          {c.avgLatency != null && <div className="ts"><span className="ts-l">Fall-asleep</span><span className="ts-v">{c.avgLatency}min</span></div>}
          {c.avgWaso != null && <div className="ts"><span className="ts-l">Awake/night</span><span className="ts-v">{c.avgWaso}min</span></div>}
          {!c.hasEffData && c.avgLatency == null && <div className="ts"><span className="ts-l">Quality trend</span><span className="ts-v">{c.qualityTrend != null ? (c.qualityTrend > 0 ? "↑ improving" : c.qualityTrend < 0 ? "↓ slipping" : "→ flat") : "—"}</span></div>}
        </div>
        {c.unrefreshing && (
          <div className="sleep-flag">
            ⚠ Unrefreshing sleep: enough hours but poor quality on {c.unrefreshCount} of {c.recentNights} recent nights. This is the top pattern worth raising with a clinician — it can't be fixed by routine alone.
          </div>
        )}
        {!c.hasEffData && <p className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>Add "mins to fall asleep" and "mins awake" when logging to unlock efficiency — the real continuity metric.</p>}
      </Card>

      {/* COUPLING */}
      {sleep.coupling.length > 0 && (
        <Card title="How sleep is affecting you" sub="patterns from your own data — correlation, not proof">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {sleep.coupling.map((co, i) => (
              <div key={i} className="sleep-couple-row">
                <span className="sleep-couple-dot" style={{ background: co.severity === "critical" ? "var(--bad)" : co.severity === "important" ? "#f9c97e" : "var(--accent)" }} />
                <span className="small" style={{ lineHeight: 1.5 }}>{co.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

    </div>
  );
}
