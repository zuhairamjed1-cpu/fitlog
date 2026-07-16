// ─── EXPERIMENT ENGINE (pure, unit-testable) ────────────────────────────────
import { parseWorkout, e1rm } from "../engines/workout";
import { normExercise } from "../engines/volume";
import { computeSleepScores } from "../engines/sleepScore";
import { estimateSleepNeed, sleepTST } from "../engines/sleep";
import { localDateStr, daysAgoFrom, formatShortDate } from "./dates";
import { makeNote, addNote, slug } from "./notes";

const toD = s => new Date(s + "T00:00:00");
const dayDiff = (a, b) => Math.round((toD(b) - toD(a)) / 86400000);
const clampDate = d => localDateStr(d);

// status is derived, never trusted from storage (except persisted 'done' + verdict).
export function deriveStatus(exp, today) {
  if (exp.verdict) return "done";
  const t = today || localDateStr(new Date());
  if (t < exp.startDate) return "planned";
  if (t > exp.endDate) return "done";     // ended, awaiting verdict — still "done" window-wise
  return "active";
}

// { day, total } — "day 4 of 7" (1-indexed, clamped).
export function daysElapsed(exp, today) {
  const t = today || localDateStr(new Date());
  const total = dayDiff(exp.startDate, exp.endDate) + 1;
  const day = Math.min(total, Math.max(1, dayDiff(exp.startDate, t) + 1));
  return { day, total };
}

// baseline = 28 days before start; during = [start, end]
export function windowsFor(exp) {
  return {
    baseline: [daysAgoFrom(exp.startDate, 28), daysAgoFrom(exp.startDate, 1)],
    during: [exp.startDate, exp.endDate],
  };
}

const inRange = (d, [a, b]) => d >= a && d <= b;

