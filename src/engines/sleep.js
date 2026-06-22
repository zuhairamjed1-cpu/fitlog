// ─── SLEEP INTELLIGENCE ENGINE (3-axis + cross-domain coupling) ───────────
import { daysAgo, daysAgoFrom, getTodayStr } from "../lib/dates.js";
import { computeWeightTrend } from "./weight.js";
import { parseWorkout } from "./workout.js";
import { clusterFeedings } from "./protein.js";

export function sleepTST(s) {
  const tib = s.duration || 0;
  return Math.max(0.5, tib - (s.latencyMin || 0) / 60 - (s.wakeMin || 0) / 60);
}

export function estimateSleepNeed(data, goals) {
  const override = parseFloat(goals?.profile?.sleepNeedH);
  if (override > 0) return { hours: Math.max(4, Math.min(12, override)), source: "override", confidence: "set", nGood: 0 };
  const good = (data.sleep || []).filter(s => s && s.date >= daysAgo(59) && /^(Good|Great|Excellent)$/.test(s.quality || ""));
  const tsts = good.map(sleepTST).sort((a, b) => a - b);
  if (tsts.length >= 5) {
    const m = tsts.length >> 1;
    let need = tsts.length % 2 ? tsts[m] : (tsts[m - 1] + tsts[m]) / 2;
    need = Math.max(6, Math.min(9.5, +need.toFixed(1)));
    return { hours: need, source: "learned", confidence: tsts.length >= 10 ? "high" : "moderate", nGood: tsts.length };
  }
  return { hours: 8, source: "default", confidence: "low", nGood: tsts.length };
}

