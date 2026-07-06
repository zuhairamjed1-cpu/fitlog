// ─── RECOVERY CAPACITY ───────────────────────────────────────────────────────
// "How well is the body currently set up to recover and adapt?" This is NOT
// fatigue. RecoveryCapacity = 0.35·Sleep + 0.30·Nutrition + 0.20·Stress +
// 0.15·Rest, on 0–100. ESTIMATED, never measured — confidence is reported and
// drops when inputs are missing. FitLog has no structured stress/mood logging
// yet, so the Stress component runs neutral and caps confidence (honest, not
// fabricated). Critically-low energy availability caps the whole score.

import { localDateStr, getTodayStr } from "../lib/dates";
import { mifflinBMR } from "./energy";

const Q = { Excellent: 100, Great: 90, Good: 78, Fair: 55, Poor: 35 };
const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

export function computeRecoveryCapacity(data, goals, today) {
  const t = today || getTodayStr();
  const since = n => { const d = new Date(t + "T00:00:00"); d.setDate(d.getDate() - n); return localDateStr(d); };
  const profile = (goals && goals.profile) || {};
  const comp = { sleep: null, nutrition: null, stress: null, rest: null };
  const detail = {};
  let eaCapped = false;

  // ── Sleep (35%) ──
  const sleep = (data.sleep || []).filter(s => s && s.date && s.duration != null && s.date >= since(7));
  if (sleep.length) {
    const durs = sleep.map(s => s.duration), need = 8;
    const durScore = clamp((mean(durs) / need) * 100, 0, 105);
    const qs = sleep.map(s => Q[s.quality]).filter(x => x != null);
    const qScore = qs.length ? mean(qs) : 70;
    const beds = sleep.map(s => { const m = /^(\d{1,2}):(\d{2})/.exec(s.bedtime || ""); if (!m) return null; let v = +m[1] * 60 + +m[2]; if (v < 720) v += 1440; return v; }).filter(x => x != null);
    const bedStd = beds.length >= 3 ? std(beds) : null;
    const consScore = bedStd == null ? 75 : clamp(100 - Math.max(0, bedStd - 20) * 0.6, 30, 100);
    const debtH = +(durs.reduce((s, d) => s + Math.max(0, need - d), 0)).toFixed(1);
    comp.sleep = clamp(0.5 * durScore + 0.3 * qScore + 0.2 * consScore - clamp(debtH * 3, 0, 30), 0, 100);
    detail.sleep = { avgDuration: +mean(durs).toFixed(1), debtH, consistencyMin: bedStd == null ? null : Math.round(bedStd) };
  }

  // ── Nutrition (30%) ──
  const diet = (data.diet || []).filter(d => d && d.date && d.date >= since(7));
  if (diet.length) {
    const byDay = {}; diet.forEach(e => { const d = (byDay[e.date] = byDay[e.date] || { cal: 0, p: 0, c: 0 }); d.cal += e.calories || 0; d.p += e.protein || 0; d.c += e.carbs || 0; });
    const days = Object.values(byDay);
    const avgCal = mean(days.map(d => d.cal)), avgP = mean(days.map(d => d.p)), avgC = mean(days.map(d => d.c));
    const bw = profile.weightKg ? parseFloat(profile.weightKg) : (data.weight && data.weight.length ? data.weight[data.weight.length - 1].weight : null);
    const maint = (profile.sex && profile.age && profile.heightCm && bw) ? Math.round((mifflinBMR(profile, bw) || 0) * 1.5) : null;
    let balScore = 70;
    if (maint) { const ratio = avgCal / maint; balScore = ratio >= 0.95 ? clamp(100 - Math.max(0, ratio - 1.15) * 200, 70, 100) : clamp(100 - (0.95 - ratio) * 250, 20, 100); }
    const pScore = bw ? clamp((avgP / bw / 1.6) * 100, 0, 100) : 70;
    const cScore = bw ? clamp((avgC / bw / 3) * 100, 40, 100) : 70;
    comp.nutrition = clamp(0.4 * balScore + 0.35 * pScore + 0.25 * cScore, 0, 100);
    detail.nutrition = { avgCalories: Math.round(avgCal), maintenance: maint, proteinGkg: bw ? +(avgP / bw).toFixed(1) : null };
    if (maint && avgCal < maint * 0.65) eaCapped = true; // critically low energy availability
  }

  // ── Stress (20%) — no structured logging in FitLog yet → neutral, flagged ──
  comp.stress = null; // unknown; neutral-filled below
  detail.stress = { tracked: false };

  // ── Rest distribution (15%) ──
  const ex = (data.exercise || []).filter(e => e && e.date);
  if (ex.length) {
    const lastTrain = ex.map(e => e.date).sort().pop();
    const daysSince = Math.round((new Date(t + "T00:00:00") - new Date(lastTrain + "T00:00:00")) / 86400000);
    const trainedDays = new Set(ex.filter(e => e.date >= since(7)).map(e => e.date)).size;
    const restDays = 7 - trainedDays;
    let rs = daysSince >= 2 ? 90 : daysSince === 1 ? 80 : 62;
    if (restDays <= 0) rs -= 20; else if (restDays >= 4) rs -= 4;
    comp.rest = clamp(rs, 0, 100);
    detail.rest = { daysSinceTraining: daysSince, restDaysLast7: restDays };
  }

  const ready = comp.sleep != null || comp.nutrition != null;
  if (!ready) return { ready: false, reason: "Log sleep or nutrition and your recovery capacity will appear here." };

  const w = { sleep: 0.35, nutrition: 0.30, stress: 0.20, rest: 0.15 };
  const v = k => (comp[k] == null ? 60 : comp[k]); // neutral-fill missing
  let score = Math.round(w.sleep * v("sleep") + w.nutrition * v("nutrition") + w.stress * v("stress") + w.rest * v("rest"));
  if (eaCapped) score = Math.min(score, 45);
  const band = score >= 80 ? "Excellent" : score >= 65 ? "Good" : score >= 45 ? "Compromised" : "Poor";
  const bandColor = score >= 80 ? "#8fd989" : score >= 65 ? "#5cc8df" : score >= 45 ? "#f9c97e" : "#f47e6e";

  const known = ["sleep", "nutrition", "rest"].filter(k => comp[k] != null).length;
  const confidence = eaCapped ? "low" : known >= 3 ? "moderate" : "low"; // stress always missing → capped at moderate

  const limiter = (() => { let lo = null, k = null; ["sleep", "nutrition", "rest"].forEach(c => { if (comp[c] != null && (lo == null || comp[c] < lo)) { lo = comp[c]; k = c; } }); return k; })();

  return {
    ready: true, tier: "estimate", score, band, bandColor, confidence,
    components: { sleep: comp.sleep == null ? null : Math.round(comp.sleep), nutrition: comp.nutrition == null ? null : Math.round(comp.nutrition), stress: null, rest: comp.rest == null ? null : Math.round(comp.rest) },
    weights: w, detail, eaCapped, limiter,
    missing: ["stress", ...(comp.sleep == null ? ["sleep"] : []), ...(comp.nutrition == null ? ["nutrition"] : []), ...(comp.rest == null ? ["rest"] : [])],
    note: "Estimated recovery capacity. Stress/mood isn't logged in FitLog yet, so that component runs neutral and confidence is capped.",
  };
}
