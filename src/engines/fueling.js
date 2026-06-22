// ─── PERFORMANCE FUELING PLANNER ────────────────────────────────────────────
// Prospective: given a day's PLANNED sessions + bodyweight, build a timed carb
// (and protein) plan. Grounded in sports-nutrition periodization ("fuel for the
// work required"): daily carb need scales with the day's glycogen demand
// (~3 g/kg light → 8–10+ g/kg for hard/multi-session days), timed around sessions.
//
// Honest: these are evidence-based STARTING POINTS scaled to weight + load, not
// exact biological truth — adjust by performance and gut comfort. Not a dietitian.

const minsOf = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
const fmt = m => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };

export const SESSION_TYPES = {
  gym:        { label: "Gym",        kind: "lift",  load: 1.0,  prePerKg: 0.8, defMin: 60 },
  football:   { label: "Football",   kind: "sport", load: 1.4,  prePerKg: 1.5, defMin: 90 },
  basketball: { label: "Basketball", kind: "sport", load: 1.35, prePerKg: 1.4, defMin: 75 },
  boxing:     { label: "Boxing",     kind: "sport", load: 1.5,  prePerKg: 1.3, defMin: 60 },
  other:      { label: "Training",   kind: "sport", load: 1.2,  prePerKg: 1.2, defMin: 60 },
};
const INTENSITY = { light: 0.8, moderate: 1.0, hard: 1.3 };

export function planFueling({ sessions, weightKg, goals }) {
  if (!weightKg || weightKg <= 0) return { needWeight: true };
  if (!sessions || !sessions.length) return null;
  const w = weightKg;

  const S = sessions.map(s => {
    const t = SESSION_TYPES[s.type] || SESSION_TYPES.other;
    const durMin = +s.durationMin || t.defMin;
    const iw = INTENSITY[s.intensity] || 1.0;
    const start = minsOf(s.time) ?? 17 * 60;
    return { type: s.type, t, durMin, durH: durMin / 60, iw, start, end: start + durMin, intensity: s.intensity || "moderate" };
  }).sort((a, b) => a.start - b.start);

  // Daily carb target from total load.
  const totalLoad = S.reduce((a, s) => a + s.durH * s.t.load * s.iw, 0);
  const gPerKg = Math.max(3, Math.min(10, 3 + 2.0 * totalLoad));
  const dailyCarbs = Math.round(gPerKg * w);
  const dailyProtein = Math.round((goals && goals.protein) || 1.8 * w);
  const dailyFat = Math.round((goals && goals.fat) || 0.9 * w);
  const dailyCalories = dailyCarbs * 4 + dailyProtein * 4 + dailyFat * 9;
  const loadLevel = gPerKg < 4.5 ? "light" : gPerKg < 6.5 ? "moderate" : gPerKg < 8.5 ? "high" : "very high";

  const blocks = [];
  S.forEach((s, i) => {
    const early = s.start < 7 * 60;
    // PRE
    if (early) {
      blocks.push({ at: s.start - 45, kind: "pre", label: `Pre: ${s.t.label}`, carbsG: Math.round(0.5 * w), proteinG: Math.round(0.2 * w), note: "Early session — a small quick carb (banana, dates, toast) 30–45 min before, or train as-is if your stomach can't handle food that early." });
    } else {
      const preCarbs = Math.round(s.t.prePerKg * w * (s.iw >= 1.3 ? 1.1 : 1));
      blocks.push({ at: s.start - 150, kind: "pre", label: `Pre: ${s.t.label}`, carbsG: preCarbs, proteinG: Math.round(0.3 * w), note: `~${(preCarbs / w).toFixed(1)} g/kg carbs 2–3h before to top off glycogen. Keep it lower-fat and lower-fibre so it digests well.` });
    }
    // DURING (long sport sessions only)
    if (s.durH >= 1.25 && s.t.kind === "sport") {
      blocks.push({ at: s.start + Math.round(s.durMin / 2), kind: "during", label: `During: ${s.t.label}`, carbsG: Math.round(s.durH * 45), proteinG: 0, note: "30–60 g/h for sessions over ~75 min — sports drink, gel, banana or dates keep output up." });
    }
    // POST
    const nextStart = S[i + 1] ? S[i + 1].start : null;
    const backToBack = nextStart != null && (nextStart - s.end) <= 480;
    const postPerKg = (s.t.kind === "sport" || backToBack) ? 1.0 : 0.8;
    blocks.push({ at: s.end + 45, kind: "post", label: `Post: ${s.t.label}`, carbsG: Math.round(postPerKg * w), proteinG: Math.round(0.4 * w), note: backToBack ? "Rapid refuel (~1 g/kg) + protein — you train again soon, so replenish glycogen fast." : `~${postPerKg} g/kg carbs + protein within ~1–2h to start recovery.` });
  });

  // Distribute the rest of the carb budget across normal meal slots not near a session.
  const anchored = blocks.reduce((a, b) => a + b.carbsG, 0);
  const remaining = Math.max(0, dailyCarbs - anchored);
  const slots = [8 * 60, 13 * 60, 19 * 60 + 30].filter(t => !blocks.some(b => Math.abs(b.at - t) < 90));
  if (slots.length && remaining > 0) {
    const per = Math.round(remaining / slots.length);
    slots.forEach(t => blocks.push({ at: t, kind: "meal", label: "Meal", carbsG: per, proteinG: 0, note: "Fills your daily carb target around the sessions." }));
  }

  // Spread protein evenly across all eating blocks (≈0.3–0.4 g/kg each is ideal),
  // then fix the rounding remainder so the plan hits the daily protein target.
  const pBlocks = blocks.filter(b => b.kind !== "during");
  if (pBlocks.length) {
    const pEach = Math.round(dailyProtein / pBlocks.length);
    pBlocks.forEach(b => { b.proteinG = pEach; });
    const psum = pBlocks.reduce((a, b) => a + b.proteinG, 0);
    pBlocks[pBlocks.length - 1].proteinG += (dailyProtein - psum);
  }

  blocks.sort((a, b) => a.at - b.at);
  blocks.forEach(b => { b.time = fmt(b.at); });

  const planCarbs = blocks.reduce((a, b) => a + b.carbsG, 0);
  const planProtein = blocks.reduce((a, b) => a + b.proteinG, 0);

  const notes = [
    `Today's load is ${loadLevel} → about ${gPerKg.toFixed(1)} g/kg carbs (~${dailyCarbs}g) for your ${w}kg. These are evidence-based starting points — tune them by how you perform and how your gut feels.`,
  ];
  if (S.some(s => s.t.label === "Boxing")) notes.push("Boxing: if you're cutting weight, fuelling changes and needs care — don't crash carbs before hard sparring. Get individual guidance for weight-cut days.");
  if (S.length > 1) notes.push("Two sessions today — prioritise carbs before the harder one and refuel fast in the gap between them.");
  notes.push("This is a fuelling plan, not medical or dietitian advice.");

  return {
    loadLevel, gPerKg: +gPerKg.toFixed(1), dailyCarbs, dailyProtein, dailyFat, dailyCalories,
    planCarbs, planProtein, weightKg: w,
    sessions: S.map(s => ({ label: s.t.label, time: fmt(s.start), durMin: s.durMin, intensity: s.intensity })),
    blocks, notes,
  };
}

