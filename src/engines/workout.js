// ─── WORKOUT PARSING (Strong-paste parser, e1RM, PR detection) ────────────

export function parseWorkout(text) {
  if (!text) return { exercises: [], totalVolume: 0, totalSets: 0, avgRPE: null };
  const lines = text.split("\n").map(l => l.trim());
  const exercises = [];
  let current = null;
  let totalVolume = 0, totalSets = 0;
  const rpeValues = [];

  const setRe = /(?:set\s*\d+\s*[:.]?\s*)?[+]?(\d+(?:\.\d+)?)\s*(kg|lb|lbs)?\s*[x×]\s*(\d+)/i;
  const bwRe = /[x×]\s*(\d+)\s*(?:reps)?$/i;
  const repOnlyRe = /^(?:set\s*\d+\s*[:.]\s*)(\d+)\s*reps?\b/i; // "Set 1: 8 reps" (bodyweight, no load)
  // RPE can appear as "@ RPE 8", "RPE 8", "@8", "@ 8.5" — capture the number (0-10, allow .5)
  const rpeRe = /(?:@\s*)?rpe\s*(\d{1,2}(?:\.\d)?)|@\s*(\d{1,2}(?:\.\d)?)\b/i;
  const warmRe = /\[\s*warm[\s-]?up\s*\]/i;        // Strong "[Warm-up]" tag
  const warmPrefixRe = /^w\d+\s*[:.]/i;            // Strong warmup set prefix "W1:" / "W2:"
  const failRe = /\[\s*failure\s*\]/i;             // "[Failure]" → taken to ~0–1 RIR

  function extractRPE(line) {
    const m = line.match(rpeRe);
    if (!m) return null;
    const v = parseFloat(m[1] ?? m[2]);
    return (v >= 0 && v <= 10) ? v : null;
  }

  for (const line of lines) {
    if (!line) continue;
    const lower = line.toLowerCase();
    // Skip duration/date/total lines
    if (/^\d+\s*h(\s*\d+\s*m)?$/i.test(line) || /^\d+\s*m(in)?$/i.test(line)) continue;
    if (/^(total|duration|volume|notes?|rest)\b/i.test(lower)) continue;

    const warmup = warmRe.test(line) || warmPrefixRe.test(line);
    const failure = failRe.test(line);

    const m = line.match(setRe);
    if (m && current) {
      const weight = parseFloat(m[1]);
      const unit = (m[2] || "kg").toLowerCase().replace("lbs", "lb");
      const reps = parseInt(m[3], 10);
      const wKg = unit === "lb" ? weight * 0.453592 : weight;
      const rpe = extractRPE(line);
      if (rpe != null && !warmup) rpeValues.push(rpe);
      current.sets.push({ weight, unit, reps, rpe, warmup, failure });
      current.volume += wKg * reps;
      totalVolume += wKg * reps;
      if (!warmup) totalSets++;
      continue;
    }
    // Rep-only set like "Set 1: 8 reps" (bodyweight)
    const ro = line.match(repOnlyRe);
    if (ro && current && !m) {
      const rpe = extractRPE(line);
      if (rpe != null && !warmup) rpeValues.push(rpe);
      current.sets.push({ weight: 0, unit: "kg", reps: parseInt(ro[1], 10), rpe, warmup, failure });
      if (!warmup) totalSets++;
      continue;
    }
    // Bodyweight set like "× 12"
    const bw = line.match(bwRe);
    if (bw && current && !m) {
      const rpe = extractRPE(line);
      if (rpe != null && !warmup) rpeValues.push(rpe);
      current.sets.push({ weight: 0, unit: "kg", reps: parseInt(bw[1], 10), rpe, warmup, failure });
      if (!warmup) totalSets++;
      continue;
    }
    // Otherwise treat as an exercise name (must contain a letter, not be too long)
    if (/[a-z]/i.test(line) && line.length < 60) {
      current = { name: line.replace(/\s*\(.*?\)\s*$/, "").trim() || line, raw: line, sets: [], volume: 0 };
      exercises.push(current);
    }
  }
  // Drop exercises with no sets (likely stray header lines)
  const withSets = exercises.filter(e => e.sets.length > 0);
  const avgRPE = rpeValues.length ? +(rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length).toFixed(1) : null;
  return { exercises: withSets, totalVolume: Math.round(totalVolume), totalSets, avgRPE };
}

export function bestSet(sets) {
  if (!sets || !sets.length) return null;
  return sets.reduce((best, s) => {
    const sKg = s.unit === "lb" ? s.weight * 0.453592 : s.weight;
    const bKg = best.unit === "lb" ? best.weight * 0.453592 : best.weight;
    if (sKg > bKg || (sKg === bKg && s.reps > best.reps)) return s;
    return best;
  });
}

export function e1rm(set) {
  if (!set) return 0;
  const wKg = set.unit === "lb" ? set.weight * 0.453592 : set.weight;
  if (set.reps <= 0) return 0;
  return wKg * (1 + set.reps / 30);
}

export function detectPRs(parsed, priorExercises) {
  if (!parsed?.exercises?.length) return [];
  // Build best historical e1RM per exercise name (case-insensitive)
  const history = {};
  for (const entry of priorExercises) {
    const p = entry._parsed || parseWorkout(entry.text);
    for (const ex of p.exercises) {
      const key = ex.name.toLowerCase();
      const best = e1rm(bestSet(ex.sets));
      if (!history[key] || best > history[key]) history[key] = best;
    }
  }
  const prs = [];
  for (const ex of parsed.exercises) {
    const key = ex.name.toLowerCase();
    const bs = bestSet(ex.sets);
    const newE = e1rm(bs);
    if (newE > 0 && (history[key] === undefined || newE > history[key] + 0.01)) {
      // Only count as PR if there was some history OR it's a meaningful lift (avoid first-ever everything)
      if (history[key] !== undefined) prs.push({ name: ex.name, ...bs });
    }
  }
  return prs;
}
