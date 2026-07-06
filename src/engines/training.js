// ─── TRAINING INTELLIGENCE ENGINE ─────────────────────────────────────────
import { parseWorkout, bestSet, e1rm } from "./workout";
import { daysAgo } from "../lib/dates";

export const MUSCLE_LABELS = { chest: "Chest", back: "Back", shoulders: "Shoulders", biceps: "Biceps", triceps: "Triceps", quads: "Quads", hamstrings: "Hamstrings", glutes: "Glutes", calves: "Calves", abs: "Abs" };

export function mapMuscles(rawName) {
  const n = (rawName || "").toLowerCase().replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return null;
  const P = (primary, secondary = []) => ({ primary, secondary });
  if (/\b(leg curl|lying curl|seated leg curl|hamstring curl|nordic)\b/.test(n)) return P(["hamstrings"]);
  if (/\b(romanian|rdl|stiff.?leg|good morning)\b/.test(n)) return P(["hamstrings"], ["glutes", "back"]);
  if (/\b(leg extension|quad extension)\b/.test(n)) return P(["quads"]);
  if (/\b(calf|calves)\b/.test(n)) return P(["calves"]);
  if (/\b(hip thrust|glute bridge|kickback|glute)\b/.test(n)) return P(["glutes"], ["hamstrings"]);
  if (/\b(leg press|hack squat)\b/.test(n)) return P(["quads"], ["glutes"]);
  if (/\b(squat)\b/.test(n)) return P(["quads"], ["glutes", "hamstrings"]);
  if (/\b(lunge|split squat|bulgarian|step.?up)\b/.test(n)) return P(["quads"], ["glutes", "hamstrings"]);
  if (/\b(deadlift|trap bar)\b/.test(n)) return P(["back"], ["hamstrings", "glutes"]);
  if (/\b(face pull|rear delt|reverse fly|reverse pec)\b/.test(n)) return P(["shoulders"], ["back"]);
  if (/\b(lateral raise|side raise|lat raise|side delt)\b/.test(n)) return P(["shoulders"]);
  if (/\b(overhead press|shoulder press|ohp|military|arnold|push press|strict press)\b/.test(n)) return P(["shoulders"], ["triceps"]);
  if (/\b(shrug)\b/.test(n)) return P(["back"]);
  if (/\b(row|pulldown|pull.?up|chin.?up|lat pull|pullover)\b/.test(n)) return P(["back"], ["biceps"]);
  if (/\bdip\b/.test(n)) return P(["triceps"], ["chest"]);
  if (/\b(tricep|triceps|pushdown|push.?down|skull|close.?grip|overhead extension)\b/.test(n)) return P(["triceps"]);
  if (/\bcurl\b/.test(n)) return P(["biceps"]);
  if (/\b(fly|flye|pec deck|pec.?dec)\b/.test(n)) return P(["chest"], ["shoulders"]);
  if (/\b(bench|chest press|incline press|decline press|chest)\b/.test(n)) return P(["chest"], ["triceps", "shoulders"]);
  if (/\bpress\b/.test(n)) return P(["chest"], ["triceps", "shoulders"]);
  if (/\b(crunch|sit.?up|plank|leg raise|knee raise|hanging|ab wheel|cable crunch|russian twist|core|abs?)\b/.test(n)) return P(["abs"]);
  if (/\bextension\b/.test(n)) return P(["triceps"]);
  return null;
}

