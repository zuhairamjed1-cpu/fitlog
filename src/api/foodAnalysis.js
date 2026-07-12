// ─── FOOD ANALYSIS PIPELINE ─────────────────────────────────────────────────
// The accuracy core. Replaces the single-pass analyzeFoodAI. Flow:
//
//   1. IDENTIFY  — AI names each item, estimates GRAMS + a grams RANGE using
//                  reference objects in frame (the web substitute for depth),
//                  emits a clean fdcQuery, and adds hidden-fat line items.
//   2. RESOLVE   — fdcResolver prices each non-hidden item from USDA per-gram.
//   3. RECONCILE — mealValidation derives totals, a calorie range, and flags.
//   4. VERIFY    — a SECOND AI pass runs ONLY when reconcile is unhappy
//                  (Atwater mismatch, low confidence, or a sanity flag). It
//                  critiques and revises portions; we re-resolve + re-reconcile.
//
// The model that never gets to hand us a final calorie number is the point:
// identification + portion is the AI's job; pricing is the database's job.

import { resolveItems } from "./fdcResolver.js";
import { reconcile, sanitizeAIResult } from "../engines/mealValidation.js";

// Reference objects the model can scale against, with real dimensions. This is
// what turns "some rice" into "~150g" without a depth sensor.
const REFERENCE_GUIDE = `PORTION ESTIMATION (critical — this is where most calorie error comes from):
You have NO depth sensor. Estimate grams by scaling against known objects in frame:
- Dinner plate ≈ 27cm across · side plate ≈ 20cm · bowl ≈ 15cm across
- Fork ≈ 19cm · dinner knife ≈ 21cm · teaspoon bowl ≈ 2.5cm · tablespoon ≈ 8cm
- Standard soda/beer can ≈ 12cm tall, 6.6cm wide · credit card ≈ 8.5cm
- Adult hand: palm ≈ 10cm, thumb tip-to-knuckle ≈ 5cm
- A closed fist ≈ 1 cup ≈ 150g cooked rice/pasta · a deck of cards ≈ 85–100g cooked meat
- A cupped palm ≈ 40g nuts/dry · a thumb ≈ 1 tbsp fat (~14g)
STEP: Identify the best reference object visible, estimate its pixel size, then scale
the food's footprint AND estimated height against it. Height matters — a thin layer
and a tall pile look identical from above, so favour a ~45° view when reasoning.
For each item give grams AND a gramsRange [low, high] that honestly reflects your
uncertainty (a tightly-visible item → narrow range; an ambiguous pile → wide range).`;

const HIDDEN_GUIDE = `HIDDEN INGREDIENTS (you will never be told about these, so infer them):
Cooking oils, butter, dressings, and sugar in sauces are invisible but calorie-dense.
Based on the dish type and visible cues (glossy/oily sheen, fried texture, visible
dressing pooling), add SEPARATE line items for likely hidden fats/sugars and set
"hidden": true on them. Typical adds: sautéed veg +1 tbsp oil (~120kcal); fried item
absorbs 1–2 tbsp; dressed salad +1–2 tbsp dressing (~120–240kcal); restaurant dishes
run oilier than home cooking. If a dish is plainly dry/grilled/steamed, add nothing.`;

const ITEM_SCHEMA = `Each item: {"food":"<name>","fdcQuery":"<clean search term for a nutrition DB, e.g. 'chicken breast, grilled' not 'my chicken'>","grams":<int>,"gramsRange":[<lo int>,<hi int>],"calories":<int est>,"protein":<int g>,"carbs":<int g>,"fat":<int g>,"confidence":"high|medium|low","hidden":<bool>}`;

function identifySystemPrompt({ isImage, useWeb }) {
  return `You are a meticulous nutritionist. Your ONLY job on this pass is to IDENTIFY foods and ESTIMATE PORTIONS accurately. A database will handle final nutrition numbers, so nail the item names, the search terms, and the grams.

${isImage ? `LOOK CAREFULLY AT THE PHOTO. Enumerate EVERY item — mains, sides, drinks, condiments, garnishes. Note cooking method (fried/grilled/baked/raw), which changes calories a lot.\n\n` : ""}${REFERENCE_GUIDE}

${HIDDEN_GUIDE}

RULES:
- One entry per distinct food/drink. Break composite dishes into components when you can (e.g. burrito → tortilla, rice, beans, chicken, cheese, sour cream).
- fdcQuery must be a clean, generic nutrition-database search term — no possessives, brands (unless ${useWeb ? "branded" : "asked"}), or portion words. "white rice, cooked" not "a big scoop of rice".
- Your per-item calories/protein/carbs/fat are a FALLBACK estimate used only if the database can't find the item — still make them realistic for the grams you gave.
- ${useWeb ? "For branded/restaurant items, search the web for official nutrition facts and reflect them." : "Estimate from typical real-food values."}

Reply with ONLY this JSON (no prose, no markdown fence):
{"items":[${ITEM_SCHEMA}],"food":"<concise overall meal name>","confidence":"high|medium|low"}`;
}

