import { useState, useMemo } from "react";
import { MiniChart, Card, Empty, toast } from "../components/primitives";
import { StatusPill } from "../components/StatusPill";
import { sleepQuality, DEFAULT_SLEEP_NEED_H } from "../config";
import { estimateSleepNeed, computeSleep } from "../engines/sleep";
import { computeSleepScores } from "../engines/sleepScore";
import { computeWeightTrend } from "../engines/weight";
import { parseWorkout } from "../engines/workout";
import { getTodayStr, formatShortDate, daysAgo } from "../lib/dates";
import { haptic } from "../lib/fx";

// ─── SLEEP FORM ──
export function SleepForm({ onAdd, recent }) {
  const [form, setForm] = useState({ date: getTodayStr(), bedtime: "22:30", wakeTime: "06:30", quality: "Good", latencyMin: "", wakeMin: "", notes: "", alarmUsed: null });
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
    if (form.alarmUsed !== null) entry.alarmUsed = form.alarmUsed; // true | false; omit if untouched
    onAdd(entry);
    toast("◐ Sleep logged");
    setForm(f => ({ ...f, latencyMin: "", wakeMin: "", notes: "", alarmUsed: null }));
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

        {/* Woke to an alarm? — kept visible; feeds the sleep-need learning gate */}
        <div className="sleep-field-label">Woke to an alarm?</div>
        <div className="seg">
          <button className={`seg-btn ${form.alarmUsed === false ? "active" : ""}`} onClick={() => { set("alarmUsed", false); haptic(8); }}>No — woke naturally</button>
          <button className={`seg-btn ${form.alarmUsed === true ? "active" : ""}`} onClick={() => { set("alarmUsed", true); haptic(8); }}>Yes — alarm</button>
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
    </>
  );
}

// ─── SLEEP SCORE CARD ──
// Oura-style nightly score computed from the user's real history. Shows the most
// recent night: ring + band, key stats, the contributor breakdown, and one tip.
const fmtHm = min => { const h = Math.floor(min / 60), m = Math.round(min % 60); return m ? `${h}h ${m}m` : `${h}h`; };

function scoreInsight(night, data) {
  if (!night || night.score >= 85 || !night.contributors.length) return null;
  const low = night.contributors.reduce((a, b) => (b.score < a.score ? b : a));
  const lateMeal = (data.diet || []).some(d => d.date === night.date && (() => {
    const t = d.consumedAt ?? d.ts; if (!t) return false; const h = new Date(t).getHours(); return h >= 21 || h < 4;
  })());
  const tips = {
    duration: "Total sleep was the drag — an earlier lights-out is the fastest single win here.",
    regularity: "Your sleep timing drifted from your recent nights — holding a fixed wake time steadies this quickest.",
    efficiency: "Time in bed outran time asleep — trimming wind-down, late caffeine or screens lifts efficiency.",
    subjective: lateMeal
      ? "You logged a late meal and rated how you felt low despite decent numbers — worth testing an earlier dinner."
      : "The numbers were fine but you didn't feel it — check late meals, screens or stress before bed.",
  };
  return { label: low.label, text: tips[low.key] || tips.subjective };
}

