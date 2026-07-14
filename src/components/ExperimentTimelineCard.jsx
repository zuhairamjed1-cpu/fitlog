import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Card, Empty } from "./primitives";
import { getTodayStr, formatShortDate, daysAgoFrom, localDateStr } from "../lib/dates";
import { deriveStatus, daysElapsed, evaluate, metricSeries, metricLabel, makeExperiment, applyVerdict, hasOverlap } from "../lib/experiments";

const AC = "#4fb3bd", GOOD = "#5fcf80", BAD = "#f4776a", MUT = "#6b7480", T2 = "#9aa4b2", TX = "#eef2f6", LINE = "#262d38";
const dayDiff = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

const STAT_BY_SOURCE = {
  exercise: ["volume", "sets", "count"],
  sleep: ["score", "debt"],
  weight: ["avg"],
  water: ["total", "count"],
  nutrition: ["total", "count"],
  nicotine: ["count", "total"],
};
const DEFAULT_DIR = { est1RM: "up", volume: "up", sets: "up", score: "up", debt: "down", avg: "down", total: "up", count: "down" };

export function ExperimentTimelineCard({ data, goals, setData, onNav }) {
  const today = getTodayStr();
  const [sheet, setSheet] = useState(false);
  const [all, setAll] = useState(false);
  const [detail, setDetail] = useState(null);
  const exps = data.experiments || [];

  const withStatus = useMemo(() => exps.map(e => ({ ...e, _status: deriveStatus(e, today) })), [exps, today]);
  const needVerdict = withStatus.filter(e => e._status === "done" && !e.verdict);
  const rank = { active: 0, planned: 1, done: 2 };
  const visible = useMemo(() => withStatus.filter(e => !(e._status === "done" && !e.verdict))
    .sort((a, b) => (rank[a._status] - rank[b._status]) || b.endDate.localeCompare(a.endDate)).slice(0, 4), [withStatus]);

  const recordVerdict = (id, v) => setData(d => ({ ...d, ...applyVerdict(d, id, v, goals) }));

  // shared timescale across visible bars, min 30-day span
  const span = useMemo(() => {
    const set = visible.length ? visible : needVerdict;
    if (!set.length) return null;
    let min = set[0].startDate, max = set[0].endDate;
    set.forEach(e => { if (e.startDate < min) min = e.startDate; if (e.endDate > max) max = e.endDate; });
    if (today < min) min = today; if (today > max) max = today;
    let days = dayDiff(min, max);
    if (days < 30) { max = daysAgoFrom(min, -30); days = 30; }
    return { min, max, days };
  }, [visible, needVerdict, today]);
  const pos = d => span ? Math.max(0, Math.min(100, (dayDiff(span.min, d) / span.days) * 100)) : 0;

  const hasAny = exps.length > 0;

  return (
    <Card title="🧪 Experiments" sub={span ? `${formatShortDate(span.min)} – ${formatShortDate(span.max)}` : "Test one change at a time"}
      action={hasAny ? <button className="btn-ghost btn-sm" onClick={() => setAll(true)}>All ›</button> : null}>

      {/* verdict prompts */}
      {needVerdict.map(e => {
        const ev = evaluate(data, e, exps);
        return (
          <div key={e.id} style={{ background: "rgba(79,179,189,0.08)", border: `1px solid rgba(79,179,189,0.25)`, borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: TX }}>{e.title} ended {dayDiff(e.endDate, today)}d ago.</div>
            <div style={{ fontSize: 12.5, color: T2, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
              {ev.baseline != null && ev.during != null
                ? <>{metricLabel(e.metric)} {Math.round(ev.baseline)} → {Math.round(ev.during)}{ev.deltaPct != null ? ` (${ev.delta >= 0 ? "+" : ""}${Math.round(ev.deltaPct * 100)}%)` : ""}{ev.confidence === "low" ? " · low confidence" : ""}</>
                : "not enough data logged to compute a change"}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {["kept", "dropped", "inconclusive"].map(v => (
                <button key={v} onClick={() => recordVerdict(e.id, v)}
                  style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: `1px solid ${LINE}`, background: "var(--bg-2)", color: TX, fontSize: 12.5, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>{v}</button>
              ))}
            </div>
          </div>
        );
      })}

      {!hasAny ? (
        <div style={{ textAlign: "center", padding: "18px 8px" }}>
          <div style={{ color: T2, fontSize: 14, marginBottom: 12 }}>Test one change at a time.</div>
          <button className="btn" onClick={() => setSheet(true)}>+ New experiment</button>
        </div>
      ) : (
        <>
          {span && visible.length > 0 && (
            <div style={{ position: "relative", marginBottom: 6 }}>
              {/* today rule */}
              <div style={{ position: "absolute", left: `${pos(today)}%`, top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.25)", zIndex: 1 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
                {visible.map(e => <TimelineRow key={e.id} e={e} pos={pos} today={today} data={data} exps={exps} onOpen={() => setDetail(e.id)} />)}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn-ghost full" onClick={() => setSheet(true)}>+ New experiment</button>
            <button className="btn-ghost full" onClick={() => setAll(true)}>All experiments</button>
          </div>
        </>
      )}

      {sheet && <NewExperimentSheet data={data} goals={goals} setData={setData} onClose={() => setSheet(false)} />}
      {all && <AllExperimentsSheet data={data} exps={exps} onClose={() => setAll(false)} onOpen={id => { setAll(false); setDetail(id); }} />}
      {detail && <ExperimentDetailSheet data={data} exp={exps.find(x => x.id === detail)} onClose={() => setDetail(null)} />}
    </Card>
  );
}

function TimelineRow({ e, pos, today, data, exps, onOpen }) {
  const status = e._status;
  const left = pos(e.startDate), right = pos(e.endDate);
  const width = Math.max(3, right - left);
  const color = status === "active" ? AC : status === "planned" ? MUT : GOOD;
  let subtitle, rightLabel;
  if (status === "active") { const { day, total } = daysElapsed(e, today); subtitle = `day ${day} of ${total} · ${metricLabel(e.metric)}`; }
  else if (status === "planned") { subtitle = `starts ${formatShortDate(e.startDate)} · ${dayDiff(e.startDate, e.endDate) + 1} days`; }
  else { const ev = evaluate(data, e, exps); subtitle = ev.baseline != null && ev.during != null ? `${metricLabel(e.metric)} ${ev.delta >= 0 ? "+" : ""}${Math.round(ev.delta)}` : "no data"; rightLabel = e.verdict; }
  return (
    <div onClick={onOpen} style={{ cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: TX, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</span>
        {rightLabel && <span style={{ fontSize: 11, fontWeight: 700, textTransform: "capitalize", color: e.verdict === "kept" ? GOOD : e.verdict === "dropped" ? BAD : MUT }}>{rightLabel}</span>}
      </div>
      <div style={{ position: "relative", height: 9, marginTop: 5, borderRadius: 999, background: "rgba(255,255,255,0.04)" }}>
        {status === "planned" ? (
          <div style={{ position: "absolute", left: `${left}%`, width: `${width}%`, top: 0, bottom: 0, borderRadius: 999, border: `1.5px dashed ${MUT}` }} />
        ) : status === "active" ? (
          <>
            <div style={{ position: "absolute", left: `${left}%`, width: `${width}%`, top: 0, bottom: 0, borderRadius: 999, background: "rgba(79,179,189,0.25)" }} />
            <div style={{ position: "absolute", left: `${left}%`, width: `${width * daysElapsed(e, today).day / daysElapsed(e, today).total}%`, top: 0, bottom: 0, borderRadius: 999, background: AC }} />
          </>
        ) : (
          <div style={{ position: "absolute", left: `${left}%`, width: `${width}%`, top: 0, bottom: 0, borderRadius: 999, background: color, opacity: 0.5 }} />
        )}
      </div>
      <div style={{ fontSize: 11.5, color: T2, marginTop: 4 }}>{subtitle}</div>
    </div>
  );
}

// ── New experiment sheet ──
function sheetShell(children, onClose) {
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(6,9,13,0.72)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000, animation: "pc-fade 0.18s ease" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", background: "#12161d", border: `1px solid ${LINE}`, borderBottom: "none", borderRadius: "22px 22px 0 0", padding: "8px 20px 26px", animation: "pc-rise 0.24s cubic-bezier(0.22,1,0.36,1)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 12px" }}><span style={{ width: 38, height: 4, borderRadius: 999, background: "#333c47" }} /></div>
        {children}
      </div>
    </div>, document.body);
}
const fieldStyle = { width: "100%", background: "var(--bg-2)", color: TX, border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 14 };
const capLabel = { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: MUT, fontWeight: 600, marginBottom: 7, display: "block" };

function NewExperimentSheet({ data, goals, setData, onClose }) {
  const today = getTodayStr();
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(daysAgoFrom(today, -6)); // 7-day default
  const [source, setSource] = useState("sleep");
  const [stat, setStat] = useState("score");
  const [hypothesis, setHypothesis] = useState("");

  const metric = { source, stat, direction: source === "exercise" ? "up" : (DEFAULT_DIR[stat] || "up") };
  const dummyExp = { id: "_new", startDate: start, endDate: end };
  const overlap = hasOverlap(dummyExp, data.experiments || []);
  const valid = title.trim() && start <= end;

  const create = () => {
    if (!valid) return;
    const exp = makeExperiment({ title, startDate: start, endDate: end, metric, hypothesis });
    if (overlap) exp.verdict = undefined; // allowed; evaluate() will mark confidence low
    setData(d => ({ ...d, experiments: [exp, ...(d.experiments || [])] }));
    onClose();
  };

  return sheetShell(
    <>
      <div style={{ fontSize: 16, fontWeight: 700, color: TX, marginBottom: 4 }}>New experiment</div>
      <div className="muted small" style={{ marginBottom: 16 }}>One change, one metric, a fixed window.</div>

      <label style={capLabel}>Title</label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Incline bench 3×/wk" style={fieldStyle} />

      <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
        <div style={{ flex: 1 }}><label style={capLabel}>Start</label><input type="date" value={start} onChange={e => setStart(e.target.value)} style={fieldStyle} /></div>
        <div style={{ flex: 1 }}><label style={capLabel}>End</label><input type="date" value={end} onChange={e => setEnd(e.target.value)} style={fieldStyle} /></div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={capLabel}>Metric (required)</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={source} onChange={e => { const s = e.target.value; setSource(s); setStat(STAT_BY_SOURCE[s][0]); }} style={{ ...fieldStyle, flex: 1 }}>
            {Object.keys(STAT_BY_SOURCE).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={capLabel}>Hypothesis (optional)</label>
        <input value={hypothesis} onChange={e => setHypothesis(e.target.value)} placeholder="…will grow my upper chest" style={fieldStyle} />
      </div>

      {overlap && <div style={{ marginTop: 14, fontSize: 12.5, color: "#f9c97e", background: "rgba(249,201,126,0.08)", border: "1px solid rgba(249,201,126,0.25)", borderRadius: 10, padding: "10px 12px" }}>You already have an experiment in this window. Overlapping runs make both results low-confidence.</div>}

      <button className="btn full" style={{ marginTop: 18 }} onClick={create} disabled={!valid}>Start experiment</button>
    </>, onClose);
}

// ── All experiments (grouped by year) ──
function AllExperimentsSheet({ data, exps, onClose, onOpen }) {
  const today = getTodayStr();
  const rows = [...exps].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const byYear = {};
  rows.forEach(e => { const y = (e.startDate || "").slice(0, 4); (byYear[y] = byYear[y] || []).push(e); });
  return sheetShell(
    <>
      <div style={{ fontSize: 16, fontWeight: 700, color: TX, marginBottom: 14 }}>All experiments</div>
      {rows.length === 0 ? <Empty title="No experiments yet" hint="Start one from the Home card." /> :
        Object.keys(byYear).sort((a, b) => b.localeCompare(a)).map(y => (
          <div key={y} style={{ marginBottom: 16 }}>
            <div style={capLabel}>{y}</div>
            {byYear[y].map(e => {
              const st = deriveStatus(e, today);
              const ev = st === "done" && e.verdict ? evaluate(data, e, exps) : null;
              return (
                <div key={e.id} onClick={() => onOpen(e.id)} style={{ padding: "11px 2px", borderTop: `1px solid ${LINE}`, cursor: "pointer" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: TX }}>{e.title}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "capitalize", color: e.verdict === "kept" ? GOOD : e.verdict === "dropped" ? BAD : e.verdict ? MUT : st === "active" ? AC : MUT }}>{e.verdict || st}</span>
                  </div>
                  <div style={{ fontSize: 12, color: T2, marginTop: 3 }}>{formatShortDate(e.startDate)}–{formatShortDate(e.endDate)} · {metricLabel(e.metric)}{ev ? ` · ${ev.delta >= 0 ? "+" : ""}${Math.round(ev.delta)}` : ""}</div>
                </div>
              );
            })}
          </div>
        ))}
    </>, onClose);
}

// ── Detail sheet: hypothesis, baseline-vs-during split, verdict, linked note ──
function ExperimentDetailSheet({ data, exp, onClose }) {
  if (!exp) return null;
  const ev = evaluate(data, exp, data.experiments);
  const during = metricSeries(data, exp.metric, [exp.startDate, exp.endDate]);
  const base = metricSeries(data, exp.metric, [daysAgoFrom(exp.startDate, 28), daysAgoFrom(exp.startDate, 1)]);
  const note = exp.noteId ? (data.notes || []).find(n => n.id === exp.noteId) : null;
  const maxV = Math.max(1, ...base.map(p => p.value), ...during.map(p => p.value));
  const bar = (p, color) => <div key={p.date} title={`${p.date}: ${Math.round(p.value)}`} style={{ flex: 1, minWidth: 3, height: `${Math.max(4, (p.value / maxV) * 60)}px`, background: color, borderRadius: "2px 2px 0 0" }} />;
  return sheetShell(
    <>
      <div style={{ fontSize: 16, fontWeight: 700, color: TX }}>{exp.title}</div>
      <div className="muted small" style={{ marginTop: 3 }}>{formatShortDate(exp.startDate)}–{formatShortDate(exp.endDate)} · {metricLabel(exp.metric)}</div>
      {exp.hypothesis && <div style={{ fontSize: 13.5, color: T2, marginTop: 10, fontStyle: "italic" }}>“{exp.hypothesis}”</div>}

      <div style={{ display: "flex", gap: 14, alignItems: "flex-end", marginTop: 16, padding: "12px", background: "var(--bg-2)", borderRadius: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={capLabel}>Baseline (28d)</div>
          <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 64 }}>{base.length ? base.map(p => bar(p, MUT)) : <span className="muted small">no data</span>}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: TX, marginTop: 6 }}>{ev.baseline != null ? Math.round(ev.baseline) : "—"}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ ...capLabel, color: AC }}>During</div>
          <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 64 }}>{during.length ? during.map(p => bar(p, AC)) : <span className="muted small">no data</span>}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: TX, marginTop: 6 }}>{ev.during != null ? Math.round(ev.during) : "—"}</div>
        </div>
      </div>
      <div style={{ fontSize: 13, color: T2, marginTop: 10 }}>
        Δ {ev.delta != null ? `${ev.delta >= 0 ? "+" : ""}${Math.round(ev.delta)}${ev.deltaPct != null ? ` (${ev.delta >= 0 ? "+" : ""}${Math.round(ev.deltaPct * 100)}%)` : ""}` : "—"} · n={ev.n} · confidence {ev.confidence}
        {exp.verdict && <> · verdict <b style={{ textTransform: "capitalize", color: exp.verdict === "kept" ? GOOD : exp.verdict === "dropped" ? BAD : MUT }}>{exp.verdict}</b></>}
      </div>

      {note && <div style={{ marginTop: 14, background: "var(--bg-2)", border: `1px solid ${LINE}`, borderRadius: 12, padding: "11px 13px" }}>
        <div style={capLabel}>Linked note</div>
        <div style={{ fontSize: 13, color: TX, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{note.text}</div>
      </div>}
    </>, onClose);
}

