// ─── NICOTINE ENGINE (stats, correlations, impact-timing) ─────────────────
import { daysAgo, getTodayStr, WEEKDAYS } from "../lib/dates";
import { avgTimeMins } from "../lib/time";
import { parseWorkout } from "./workout";

// Per-unit nicotine content (mg). Pouches use their own mg when set.
export const NIC_MG = { cigarette: 1.2, vape: 0.05, pouch: 6 };
function nicMg(entry) {
  if (entry.type === "pouch") return (entry.amount || 0) * (entry.mg || NIC_MG.pouch);
  return (entry.amount || 0) * (NIC_MG[entry.type] || 0);
}

export function computeNicotineStats(data) {
  const nic = data.nicotine || [];
  const today = getTodayStr();
  const byDay = {}; // date -> { mg, count, byType }
  nic.forEach(e => {
    if (!e.date) return;
    if (!byDay[e.date]) byDay[e.date] = { mg: 0, count: 0, cigarette: 0, vape: 0, pouch: 0 };
    const d = byDay[e.date];
    d.mg += nicMg(e);
    d.count += 1;
    d[e.type] = (d[e.type] || 0) + (e.amount || 0);
  });

  const sumWindow = (days) => {
    let mg = 0, count = 0, daysWithData = 0;
    for (let i = 0; i < days; i++) {
      const ds = daysAgo(i);
      if (byDay[ds]) { mg += byDay[ds].mg; count += byDay[ds].count; daysWithData++; }
    }
    return { mg, count, daysWithData };
  };

  const todayStats = byDay[today] || { mg: 0, count: 0, cigarette: 0, vape: 0, pouch: 0 };
  const w7 = sumWindow(7);
  const w30 = sumWindow(30);
  // Rolling averages per day (over the window length, treating no-log days as 0)
  const avg7 = +(w7.mg / 7).toFixed(1);
  const avg30 = +(w30.mg / 30).toFixed(1);
  const avgCount7 = +(w7.count / 7).toFixed(1);

  // Daily series for the trend chart (last 30 days, mg per day)
  const series30 = Array.from({ length: 30 }, (_, i) => {
    const ds = daysAgo(29 - i);
    return { value: byDay[ds] ? +byDay[ds].mg.toFixed(1) : 0, label: ds };
  });
  // Entries-per-day series (what the trend chart shows — more intuitive than mg)
  const seriesCount30 = Array.from({ length: 30 }, (_, i) => {
    const ds = daysAgo(29 - i);
    return { value: byDay[ds] ? byDay[ds].count : 0, label: ds };
  });

  // Type breakdown over last 30 days
  const typeTotals = { cigarette: 0, vape: 0, pouch: 0 };
  nic.filter(e => e.date >= daysAgo(29)).forEach(e => { typeTotals[e.type] = (typeTotals[e.type] || 0) + (e.amount || 0); });

  // Context tag frequency (last 30d)
  const contextCounts = {};
  nic.filter(e => e.date >= daysAgo(29)).forEach(e => (e.contexts || []).forEach(c => { contextCounts[c] = (contextCounts[c] || 0) + 1; }));
  const topContexts = Object.entries(contextCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return { byDay, today: todayStats, w7, w30, avg7, avg30, avgCount7, series30, seriesCount30, typeTotals, topContexts, totalDaysLogged: Object.keys(byDay).length };
}

export function computeNicotineCorrelations(data) {
  const nic = data.nicotine || [];
  if (nic.length < 10) return { ready: false, reason: "Keep logging — correlations unlock once there's about 2 weeks of data." };

  const stats = computeNicotineStats(data);
  const byDay = stats.byDay;
  // Only consider days that have BOTH a nicotine value (0 counts) and the comparison metric.
  const findings = [];

  // Helper: split days into high vs low nicotine (above/below median mg) and compare a metric
  function compareByNicotine(metricForDate, label, unit, minPairs = 8) {
    const rows = [];
    // Look back 60 days
    for (let i = 0; i < 60; i++) {
      const ds = daysAgo(i);
      const mg = byDay[ds] ? byDay[ds].mg : 0;
      const metric = metricForDate(ds);
      if (metric != null) rows.push({ mg, metric });
    }
    if (rows.length < minPairs) return null;
    const mgs = rows.map(r => r.mg).sort((a, b) => a - b);
    const median = mgs[Math.floor(mgs.length / 2)];
    const high = rows.filter(r => r.mg > median);
    const low = rows.filter(r => r.mg <= median);
    if (high.length < 3 || low.length < 3) return null;
    const avg = arr => arr.reduce((a, b) => a + b.metric, 0) / arr.length;
    const hi = avg(high), lo = avg(low);
    const diff = hi - lo;
    return { hi, lo, diff, label, unit, nHigh: high.length, nLow: low.length };
  }

  // Sleep duration vs nicotine
  const sleepByDate = {};
  (data.sleep || []).forEach(s => { if (s.date) sleepByDate[s.date] = s.duration; });
  const sleepCorr = compareByNicotine(ds => sleepByDate[ds] ?? null, "sleep", "h");
  if (sleepCorr && Math.abs(sleepCorr.diff) >= 0.4) {
    const mins = Math.abs(Math.round(sleepCorr.diff * 60));
    findings.push(`On your higher-nicotine days, average sleep was about ${mins} min ${sleepCorr.diff < 0 ? "shorter" : "longer"} (${sleepCorr.hi.toFixed(1)}h vs ${sleepCorr.lo.toFixed(1)}h).`);
  }

  // Workout RPE vs nicotine (same-day)
  const rpeByDate = {};
  (data.exercise || []).forEach(e => { const p = e._parsed || parseWorkout(e.text || ""); if (p.avgRPE != null && e.date) rpeByDate[e.date] = p.avgRPE; });
  const rpeCorr = compareByNicotine(ds => rpeByDate[ds] ?? null, "RPE", "");
  if (rpeCorr && Math.abs(rpeCorr.diff) >= 0.5) {
    findings.push(`On higher-nicotine days, your logged session RPE averaged ${rpeCorr.hi.toFixed(1)} vs ${rpeCorr.lo.toFixed(1)} — sessions felt ${rpeCorr.diff > 0 ? "harder" : "easier"}.`);
  }

  // Calories vs nicotine (appetite)
  const calByDate = {};
  (data.diet || []).forEach(m => { if (m.date) calByDate[m.date] = (calByDate[m.date] || 0) + (m.calories || 0); });
  const calCorr = compareByNicotine(ds => calByDate[ds] ?? null, "calories", "kcal");
  if (calCorr && Math.abs(calCorr.diff) >= 150) {
    findings.push(`On higher-nicotine days, you ate about ${Math.abs(Math.round(calCorr.diff))} kcal ${calCorr.diff < 0 ? "less" : "more"} on average (${Math.round(calCorr.hi)} vs ${Math.round(calCorr.lo)}).`);
  }

  // Sleep quality (map quality words to score)
  const qMap = { Poor: 1, Fair: 2, Good: 3, Great: 4, Excellent: 4 };
  const sleepQByDate = {};
  (data.sleep || []).forEach(s => { if (s.date && qMap[s.quality]) sleepQByDate[s.date] = qMap[s.quality]; });
  const sqCorr = compareByNicotine(ds => sleepQByDate[ds] ?? null, "sleep quality", "");
  if (sqCorr && Math.abs(sqCorr.diff) >= 0.4) {
    findings.push(`On higher-nicotine days, your sleep quality rating trended ${sqCorr.diff < 0 ? "lower" : "higher"}.`);
  }

  return { ready: true, findings, enoughForMore: nic.length >= 20 };
}

export function computeNicotineTiming(data, goals) {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const today = getTodayStr();
  const minsOf = t => { if (!t) return null; const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? +m[1] * 60 + +m[2] : null; };

  // ── ACTIVE DAY ──
  // People don't reset at midnight — they reset when they wake. If it's the small hours
  // (before ~5am) and there's no sleep logged for the new calendar day yet, the user is
  // still inside their PREVIOUS waking day. So "today's" workouts/meals should be read from
  // yesterday's date, and time-since-event must count across midnight (+24h).
  const preDawn = nowMins < 5 * 60; // before 5:00am
  const sleptForToday = (data.sleep || []).some(s => s.date === today);
  const activeDay = (preDawn && !sleptForToday) ? daysAgo(1) : today;
  const crossedMidnight = activeDay !== today;
  // When comparing event times on the active (previous) day to "now", add 24h to now.
  const nowMinsAdj = crossedMidnight ? nowMins + 24 * 60 : nowMins;

  const raising = [];   // { text } — factors increasing impact right now
  const easing = [];    // { text } — factors that are currently favorable
  const unknown = [];   // metrics we couldn't read
  let strongOverride = false; // post-workout 0-2h or near-bedtime → never "Lower"

  // ── FACTOR 1: Trained in last ~0–3h (lift OR sport) ──
  // Read from the ACTIVE day (which may be yesterday's date if pre-dawn).
  const dayWorkouts = [
    ...(data.exercise || []).filter(e => e.date === activeDay && e.time).map(e => ({ time: e.time, label: e.label || "workout" })),
    ...(data.sports || []).filter(s => s.date === activeDay && s.time).map(s => ({ time: s.time, label: s.sport || "sport" })),
  ];
  if (dayWorkouts.length) {
    let mostRecent = null, mostRecentMins = -1;
    dayWorkouts.forEach(w => {
      let m = minsOf(w.time);
      if (m == null) return;
      // If we're past midnight, the event happened on the previous day → it's at m (no +24);
      // "now" already had +24 added, so the difference is correct.
      if (m > mostRecentMins && m <= nowMinsAdj) { mostRecentMins = m; mostRecent = w; }
    });
    if (mostRecent) {
      const hrsSince = (nowMinsAdj - mostRecentMins) / 60;
      if (hrsSince >= 0 && hrsSince <= 2) {
        raising.push({ text: `Trained ${hrsSince < 1 ? "under an hour" : Math.round(hrsSince) + "h"} ago — you're in the post-workout window where blood flow drives recovery and protein synthesis; nicotine's vasoconstriction works directly against that.` });
        strongOverride = true;
      } else if (hrsSince > 2 && hrsSince <= 3) {
        raising.push({ text: `Trained about ${Math.round(hrsSince)}h ago — still within the recovery window where blood flow matters.` });
      } else {
        easing.push({ text: `Last trained ${Math.round(hrsSince)}h ago — outside the tightest recovery window.` });
      }
    }
  } else {
    const activeName = WEEKDAYS[(new Date(activeDay + "T00:00:00").getDay() + 6) % 7];
    const isTrainingDay = goals.plan?.trainingDays?.includes(activeName);
    if (isTrainingDay) easing.push({ text: `No training logged ${crossedMidnight ? "yesterday" : "yet today"} — not currently in a recovery window.` });
    else easing.push({ text: `Rest day — no training stress to recover from right now, so the training-specific cost is lowest.` });
  }

  // ── FACTOR 2: Short / poor sleep ──
  // Find the MOST RECENT sleep log (not just today/yesterday — don't "forget" older data).
  const sortedSleep = (data.sleep || []).filter(s => s.date && s.duration != null).sort((a, b) => b.date.localeCompare(a.date));
  const lastSleep = sortedSleep[0] || null;
  if (!lastSleep) {
    unknown.push("sleep");
  } else {
    // Staleness is measured from the most recent night that COULD have a log.
    // If we've crossed midnight and slept already, last night = today's date; otherwise
    // last night = yesterday's date. Compare the log's age against that reference.
    const lastNightDate = sleptForToday ? today : daysAgo(1);
    const daysOld = Math.round((new Date(lastNightDate + "T00:00:00") - new Date(lastSleep.date + "T00:00:00")) / 86400000);
    const whenLabel = daysOld <= 0 ? "last night" : daysOld === 1 ? "the night before last" : `${daysOld + 1} nights ago (most recent log)`;
    const stale = daysOld >= 1; // anything older than the most recent loggable night is stale
    const poorQuality = lastSleep.quality === "Poor" || lastSleep.quality === "Fair";
    const dur = lastSleep.duration;
    const qStr = lastSleep.quality ? ` (${lastSleep.quality.toLowerCase()})` : "";
    if (stale) {
      unknown.push(`sleep — not logged for last night (most recent: ${dur}h${qStr}, ${whenLabel})`);
    } else if (dur < 6) {
      raising.push({ text: `Slept ${dur}h last night — recovery is already compromised before anything else stacks on top.` });
    } else if (dur < 7 || poorQuality) {
      raising.push({ text: `Slept ${dur}h${qStr} last night — recovery is running below par.` });
    } else {
      easing.push({ text: `Slept ${dur}h${qStr} last night — recovery base is solid.` });
    }
  }

  // ── FACTOR 3: Under-fuelled vs target on the ACTIVE day (esp. protein) ──
  const dayDiet = (data.diet || []).filter(d => d.date === activeDay);
  // "Hours into the waking day" — if pre-dawn, the day's been going a long time, so don't
  // excuse low intake as "just getting started".
  const hoursIntoDay = crossedMidnight ? (nowMins / 60 + 24 - 6) : (nowMins / 60 - 6);
  if (dayDiet.length === 0 && !crossedMidnight && nowMins < 11 * 60) {
    easing.push({ text: `Early in the day — fuelling just getting started.` });
  } else if (dayDiet.length === 0) {
    // Late in a day (or past midnight) with no food logged is itself a fuelling gap, not "unknown".
    if (crossedMidnight || nowMins >= 15 * 60) {
      raising.push({ text: `No food logged ${crossedMidnight ? "for yesterday" : "today"} — if that's accurate, you're under-fuelled, which compounds the recovery hit.` });
    } else {
      unknown.push("food");
    }
  } else {
    const cal = dayDiet.reduce((a, m) => a + (m.calories || 0), 0);
    const protein = dayDiet.reduce((a, m) => a + (m.protein || 0), 0);
    const calTarget = goals.calories || 0;
    const pTarget = goals.protein || 0;
    // Fraction of the day elapsed (cap at 1 once past ~9pm or after midnight)
    const dayFrac = crossedMidnight ? 1 : Math.max(0, Math.min(1, (nowMins - 6 * 60) / ((21 - 6) * 60)));
    const expectedCal = calTarget * dayFrac;
    const lowProtein = pTarget && protein < pTarget * dayFrac * 0.7;
    const lowCal = calTarget && cal < expectedCal * 0.65;
    if (lowProtein && lowCal) {
      raising.push({ text: `Under-fuelled (${cal} kcal, ${protein}g protein) ${crossedMidnight ? "across yesterday" : "for this point in the day"} — under-eating, especially low protein, compounds the recovery hit.` });
    } else if (lowProtein) {
      raising.push({ text: `Protein is behind (${protein}g vs ${pTarget}g target) — low protein leaves recovery under-supported.` });
    } else if (lowCal) {
      raising.push({ text: `Calories are behind target — under-fuelling compounds recovery stress.` });
    } else {
      easing.push({ text: `Fuelling is on track — recovery is supported.` });
    }
  }

  // ── FACTOR 4: Within ~1–2h of usual bedtime ──
  // Use 7-day average bedtime, fall back to last night's.
  const recentBedtimes = (data.sleep || []).filter(s => s.date >= daysAgo(7) && s.bedtime).map(s => s.bedtime);
  let bedtimeMins = null;
  if (recentBedtimes.length >= 2) {
    bedtimeMins = avgTimeMins(recentBedtimes);
  } else if (lastSleep?.bedtime) {
    bedtimeMins = minsOf(lastSleep.bedtime);
    if (bedtimeMins != null && bedtimeMins < 5 * 60) bedtimeMins += 24 * 60;
  }
  if (bedtimeMins == null) {
    unknown.push("bedtime");
  } else {
    // Normalize "now" to compare against a possibly-after-midnight bedtime
    let nowForBed = nowMins;
    if (bedtimeMins >= 24 * 60 && nowMins < 12 * 60) nowForBed += 24 * 60;
    const minsToBed = bedtimeMins - nowForBed;
    const bedLabel = `${String(Math.floor((bedtimeMins % (24 * 60)) / 60)).padStart(2, "0")}:${String(bedtimeMins % 60).padStart(2, "0")}`;
    if (minsToBed >= 0 && minsToBed <= 60) {
      raising.push({ text: `It's within an hour of your usual bedtime (~${bedLabel}) — nicotine is a stimulant and fragments sleep, your biggest recovery lever.` });
      strongOverride = true;
    } else if (minsToBed > 60 && minsToBed <= 120) {
      raising.push({ text: `Getting close to your usual bedtime (~${bedLabel}) — late nicotine can disrupt sleep onset and quality.` });
    } else if (minsToBed > 120 && minsToBed <= 240) {
      easing.push({ text: `A few hours from your usual bedtime — outside the window where it most disrupts sleep.` });
    } else {
      easing.push({ text: `Far from bedtime — sleep disruption isn't the main concern right now.` });
    }
  }

  // ── ROLL INTO BANDS ──
  // Additive: 0 raising → lower; 1-2 → moderate; 3+ → higher.
  // Override: a strong factor (0-2h post-workout OR within 1h of bed) can never read "Lower".
  let band;
  const n = raising.length;
  if (n >= 3) band = "higher";
  else if (n >= 1) band = "moderate";
  else band = "lower";
  if (band === "lower" && strongOverride) band = "moderate";

  // Guard: the two factors that most define recovery are sleep and training status.
  // If sleep is unknown, we can't honestly call this a "Lower-impact" window — that would
  // read like a green light based on missing data. Floor it at Moderate and flag why.
  const sleepUnknown = unknown.some(u => u === "sleep" || u.startsWith("sleep"));
  let insufficientData = false;
  if (band === "lower" && sleepUnknown) {
    band = "moderate";
    insufficientData = true;
  }

  return { band, raising, easing, unknown, strongOverride, insufficientData, crossedMidnight, activeDay, time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` };
}