function SleepScoreCard({ data, need }) {
  const scores = useMemo(() => computeSleepScores(data.sleep, need), [data.sleep, need]);
  if (!scores.length) return null;
  const night = scores[scores.length - 1];
  const band = night.band;
  const frac = Math.min(1, Math.max(0, night.score / 100));
  const size = 150, stroke = 11, R = (size - stroke) / 2, C = 2 * Math.PI * R;
  const trend = scores.slice(-14).map(s => ({ value: s.score, label: s.date.slice(5) }));
  const insight = scoreInsight(night, data);
  const stat = (v, l) => (<div className="ss-stat"><div className="ss-stat-v">{v}</div><div className="ss-stat-l">{l}</div></div>);

  return (
    <Card title="Sleep score" action={<span className="muted small">{formatShortDate(night.date)}</span>}>
      <div className="ss-ring-wrap">
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="var(--line)" strokeWidth={stroke} />
          <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke={band.color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - frac)} style={{ transition: "stroke-dashoffset .7s cubic-bezier(.22,1,.36,1)" }} />
        </svg>
        <div className="ss-ring-center">
          <div className="ss-score">{night.score}</div>
          <div className="ss-band" style={{ color: band.color }}>{band.label}</div>
        </div>
      </div>

      <div className="ss-stats">
        {stat(night.tstMin != null ? fmtHm(night.tstMin) : "—", "slept")}
        {stat(night.efficiency != null ? `${night.efficiency}%` : "—", "efficiency")}
        {stat(night.regSD != null ? `${night.regSD}m` : "—", "SD regularity")}
      </div>

      <div className="ss-shaped-h">WHAT SHAPED IT</div>
      <div className="ss-contribs">
        {night.contributors.map(c => (
          <div className="ss-contrib" key={c.key}>
            <div className="ss-contrib-top">
              <span className="ss-contrib-name">{c.icon} {c.label}</span>
              <span className="ss-contrib-val">{c.band.label} · {c.score}</span>
            </div>
            <div className="ss-bar"><i style={{ width: `${c.score}%`, background: c.band.color }} /></div>
          </div>
        ))}
      </div>

      {insight && (
        <div className="ss-insight">
          <div className="ss-insight-h">💡 Worth testing</div>
          <div className="ss-insight-t">{insight.text}</div>
        </div>
      )}

      {trend.length >= 3 && (
        <div style={{ marginTop: 14 }}>
          <div className="ss-shaped-h">SCORE · LAST {trend.length} NIGHTS</div>
          <MiniChart points={trend} height={64} />
        </div>
      )}
    </Card>
  );
}

