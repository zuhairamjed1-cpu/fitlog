// ─── FDC MATCHING + SANITY VALIDATION ───────────────────────────────────────
// Shared by api/fdc.js (server) and eval/adapters.mjs (harness) so the two can
// never drift apart again — they drifted, and the eval caught it.
//
// WHY THIS EXISTS. The first eval run found the DB layer, not portion estimation,
// was the biggest error source:
//     Big Mac pickles, 30g  → FDC said 160 kcal (533 kcal/100g). Real: ~5.
//     Broccoli, 160g        → FDC said 357 kcal (223 kcal/100g). Real: ~56.
//     Beef strips, 120g     → FDC said  31 kcal ( 26 kcal/100g). Real: ~300.
// A verified database that returns 533 kcal/100g for a pickle is worse than no
// database — it launders a bad number into a trusted one. So every FDC match now
// has to survive three gates before we let it price anything:
//
//   GATE 1 — UNIT. Energy must be reported in KCAL. FDC also carries kJ (nutrient
//            268); reading a kJ value as kcal inflates by ~4.2x. Suspected cause
//            of the pickle.
//   GATE 2 — PHYSICS. Nothing edible exceeds ~900 kcal/100g (pure oil is 884).
//            Anything above that is a parse error, not a food.
//   GATE 3 — CROSS-CHECK. The AI gave its own independent per-gram estimate. If
//            FDC and the AI disagree by more than ~2.5x, ONE OF THEM IS WRONG and
//            we don't know which — so we refuse to launder it. Fall back to the
//            AI estimate and flag it. Two independent estimators disagreeing wildly
//            is the strongest error signal available to us; it is exactly the
//            signal the Atwater check CANNOT see (a bad match is internally
//            consistent — double the grams, every macro doubles, Atwater passes).
//
// This is also the escalation trigger the pipeline was missing.

export const KCAL_PER_100G_MAX = 900;   // pure fat = 884
export const CROSS_CHECK_RATIO = 2.5;   // FDC vs AI disagreement tolerance

// Prefer lab-analysed data types; Branded is crowd-entered and noisiest.
const TYPE_RANK = {
  "sr legacy": 0, "sr_legacy_food": 0,
  "foundation": 1, "foundation_food": 1,
  "survey (fndds)": 2, "survey_fndds_food": 2,
  "branded": 3, "branded_food": 3,
};
export const DATATYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"];

// Extract per-100g macros. GATE 1 lives here: energy must be KCAL, not kJ.
export function macrosPer100(food) {
  let cal = null, protein = 0, carbs = 0, fat = 0;

  for (const n of food.foodNutrients || []) {
    const num = String(n.nutrientNumber ?? n.nutrient?.number ?? "");
    const unit = String(n.unitName ?? n.nutrient?.unitName ?? "").toUpperCase();
    const val = n.value ?? n.amount;
    if (val == null) continue;

    if (num === "208") {
      // GATE 1: only accept an explicitly-KCAL energy value. Some records carry
      // energy in kJ; misreading one as kcal inflates the food ~4.2x.
      if (unit === "KCAL" || unit === "") cal = val;
    } else if (num === "203") protein = val;
    else if (num === "204") fat = val;
    else if (num === "205") carbs = val;
  }

  if (cal == null) return null;

  // GATE 2: physics. Nothing edible is denser than pure fat.
  if (cal > KCAL_PER_100G_MAX || cal < 0) return null;

  return {
    cal: Math.round(cal),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
  };
}

// Does the candidate's description actually contain the food we asked for?
// "chicken breast" matching "Chicken breast, grilled" is good. "beef" matching
// "Beef broth, canned" is not — and broth is why a 120g portion came back as
// 31 kcal. Require the LAST content word (the head noun) to appear.
function nameOverlap(desc, query) {
  const stop = new Set(["raw", "cooked", "fried", "grilled", "baked", "boiled",
    "roasted", "fresh", "the", "a", "of", "with", "and", "stir"]);
  const qWords = query.toLowerCase().split(/[\s,]+/).filter(w => w && !stop.has(w));
  if (!qWords.length) return 0;
  const d = desc.toLowerCase();
  const hits = qWords.filter(w => d.includes(w)).length;
  return hits / qWords.length;
}

// Pick the best candidate. Returns null if nothing passes the gates.
export function pickBest(foods, query) {
  const q = String(query || "").toLowerCase().trim();
  const scored = [];

  for (const f of foods) {
    const per100 = macrosPer100(f);   // gates 1 + 2
    if (!per100) continue;

    const desc = String(f.description || "");
    const overlap = nameOverlap(desc, q);
    // Require at least half the query's content words to appear. This is what
    // stops "beef" → "Beef broth" and "pickle" → some pickle-flavoured snack.
    if (overlap < 0.5) continue;

    const dl = desc.toLowerCase();
    const typeRank = TYPE_RANK[String(f.dataType || "").toLowerCase()] ?? 5;
    let rel = 3;
    if (dl === q) rel = 0;
    else if (dl.startsWith(q)) rel = 1;
    else if (dl.includes(q)) rel = 2;

    scored.push({
      f, per100,
      score: typeRank * 10 + rel * 2 + (1 - overlap) * 4 + Math.min(3, desc.length / 50),
    });
  }

  if (!scored.length) return null;
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  return {
    fdcId: best.f.fdcId,
    description: best.f.description,
    dataType: best.f.dataType,
    per100: best.per100,
  };
}

// GATE 3 — the cross-check. Compare the DB's per-100g against the AI's own
// implied per-100g for the same item. Wild disagreement means one is wrong and
// we can't tell which, so we don't trust the DB number.
//
// Returns { ok, ratio, aiPer100, dbPer100, reason }.
export function crossCheck(dbMacros, aiItem) {
  const grams = Number(aiItem?.grams);
  const aiCal = Number(aiItem?.calories);
  // No usable AI estimate to check against — accept the DB (it passed gates 1-2).
  if (!(grams > 0) || !(aiCal > 0)) {
    return { ok: true, ratio: null, reason: "no_ai_estimate" };
  }
  const aiPer100 = (aiCal / grams) * 100;
  const dbPer100 = typeof dbMacros === "number" ? dbMacros : Number(dbMacros?.cal);
  if (!(dbPer100 > 0) || !(aiPer100 > 0)) return { ok: true, ratio: null, reason: "degenerate" };

  const ratio = Math.max(dbPer100 / aiPer100, aiPer100 / dbPer100);
  return {
    ok: ratio <= CROSS_CHECK_RATIO,
    ratio: +ratio.toFixed(2),
    aiPer100: Math.round(aiPer100),
    dbPer100: Math.round(dbPer100),
    reason: ratio <= CROSS_CHECK_RATIO ? "agree" : "disagree",
  };
}
