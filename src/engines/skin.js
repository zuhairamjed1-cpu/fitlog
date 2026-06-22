// ─── SKIN INTELLIGENCE ENGINE ───────────────────────────────────────────────
// The reason skin belongs inside FitLog and not in a standalone app: it reads
// the user's OWN physiology (sleep, nicotine, dairy/high-GL diet, stress) and
// correlates it against their logged skin condition. Plus curated routine-
// conflict detection and trend tracking. Honest by construction:
//   • correlations are personal and lagged, never claimed as proof;
//   • we never fabricate quantified photo metrics or a single "skin score";
//   • routine conflicts come from a curated rule set, not invention;
//   • evidence is graded (nicotine/UV strong; dairy/GL moderate; hydration weak);
//   • nothing here diagnoses or prescribes — it defers to a clinician.

import { daysAgo, daysAgoFrom, getTodayStr } from "../lib/dates.js";
import { sleepTST, estimateSleepNeed } from "./sleep.js";

const DAIRY_RE = /\b(milk|cheese|yogurt|yoghurt|dairy|whey|ice ?cream|latte|cappuccino|cereal)\b/i;
const STRESS_RE = /\b(stress|stressed|anxious|anxiety|overwhelmed|exhausted|burnt out|burned out|wrecked|rough day)\b/i;

// Active-ingredient keywords for routine-conflict detection.
const ACTIVE_RE = {
  retinoid: /\b(retinol|retinoid|retinal|tretinoin|adapalene|differin|retin-?a|granactive)\b/i,
  aha: /\b(glycolic|lactic|mandelic|aha)\b/i,
  bha: /\b(salicylic|bha)\b/i,
  benzoyl: /\b(benzoyl|bpo)\b/i,
  vitc: /\b(vitamin ?c|ascorbic|ascorbate|vit ?c)\b/i,
};

function activesIn(name) {
  const out = [];
  for (const [k, re] of Object.entries(ACTIVE_RE)) if (re.test(name || "")) out.push(k);
  return out;
}

// Curated, evidence-grounded conflict rules. Deliberately conservative.
export function detectRoutineConflicts(routine) {
  const r = routine || { am: [], pm: [] };
  const conflicts = [];
  const collect = steps => (steps || []).flatMap(s => activesIn(s.product || s.name || ""));
  const pm = collect(r.pm);
  const am = collect(r.am);
  const all = [...am, ...pm];
  const has = (arr, k) => arr.includes(k);

  if (has(pm, "retinoid") && (has(pm, "aha") || has(pm, "bha")))
    conflicts.push("Your PM routine layers a retinoid with an exfoliating acid — that combo over-irritates many people. Alternate them on different nights rather than stacking.");
  if (has(all, "benzoyl") && has(all, "retinoid"))
    conflicts.push("Benzoyl peroxide can deactivate some retinoids when layered — use them at different times of day (e.g. BP in the AM, retinoid PM).");
  if (has(am, "benzoyl") && has(am, "vitc"))
    conflicts.push("Benzoyl peroxide can oxidize vitamin C — keep them in separate routines (vitamin C AM, benzoyl peroxide PM).");
  const acidCount = new Set([...all.filter(k => k === "retinoid" || k === "aha" || k === "bha")]).size;
  if (acidCount >= 3)
    conflicts.push("You're running three or more exfoliating/retinoid actives — that's a common route to a damaged barrier. Consider paring back and reintroducing one at a time.");
  if (!collect([...(r.am || [])]).length && (r.am || []).length && !(r.am || []).some(s => /spf|sunscreen|sun ?screen/i.test(s.product || s.name || "")))
    conflicts.push("No sunscreen detected in your AM routine — daily SPF is the single best-evidenced anti-aging and pigmentation step. Add it.");
  return conflicts;
}