export function computeSleep(data, goals) {
  const sleep = (data.sleep || []).filter(s => s && s.date && s.duration != null);
  if (sleep.length === 0) return null;
  const today = getTodayStr();
  const mins = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
  const qScore = { Poor: 1, Fair: 2, Good: 3, Great: 4, Excellent: 5 };
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const fmtClock = m => m == null ? null : `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;

  const need = estimateSleepNeed(data, goals);

  const enrich = s => {
    const bed = mins(s.bedtime), wake = mins(s.wakeTime);
    const tib = s.duration || 0;
    const tst = sleepTST(s);
    const eff = tib > 0 ? Math.round((tst / tib) * 100) : null;
    const mid = bed != null ? (bed + tib * 30) % 1440 : null; // mid-sleep clock minute
    return { date: s.date, tib, tst, eff, latency: s.latencyMin ?? null, waso: s.wakeMin ?? null, quality: s.quality, q: qScore[s.quality] ?? null, bed, wake, mid, hasEff: (s.latencyMin != null || s.wakeMin != null) };
  };
  const sorted = [...sleep].sort((a, b) => a.date.localeCompare(b.date));
  const inWin = n => sorted.filter(s => s.date >= daysAgo(n - 1)).map(enrich);
  const last7 = inWin(7), last14 = inWin(14), last21 = inWin(21);

  // Circular-stats helpers (clock times wrap at midnight)
  const circMean = arr => {
    if (!arr.length) return null;
    let sx = 0, sy = 0; arr.forEach(v => { const a = (v / 1440) * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a); });
    if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return Math.round(arr.reduce((x, y) => x + y, 0) / arr.length);
    let a = Math.atan2(sy, sx); if (a < 0) a += 2 * Math.PI; return Math.round(a / (2 * Math.PI) * 1440) % 1440;
  };
  const circSD = arr => {
    if (arr.length < 2) return null;
    let sx = 0, sy = 0; arr.forEach(v => { const a = (v / 1440) * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a); });
    const R = Math.sqrt(sx * sx + sy * sy) / arr.length;
    if (R <= 0.0001) return 720;
    return Math.round(Math.sqrt(-2 * Math.log(Math.min(1, R))) * 1440 / (2 * Math.PI));
  };
  const circDiff = (a, b) => { if (a == null || b == null) return null; let d = Math.abs(a - b) % 1440; return d > 720 ? 1440 - d : d; };

  // ── AXIS 1 — QUANTITY (vs personal need) ──
  const avgTST7 = last7.length ? +mean(last7.map(r => r.tst)).toFixed(1) : null;
  const avgTST14 = last14.length ? +mean(last14.map(r => r.tst)).toFixed(1) : null;
  const debt7 = +last7.reduce((d, r) => d + (need.hours - r.tst), 0).toFixed(1); // net vs need
  let qStatus = "good", qLabel = "On target";
  if (avgTST7 != null) {
    const gap = avgTST7 - need.hours;
    if (gap <= -1.5) { qStatus = "bad"; qLabel = "Significantly short"; }
    else if (gap <= -0.5) { qStatus = "warn"; qLabel = "Running short"; }
    else if (gap >= 1.2) { qStatus = "warn"; qLabel = "Oversleeping"; }
  }

  // ── AXIS 2 — TIMING / REGULARITY ──
  const midVals = last14.map(r => r.mid).filter(v => v != null);
  const wakeVals = last14.map(r => r.wake).filter(v => v != null);
  const midSD = circSD(midVals);
  const wakeSD = circSD(wakeVals);
  let rStatus = null, rLabel = null;
  if (midSD != null) {
    if (midSD <= 30) { rStatus = "good"; rLabel = "Very regular"; }
    else if (midSD <= 60) { rStatus = "good"; rLabel = "Fairly regular"; }
    else if (midSD <= 90) { rStatus = "warn"; rLabel = "Irregular"; }
    else { rStatus = "bad"; rLabel = "Highly irregular"; }
  }
  const isWknd = ds => { const wd = new Date(ds + "T00:00:00").getDay(); return wd === 0 || wd === 6; };
  const wkdayMid = last21.filter(r => r.mid != null && !isWknd(r.date)).map(r => r.mid);
  const wkendMid = last21.filter(r => r.mid != null && isWknd(r.date)).map(r => r.mid);
  let socialJetlag = null;
  if (wkdayMid.length >= 2 && wkendMid.length >= 1) socialJetlag = +(circDiff(circMean(wkendMid), circMean(wkdayMid)) / 60).toFixed(1);
  const anchorWakeMin = wakeVals.length ? circMean(wakeVals) : null;
  const typLatency = (() => { const ls = last14.map(r => r.latency).filter(v => v != null); return ls.length ? median(ls) : 15; })();
  const bedTargetMin = anchorWakeMin != null ? ((anchorWakeMin - Math.round(need.hours * 60) - typLatency) % 1440 + 1440) % 1440 : null;

  // ── AXIS 3 — CONTINUITY / QUALITY ──
  const effNights = last14.filter(r => r.hasEff);
  const avgEff = effNights.length ? Math.round(mean(effNights.map(r => r.eff))) : null;
  const avgLatency = (() => { const v = last14.map(r => r.latency).filter(x => x != null); return v.length ? Math.round(mean(v)) : null; })();
  const avgWaso = (() => { const v = last14.map(r => r.waso).filter(x => x != null); return v.length ? Math.round(mean(v)) : null; })();
  const q7 = last7.map(r => r.q).filter(v => v != null);
  const qOlder = last14.filter(r => r.date < daysAgo(6)).map(r => r.q).filter(v => v != null);
  const avgQ7 = q7.length ? +mean(q7).toFixed(1) : null;
  const qualityTrend = (avgQ7 != null && qOlder.length) ? +(avgQ7 - mean(qOlder)).toFixed(1) : null;
  // Unrefreshing sleep: adequate duration but consistently poor quality — the
  // single highest-leverage screening signal (possible OSA / fragmentation).
  const unrefreshNights = last14.filter(r => r.q != null && r.q <= 2 && r.tst >= need.hours - 0.5);
  const unrefreshing = last14.length >= 5 && unrefreshNights.length >= 3 && (unrefreshNights.length / last14.length) >= 0.4;
  let cStatus = null, cLabel = null;
  if (avgEff != null) {
    if (avgEff >= 90) { cStatus = "good"; cLabel = "Solid & consolidated"; }
    else if (avgEff >= 85) { cStatus = "warn"; cLabel = "Slightly fragmented"; }
    else { cStatus = "bad"; cLabel = "Fragmented / inefficient"; }
  } else if (avgQ7 != null) {
    if (avgQ7 >= 3.5) { cStatus = "good"; cLabel = "Feels restful"; }
    else if (avgQ7 >= 2.5) { cStatus = "warn"; cLabel = "Mediocre quality"; }
    else { cStatus = "bad"; cLabel = "Poor quality"; }
  }
  if (unrefreshing && cStatus !== "bad") { cStatus = "warn"; cLabel = "Unrefreshing"; }

  // ── COUPLING — sleep × the rest of the body (their own data only) ──
  const coupling = [];
  // 1) Partitioning: short sleep in a deficit burns muscle, not fat.
  const wt = computeWeightTrend(data);
  const phase = (goals?.strategy?.phase || "").toLowerCase();
  const goal = (goals?.goal || "").toLowerCase();
  const cutting = /cut|deficit|fat/.test(phase) || goal.includes("fat") || goal.includes("lose") || (wt && wt.confidence !== "Low" && wt.pctBWPerWeek != null && wt.pctBWPerWeek <= -0.3);
  if (cutting && avgTST7 != null && avgTST7 < need.hours - 0.8) {
    coupling.push({ key: "partitioning", severity: "critical", text: `You're in a deficit and averaging ${avgTST7}h (need ~${need.hours}h). At matched calories, short sleep makes more of your loss come from muscle, not fat — the scale moves the same, the mirror doesn't. Protecting sleep is your strongest muscle-retention lever while cutting.` });
  }
  // 2) RPE inflation: under-slept loads feel harder; you quietly cut volume.
  const rpe7 = last7.length ? (() => {
    const v = (data.exercise || []).filter(e => e.date >= daysAgo(6)).map(e => (e._parsed || parseWorkout(e.text || "")).avgRPE).filter(x => x != null);
    return v.length ? +mean(v).toFixed(1) : null;
  })() : null;
  if (rpe7 != null && rpe7 >= 8 && debt7 >= 3) {
    coupling.push({ key: "rpe", severity: "important", text: `Sessions are feeling hard (avg RPE ${rpe7}) and you're carrying ~${debt7}h of sleep debt. That's central fatigue inflating perceived effort — not lost strength. Hold your planned load; don't auto-cut volume.` });
  }
  // 3) APPETITE TAX — sleep → eating (Tasali 2022: sleep loss drives reward-seeking
  // intake; mechanism is hedonic/endocannabinoid + more waking hours, NOT leptin/ghrelin
  // which the evidence downgrades). We never estimate hormones — we measure the four
  // behavioural fingerprints in the user's OWN logs: total kcal, eating occasions
  // (snacking), late-night calories, and protein share (a proxy for drifting toward
  // calorie-dense food). Same-day alignment: a night's short sleep shapes THAT day's eating.
  let appetite = null;
  {
    const dietByDate = {};
    (data.diet || []).forEach(d => { if (!d.date) return; (dietByDate[d.date] = dietByDate[d.date] || []).push(d); });
    const win = sorted.filter(s => s.date >= daysAgo(29)).map(enrich);
    const lateMin = 21 * 60; // 9pm
    const dayMetrics = r => {
      const ents = dietByDate[r.date];
      if (!ents || !ents.length) return null;
      const kcal = ents.reduce((a, e) => a + (e.calories || 0), 0);
      if (kcal <= 0) return null;
      const protein = ents.reduce((a, e) => a + (e.protein || 0), 0);
      const occasions = clusterFeedings(ents).length;
      const lateKcal = ents.filter(e => { const m = mins(e.time); return m != null && m >= lateMin; }).reduce((a, e) => a + (e.calories || 0), 0);
      return { kcal, occasions, lateKcal, pShare: (protein * 4 / kcal) * 100 };
    };
    const shortM = win.filter(r => r.tst < need.hours - 1).map(dayMetrics).filter(Boolean);
    const okM = win.filter(r => r.tst >= need.hours - 0.5).map(dayMetrics).filter(Boolean);
    if (shortM.length >= 3 && okM.length >= 3) {
      const avg = (arr, k) => mean(arr.map(x => x[k]).filter(v => v != null));
      const kcalDelta = Math.round(avg(shortM, "kcal") - avg(okM, "kcal"));
      const occDelta = +(avg(shortM, "occasions") - avg(okM, "occasions")).toFixed(1);
      const lateDelta = Math.round(avg(shortM, "lateKcal") - avg(okM, "lateKcal"));
      const ps = avg(shortM, "pShare"), po = avg(okM, "pShare");
      const pShareDrop = (ps != null && po != null) ? +(po - ps).toFixed(1) : null;
      const n = Math.min(shortM.length, okM.length);
      const confidence = n >= 6 ? "High" : n >= 4 ? "Moderate" : "Low";
      // Population expectation says intake rises — but defer to THEIR reality.
      const responder = kcalDelta >= 120 || lateDelta >= 100 || (pShareDrop != null && pShareDrop >= 4);
      const ph = (/cut|deficit|fat/.test(phase) || goal.includes("fat") || goal.includes("lose")) ? "cut"
               : (/bulk|surplus|gain/.test(phase) || goal.includes("muscle")) ? "bulk" : "maintain";
      appetite = { shortDays: shortM.length, okDays: okM.length, kcalDelta, occDelta, lateDelta, pShareDrop, responder, phase: ph, confidence };

      // Surface it only when the user's OWN data shows the pattern (responder).
      // Behavioural readout, externalised, never a restriction instruction.
      if (responder) {
        const bits = [];
        if (kcalDelta >= 120) bits.push(`+${kcalDelta} kcal`);
        if (occDelta >= 0.7) bits.push(`~${occDelta} more eating occasion${occDelta >= 1.5 ? "s" : ""}`);
        if (lateDelta >= 100) bits.push(`+${lateDelta} kcal after 9pm`);
        if (pShareDrop != null && pShareDrop >= 3) bits.push(`protein share down ~${pShareDrop}pts`);
        const hasPart = coupling.some(c => c.key === "partitioning");
        let tail, sev;
        if (ph === "cut") {
          tail = ` On a cut this is where the deficit quietly leaks${hasPart ? ", same root cause as the muscle-loss risk above" : ""} — the lever is upstream: protect sleep, and pre-plan tomorrow's food after a bad night rather than fighting it in the moment.`;
          sev = "important";
        } else if (ph === "bulk") {
          tail = ` In a surplus that's a mild tailwind for hitting calories — just steer the extra toward protein and whole food, not late snacks.`;
          sev = "notable";
        } else {
          tail = ` Pre-planning meals after a short night beats white-knuckling it in the moment.`;
          sev = "notable";
        }
        const caveat = confidence === "Low" ? " (early read — only a few matched days so far)" : "";
        coupling.push({ key: "appetite", severity: sev, text: `On your short-sleep days your eating shifts — ${bits.join(", ")} vs well-slept days${caveat}. That's the sleep→appetite drive (reward-seeking, not willpower).${tail}` });
      }
    }
  }
  // 4) Mood: poor sleep preceding low journal sentiment.
  const fatigueRe = /\b(exhausted|drained|run down|rundown|burnt out|burned out|wrecked|tired|no energy|low|down|stressed|anxious|irritable|foggy)\b/i;
  const poorThenLow = last14.filter(r => (r.q != null && r.q <= 2) || r.tst < need.hours - 1.5).filter(r => {
    const next = daysAgoFrom(r.date, -1);
    return (data.journal || []).some(j => (j.date === r.date || j.date === next) && fatigueRe.test(j.text || ""));
  });
  if (poorThenLow.length >= 2) {
    coupling.push({ key: "mood", severity: "notable", text: `Your rougher nights tend to line up with lower-mood journal entries the next day. Sleep is upstream of mood as often as the reverse — protecting it may lift how you feel, not just how you train.` });
  }

  // ── INSIGHTS + biggest lever ──
  const insights = [];
  const push = (text, priority, axis) => insights.push({ text, priority, axis });
  if (qStatus === "bad") push(`Averaging ${avgTST7}h vs your ~${need.hours}h need — a real shortfall that drags recovery, partitioning and mood.`, "critical", "quantity");
  else if (qStatus === "warn" && qLabel === "Running short") push(`Running ~${(need.hours - avgTST7).toFixed(1)}h short of your ${need.hours}h need most nights — close the gap before adding training load.`, "important", "quantity");
  if (rStatus === "bad" || (wakeSD != null && wakeSD > 75)) push(`Your wake time swings ~${Math.round((wakeSD ?? midSD) / 60 * 10) / 10}h night to night. Anchoring a fixed wake time (even weekends) is higher-leverage than adding hours.`, "important", "regularity");
  else if (rStatus === "warn") push(`Sleep timing is a bit irregular (mid-sleep varies ~${midSD}min). Tightening it stabilises your whole circadian system.`, "notable", "regularity");
  if (socialJetlag != null && socialJetlag >= 1.5) push(`Social jetlag ~${socialJetlag}h (weekend vs weekday) — like a mild self-inflicted timezone shift every week. Pull weekend timing closer to weekdays.`, "notable", "regularity");
  if (unrefreshing) push(`You're logging enough hours but rating sleep poor on ${unrefreshNights.length} of ${last14.length} recent nights. Persistent unrefreshing sleep is the top signal worth raising with a clinician (e.g. screening for sleep apnea) — it can't be fixed by hygiene alone.`, "important", "continuity");
  if (avgEff != null && avgEff < 85) push(`Sleep efficiency ~${avgEff}% (asleep ÷ in bed). Below ~85% usually means too much time in bed or fragmentation — spending less time in bed often consolidates it.`, "important", "continuity");
  else if (avgLatency != null && avgLatency > 30) push(`Taking ~${avgLatency}min to fall asleep on average — long onset points to going to bed before you're sleepy or evening arousal.`, "notable", "continuity");
  coupling.forEach(c => push(c.text, c.severity === "critical" ? "critical" : c.severity === "important" ? "important" : "notable", "coupling"));
  if (qLabel === "Oversleeping" && qStatus === "warn") push(`Averaging ${avgTST7}h, above your ~${need.hours}h need. Long sleep is often a symptom (illness, low mood, debt repayment) rather than a goal — worth noting if it's new.`, "notable", "quantity");

  const order = { critical: 0, important: 1, notable: 2 };
  const ranked = [...insights].sort((a, b) => order[a.priority] - order[b.priority]);
  const topLever = ranked[0] || null;

  // ── Tonight read + sparkline series ──
  const todayRec = last7.find(r => r.date === today) || null;
  const series14 = sorted.filter(s => s.date >= daysAgo(13)).map(s => { const e = enrich(s); return e; });
  const tstSeries = Array.from({ length: 14 }, (_, i) => { const d = daysAgo(13 - i); const r = series14.find(x => x.date === d); return { value: r ? +r.tst.toFixed(1) : null, label: d }; });
  const qSeries = Array.from({ length: 14 }, (_, i) => { const d = daysAgo(13 - i); const r = series14.find(x => x.date === d); return { value: r ? r.q : null, label: d }; });

  // Overall confidence from how much is logged
  let confidence = "Low";
  if (sleep.length >= 7) confidence = "Moderate";
  if (sleep.length >= 14 && midVals.length >= 7) confidence = "High";

  return {
    need, nightsLogged: sleep.length, confidence,
    quantity: { avgTST7, avgTST14, need: need.hours, debt7, status: qStatus, label: qLabel, loggedNights7: last7.length },
    regularity: { midSD, wakeSD, socialJetlag, status: rStatus, label: rLabel, anchorWake: fmtClock(anchorWakeMin), bedTarget: fmtClock(bedTargetMin) },
    continuity: { avgEff, avgLatency, avgWaso, qualityTrend, unrefreshing, unrefreshCount: unrefreshNights.length, recentNights: last14.length, status: cStatus, label: cLabel, hasEffData: effNights.length > 0 },
    coupling, insights, topLever, appetite,
    today: todayRec ? { tst: +todayRec.tst.toFixed(1), eff: todayRec.eff, quality: todayRec.quality } : null,
    series: { tst: tstSeries, quality: qSeries },
  };
}
