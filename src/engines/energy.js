// ─── ADAPTIVE TDEE / ENERGY-BALANCE ENGINE ────────────────────────────────
import { computeWeightTrend } from "./weight.js";
import { daysAgo, getTodayStr } from "../lib/dates.js";

export const KCAL_PER_KG = 7700; // energy density of weight change (fat-dominant; rough for lean-mass gain)

export function mifflinBMR(profile, weightKg) {
  const sex = (profile?.sex || "").toLowerCase();
  const w = weightKg || parseFloat(profile?.weightKg);
  const h = parseFloat(profile?.heightCm);
  const a = parseFloat(profile?.age);
  if (!(w > 0 && h > 0 && a > 0)) return null;
  const base = 10 * w + 6.25 * h - 5 * a;
  if (sex.startsWith("m")) return Math.round(base + 5);
  if (sex.startsWith("f")) return Math.round(base - 161);
  return Math.round(base - 78); // unknown sex → midpoint of the ±83 constant
}

export function computeEnergyBalance(data, goals) {
  const WINDOW = 21;
  const today = getTodayStr();

  // Daily intake over the window — only days with real food logged (≥800 kcal,
  // to exclude days where a single snack was logged and the rest forgotten).
  const kcalByDay = {};
  (data.diet || []).forEach(d => { if (d.date && d.date >= daysAgo(WINDOW - 1)) kcalByDay[d.date] = (kcalByDay[d.date] || 0) + (d.calories || 0); });
  const datesLogged = Object.keys(kcalByDay).filter(d => kcalByDay[d] >= 800).sort();
  const loggedDays = datesLogged.length;
  const earliest = datesLogged[0];
  const spanDays = earliest ? Math.min(WINDOW, Math.round((new Date(today + "T00:00:00") - new Date(earliest + "T00:00:00")) / 86400000) + 1) : 0;
  const completeness = spanDays > 0 ? +(loggedDays / spanDays).toFixed(2) : 0;
  const meanIntake = loggedDays ? Math.round(datesLogged.reduce((a, d) => a + kcalByDay[d], 0) / loggedDays) : null;

  const wt = computeWeightTrend(data);
  const haveWeight = wt && wt.ratePerWeekKg != null && wt.confidence !== "Low";

  // ── Insufficient-data state — be honest, never fabricate a maintenance number ──
  if (loggedDays < 10 || spanDays < 14 || !haveWeight || meanIntake == null) {
    return {
      ready: false, loggedDays, spanDays, completeness, haveWeight: !!haveWeight,
      reason: !haveWeight
        ? "Log your weight a few more mornings — I need a stable 2-week trend before I can measure your real maintenance."
        : `Keep logging food daily — ${loggedDays}/14 days so far. TDEE is only as honest as your intake logging, so I won't guess until there's enough.`,
    };
  }

  const weightChangeKg = +(wt.ratePerWeekKg * (spanDays / 7)).toFixed(2);
  const tdee = Math.round((meanIntake - (weightChangeKg * KCAL_PER_KG / spanDays)) / 10) * 10;
  const realDelta = meanIntake - tdee; // <0 = real deficit, >0 = real surplus
  const absD = Math.abs(realDelta);

  // Sanity floor: a measured maintenance below BMR×1.1 for someone training is
  // physiologically implausible → the food logs are almost certainly short. When
  // weight is flat the back-calc makes TDEE≈intake, so the implausibly-low number
  // itself is the under-logging tell (realDelta will be ~0, not a measured deficit).
  const curWeight = wt.current || parseFloat(goals?.profile?.weightKg) || null;
  const bmr = mifflinBMR(goals?.profile, curWeight);
  const underLogging = bmr != null && tdee < bmr * 1.1 && realDelta < 50;

  let confidence = "Low";
  if (completeness >= 0.7 && loggedDays >= 12) confidence = "Moderate";
  if (completeness >= 0.85 && loggedDays >= 18 && wt.confidence === "High") confidence = "High";

  // Goal intent + a sensible recommended intake
  const phase = (goals?.strategy?.phase || "").toLowerCase();
  const goal = (goals?.goal || "").toLowerCase();
  const intent = (/cut|deficit|fat/.test(phase) || goal.includes("fat") || goal.includes("lose")) ? "cut"
    : (/bulk|surplus|gain/.test(phase) || goal.includes("muscle")) ? "bulk" : "maintain";
  let recommendedIntake = tdee;
  if (intent === "cut") recommendedIntake = Math.round((tdee * 0.82) / 10) * 10;   // ~18% deficit
  else if (intent === "bulk") recommendedIntake = Math.round((tdee * 1.10) / 10) * 10; // ~10% surplus

  // Plateau: fat-loss intent, trend weight ~flat, intake implies a deficit.
  const flat = Math.abs(wt.ratePerWeekKg) < 0.1; // <100 g/wk
  const plateau = intent === "cut" && flat && realDelta < -150 && completeness >= 0.7;

  // ── Insights ──
  const insights = [];
  if (underLogging) {
    insights.push({ text: `Your measured maintenance (~${tdee} kcal) is implausibly low for your size — that almost always means food is going unlogged, not a slow metabolism. Tighten logging before trusting any deficit number.`, priority: "important" });
  } else {
    const tgt = goals?.calories ?? null;
    if (tgt && Math.abs(tgt - tdee) >= 150) {
      insights.push({ text: `Your real maintenance measures ~${tdee} kcal — ${tdee > tgt ? `higher than the ${tgt} your targets assume, so you have more room than you think` : `lower than the ${tgt} your targets assume`}.`, priority: "notable" });
    }
    if (intent === "cut" && realDelta >= 0) {
      insights.push({ text: `You're aiming to lose fat but eating ~${meanIntake}/day — at or above your measured maintenance of ${tdee}. That's why the scale isn't moving; drop below ${tdee} for a real deficit.`, priority: "important" });
    } else if (intent === "bulk" && realDelta < -100) {
      insights.push({ text: `You're aiming to gain but eating ~${absD} kcal below your measured maintenance (${tdee}) — you're actually in a deficit, which is why the gain stalled. Eat above ${tdee}.`, priority: "important" });
    } else if (plateau) {
      insights.push({ text: `Fat loss has stalled — trend weight is flat while your intake implies a ~${absD} kcal deficit. ${completeness >= 0.8 ? "Adaptation has likely pulled your maintenance down to meet your intake — a short diet break or a further ~150–200 kcal cut will restart it." : "Some intake may be unlogged — tighten logging for a week to tell adaptation from under-recording."}`, priority: "important" });
    } else if (realDelta < -50) {
      insights.push({ text: `Eating ~${meanIntake}/day against a measured maintenance of ${tdee} — a real deficit of ~${absD}/day (≈${(absD * 7 / KCAL_PER_KG).toFixed(2)} kg/wk of tissue if held).`, priority: "notable" });
    } else if (realDelta > 50) {
      insights.push({ text: `Eating ~${meanIntake}/day against a measured maintenance of ${tdee} — a real surplus of ~${absD}/day.`, priority: "notable" });
    }
  }

  return {
    ready: true, tdee, meanIntake, realDelta, intent, recommendedIntake, currentTarget: goals?.calories ?? null,
    weightChangeKg, weightRateKgWk: wt.ratePerWeekKg, spanDays, loggedDays, completeness,
    confidence, bmr, underLogging, plateau, insights,
  };
}
