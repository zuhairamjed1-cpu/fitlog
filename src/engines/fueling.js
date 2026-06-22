// ─── PERFORMANCE FUELING PLANNER (reactive) ─────────────────────────────────
// Given a day's PLANNED sessions + bodyweight, build a timed carb/protein plan,
// then REACT to what's actually been logged: meals you've eaten anchor the
// timeline at their real times, and the remaining suggestions re-plan around
// them (amounts scaled to what's left, carb TYPE chosen by timing, simple meals
// proposed). The eating window follows your real average sleep — no midnight cap.
//
// Grounded in "fuel for the work required": daily carbs scale with the day's
// glycogen demand (~3 g/kg light → 8–10+ g/kg hard/two-a-day), timed around
// sessions. Honest: evidence-based STARTING POINTS scaled to weight + load, not
// exact biological truth, and not a dietitian. The post-workout "anabolic
// window" is largely a myth for once-a-day lifters; the real lever is PRE-fuel.

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
const MEALS_TARGET = 4; // aim for ~4 eating occasions/day (meals + a snack)

export function planFueling({ sessions, weightKg, goals, wakeMin = 420, sleepMin = 1380 }) {
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
    const early = s.start < wakeMin + 60;
    if (early) {
      blocks.push({ at: s.start - 45, kind: "pre", label: `Pre: ${s.t.label}`, carbsG: Math.round(0.5 * w), proteinG: Math.round(0.2 * w), note: "Early session — a small quick carb (banana, dates, toast) 30–45 min before, or train as-is if your stomach can't handle food that early." });
    } else {
      const preCarbs = Math.round(s.t.prePerKg * w * (s.iw >= 1.3 ? 1.1 : 1));
      blocks.push({ at: s.start - 150, kind: "pre", label: `Pre: ${s.t.label}`, carbsG: preCarbs, proteinG: Math.round(0.3 * w), note: `~${(preCarbs / w).toFixed(1)} g/kg carbs 2–3h before to top off glycogen. Keep it lower-fat and lower-fibre so it digests well.` });
    }
    if (s.durH >= 1.25 && s.t.kind === "sport") {
      blocks.push({ at: s.start + Math.round(s.durMin / 2), kind: "during", label: `During: ${s.t.label}`, carbsG: Math.round(s.durH * 45), proteinG: 0, note: "30–60 g/h for sessions over ~75 min — sports drink, gel, banana or dates keep output up." });
    }
    const nextStart = S[i + 1] ? S[i + 1].start : null;
    const backToBack = nextStart != null && (nextStart - s.end) <= 480;
    const postPerKg = (s.t.kind === "sport" || backToBack) ? 1.0 : 0.8;
    blocks.push({ at: s.end + 45, kind: "post", label: `Post: ${s.t.label}`, carbsG: Math.round(postPerKg * w), proteinG: Math.round(0.4 * w), note: backToBack ? "Rapid refuel (~1 g/kg) + protein — you train again soon, so replenish glycogen fast." : `~${postPerKg} g/kg carbs + protein within ~1–2h to start recovery.` });
  });

  // Fill remaining carb budget across normal meal slots, aiming for ~MEALS_TARGET
  // eating occasions total. Window follows the real sleep schedule — last meal
  // ~90 min before the average bedtime, with NO hard midnight cap (bedtime can be
  // after 00:00; times render mod-24).
  const anchored = blocks.reduce((a, b) => a + b.carbsG, 0);
  const remaining = Math.max(0, dailyCarbs - anchored);
  const eatingAnchored = blocks.filter(b => b.kind === "pre" || b.kind === "post").length;
  const fillerCount = Math.max(0, MEALS_TARGET - eatingAnchored);
  const dayStart = wakeMin + 45;
  const dayEnd = Math.max(dayStart + 120, sleepMin - 90);
  let slotTimes = [];
  if (fillerCount === 1) slotTimes = [Math.round((dayStart + dayEnd) / 2)];
  else if (fillerCount > 1) slotTimes = Array.from({ length: fillerCount }, (_, i) => Math.round(dayStart + (dayEnd - dayStart) * (i / (fillerCount - 1))));
  const slots = slotTimes.filter(t => !blocks.some(b => Math.abs(b.at - t) < 90));
  if (slots.length && remaining > 0) {
    const per = Math.round(remaining / slots.length);
    slots.forEach(t => blocks.push({ at: t, kind: "meal", label: "Meal", carbsG: per, proteinG: 0, note: "Fills your daily carb target around the sessions." }));
  }

  // Spread protein evenly across all eating blocks, then fix the rounding remainder.
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
    sessMins: S.map(s => ({ start: s.start, end: s.end, label: s.t.label, durMin: s.durMin, intensity: s.intensity })),
    blocks, notes, wakeMin, sleepMin,
  };
}

