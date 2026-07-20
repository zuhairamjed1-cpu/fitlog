import { useState, useMemo, useEffect } from "react";
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
import { normalizeSleep, sleepScoreParts, hypnoSegments } from "../lib/googleHealthSleep";
import { ringSVG, hypnoSVG, tstStripSVG, clockSVG, compositionSVG, miniBarSVG, hm, scoreColor } from "../lib/sleepViz";

const Svg = ({ html, className, style }) => <div className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
const parseHM = s => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : null; };
const CONF_PCT = { high: 85, moderate: 60, low: 35, set: 100 };

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

// Per-stage + efficiency trends over recent Google-Health nights.
function StageTrendCard({ nights }) {
  const withStages = (nights || []).filter(s => s.stageTotals).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  if (withStages.length < 3) return null;
  const deep = withStages.map(s => +(s.stageTotals.DEEP / 60).toFixed(2));
  const rem = withStages.map(s => +(s.stageTotals.REM / 60).toFixed(2));
  const eff = withStages.map(s => s.efficiency ?? 0);
  const avg = a => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  return (
    <Card title="Stage trends" sub={`last ${withStages.length} nights · from Google Health`}>
      <div className="ss-shaped-h">DEEP · avg {avg(deep)}h</div>
      <MiniChart points={deep} height={54} unit="h" />
      <div className="ss-shaped-h" style={{ marginTop: 14 }}>REM · avg {avg(rem)}h</div>
      <MiniChart points={rem} height={54} unit="h" />
      <div className="ss-shaped-h" style={{ marginTop: 14 }}>EFFICIENCY · avg {Math.round(avg(eff))}%</div>
      <MiniChart points={eff} height={54} unit="%" />
    </Card>
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
      const since = new Date(Date.now() - (days - 1) * 86400000).toISOString(); // full RFC3339 — Google filter needs a timestamp, not a date
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
              <span className="list-main">{s.duration}h · {s.quality}{s.source === "googlehealth" ? " · ⌚" : " · ✎"}</span>
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


// Read-time union of live Google nights + archived manual nights (storage stays
// split). Feeds the intelligence + duration/score/debt charts so manual history
// still shows; stage-only charts keep using data.sleep (manual nights lack stages).
function mergeSleep(data) {
  const live = data.sleep || [], arch = data.sleepArchive || [];
  const key = s => s.id ?? `${s.date}|${s.bedtime}`;
  const seen = new Set(live.map(key));
  return [...live, ...arch.filter(s => !seen.has(key(s)))];
}

// ─── ⌚ connect / sync bar (top of section) ─────────────────────────────────
function SyncBar({ data, addEntry }) {
  const { connected, needsReconnect, loading, connect, disconnect, fetchMetric } = useGoogleHealth();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const importSleep = async (days = 30) => {
    setBusy(true); setStatus("");
    try {
      const since = new Date(Date.now() - (days - 1) * 86400000).toISOString();
      const { dataPoints = [] } = await fetchMetric("sleep", since);
      const entries = dataPoints.map(normalizeSleep).filter(Boolean);
      const have = new Set((data.sleep || []).map(s => s.ghId).filter(Boolean));
      const add = entries.filter(e => !have.has(e.ghId));
      add.forEach(e => addEntry("sleep")(e));
      setStatus(add.length ? `✓ Imported ${add.length} night${add.length === 1 ? "" : "s"}` : "Up to date — open Google Health to force a device sync.");
      haptic(10);
    } catch (e) {
      setStatus(e.message === "token_expired" || needsReconnect ? "Session expired — reconnect." : `Sync failed: ${e.message || "try again"}`);
    }
    setBusy(false);
  };

  useEffect(() => {
    if (connected && (data.sleep || []).every(s => s.source !== "googlehealth")) importSleep(30);
    // eslint-disable-next-line
  }, [connected]);

  if (loading) return <div className="topbar"><div className="crumbs">Goals · <b>Sleep</b></div><span className="sync">checking…</span></div>;

  if (!connected) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="eyebrow">⌚ Fitbit Air</div>
        {needsReconnect && <div style={{ color: "var(--gh-red)", fontSize: 12, margin: "4px 0" }}>Session expired (weekly Testing-mode limit).</div>}
        <p style={{ margin: "2px 0 12px", fontSize: 13, color: "#aab3bd", lineHeight: 1.5 }}>Sign in with the Google account your Fitbit Air syncs to. Tokens stay server-side.</p>
        <button className="ghbtn" onClick={connect}>Connect Google Health</button>
      </div>
    );
  }

  return (
    <div className="topbar">
      <div className="crumbs">Goals · <b>Sleep</b></div>
      <button className="sync tap" onClick={() => importSleep(30)} disabled={busy} title="Sync sleep from Fitbit">
        <span className="dot" />{busy ? "syncing…" : "⌚ Fitbit Air"}
        <span className="syncx" onClick={e => { e.stopPropagation(); disconnect(); }}>✕</span>
      </button>
      {status && <div className="syncstatus">{status}</div>}
    </div>
  );
}