// Rough carb-food reference for "what to add" suggestions (grams per portion).
const CARB_FOODS = [
  { n: "a bowl of rice", g: 45 },
  { n: "a large potato", g: 37 },
  { n: "a banana", g: 27 },
  { n: "a cup of oats", g: 27 },
  { n: "a wrap", g: 30 },
  { n: "3 dates", g: 18 },
  { n: "a slice of toast", g: 15 },
];
function suggestCarbFoods(target) {
  let left = target; const picks = [];
  for (const f of CARB_FOODS) {
    let n = 0;
    while (left >= f.g * 0.7 && n < 2 && picks.length < 4) { picks.push(f.n); left -= f.g; n++; }
    if (left < 15 || picks.length >= 4) break;
  }
  if (!picks.length) return "";
  const counts = {}; picks.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
  return Object.entries(counts).map(([n, c]) => (c > 1 ? `${n} \u00d7${c}` : n)).join(", ");
}

// Reconcile a fuel plan against what's actually been eaten today + the clock:
// how the day is tracking, whether you're fuelled for what's coming, and what to add.
export function reconcileFueling({ plan, meals, nowMin }) {
  if (!plan || !plan.blocks || !plan.blocks.length) return null;
  const mof = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : 0; };
  const consumedCarbs = Math.round((meals || []).reduce((a, m) => a + (m.carbs || 0), 0));
  const consumedProtein = Math.round((meals || []).reduce((a, m) => a + (m.protein || 0), 0));
  const carbsLeft = Math.max(0, plan.dailyCarbs - consumedCarbs);
  const proteinLeft = Math.max(0, plan.dailyProtein - consumedProtein);
  const carbPct = Math.min(100, Math.round((consumedCarbs / Math.max(plan.dailyCarbs, 1)) * 100));
  const proteinPct = Math.min(100, Math.round((consumedProtein / Math.max(plan.dailyProtein, 1)) * 100));

  const expectedByNow = plan.blocks.filter(b => mof(b.time) <= nowMin).reduce((a, b) => a + b.carbsG, 0);
  const pace = consumedCarbs - expectedByNow; // + ahead of plan, - behind
  const upcoming = plan.blocks.filter(b => mof(b.time) > nowMin);
  const nextPre = upcoming.find(b => b.kind === "pre");

  let status, tone, advice;
  if (nextPre) {
    const sess = nextPre.label.replace("Pre: ", "");
    tone = pace < -40 ? "warn" : "ok";
    status = `Fuel up for ${sess}`;
    advice = `${pace < -40 ? `You're about ${-pace}g of carbs behind pace - don't go in under-fuelled. ` : ""}Get ~${nextPre.carbsG}g easy-digesting carbs around ${nextPre.time}, plus ${nextPre.proteinG}g protein.`;
  } else if (carbsLeft > 0) {
    tone = pace < -60 ? "warn" : "ok";
    status = pace < -60 ? "Behind on fuel" : "On track";
    advice = `You've had ${consumedCarbs}g of ~${plan.dailyCarbs}g carbs. Add about ${carbsLeft}g more${proteinLeft > 0 ? ` and ${proteinLeft}g protein` : ""} across the rest of today to stay fully energised.`;
  } else {
    tone = "ok";
    status = "Topped up";
    advice = `You've hit today's carb target (${consumedCarbs}g) for this load - glycogen's covered.${proteinLeft > 0 ? ` Just ${proteinLeft}g protein left.` : ""}`;
  }

  return {
    consumedCarbs, consumedProtein, carbsLeft, proteinLeft, carbPct, proteinPct, pace,
    status, tone, advice,
    addPhrase: carbsLeft >= 15 ? suggestCarbFoods(carbsLeft) : "",
    upcoming: upcoming.map(b => ({ time: b.time, label: b.label, carbsG: b.carbsG, proteinG: b.proteinG, kind: b.kind })),
    dailyCarbs: plan.dailyCarbs, dailyProtein: plan.dailyProtein,
  };
}
