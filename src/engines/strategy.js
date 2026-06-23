// ─── STRATEGY MEMORY + DECISION OUTCOME TRACKING (Steps 5 + 6) ───────────────
// Step 5: every completed phase becomes an experiment. Body-comp splits are
//   MODELED RANGES, never measured. Personal history is a WEAK PRIOR blended with
//   the evidence base by sample size — it adjusts the textbook, never replaces it.
// Step 6: recommendations are logged; "taken" is INFERRED from data (not nagged);
//   learning is strictly CORRELATIONAL ("coincided with"), never causal.

const DAY = 86400000;
const wkBetween = (a, b) => (!a || !b) ? null : (new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / (7 * DAY);
const daysSince = (date, today) => (!date ? 999 : Math.round((new Date(today + "T00:00:00") - new Date(date + "T00:00:00")) / DAY));

// ── Step 5: turn a finished phase into a stored result ──
export function computePhaseResult(phase, data) {
  const weeks = wkBetween(phase.startDate, phase.endDate) || 0;
  const wInPhase = (data.weight || [])
    .filter(w => w && w.kg > 0 && w.date >= phase.startDate && w.date <= phase.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  let actualRateKgWk = null, deltaWeightKg = null;
  if (wInPhase.length >= 2 && weeks > 0) {
    deltaWeightKg = +(wInPhase[wInPhase.length - 1].kg - wInPhase[0].kg).toFixed(2);
    actualRateKgWk = +(deltaWeightKg / weeks).toFixed(3);
  }
  const plannedRateKgWk = (phase.goalWeight != null && phase.startWeight != null && weeks > 0)
    ? +(((phase.goalWeight - phase.startWeight) / weeks)).toFixed(3)
    : (phase.targetRateKgWk ?? null);

  // MODELED body-comp split (ranges, not measured)
  const cw = wInPhase.length ? wInPhase[0].kg : (phase.startWeight || 80);
  const split = modelBodyComp(deltaWeightKg, actualRateKgWk, cw);

  // adherence over the phase
  const adherence = phaseAdherence(phase, data);

  // success band (rate near plan + decent adherence; fat-heavy gain caps at partial)
  const success = scoreSuccess(plannedRateKgWk, actualRateKgWk, adherence, actualRateKgWk, cw);

  return {
    id: phase.id || Date.now(), type: phase.type,
    startDate: phase.startDate, endDate: phase.endDate, weeks: +weeks.toFixed(1),
    plannedRateKgWk, actualRateKgWk, deltaWeightKg,
    estMuscleKg: split.muscle, estFatKg: split.fat,    // [lo, hi] ranges
    adherence, success,
    tier: "estimate", confidence: "low–moderate",
    note: "muscle/fat are modeled ranges from rate, not measured (no DEXA)",
  };
}

function modelBodyComp(delta, rate, cw) {
  if (delta == null || rate == null) return { muscle: null, fat: null };
  const ceiling = (0.5 / 100) * cw; // lean-gain ceiling kg/wk
  if (delta >= 0) {
    // faster than ceiling → smaller lean share
    const leanLo = rate > ceiling ? 0.3 : 0.5;
    const leanHi = rate > ceiling ? 0.5 : 0.7;
    return { muscle: [round(delta * leanLo), round(delta * leanHi)], fat: [round(delta * (1 - leanHi)), round(delta * (1 - leanLo))] };
  } else {
    // loss: faster loss → more lean lost
    const fast = -rate > (1.0 / 100) * cw;
    const muscleLo = fast ? 0.15 : 0.05, muscleHi = fast ? 0.35 : 0.15;
    const lost = -delta;
    return { muscle: [round(-lost * muscleHi), round(-lost * muscleLo)], fat: [round(-lost * (1 - muscleLo)), round(-lost * (1 - muscleHi))] };
  }
}

function phaseAdherence(phase, data) {
  const days = Math.max(1, Math.round((wkBetween(phase.startDate, phase.endDate) || 0) * 7));
  const loggedDiet = new Set((data.diet || []).filter(d => d.date >= phase.startDate && d.date <= phase.endDate).map(d => d.date)).size;
  return Math.min(100, Math.round((loggedDiet / days) * 100));
}

function scoreSuccess(planned, actual, adherence, rate, cw) {
  if (planned == null || actual == null) return "unknown";
  const ratio = planned !== 0 ? actual / planned : (Math.abs(actual) < 0.05 ? 1 : 0);
  const onPace = ratio >= 0.7 && ratio <= 1.3;
  const fatHeavy = rate != null && rate > (0.5 / 100) * cw; // gain above ceiling
  if (onPace && adherence >= 75 && !fatHeavy) return "high";
  if ((ratio >= 0.4 || adherence >= 60)) return "partial";
  return "low";
}

// Personal rate as a weak prior, blended with the evidence base by sample size.
export function blendRate(personalRates, textbookRate, k = 2.5) {
  const rs = (personalRates || []).filter(x => x != null);
  if (!rs.length) return { rate: textbookRate, weight: 0, n: 0, source: "evidence-only" };
  const personal = rs.reduce((a, b) => a + b, 0) / rs.length;
  const w = rs.length / (rs.length + k);
  return { rate: +(w * personal + (1 - w) * textbookRate).toFixed(3), weight: +w.toFixed(2), n: rs.length, personal: +personal.toFixed(3), source: "blended" };
}

// ── Step 6: decision outcome tracking ──
export function logDecision(log, entry) {
  return [{
    id: Date.now() + Math.random(), date: entry.date, source: entry.source || "adaptation",
    rec: entry.rec, metric: entry.metric, expectedDir: entry.expectedDir, // +1 metric should rise, -1 should fall
    baselineValue: entry.baselineValue, takenInferred: null, followupValue: null, deltaAfter: null, verdict: null,
  }, ...(log || [])];
}

// Infer "taken" from data movement and grade the outcome — correlational only.
export function evaluateDecisions(log, metricNow, today, windowDays = 21) {
  return (log || []).map(e => {
    if (e.verdict != null || e.metric == null || daysSince(e.date, today) < windowDays) return e;
    const now = metricNow[e.metric];
    if (now == null || e.baselineValue == null) return e;
    const delta = +(now - e.baselineValue).toFixed(3);
    const moved = e.expectedDir ? Math.sign(delta) === Math.sign(e.expectedDir) && Math.abs(delta) > 1e-6 : Math.abs(delta) > 1e-6;
    const verdict = !moved ? "no-change" : (e.expectedDir ? (Math.sign(delta) === Math.sign(e.expectedDir) ? "improved" : "worsened") : "changed");
    return { ...e, followupValue: now, deltaAfter: delta, takenInferred: moved, verdict, correlational: true };
  });
}

export function summarizeDecisions(log) {
  const done = (log || []).filter(e => e.verdict != null);
  const taken = done.filter(e => e.takenInferred);
  const improvedWhenTaken = taken.filter(e => e.verdict === "improved").length;
  return {
    total: done.length, taken: taken.length, improvedWhenTaken,
    note: done.length ? `Of ${done.length} evaluated suggestions, ${taken.length} coincided with the data moving the expected way; ${improvedWhenTaken} of those coincided with improvement (correlational, not proof).` : null,
  };
}

function round(x) { return x == null ? null : Math.round(x * 10) / 10; }