function verifySystemPrompt() {
  return `You are auditing a nutrition estimate that failed a sanity check. You will get the ORIGINAL items (with grams) and the specific problem. Re-examine the photo/description and CORRECT the portions or items that are wrong. Common fixes: a plate read as too small/large, a missed high-calorie item, a hidden oil/sauce not accounted for, or a portion whose macros don't add up to its calories.

Keep the SAME JSON contract. Adjust grams/items so the numbers are physically consistent. Do NOT inflate uncertainty for its own sake — only change what's actually wrong.

Reply with ONLY this JSON (no prose, no markdown fence):
{"items":[${ITEM_SCHEMA}],"food":"<meal name>","confidence":"high|medium|low"}`;
}

// Decide whether a reconciled meal needs the verify pass.
function needsVerify(rec) {
  if (!rec) return false;
  if (rec.flags.some(f => f.code === "atwater" || f.code === "meal_high" || f.code === "item_high")) return true;
  if (rec.confidence === "low") return true;
  return false;
}

// Parse an identify/verify response into the item array, tolerating the model.
function parseItems(raw, extractJSON) {
  const r = extractJSON(raw); // reuse existing robust extractor
  if (!r || !Array.isArray(r.items)) return null;
  return { items: r.items, food: r.food || "", confidence: r.confidence || null };
}

// Run one identify pass on a given model, resolve against FDC, and reconcile.
// Returns a reconciled meal (or null if the model gave us nothing usable).
async function identifyPass({ model, system, userText, imageBase64, imageMediaType, useWeb }, deps) {
  const { callClaude, extractJSON, WEB_SEARCH_TOOL, resolveImpl } = deps;
  let parsed;
  try {
    const raw = await callClaude({
      model,
      maxTokens: useWeb ? 1800 : 1400,
      tools: useWeb ? WEB_SEARCH_TOOL : undefined,
      system, userText, imageBase64, imageMediaType,
    });
    parsed = parseItems(raw, extractJSON);
  } catch { parsed = null; }
  if (!parsed || !parsed.items.length) return null;

  const resolved = await resolveImpl(parsed.items);
  const rec = reconcile(resolved.items, { food: parsed.food, confidence: parsed.confidence });
  rec.fdcStats = resolved.stats;
  rec._parsedItems = parsed.items; // kept for a potential verify pass
  return rec;
}

// Main entry. TIERED MODEL STRATEGY (cost control): pass 1 runs on the CHEAP model
// (Haiku by default). We only escalate to the STRONG model (Sonnet) when the cheap
// pass produces numbers the reconciler doesn't trust — low confidence or physically
// inconsistent macros. Most clean meals never touch Sonnet, so average photo cost
// drops from "~5× every photo" to "~2-3× on average, full accuracy on the hard ones."
//
// `deps` may provide { cheapModel, strongModel }. Falls back to currentModelId()
// for both (so callers that don't opt into tiering keep single-model behavior).
export async function analyzeFood({
  description, imageBase64, imageMediaType, useWeb = false, model,
}, deps) {
  const { currentModelId, resolveImpl = resolveItems } = deps;
  const d = { ...deps, resolveImpl };
  const isImage = !!imageBase64;

  // If the caller pins a model explicitly, use it for both tiers (no escalation).
  const cheapModel = model || deps.cheapModel || currentModelId();
  const strongModel = model || deps.strongModel || cheapModel;

  const identSystem = identifySystemPrompt({ isImage, useWeb });
  const identUser = description
    ? `Identify and portion every food in: "${description}".${useWeb ? " Search for official data if branded/restaurant." : ""}`
    : `Identify and portion EVERY food item in this image.${useWeb ? " Search official nutrition facts for any branded/restaurant dish." : ""}`;

  // ── TIER 1: identify + portion on the cheap model ───────────────────────
  let rec = await identifyPass(
    { model: cheapModel, system: identSystem, userText: identUser, imageBase64, imageMediaType, useWeb },
    d
  );
  if (!rec) return null;
  rec.tier = "cheap";

  // ── TIER 2: escalate to the strong model ONLY when the cheap pass is shaky ──
  const canEscalate = strongModel !== cheapModel;
  if (canEscalate && needsVerify(rec)) {
    const problem = rec.flags.map(f => f.msg).join(" ") || "Low-confidence estimate.";
    // Fresh identification on the strong model — not a critique of the cheap pass.
    // If Haiku misjudged the plate, we want Sonnet's own eyes, not Sonnet reasoning
    // about Haiku's mistake. We hand over the flagged problem + prior items as a hint.
    const verifyUser = `${identUser}\n\nA faster model already tried and its numbers were flagged: ${problem}\nIts items were: ${JSON.stringify(rec._parsedItems)}\nRe-identify and re-portion carefully; fix what's wrong so the macros are physically consistent.`;
    try {
      const rec2 = await identifyPass(
        { model: strongModel, system: verifySystemPrompt(), userText: verifyUser, imageBase64, imageMediaType, useWeb },
        d
      );
      if (rec2) {
        rec2.tier = "strong";
        rec2.verified = true;
        // Keep the strong pass only if it's at least as clean as the cheap one.
        if (rec2.flags.length <= rec.flags.length) rec = rec2;
      }
    } catch { /* keep the cheap-tier result */ }
  }

  delete rec._parsedItems;
  return sanitizeAIResult(rec) && rec;
}