// Derive a typical waking window from logged sleep (avg wake & bedtime, last 14
// nights). After-midnight bedtimes are carried past 1440 so the eating window can
// legitimately extend past midnight. Defaults if empty.
export function sleepWindow(data) {
  const mof = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
  const recent = (data.sleep || []).slice(-14);
  const wakes = [], beds = [];
  recent.forEach(s => {
    const w = mof(s.wakeTime); if (w != null) wakes.push(w);
    let b = mof(s.bedtime); if (b != null) { if (b < 720) b += 1440; beds.push(b); }
  });
  const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  return { wakeMin: avg(wakes) ?? 420, sleepMin: avg(beds) ?? 1380, hasData: wakes.length > 0 || beds.length > 0 };
}

// ─── carb typing + simple-meal suggestions ──────────────────────────────────
const SLOW_RE = /\b(oat|oatmeal|porridge|brown rice|whole ?grain|wholemeal|whole ?wheat|lentil|bean|chickpea|chick pea|quinoa|barley|bulgur|sweet potato|yam|berr|apple|pear|orange|legume|veg|salad|hummus)/i;
const FAST_RE = /\b(rice|potato|bread|bagel|toast|bun|banana|date|honey|sugar|juice|soda|cola|candy|sweet|cereal|cornflake|pasta|noodle|pancake|waffle|gel|sports drink|maltodextrin|white)/i;
export function carbTypeOf(s) { if (SLOW_RE.test(s || "")) return "slow"; if (FAST_RE.test(s || "")) return "fast"; return "mixed"; }

const TYPE_NOTE = {
  fast: "fast, low-fibre carbs — digest clean",
  slow: "slower, lower-GI carbs — gentler before bed",
  mixed: "balanced carbs with some fibre + protein",
};
const FOODS = {
  fast: [{ n: "a bowl of rice", g: 45 }, { n: "a large potato", g: 37 }, { n: "a banana", g: 27 }, { n: "3 dates", g: 18 }, { n: "a slice of toast", g: 15 }],
  slow: [{ n: "a cup of oats", g: 27 }, { n: "a bowl of brown rice", g: 42 }, { n: "a cup of lentils", g: 30 }, { n: "an apple", g: 21 }],
  mixed: [{ n: "a bowl of rice", g: 45 }, { n: "a wrap", g: 30 }, { n: "a cup of oats", g: 27 }, { n: "a banana", g: 27 }],
};
const PROTEINS = [{ n: "tuna", g: 26 }, { n: "chicken breast", g: 35 }, { n: "a scoop of whey", g: 24 }, { n: "3 eggs", g: 18 }, { n: "Greek yogurt", g: 17 }];
function suggestMeal(carbT, type, protT) {
  let left = carbT; const picks = [];
  for (const f of (FOODS[type] || FOODS.mixed)) {
    let n = 0;
    while (left >= f.g * 0.6 && n < 3 && picks.length < 3) { picks.push(f.n); left -= f.g; n++; }
    if (left < 12 || picks.length >= 3) break;
  }
  const counts = {}; picks.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
  let s = Object.entries(counts).map(([n, c]) => (c > 1 ? `${n} \u00d7${c}` : n)).join(", ");
  if (protT >= 12) { const p = PROTEINS.reduce((best, x) => (Math.abs(x.g - protT) < Math.abs(best.g - protT) ? x : best)); s += (s ? " + " : "") + p.n; }
  return s;
}
function slotCarbType(at, sessions, bedMin) {
  for (const s of (sessions || [])) {
    if (at >= s.start - 150 && at <= s.start) return "fast";
    if (at >= s.end && at <= s.end + 120) return "fast";
  }
  if ((bedMin - at) <= 150 && (bedMin - at) >= -90) return "slow";
  return "mixed";
}