// ── Phase 7: inline full list for Insights → Training ──
export function ExperimentsInline({ data }) {
  const today = getTodayStr();
  const [detail, setDetail] = useState(null);
  const exps = data.experiments || [];
  if (!exps.length) return null;
  const rows = [...exps].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const byYear = {};
  rows.forEach(e => { const y = (e.startDate || "").slice(0, 4); (byYear[y] = byYear[y] || []).push(e); });
  return (
    <Card title="🧪 All experiments" sub={`${exps.length} total`}>
      {Object.keys(byYear).sort((a, b) => b.localeCompare(a)).map(y => (
        <div key={y} style={{ marginBottom: 12 }}>
          <div style={{ ...capLabel, marginBottom: 4 }}>{y}</div>
          {byYear[y].map(e => {
            const st = deriveStatus(e, today);
            const ev = st === "done" && e.verdict ? evaluate(data, e, exps) : null;
            return (
              <div key={e.id} onClick={() => setDetail(e.id)} style={{ padding: "10px 2px", borderTop: `1px solid ${LINE}`, cursor: "pointer" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: TX }}>{e.title}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "capitalize", color: e.verdict === "kept" ? GOOD : e.verdict === "dropped" ? BAD : e.verdict ? MUT : st === "active" ? AC : MUT }}>{e.verdict || st}</span>
                </div>
                <div style={{ fontSize: 12, color: T2, marginTop: 3 }}>{formatShortDate(e.startDate)}–{formatShortDate(e.endDate)} · {metricLabel(e.metric)}{ev ? ` · ${ev.delta >= 0 ? "+" : ""}${Math.round(ev.delta)}` : ""}</div>
              </div>
            );
          })}
        </div>
      ))}
      {detail && <ExperimentDetailSheet data={data} exp={exps.find(x => x.id === detail)} onClose={() => setDetail(null)} />}
    </Card>
  );
}

export default ExperimentTimelineCard;