export function SleepSection({ data, goals, addEntry, onSaveGoals }) {
  const merged = useMemo(() => mergeSleep(data), [data]);
  const mergedData = useMemo(() => ({ ...data, sleep: merged }), [data, merged]);
  const sleep = useMemo(() => computeSleep(mergedData, goals), [mergedData, goals]);
  const [editNeed, setEditNeed] = useState(false);
  const [needVal, setNeedVal] = useState(goals.profile?.sleepNeedH || "");

  const gNights = useMemo(
    () => (data.sleep || []).filter(s => s.source === "googlehealth" && s.stageTotals).sort((a, b) => a.date.localeCompare(b.date)),
    [data.sleep]
  );
  const lastNight = gNights[gNights.length - 1] || null;
  const recentRows = useMemo(() => [...merged].filter(s => s.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8), [merged]);
  const archivedN = (data.sleepArchive || []).length;

  function saveNeed() {
    const v = parseFloat(needVal);
    onSaveGoals({ ...goals, profile: { ...goals.profile, sleepNeedH: v > 0 ? v : "" } });
    setEditNeed(false);
    toast(v > 0 ? `Sleep need set to ${v}h` : "Back to auto-learned need");
  }

  const bar = <SyncBar data={data} addEntry={addEntry} />;

  if (!sleep) {
    return (
      <div className="sleepx">
        {bar}
        <div className="card"><Empty icon="◐" title="Connect & sync to wake this up" hint="Sleep comes from your Fitbit Air via Google Health. Connect above and sync a few nights — this dashboard then learns your sleep need and reads stages, debt, and rhythm." /></div>
      </div>
    );
  }

  const q = sleep.quantity, r = sleep.regularity, need = sleep.need.hours;

  // hero
  const st = lastNight?.stageTotals;
  const parts = lastNight ? sleepScoreParts(lastNight) : null;
  const hyp = lastNight ? hypnoSegments(lastNight) : null;
  const score = lastNight?.derivedScore;
  const avg14 = gNights.slice(-14).map(n => n.derivedScore).filter(v => v != null);
  const scoreAvg = avg14.length ? Math.round(avg14.reduce((a, b) => a + b, 0) / avg14.length) : null;
  const delta = score != null && scoreAvg != null ? score - scoreAvg : null;
  const heroDate = lastNight ? new Date(lastNight.date + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "";
  const continuity = lastNight ? [
    { k: "In bed", v: lastNight.inBedHours ? hm(lastNight.inBedHours * 60) : "—" },
    { k: "Asleep", v: hm(lastNight.duration * 60) },
    { k: "Efficiency", v: lastNight.efficiency != null ? lastNight.efficiency + "%" : "—" },
    { k: "REM", v: hm(st?.REM || 0) },
    { k: "WASO", v: hm(st?.AWAKE || 0) },
  ] : [];

  // need + debt
  const debtH = sleep.debt?.debtH ?? 0;
  const confPct = CONF_PCT[sleep.confidence] ?? 40;

  // circadian
  const bedMin = parseHM(r.bedTarget), wakeMin = parseHM(r.anchorWake);
  const jlRaw = r.socialJetlag || 0;
  const jetlagMin = Math.round(jlRaw < 6 ? jlRaw * 60 : jlRaw);
  const showClock = bedMin != null && wakeMin != null;

  // composition (google, last 14)
  const comp = gNights.slice(-14).map(n => ({ D: n.stageTotals.DEEP, R: n.stageTotals.REM, L: n.stageTotals.LIGHT, A: n.stageTotals.AWAKE }));
  const deepPct = comp.length ? Math.round(comp.reduce((a, s) => a + s.D, 0) / comp.reduce((a, s) => a + s.D + s.R + s.L + s.A, 0) * 100) : 0;

  const stageChips = st ? [["Deep", st.DEEP, "var(--gh-deep)"], ["REM", st.REM, "var(--gh-rem)"], ["Light", st.LIGHT, "var(--gh-light)"], ["Awake", st.AWAKE, "var(--gh-awake)"]] : [];

  return (
    <div className="sleepx">
      {bar}

      {/* ===== HERO: LAST NIGHT ===== */}
      {lastNight ? (
        <section className="card hero">
          <div className="eyebrow">Last night</div>
          <div className="date">{heroDate}</div>
          <div className="ringwrap">
            <div className="ring">
              {parts && <Svg html={ringSVG(parts)} />}
              <div className="center">
                <div className="score num">{score ?? "—"}</div>
                <div className="cap">Sleep score</div>
                {delta != null && delta !== 0 && <div className="delta" style={{ color: delta > 0 ? "var(--gh-good)" : "var(--gh-red)" }}>{delta > 0 ? "▲" : "▼"} {Math.abs(delta)} vs 14-night avg</div>}
              </div>
            </div>
            {parts && (
              <div className="breakdown">
                {parts.map(p => (
                  <div className="bd" key={p.key}>
                    <div className="bd-top">
                      <span className="lbl"><span className="swatch" style={{ background: p.color }} />{p.key}</span>
                      <span className="val num">{Math.round(p.pts)}<i>/{p.max}</i></span>
                    </div>
                    <span className="bd-bar"><i style={{ width: Math.min(100, (p.pts / p.max) * 100) + "%", background: p.color }} /></span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {hyp && <>
            <hr className="divider" />
            <div className="stages-head"><span className="t">Sleep stages</span><span className="clock">{lastNight.bedtime} → {lastNight.wakeTime}</span></div>
            <Svg className="hypno" html={hypnoSVG(hyp)} />
          </>}
          {stageChips.length > 0 && (
            <div className="stagechips">
              {stageChips.map(([n, m, c]) => <span className="pill" key={n}><span className="swatch" style={{ background: c }} />{n} <b>{hm(m)}</b></span>)}
            </div>
          )}
          {continuity.length > 0 && (
            <div className="continuity">
              {continuity.map(c => <div className="c" key={c.k}><div className="v num">{c.v}</div><div className="k">{c.k}</div></div>)}
            </div>
          )}
        </section>
      ) : (
        <section className="card"><Empty icon="⌚" title="Synced — waiting on stage data" hint="Nights imported, but no sleep-stage detail yet. Once your Fitbit Air uploads staged sleep, the hero fills in." /></section>
      )}

      {/* ===== NEED + DEBT ===== */}
      <section className="card nd">
        <div className="nd-top">
          <div className="block need">
            <div className="k">Learned need</div>
            <div className="big num">{need}<small>h</small></div>
            <div className="conf"><span className="bar"><i style={{ width: confPct + "%" }} /></span><span className="txt">{sleep.confidence} confidence</span></div>
            <button className="link-btn" style={{ marginTop: 6, fontSize: 12 }} onClick={() => { setNeedVal(goals.profile?.sleepNeedH || ""); setEditNeed(e => !e); }}>{editNeed ? "Cancel" : "Set manually"}</button>
          </div>
          <div className="block debt" style={{ textAlign: "right" }}>
            <div className="k">Sleep debt · 14 nights</div>
            <div className="big num">{debtH <= 0.1 ? "0" : "−" + debtH}<small>h</small></div>
            <div className="sub">rolling deficit vs need</div>
          </div>
        </div>
        {editNeed && (
          <div className="row" style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <input type="number" step="0.5" inputMode="decimal" value={needVal} onChange={e => setNeedVal(e.target.value)} placeholder="e.g. 8" />
            <span className="txt">h</span><button className="ghbtn" style={{ width: "auto", padding: "8px 14px" }} onClick={saveNeed}>Save</button>
          </div>
        )}
        <Svg className="tst" html={tstStripSVG(sleep.series.tst, need)} />
        {sleep.debt?.paydownNights > 0 && (
          <div className="plan"><span className="ic">↗</span><span className="tx"><b>+{sleep.debt.paydownExtraMin} min/night for {sleep.debt.paydownNights} night{sleep.debt.paydownNights === 1 ? "" : "s"}</b> clears the debt without oversleeping.</span></div>
        )}
      </section>

      {/* ===== BIGGEST LEVER ===== */}
      {sleep.topLever && (
        <div className="lever" role="note">
          <div className="ic">🎯</div>
          <div><div className="eyebrow">Biggest lever</div><p>{sleep.topLever.text}</p></div>
        </div>
      )}

      <div className="sectionlabel"><span>Patterns</span><span>Fitbit nights only</span></div>

      {/* ===== CIRCADIAN ===== */}
      {showClock && (
        <section className="card cd">
          <div className="eyebrow">Circadian rhythm</div>
          <div className="circ">
            <Svg className="clockwrap" html={clockSVG({ bedMin, wakeMin, jetlagMin, bedSD: Math.round(r.midSD || 30) })} />
            <div className="facts">
              <div className="fact"><div className="k">Anchor wake</div><div className="v num">{r.anchorWake}</div></div>
              <div className="fact"><div className="k">Bed target</div><div className="v num">{r.bedTarget || "—"}</div></div>
              <div className="fact jet"><div className="k">Social jetlag</div><div className="v num">{jetlagMin}m</div></div>
            </div>
          </div>
        </section>
      )}

      {/* ===== STAGE COMPOSITION ===== */}
      {comp.length >= 3 && (
        <section className="card cp comp">
          <div className="lead">
            <div><div className="eyebrow">Stage composition</div><h2>Last {comp.length} nights</h2></div>
            <span className="pill num">Deep <b style={{ marginLeft: 4, color: "var(--gh-text)" }}>{deepPct}%</b></span>
          </div>
          <Svg html={compositionSVG(comp)} />
          <div className="complegend">
            {[["Deep", "var(--gh-deep)"], ["Light", "var(--gh-light)"], ["REM", "var(--gh-rem)"], ["Awake", "var(--gh-awake)"]].map(([n, c]) => <span className="pill" key={n}><span className="swatch" style={{ background: c }} />{n}</span>)}
          </div>
        </section>
      )}

      {/* ===== RECENT + ARCHIVE ===== */}
      <section className="card rc">
        <div className="lead" style={{ marginBottom: 4 }}><div><div className="eyebrow">History</div><h2>Recent nights</h2></div></div>
        {recentRows.map(s => {
          const isG = s.source === "googlehealth";
          const t = s.stageTotals;
          return (
            <div className={`row ${isG ? "" : "archived"}`} key={s.id || s.date}>
              <div className="tag">{isG ? "⌚" : "✎"}</div>
              <div className="when"><div className="d num">{formatShortDate(s.date)}</div></div>
              <div className="mini">{isG && t ? <Svg html={miniBarSVG({ D: t.DEEP, R: t.REM, L: t.LIGHT, A: t.AWAKE })} /> : <span className="arch">no stage data</span>}</div>
              <div className="dur num">{s.duration != null ? hm(s.duration * 60) : "—"}</div>
              {isG && s.derivedScore != null
                ? <div className="sc num" style={{ color: scoreColor(s.derivedScore), borderColor: scoreColor(s.derivedScore) + "33", background: scoreColor(s.derivedScore) + "12" }}>{s.derivedScore}</div>
                : <div className="sc num" style={{ color: "var(--gh-muted)", fontSize: 11, fontWeight: 600 }}>{s.quality || "—"}</div>}
            </div>
          );
        })}
        {archivedN > 0 && <div className="archnote">✎ {archivedN} legacy night{archivedN === 1 ? "" : "s"} logged manually before Fitbit — shown without stage data.</div>}
      </section>
    </div>
  );
}