// ── metric series: [{date, value}] over an optional [from,to] range ──
export function metricSeries(data, metric, range) {
  const within = d => !range || inRange(d, range);
  const src = metric.source;

  if (src === "exercise") {
    // key optional. With a key → that lift; without → the whole workout aggregated.
    const key = metric.key ? normExercise(metric.key) : null;
    const rows = [];
    (data.exercise || []).forEach(e => {
      if (!e.date || !within(e.date)) return;
      const p = e._parsed || parseWorkout(e.text || "");
      const exs = key ? (p.exercises || []).filter(x => normExercise(x.name) === key) : (p.exercises || []);
      if (!exs.length) return;
      const allSets = exs.flatMap(ex => ex.sets || []);
      let value;
      if (metric.stat === "count") value = 1;                                   // one session
      else if (metric.stat === "sets") value = allSets.length;
      else if (metric.stat === "volume") value = allSets.reduce((s, st) => s + (st.weight || 0) * (st.reps || 0), 0);
      else value = Math.max(0, ...allSets.map(st => e1rm(st)));                  // est1RM (needs a key)
      rows.push({ date: e.date, value });
    });
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  if (src === "sleep") {
    if (metric.stat === "debt") {
      const needH = estimateSleepNeed(data, {}).hours;
      return (data.sleep || []).filter(s => s.date && within(s.date))
        .map(s => ({ date: s.date, value: needH - (sleepTST(s) || 0) }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    const needH = estimateSleepNeed(data, {}).hours;
    return computeSleepScores(data.sleep || [], needH)
      .filter(n => n.date && within(n.date))
      .map(n => ({ date: n.date, value: n.score }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  if (src === "weight") {
    // 7-day rolling mean of logged weight
    const pts = (data.weight || []).filter(w => w.date).map(w => ({ date: w.date, kg: w.kg }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const out = [];
    pts.forEach((p, i) => {
      const from = daysAgoFrom(p.date, 6);
      const window = pts.filter(q => q.date >= from && q.date <= p.date);
      const mean = window.reduce((s, q) => s + q.kg, 0) / window.length;
      if (within(p.date)) out.push({ date: p.date, value: +mean.toFixed(2) });
    });
    return out;
  }

  // water / nutrition / nicotine → daily total or count
  const arr = src === "nutrition" ? (data.diet || []) : (data[src] || []);
  const byDate = {};
  arr.forEach(row => {
    if (!row.date || !within(row.date)) return;
    if (metric.stat === "count") byDate[row.date] = (byDate[row.date] || 0) + 1;
    else {
      const v = src === "water" ? (row.ml || 0) : src === "nutrition" ? (row.calories || 0) : 1;
      byDate[row.date] = (byDate[row.date] || 0) + v;
    }
  });
  return Object.entries(byDate).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;

export function hasOverlap(exp, all) {
  return (all || []).some(o => o.id !== exp.id && o.startDate <= exp.endDate && o.endDate >= exp.startDate);
}

// baseline vs during, signed by metric.direction so "better" is always positive.
export function evaluate(data, exp, allExperiments) {
  const w = windowsFor(exp);
  const base = metricSeries(data, exp.metric, w.baseline).map(p => p.value);
  const during = metricSeries(data, exp.metric, w.during);
  const dvals = during.map(p => p.value);
  const baseline = mean(base);
  const duringMean = mean(dvals);
  const n = during.length;
  let delta = (baseline != null && duringMean != null) ? duringMean - baseline : null;
  // sign so "down is better" (e.g. sleep debt, weight-cut) reads positive when it drops
  if (delta != null && exp.metric.direction === "down") delta = -delta;
  const rawDelta = (baseline != null && duringMean != null) ? duringMean - baseline : null;
  const deltaPct = (delta != null && baseline) ? (delta / Math.abs(baseline)) : null;
  const overlap = allExperiments ? hasOverlap(exp, allExperiments) : false;
  const confidence = (n < 3 || overlap) ? "low" : "ok";
  return { baseline, during: duringMean, delta, rawDelta, deltaPct, n, confidence, overlap, baselineN: base.length };
}

// ── store helpers (pure array transforms) ──
export function makeExperiment(fields) {
  const now = Date.now();
  return {
    id: `x${now}`,
    title: (fields.title || "Untitled").trim(),
    hypothesis: fields.hypothesis?.trim() || undefined,
    startDate: fields.startDate,
    endDate: fields.endDate,
    metric: fields.metric,
    status: "planned",
    createdAt: localDateStr(new Date()),
  };
}

// Human label for a metric.
export function metricLabel(m) {
  if (!m) return "no metric set";
  const statLabel = { est1RM: "est-1RM", volume: "volume", sets: "sets", score: "score", debt: "debt", avg: "avg", total: "total", count: "count" }[m.stat] || m.stat;
  // Exercise with a specific lift → "Bench Press volume"; keyless (whole-workout
  // aggregate) → "workout volume". Never render the literal "undefined".
  const scope = m.source === "exercise" ? (m.key || "workout") : m.source;
  return [scope, statLabel].filter(Boolean).join(" ") || "no metric set";
}

function fmtDelta(exp, ev) {
  if (ev.baseline == null || ev.during == null) return "not enough data to compute a change";
  const unit = exp.metric.source === "exercise" && exp.metric.stat === "volume" ? " kg" : exp.metric.source === "exercise" && exp.metric.stat === "est1RM" ? " kg" : "";
  const b = Math.round(ev.baseline), d = Math.round(ev.during);
  const pct = ev.deltaPct != null ? ` (${ev.delta >= 0 ? "+" : ""}${Math.round(ev.deltaPct * 100)}%)` : "";
  return `${metricLabel(exp.metric)}: ${b}${unit} → ${d}${unit}${pct}`;
}

// Apply a verdict: set verdict + status:'done', create a linked note, set noteId.
// Returns { experiments, notes } to spread into data via setData.
export function applyVerdict(data, expId, verdict, goals) {
  const exp = (data.experiments || []).find(e => e.id === expId);
  if (!exp) return {};
  const ev = evaluate(data, exp, data.experiments);
  const body = `${exp.title} · ${formatShortDate(exp.startDate)}–${formatShortDate(exp.endDate)}\n${fmtDelta(exp, ev)}\nVerdict: ${verdict}.`;
  const tags = ["experiment"];
  if (exp.metric.key) tags.push(slug(exp.metric.key));
  const note = makeNote(body, data, goals, { source: "experiment-verdict", linkedExperimentId: exp.id, linkedExercise: exp.metric.source === "exercise" ? exp.metric.key : undefined });
  note.tags = [...new Set([...tags, ...note.tags])];
  const experiments = (data.experiments || []).map(e => e.id === expId ? { ...e, verdict, status: "done", noteId: note.id } : e);
  return { experiments, notes: addNote(data.notes || [], note) };
}
