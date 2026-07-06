// ─── CORRELATION ENGINE (cross-metric patterns from the user's own logs) ──────
// Pure. Aggregates each tracked metric to a daily value, then runs Pearson
// across every meaningful pair and surfaces the strongest, plain-English links.
import { daysAgo } from "../lib/dates";

// Daily-metric registry. `unit` only flavors phrasing.
const METRICS = [
  { key: "sleep", label: "sleep" },
  { key: "cal", label: "calories" },
  { key: "protein", label: "protein" },
  { key: "carbs", label: "carbs" },
  { key: "water", label: "water" },
  { key: "workouts", label: "training volume" },
  { key: "sportMin", label: "active minutes" },
  { key: "nicotine", label: "nicotine" },
];

// Pairs we never report — either tautological or too noisy to be useful.
const SKIP = new Set(["cal|protein", "cal|carbs", "protein|carbs"]);

// Actionable hints for notable pairs (order-independent key a|b sorted).
const TIPS = {
  "sleep|workouts": (dir) => dir > 0
    ? "Better sleep tracks with more training — protect your sleep on big weeks."
    : "You train more on short sleep — watch for accumulating fatigue.",
  "cal|sleep": (dir) => dir > 0
    ? "More sleep tracks with eating more — likely better appetite/recovery."
    : "Short sleep tracks with eating more — possible late-night hunger.",
  "nicotine|sleep": (dir) => dir > 0
    ? "More nicotine days line up with longer sleep logs — check if that's real rest."
    : "More nicotine tracks with less sleep — a likely lever to pull.",
  "nicotine|workouts": (dir) => dir < 0
    ? "Higher nicotine days track with less training."
    : "Nicotine and training move together in your logs.",
  "water|workouts": (dir) => dir > 0
    ? "You drink more on training days — keep hydration up around sessions."
    : null,
  "protein|workouts": (dir) => dir > 0
    ? "Protein tracks with training volume — good fueling habit."
    : null,
};

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 8) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

// Build per-day metric map over the last `windowDays` days.
function aggregate(data, windowDays) {
  const cutoff = daysAgo(windowDays);
  const days = {};
  const ensure = d => (days[d] = days[d] || {});
  const add = (d, k, v) => { if (v == null) return; const r = ensure(d); r[k] = (r[k] || 0) + v; };

  (data.sleep || []).forEach(s => {
    if (s && s.date && s.date >= cutoff && s.duration != null) ensure(s.date).sleep = s.duration;
  });
  (data.diet || []).forEach(e => {
    if (e && e.date && e.date >= cutoff) {
      add(e.date, "cal", e.calories || 0);
      add(e.date, "protein", e.protein || 0);
      add(e.date, "carbs", e.carbs || 0);
    }
  });
  (data.water || []).forEach(w => {
    if (w && w.date && w.date >= cutoff) add(w.date, "water", w.ml || 0);
  });
  (data.exercise || []).forEach(e => {
    if (e && e.date && e.date >= cutoff) add(e.date, "workouts", 1);
  });
  (data.sports || []).forEach(s => {
    if (s && s.date && s.date >= cutoff) {
      add(s.date, "workouts", 1);
      add(s.date, "sportMin", s.duration || 0);
    }
  });
  (data.nicotine || []).forEach(n => {
    if (n && n.date && n.date >= cutoff) add(n.date, "nicotine", (n.mg != null ? n.mg : 0) || (n.amount || 0));
  });
  return days;
}

const STRENGTH = r => (Math.abs(r) >= 0.6 ? "Strong" : "Moderate");

export function computeCorrelations(data, opts = {}) {
  const { windowDays = 60, minOverlap = 14, minN = 8, threshold = 0.35, topN = 6 } = opts;
  const days = aggregate(data, windowDays);
  const dates = Object.keys(days).sort();
  if (dates.length < minOverlap) {
    return { ready: false, reason: `Keep logging — patterns appear after about ${minOverlap} days of overlapping data.`, links: [] };
  }

  const links = [];
  for (let i = 0; i < METRICS.length; i++) {
    for (let j = i + 1; j < METRICS.length; j++) {
      const A = METRICS[i], B = METRICS[j];
      const pairKey = [A.key, B.key].sort().join("|");
      if (SKIP.has(pairKey)) continue;

      const xs = [], ys = [];
      dates.forEach(d => {
        const row = days[d];
        if (row[A.key] != null && row[B.key] != null) { xs.push(row[A.key]); ys.push(row[B.key]); }
      });
      if (xs.length < minN) continue;

      const r = pearson(xs, ys);
      if (r == null || Math.abs(r) < threshold) continue;

      const dir = r > 0 ? 1 : -1;
      const text = `When ${A.label} is higher, ${B.label} tends to be ${dir > 0 ? "higher" : "lower"}.`;
      const tipFn = TIPS[pairKey];
      const tip = tipFn ? tipFn(dir) : null;

      links.push({
        a: A.label, b: B.label, aKey: A.key, bKey: B.key,
        r: +r.toFixed(2), n: xs.length, dir,
        strength: STRENGTH(r),
        text, tip,
      });
    }
  }

  links.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  return { ready: true, links: links.slice(0, topN), reason: null };
}