const CARB_FOODS = [
  { n: "a bowl of rice", g: 45 }, { n: "a large potato", g: 37 }, { n: "a banana", g: 27 },
  { n: "a cup of oats", g: 27 }, { n: "a wrap", g: 30 }, { n: "3 dates", g: 18 }, { n: "a slice of toast", g: 15 },
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

// Reconcile a fuel plan against what's actually been eaten + the clock, and build
// a REACTIVE, physiologically-divided timeline:
//  • logged meals are GROUPED (entries within 1h merge into one) and named
//    wake-relative (first meal = Breakfast), carb-typed by their foods;
//  • the gym is a marker; pre-gym is a LIGHT top-up (never a dumping ground);
//  • the remaining carb/protein budget is divided into as many meals as needed so
//    no single meal exceeds a per-meal ceiling (~1 g/kg carbs) — count is dynamic,
//    not capped; the last meal before bed is lighter and slower.
export function reconcileFueling({ plan, meals, nowMin }) {
  if (!plan || !plan.blocks || !plan.blocks.length) return null;
  const mofT = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
  const w = plan.weightKg || 75;
  const wakeMin = plan.wakeMin != null ? plan.wakeMin : 420;
  const bedMin = plan.sleepMin || 1380;
  const sess = plan.sessMins || [];

  // per-meal physiology caps (scaled to bodyweight)
  const MEAL_C_TARGET = 0.8 * w, MEAL_C_CAP = 1.0 * w;     // split a meal past ~1 g/kg carbs
  const MEAL_P_TARGET = 0.4 * w, MEAL_P_CAP = 0.55 * w;    // ~0.4 g/kg protein per meal for MPS
  const PRE_C = Math.round(0.5 * w), PRE_P = Math.round(0.25 * w);  // pre-gym stays LIGHT
  const POST_C = Math.round(0.8 * w), POST_P = Math.round(0.4 * w);

  // wake-relative, training-aware meal name
  const inPre = at => sess.find(s => at >= s.start - 150 && at <= s.start);
  const inPost = at => sess.find(s => at >= s.end && at <= s.end + 120);
  const bandName = at => {
    if (inPre(at)) return "Pre-gym";
    if (inPost(at)) return "Post-gym";
    const h = (at - wakeMin) / 60;
    if (h < 3.5) return "Breakfast";
    if (h < 6.5) return "Lunch";
    if (h < 9) return "Snack";
    if (h < 12) return "Dinner";
    return "Late meal";
  };

  // group logged meals: entries within 1h merge into one block
  const ML = (meals || []).filter(m => m && (m.carbs || m.protein || m.food || m.meal))
    .map(m => ({ at: mofT(m.time), carbs: Math.round(m.carbs || 0), protein: Math.round(m.protein || 0), name: m.food || m.meal || "food", raw: `${m.food || ""} ${m.meal || ""} ${m.notes || ""}` }))
    .filter(m => m.at != null).sort((a, b) => a.at - b.at);
  const groups = [];
  for (const m of ML) {
    const g = groups[groups.length - 1];
    if (g && (m.at - g.lastAt) <= 60) { g.carbs += m.carbs; g.protein += m.protein; g.foods.push(m.name); g.raw += " " + m.raw; g.lastAt = m.at; }
    else groups.push({ at: m.at, lastAt: m.at, carbs: m.carbs, protein: m.protein, foods: [m.name], raw: m.raw });
  }

  const consumedCarbs = groups.reduce((a, g) => a + g.carbs, 0);
  const consumedProtein = groups.reduce((a, g) => a + g.protein, 0);
  const carbsLeft = Math.max(0, plan.dailyCarbs - consumedCarbs);
  const proteinLeft = Math.max(0, plan.dailyProtein - consumedProtein);
  const carbPct = Math.min(100, Math.round((consumedCarbs / Math.max(plan.dailyCarbs, 1)) * 100));
  const proteinPct = Math.min(100, Math.round((consumedProtein / Math.max(plan.dailyProtein, 1)) * 100));

  const eatenRows = groups.map(g => ({ at: g.at, time: fmt(g.at), kind: "eaten", label: bandName(g.at), carbsG: g.carbs, proteinG: g.protein, carbType: carbTypeOf(g.raw), foodsLine: g.foods.slice(0, 4).join(" · "), done: true }));
  const sessRows = sess.map(s => ({ at: s.start, time: fmt(s.start), kind: "session", label: `${s.label} · ${s.durMin}min · ${s.intensity}` }));

  // ── divide the REMAINING budget across the rest of the day ──
  let rC = carbsLeft, rP = proteinLeft;
  const winStart = Math.max((nowMin || 0) + 15, wakeMin);
  const winEnd = Math.max(winStart + 60, bedMin - 75);
  const sugg = [];
  // training slots first: light pre, moderate post (only ones still ahead)
  sess.forEach(s => {
    const preAt = s.start - 105, postAt = s.end + 40;
    const preName = s.label === "Gym" ? "Pre-gym" : `Pre: ${s.label}`;
    const postName = s.label === "Gym" ? "Post-gym" : `Post: ${s.label}`;
    if (preAt > nowMin) { const c = Math.min(PRE_C, rC), pr = Math.min(PRE_P, rP); sugg.push({ at: preAt, kind: "pre", baseLabel: preName, sessLabel: s.label, carbsG: Math.round(c / 5) * 5, proteinG: Math.round(pr / 5) * 5, carbType: "fast", light: true }); rC -= c; rP -= pr; }
    if (postAt > nowMin) { const c = Math.min(POST_C, rC), pr = Math.min(POST_P, rP); sugg.push({ at: postAt, kind: "post", baseLabel: postName, sessLabel: s.label, carbsG: Math.round(c / 5) * 5, proteinG: Math.round(pr / 5) * 5, carbType: "fast" }); rC -= c; rP -= pr; }
  });
  rC = Math.max(0, rC); rP = Math.max(0, rP);
  // normal meals: dynamic count so no meal exceeds the ceiling
  let behind = 0;
  if (rC > 0 || rP > 0) {
    const byC = Math.ceil(rC / Math.max(MEAL_C_TARGET, 1));
    const byP = Math.ceil(rP / Math.max(MEAL_P_TARGET, 1));
    const maxSlots = Math.max(1, Math.floor((winEnd - winStart) / 150) + 1); // >= 2.5h apart
    const n = Math.min(Math.max(byC, byP, 1), maxSlots);
    const taken = [...sugg.map(b => b.at), ...eatenRows.map(b => b.at)];
    const inSession = t => sess.some(s => t >= s.start - 30 && t <= s.end + 30);
    const times = [];
    for (let i = 0; i < n; i++) { const t = Math.round(winStart + (winEnd - winStart) * ((i + 0.5) / n)); if (!taken.some(x => Math.abs(x - t) < 75) && !inSession(t)) times.push(t); }
    const k = times.length || 1;
    const perC = rC / k, perP = rP / k;
    if (perC > MEAL_C_CAP) behind = Math.round(rC - MEAL_C_CAP * k);
    const capC = Math.min(perC, MEAL_C_CAP), capP = Math.min(perP, MEAL_P_CAP);
    times.forEach(t => {
      const near = (bedMin - t) <= 150;
      sugg.push({ at: t, kind: "meal", baseLabel: bandName(t), carbsG: Math.round(capC / 5) * 5, proteinG: Math.round(capP / 5) * 5, carbType: near ? "slow" : "mixed" });
    });
  }
  // finalize: order, dedupe names, type note, food idea
  const used = {};
  sugg.sort((a, b) => a.at - b.at).forEach(b => {
    b.time = fmt(b.at);
    let nm = b.baseLabel;
    if (used[nm]) nm = nm === "Lunch" ? "Snack" : nm === "Snack" ? "Dinner" : nm === "Dinner" ? "Late meal" : nm === "Breakfast" ? "Snack" : nm;
    if (used[nm]) nm = "Snack";
    used[nm] = 1; used[b.baseLabel] = 1;
    b.label = nm;
    b.typeNote = (TYPE_NOTE[b.carbType] || "") + (b.light ? " — keep it light right before training" : "");
    b.foodIdea = b.carbsG >= 10 ? suggestMeal(b.carbsG, b.carbType, b.proteinG) : "";
  });
  const ordered = [...sugg].sort((a, b) => a.at - b.at);
  if (ordered[0]) ordered[0].isNext = true;

  const timeline = [...eatenRows, ...sessRows, ...sugg].sort((a, b) => a.at - b.at);
  const firstSugg = ordered[0];
  const nextPre = ordered.find(b => b.kind === "pre");

  let status, tone, advice;
  if (nextPre) {
    tone = behind > 0 ? "warn" : "ok"; status = `Fuel up for ${nextPre.sessLabel || "your session"}`;
    advice = `Keep pre-${(nextPre.sessLabel || "session").toLowerCase()} light: ~${nextPre.carbsG}g easy carbs${nextPre.proteinG ? ` + ${nextPre.proteinG}g protein` : ""} around ${nextPre.time}. The rest of today's carbs are spread across your other meals, not piled in before training.${behind > 0 ? ` You're ~${behind}g of carbs behind with limited time — fit what you reasonably can; tomorrow's a fresh start.` : ""}`;
  } else if (carbsLeft > 0) {
    tone = behind > 0 ? "warn" : "ok";
    status = behind > 0 ? "Behind on fuel" : "On track";
    advice = `You've had ${consumedCarbs}g of ~${plan.dailyCarbs}g carbs.${firstSugg ? ` Next: ${firstSugg.label} ~${firstSugg.time}, about ${firstSugg.carbsG}g carbs${firstSugg.proteinG ? ` + ${firstSugg.proteinG}g protein` : ""}.` : ""}${behind > 0 ? ` You're ~${behind}g behind with little day left — fit what you reasonably can, prioritise the session; tomorrow's a fresh start.` : ""}`;
  } else {
    tone = "ok"; status = "Topped up";
    advice = `You've hit today's carb target (${consumedCarbs}g) for this load — glycogen's covered.${proteinLeft > 0 ? ` Just ${proteinLeft}g protein left.` : ""}`;
  }

  return {
    consumedCarbs, consumedProtein, carbsLeft, proteinLeft, carbPct, proteinPct, behind,
    status, tone, advice,
    addPhrase: carbsLeft >= 15 ? suggestCarbFoods(carbsLeft) : "",
    timeline,
    next: firstSugg ? { time: firstSugg.time, label: firstSugg.label, carbsG: firstSugg.carbsG, carbType: firstSugg.carbType } : null,
    upcoming: ordered.map(b => ({ time: b.time, label: b.label, carbsG: b.carbsG, proteinG: b.proteinG, kind: b.kind })),
    dailyCarbs: plan.dailyCarbs, dailyProtein: plan.dailyProtein,
  };
}
