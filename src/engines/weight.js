// ─── WEIGHT TREND ENGINE (A1) ───────────────────────────────────────────────
// Robust bodyweight trend via Theil–Sen (median of pairwise slopes) over the
// last ≤21 days: unbiased like OLS but resistant to water/refeed spikes.
// Pure — depends on nothing but the data passed in.

export function computeWeightTrend(data) {
  const raw = (data.weight || []).filter(w => w && w.kg > 0 && w.date);
  if (raw.length === 0) return null;

  // One value per day = the EARLIEST weigh-in that day (morning-fasted is the
  // most consistent reading, so we anchor on it).
  const byDay = {};
  raw.forEach(w => { const cur = byDay[w.date]; if (!cur || (w.ts || 0) < (cur.ts || 0)) byDay[w.date] = w; });
  const days = Object.keys(byDay).sort(); // ascending YYYY-MM-DD
  const series = days.map(d => ({ date: d, kg: byDay[d].kg }));

  const latestRaw = series[series.length - 1].kg;
  const nDays = series.length;
  const dayMs = 86400000;
  const latestMs = new Date(days[days.length - 1] + "T00:00:00").getTime();
  const spanDays = Math.round((latestMs - new Date(days[0] + "T00:00:00").getTime()) / dayMs);

  // Trend level + rate of change come from an ordinary least-squares fit over
  // the RAW daily weigh-ins in the last ≤21 days, via Theil–Sen: the median of
  // every pairwise slope. Like OLS it's unbiased for a linear trend (no EWMA
  // lag), but unlike OLS it's robust — one water/refeed/glycogen spike can't
  // lever the slope, because the median ignores outlier pairs. We also refuse to
  // express a *weekly* rate until the window spans ≥7 days.
  const WINDOW_DAYS = 20;
  const windowStartMs = latestMs - WINDOW_DAYS * dayMs;
  const wpts = series
    .filter(s => new Date(s.date + "T00:00:00").getTime() >= windowStartMs)
    .map(s => ({ x: (new Date(s.date + "T00:00:00").getTime() - windowStartMs) / dayMs, y: s.kg }));
  const median = arr => { if (!arr.length) return null; const a = [...arr].sort((p, q) => p - q); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const windowSpan = wpts.length ? wpts[wpts.length - 1].x - wpts[0].x : 0;
  let ratePerWeekKg = null, current = latestRaw, residSd = 0;
  if (wpts.length >= 2 && windowSpan >= 7) {
    const slopes = [];
    for (let i = 0; i < wpts.length; i++)
      for (let j = i + 1; j < wpts.length; j++)
        if (wpts[j].x !== wpts[i].x) slopes.push((wpts[j].y - wpts[i].y) / (wpts[j].x - wpts[i].x));
    const slopePerDay = median(slopes);
    const intercept = median(wpts.map(p => p.y - slopePerDay * p.x));
    ratePerWeekKg = +(slopePerDay * 7).toFixed(3);
    const latestX = (latestMs - windowStartMs) / dayMs;
    current = +(intercept + slopePerDay * latestX).toFixed(2);
    const resid = wpts.map(p => p.y - (intercept + slopePerDay * p.x));
    const mr = resid.reduce((a, b) => a + b, 0) / resid.length;
    residSd = Math.sqrt(resid.reduce((a, b) => a + (b - mr) ** 2, 0) / resid.length);
  } else if (wpts.length >= 2) {
    // Enough weigh-ins but too short a span to call a weekly rate — still give a
    // robust current level (median of the window) so the UI can show a number.
    current = +median(wpts.map(p => p.y)).toFixed(2);
  }
  const ratePerWeekG = ratePerWeekKg != null ? Math.round(ratePerWeekKg * 1000) : null;
  const pctBWPerWeek = (ratePerWeekKg != null && current) ? +((ratePerWeekKg / current) * 100).toFixed(2) : null;

  // Direction with a ~100 g/wk noise floor.
  let direction = "flat";
  if (ratePerWeekG != null) { if (ratePerWeekG > 100) direction = "gaining"; else if (ratePerWeekG < -100) direction = "losing"; }

  // Raw vs trend divergence — today's scale reading vs the fitted trend line.
  const divergence = +(latestRaw - current).toFixed(2);
  const sd = residSd;

  // Confidence from density + span, knocked down if the scale is very noisy.
  let confidence = "Low";
  if (nDays >= 5 && spanDays >= 10) confidence = "Moderate";
  if (nDays >= 10 && spanDays >= 14) confidence = "High";
  if (confidence === "High" && sd > 1.0) confidence = "Moderate";

  return {
    current, latestRaw, latestDate: days[days.length - 1],
    ratePerWeekKg, ratePerWeekG, pctBWPerWeek,
    direction, divergence, nDays, spanDays, confidence,
  };
}