export function computeSkin(data, goals) {
  const logs = (data.skin || []).filter(s => s && s.date && s.condition != null).sort((a, b) => a.date.localeCompare(b.date));
  if (logs.length === 0) return null;
  const recent = logs.filter(s => s.date >= daysAgo(59));
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  // ── Trends (condition is 1–5, higher = better) ──
  const last14 = logs.filter(s => s.date >= daysAgo(13));
  const prior14 = logs.filter(s => s.date >= daysAgo(27) && s.date < daysAgo(13));
  const avgCond14 = last14.length ? +mean(last14.map(s => s.condition)).toFixed(1) : null;
  const condTrend = (avgCond14 != null && prior14.length) ? +(avgCond14 - mean(prior14.map(s => s.condition))).toFixed(1) : null;
  const breakouts14 = last14.length ? +mean(last14.map(s => s.breakouts || 0)).toFixed(1) : null;

  // ── Physiology lookups (the cross-domain advantage) ──
  const need = estimateSleepNeed(data, goals).hours;
  const sleepByDate = {}; (data.sleep || []).forEach(s => { if (s.date) sleepByDate[s.date] = sleepTST(s); });
  const nicByDate = {}; (data.nicotine || []).forEach(n => { if (n.date) nicByDate[n.date] = (nicByDate[n.date] || 0) + 1; });
  const dairyByDate = {}; (data.diet || []).forEach(d => { if (d.date && DAIRY_RE.test(`${d.name || ""} ${d.label || ""} ${d.text || ""}`)) dairyByDate[d.date] = true; });
  const stressByDate = {}; (data.journal || []).forEach(j => { if (j.date && STRESS_RE.test(j.text || "")) stressByDate[j.date] = true; });

  // Lagged correlation: skin reacts a day or two after the trigger. Compare
  // average condition on logs preceded by an exposure vs not. Confidence-gated.
  function corr(exposed, lag = 2) {
    const ex = [], un = [];
    recent.forEach(s => {
      let hit = false;
      for (let k = 1; k <= lag; k++) if (exposed(daysAgoFrom(s.date, k))) hit = true;
      (hit ? ex : un).push(s.condition);
    });
    if (ex.length >= 4 && un.length >= 4) {
      const de = mean(ex), du = mean(un);
      if (du - de >= 0.5) return { exposedAvg: +de.toFixed(1), baseAvg: +du.toFixed(1), nExposed: ex.length };
    }
    return null;
  }

  const correlations = [];
  const cSleep = corr(d => sleepByDate[d] != null && sleepByDate[d] < need - 1);
  if (cSleep) correlations.push({ key: "sleep", evidence: "moderate", ...cSleep, text: `Your skin rates worse after short-sleep nights (avg ${cSleep.exposedAvg} vs ${cSleep.baseAvg}/5). Sleep drives barrier repair and lowers inflammation — protecting it looks like one of your real levers.` });
  const cNic = corr(d => nicByDate[d]);
  if (cNic) correlations.push({ key: "nicotine", evidence: "strong", ...cNic, text: `Skin rates worse around your nicotine days (${cNic.exposedAvg} vs ${cNic.baseAvg}/5). Nicotine constricts blood flow and impairs skin repair — one of the best-evidenced skin levers you control.` });
  const cDairy = corr(d => dairyByDate[d]);
  if (cDairy) correlations.push({ key: "dairy", evidence: "moderate", ...cDairy, text: `Higher-dairy days precede worse skin for you (${cDairy.exposedAvg} vs ${cDairy.baseAvg}/5). Dairy has moderate evidence linking to acne in some people — worth a controlled 4-week test, not a blanket cut.` });
  const cStress = corr(d => stressByDate[d]);
  if (cStress) correlations.push({ key: "stress", evidence: "moderate", ...cStress, text: `Your higher-stress days line up with worse skin (${cStress.exposedAvg} vs ${cStress.baseAvg}/5). Stress flares are real via the HPA axis — managing load may help your skin too.` });

  const conflicts = detectRoutineConflicts(goals.skinRoutine);
  const experiment = goals.skinExperiment || null;

  // ── Insights (kept in the SKIN lens; not pushed into the physiology pool) ──
  const insights = [];
  correlations.forEach(c => insights.push({ text: c.text, priority: c.key === "nicotine" ? "important" : "notable" }));
  conflicts.forEach(c => insights.push({ text: c, priority: "notable" }));
  if (condTrend != null && condTrend <= -0.6) insights.push({ text: `Skin's trended down over two weeks (avg ${avgCond14}/5). Look at what changed — a new product, sleep, stress, or diet.`, priority: "notable" });
  if (condTrend != null && condTrend >= 0.6) insights.push({ text: `Skin's trending up (avg ${avgCond14}/5) — hold the routine steady; don't change variables while it's improving.`, priority: "notable" });

  // biggest lever = highest-evidence actionable correlation
  const order = { strong: 0, moderate: 1, weak: 2 };
  const topLever = [...correlations].sort((a, b) => order[a.evidence] - order[b.evidence])[0] || null;

  let confidence = "Low";
  if (recent.length >= 10) confidence = "Moderate";
  if (recent.length >= 20) confidence = "High";

  // condition sparkline, last 30 days
  const series = Array.from({ length: 30 }, (_, i) => {
    const d = daysAgo(29 - i);
    const rec = logs.find(s => s.date === d);
    return { value: rec ? rec.condition : null, label: d };
  });

  return {
    nLogs: logs.length, avgCond14, condTrend, breakouts14,
    correlations, conflicts, experiment, topLever, confidence,
    lastConcern: logs[logs.length - 1]?.concern || null,
    procedures: (data.skinProcedures || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6),
    insights, series,
  };
}