// Collapsible "Recent nights" — lives at the very bottom of the section.
function RecentSleepDropdown({ sleep }) {
  const [open, setOpen] = useState(false);
  const nights = [...(sleep || [])].filter(s => s && s.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  if (!nights.length) return null;
  return (
    <Card>
      <button className="ss-recent-toggle" onClick={() => setOpen(o => !o)}>
        <span>Recent nights<span className="muted small" style={{ marginLeft: 8 }}>{nights.length}</span></span>
        <span className="muted">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="list" style={{ marginTop: 12 }}>
          {nights.map(s => (
            <div key={s.id} className="list-row">
              <span className="list-main">{s.duration}h · {s.quality}</span>
              <span className="muted small">{formatShortDate(s.date)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── SLEEP DEBT CARD ──
// Everyday view of the rolling 14-night debt. Neutral debt number; teal for the
// pay-down plan and the aged-out relief nudge (shown only when relief > 0).
function SleepDebtCard({ debt }) {
  if (!debt) return null;
  const { debtH, deltaVsYesterdayH, agedOutReliefH, paydownNights, paydownExtraMin, lowConfidence, loggedNights } = debt;
  const square = debtH <= 0.2;
  return (
    <Card title="Sleep debt" sub="rolling 14 nights vs your need">
      <div className="center-stack" style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>
          {square ? "0" : debtH}<span className="muted" style={{ fontSize: 15, marginLeft: 4 }}>{square ? "h — you're square" : "h behind"}</span>
        </div>
        {!square && deltaVsYesterdayH !== 0 && (
          <div className="muted small">{deltaVsYesterdayH > 0 ? `+${deltaVsYesterdayH}` : deltaVsYesterdayH}h since yesterday</div>
        )}
      </div>
      {!square && paydownNights > 0 && (
        <div className="ss-insight" style={{ marginTop: 4 }}>
          <div className="ss-insight-h">Clear it</div>
          <div className="ss-insight-t">Sleep <strong>+{paydownExtraMin} min</strong> for <strong>{paydownNights} night{paydownNights === 1 ? "" : "s"}</strong> to wipe the slate.</div>
        </div>
      )}
      {agedOutReliefH > 0 && (
        <p className="small" style={{ marginTop: 10, color: "var(--accent)", lineHeight: 1.5 }}>↓ A rough night just aged out of the 14-night window — {agedOutReliefH}h of debt rolled off on its own.</p>
      )}
      {lowConfidence && <p className="muted small" style={{ marginTop: 8 }}>Only {loggedNights}/14 nights logged — treat this as a rough estimate.</p>}
    </Card>
  );
}

// ─── SLEEP DEBT CALCULATOR (onboarding / what-if; no history needed) ──
// Standalone: lets a brand-new user feel the debt feature in 30 seconds by
// punching in their last week. In-app debt (SleepDebtCard) stays automatic.
function SleepDebtCalculator() {
  const [need, setNeed] = useState("8");
  const [nights, setNights] = useState(["", "", "", "", "", "", ""]);
  const setN = (i, v) => setNights(a => a.map((x, j) => (j === i ? v : x)));
  const needH = Math.max(4, Math.min(12, parseFloat(need) || DEFAULT_SLEEP_NEED_H));
  const vals = nights.map(parseFloat).filter(v => v > 0 && v < 24);
  const debt = vals.length ? Math.max(0, +vals.reduce((a, h) => a + (needH - h), 0).toFixed(1)) : null;
  const band = debt == null ? null
    : debt < 2 ? "You're basically square."
    : debt < 6 ? "A manageable backlog — a couple of longer nights clears it."
    : "A real backlog — worth prioritising sleep this week.";
  return (
    <Card title="Try it: sleep debt" sub="No history needed — punch in your last week">
      <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span className="muted small">Your nightly need</span>
        <input type="number" step="0.5" inputMode="decimal" value={need} onChange={e => setNeed(e.target.value)} style={{ width: 80 }} />
        <span className="muted">h</span>
      </div>
      <div className="sleep-field-label">Hours slept — last 7 nights</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 }}>
        {nights.map((v, i) => (
          <input key={i} type="number" step="0.5" inputMode="decimal" value={v} onChange={e => setN(i, e.target.value)} placeholder="–" style={{ textAlign: "center", padding: "8px 4px" }} />
        ))}
      </div>
      <div className="center-stack" style={{ marginTop: 16 }}>
        <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>{debt == null ? "—" : debt}<span className="muted" style={{ fontSize: 15, marginLeft: 4 }}>h behind</span></div>
        {band && <div className="muted small" style={{ marginTop: 4 }}>{band}</div>}
      </div>
      <p className="muted small" style={{ marginTop: 12, lineHeight: 1.5 }}>Log a few nights above and this becomes automatic — tracked over a rolling 14-night window, with a pay-down plan.</p>
    </Card>
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
        <SleepDebtCalculator />
      </div>
    );
  }

  const q = sleep.quantity, r = sleep.regularity, c = sleep.continuity;
  const nFree = sleep.need.nUnassisted ?? sleep.need.nGood;
  const needSrc = sleep.need.source === "override" ? "you set this"
    : sleep.need.source === "learned" ? `learned from ${nFree} alarm-free mornings`
    : sleep.need.source === "learning" ? `learning from ${nFree} alarm-free morning${nFree === 1 ? "" : "s"} so far — still near the ${DEFAULT_SLEEP_NEED_H}h default`
    : "provisional default — log more alarm-free nights to personalize";

  return (
    <div className="stack">
      {log}

      <SleepScoreCard data={data} need={sleep.need.hours} />

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

      {/* SLEEP DEBT */}
      <SleepDebtCard debt={sleep.debt} />

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

      {/* RECENT — collapsed at the very bottom */}
      <RecentSleepDropdown sleep={data.sleep} />
    </div>
  );
}