export function computeTraining(data, goals) {
  const ex = (data.exercise || []).filter(e => e && e.date);
  if (ex.length === 0) return null;
  const getP = e => e._parsed || parseWorkout(e.text || "");
  const kgOf = s => (s.unit === "lb" ? s.weight * 0.453592 : s.weight);

  // ── PER-MUSCLE WEEKLY VOLUME (last 7 days) ──
  const weekEx = ex.filter(e => e.date >= daysAgo(6));
  const setCounts = {}; Object.keys(MUSCLE_LABELS).forEach(m => (setCounts[m] = 0));
  const unmapped = new Set();
  let workingSets = 0;
  weekEx.forEach(e => {
    getP(e).exercises.forEach(x => {
      // Approximate working sets: drop obvious warm-ups (<60% of the session's top
      // load for that lift). Bodyweight lifts (top load 0) count every set.
      const topW = x.sets.length ? Math.max(...x.sets.map(kgOf)) : 0;
      const nSets = x.sets.filter(s => (topW <= 0 ? true : kgOf(s) >= 0.6 * topW)).length;
      if (nSets === 0) return;
      const mm = mapMuscles(x.name);
      if (!mm) { unmapped.add(x.name); return; }
      workingSets += nSets;
      mm.primary.forEach(m => { if (setCounts[m] != null) setCounts[m] += nSets; });
      (mm.secondary || []).forEach(m => { if (setCounts[m] != null) setCounts[m] += nSets * 0.5; });
    });
  });
  const band = s => s < 6 ? "low" : s < 10 ? "maint" : s <= 20 ? "growth" : "high";
  const perMuscle = Object.keys(MUSCLE_LABELS).map(m => ({ muscle: m, label: MUSCLE_LABELS[m], sets: Math.round(setCounts[m] * 2) / 2, band: band(setCounts[m]) }));
  const trained = perMuscle.filter(x => x.sets > 0);
  const sortedVol = [...trained].sort((a, b) => b.sets - a.sets);
  const get = m => setCounts[m] || 0;

  const imbalances = [];
  const ratioFlag = (a, b, la, lb) => { const va = get(a), vb = get(b); if (va >= 6 && va / Math.max(vb, 0.5) >= 2) imbalances.push(`${la} (${Math.round(va)} sets) is getting ~${(va / Math.max(vb, 0.5)).toFixed(1)}× the volume of ${lb} (${Math.round(vb)})`); };
  ratioFlag("chest", "back", "Chest", "Back"); ratioFlag("back", "chest", "Back", "Chest");
  ratioFlag("quads", "hamstrings", "Quads", "Hamstrings");

  const goalMuscle = /muscle|hypertrophy|build|gain/i.test((goals?.goal || "") + " " + (goals?.strategy?.focus || ""));
  const majors = ["chest", "back", "shoulders", "quads", "hamstrings"];
  const neglected = workingSets >= 20 ? majors.filter(m => get(m) < 6).map(m => MUSCLE_LABELS[m]) : [];

  // ── PER-LIFT PROGRESSION (last 8 weeks, est 1RM trend) ──
  const base = daysAgo(55);
  const byLift = {};
  ex.filter(e => e.date >= base).forEach(e => {
    const dayIdx = Math.round((new Date(e.date + "T00:00:00") - new Date(base + "T00:00:00")) / 86400000);
    getP(e).exercises.forEach(x => {
      const best = e1rm(bestSet(x.sets));
      if (best <= 0) return;
      const key = x.name.toLowerCase().replace(/\s+/g, " ").trim();
      (byLift[key] = byLift[key] || { display: x.name, pts: [] }).pts.push({ dayIdx, e1rm: best });
    });
  });
  const lifts = [];
  Object.values(byLift).forEach(L => {
    const byDay = {};
    L.pts.forEach(pt => { if (!byDay[pt.dayIdx] || pt.e1rm > byDay[pt.dayIdx].e1rm) byDay[pt.dayIdx] = pt; });
    const pts = Object.values(byDay).sort((a, b) => a.dayIdx - b.dayIdx);
    if (pts.length < 3) return;
    const spanDays = pts[pts.length - 1].dayIdx - pts[0].dayIdx;
    if (spanDays < 14) return;
    const n = pts.length, sx = pts.reduce((a, p) => a + p.dayIdx, 0), sy = pts.reduce((a, p) => a + p.e1rm, 0);
    const sxx = pts.reduce((a, p) => a + p.dayIdx * p.dayIdx, 0), sxy = pts.reduce((a, p) => a + p.dayIdx * p.e1rm, 0);
    const denom = n * sxx - sx * sx;
    const slopePerWk = (denom !== 0 ? (n * sxy - sx * sy) / denom : 0) * 7;
    const meanE = sy / n;
    const slopePct = meanE > 0 ? +(slopePerWk / meanE * 100).toFixed(1) : 0;
    let status;
    if (slopePct >= 0.4) status = "progressing";
    else if (slopePct <= -0.6) status = "regressing";
    else status = "stalled";
    lifts.push({ name: L.display, sessions: pts.length, e1rmNow: Math.round(pts[pts.length - 1].e1rm), slopePct, status, weeks: Math.max(2, Math.round(spanDays / 7)) });
  });
  const compoundRe = /bench|squat|deadlift|press|row|pulldown|pull.?up|chin/i;
  lifts.sort((a, b) => (compoundRe.test(b.name) - compoundRe.test(a.name)) || b.sessions - a.sessions || b.e1rmNow - a.e1rmNow);
  const stalls = lifts.filter(l => l.status === "stalled" || l.status === "regressing");
  const progressing = lifts.filter(l => l.status === "progressing");

  // ── INSIGHTS ──
  const insights = [];
  stalls.slice(0, 2).forEach(l => insights.push({ text: `${l.name} has ${l.status === "regressing" ? "slipped" : "been flat"} ~${l.weeks} weeks (est 1RM ~${l.e1rmNow}kg). Change a variable — add a set, drop reps and add load, or take a deload week.`, priority: "important" }));
  if (neglected.length) insights.push({ text: `Under-trained this week: ${neglected.join(", ")} (under ~6 hard sets). For balanced growth, aim ~10+ sets/week each.`, priority: "important" });
  imbalances.slice(0, 1).forEach(t => insights.push({ text: `Volume imbalance — ${t}. Worth evening out for structural balance and joint health.`, priority: "notable" }));
  if (goalMuscle && trained.length >= 3) {
    const lowMaj = majors.filter(m => get(m) > 0 && get(m) < 10);
    if (lowMaj.length >= 3) insights.push({ text: `Most muscles are under ~10 hard sets this week — below the productive hypertrophy range. If growth is the goal, add volume gradually (a set or two per muscle per week).`, priority: "notable" });
  }
  progressing.slice(0, 1).forEach(l => insights.push({ text: `${l.name} is progressing well (est 1RM trending +${l.slopePct}%/wk). Keep the current approach.`, priority: "notable" }));

  let confidence = "Low";
  if (ex.length >= 6 && weekEx.length >= 2) confidence = "Moderate";
  if (ex.length >= 12 && lifts.length >= 2) confidence = "High";

  return {
    week: { perMuscle, trained, sortedVol, mostTrained: sortedVol[0] || null, leastTrained: sortedVol[sortedVol.length - 1] || null, imbalances, neglected, unmapped: [...unmapped], workingSets: Math.round(workingSets), sessions: weekEx.length },
    progression: { lifts: lifts.slice(0, 6), stalls, progressing, tracked: lifts.length },
    insights, confidence,
  };
}
