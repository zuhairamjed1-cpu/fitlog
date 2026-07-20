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
import { useGoogleHealth } from "../useGoogleHealth";
import { normalizeSleep } from "../lib/googleHealthSleep";

// ─── Fitbit Air → Google Health connect + sleep import ──────────────────────
const STAGE_COLORS = { Deep: "#4f6bff", REM: "#8b6cff", Light: "#4fb3bd", Awake: "#f9c97e", "Out of bed": "#6b7480" };

// Stacked stage timeline for one night (Deep / REM / Light / Awake).
function StageBar({ totals }) {
  const order = ["Deep", "REM", "Light", "Awake"];
  const map = { Deep: totals.DEEP, REM: totals.REM, Light: totals.LIGHT, Awake: totals.AWAKE };
  const sum = order.reduce((a, k) => a + (map[k] || 0), 0) || 1;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden" }}>
        {order.map(k => (map[k] > 0 &&
          <div key={k} title={`${k} ${map[k]}m`} style={{ width: `${(map[k] / sum) * 100}%`, background: STAGE_COLORS[k] }} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8 }}>
        {order.map(k => (map[k] > 0 &&
          <span key={k} className="muted small" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: STAGE_COLORS[k] }} />
            {k} {Math.floor(map[k] / 60)}h {map[k] % 60}m
          </span>
        ))}
      </div>
    </div>
  );
}

function GoogleHealthCard({ data, addEntry }) {
  const { connected, needsReconnect, loading, connect, disconnect, fetchMetric } = useGoogleHealth();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  // Import last `days` nights of sleep, normalize, dedupe by ghId into data.sleep.
  const importSleep = async (days = 30) => {
    setBusy(true); setStatus("");
    try {
      const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
      const { dataPoints = [] } = await fetchMetric("sleep", since);
      const entries = dataPoints.map(normalizeSleep).filter(Boolean);
      const have = new Set((data.sleep || []).map(s => s.ghId).filter(Boolean));
      const add = entries.filter(e => !have.has(e.ghId));
      add.forEach(e => addEntry("sleep")(e));
      setStatus(add.length
        ? `✓ Imported ${add.length} night${add.length === 1 ? "" : "s"}`
        : "Already up to date — device may need a sync (open the Google Health app).");
      haptic(10);
    } catch (e) {
      setStatus(e.message === "token_expired" || needsReconnect
        ? "Session expired (weekly Testing-mode limit) — reconnect."
        : `Sync failed: ${e.message || "try again"}`);
    }
    setBusy(false);
  };

  // Auto-import once when we land back connected (?gh=connected round-trip).
  useEffect(() => {
    if (connected && (data.sleep || []).every(s => s.source !== "googlehealth")) importSleep(30);
    // eslint-disable-next-line
  }, [connected]);

  // Most recent Google-Health night with stage data, for the mini breakdown.
  const lastNight = useMemo(
    () => (data.sleep || []).filter(s => s.source === "googlehealth" && s.stageTotals).sort((a, b) => (a.date < b.date ? 1 : -1))[0],
    [data.sleep]
  );

  if (loading) {
    return <Card title="⌚ Fitbit Air" sub="Google Health"><p className="muted small"><span className="spinner" /> Checking connection…</p></Card>;
  }

  if (!connected) {
    return (
      <Card title="⌚ Fitbit Air" sub="Auto-import sleep stages via Google Health">
        {needsReconnect && <div className="err" style={{ marginBottom: 10 }}>Session expired (weekly Testing-mode limit). Reconnect to keep syncing.</div>}
        <p className="muted small" style={{ margin: "0 0 12px", lineHeight: 1.5 }}>
          Sign in with the Google account your Fitbit Air syncs to. Tokens stay server-side — the app never sees them.
        </p>
        <button className="btn full" onClick={connect}>Connect Google Health</button>
      </Card>
    );
  }

  return (
    <Card title="⌚ Fitbit Air" sub="Connected via Google Health" action={<button className="link-btn" onClick={disconnect}>Disconnect</button>}>
      <button className="btn full" onClick={() => importSleep(30)} disabled={busy}>{busy ? <><span className="spinner" />Syncing…</> : "↻ Sync sleep now"}</button>
      {status && <p className="muted small" style={{ marginTop: 8 }}>{status}</p>}
      {lastNight && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="small" style={{ fontWeight: 600 }}>{formatShortDate(lastNight.date)} · {lastNight.duration}h asleep</span>
            {lastNight.derivedScore != null && <span className="small" style={{ color: "#4fb3bd", fontWeight: 700 }}>Score {lastNight.derivedScore}</span>}
          </div>
          <StageBar totals={lastNight.stageTotals} />
          <p className="muted small" style={{ marginTop: 6 }}>Efficiency {lastNight.efficiency ?? "—"}% · derived score (Google Health has no native sleep score).</p>
        </div>
      )}
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>Pulls the last 30 nights with stage segments, deduped. Empty result usually means the device hasn't synced yet — open the Google Health app.</p>
    </Card>
  );
}

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
  const fitbit = <GoogleHealthCard data={data} addEntry={addEntry} />;

  if (!sleep) {
    return (
      <div className="stack">
        {log}
        {fitbit}
        <Card title="Sleep intelligence">
          <Empty icon="◐" title="Log a few nights to wake this up" hint="Once you've logged sleep for several nights, this section learns your personal sleep need and starts reading how sleep is shaping your training, weight, and mood." />
        </Card>
        <SleepDebtCalculator />
      </div>
    );
  }

  const q = sleep.quantity, r = sleep.regularity;
  const nFree = sleep.need.nUnassisted ?? sleep.need.nGood;
  const needSrc = sleep.need.source === "override" ? "you set this"
    : sleep.need.source === "learned" ? `learned from ${nFree} alarm-free mornings`
    : sleep.need.source === "learning" ? `learning from ${nFree} alarm-free morning${nFree === 1 ? "" : "s"} so far — still near the ${DEFAULT_SLEEP_NEED_H}h default`
    : "provisional default — log more alarm-free nights to personalize";

  return (
    <div className="stack">
      {log}
      {fitbit}

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

      {/* DURATION */}
      <Card title="Duration" sub="vs your personal need" action={<StatusPill status={q.status} label={q.label} />}>
        <div className="center-stack" style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{q.avgTST7 ?? "—"}<span className="muted" style={{ fontSize: 15, marginLeft: 4 }}>h avg asleep (7d)</span></div>
          <div className="muted small">{q.debt7 > 0.5 ? `~${q.debt7}h short of your need this week` : q.debt7 < -0.5 ? `~${Math.abs(q.debt7)}h above need this week` : "On target this week"}</div>
        </div>
        <MiniChart points={sleep.series.tst} showGoal={q.need} rollingAvg unit="h" />
      </Card>

      {/* RECENT — collapsed at the very bottom */}
      <RecentSleepDropdown sleep={data.sleep} />
    </div>
  );
}
