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

import { resolveItems } from "./fdcResolver";
import { reconcile, sanitizeAIResult } from "../engines/mealValidation";

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

// Main entry. `deps` injects callClaude + extractJSON + WEB_SEARCH_TOOL from the
// existing client so this module stays pure/testable and doesn't re-import them.
export async function analyzeFood({
  description, imageBase64, imageMediaType, useWeb = false, model,
}, deps) {
  const { callClaude, extractJSON, WEB_SEARCH_TOOL, currentModelId, resolveImpl = resolveItems } = deps;
  const isImage = !!imageBase64;
  const useModel = model || currentModelId();

  // ── PASS 1: identify + portion ──────────────────────────────────────────
  let parsed;
  try {
    const raw = await callClaude({
      model: useModel,
      maxTokens: useWeb ? 1800 : 1400,
      tools: useWeb ? WEB_SEARCH_TOOL : undefined,
      system: identifySystemPrompt({ isImage, useWeb }),
      userText: description
        ? `Identify and portion every food in: "${description}".${useWeb ? " Search for official data if branded/restaurant." : ""}`
        : `Identify and portion EVERY food item in this image.${useWeb ? " Search official nutrition facts for any branded/restaurant dish." : ""}`,
      imageBase64, imageMediaType,
    });
    parsed = parseItems(raw, extractJSON);
  } catch { parsed = null; }
  if (!parsed || !parsed.items.length) return null;

  // ── RESOLVE + RECONCILE ─────────────────────────────────────────────────
  const resolved1 = await resolveImpl(parsed.items);
  let rec = reconcile(resolved1.items, { food: parsed.food, confidence: parsed.confidence });
  rec.fdcStats = resolved1.stats;

  // ── PASS 2: verify, only if the numbers are suspicious ──────────────────
  if (needsVerify(rec)) {
    const problem = rec.flags.map(f => f.msg).join(" ") || "Low confidence estimate.";
    try {
      const raw2 = await callClaude({
        model: useModel,
        maxTokens: useWeb ? 1800 : 1400,
        tools: useWeb ? WEB_SEARCH_TOOL : undefined,
        system: verifySystemPrompt(),
        userText: `PROBLEM: ${problem}\n\nORIGINAL ITEMS:\n${JSON.stringify(parsed.items)}\n\n${description ? `The meal was described as: "${description}".` : "Re-examine the attached photo."} Fix the portions/items so the numbers are physically consistent.`,
        imageBase64, imageMediaType,
      });
      const parsed2 = parseItems(raw2, extractJSON);
      if (parsed2 && parsed2.items.length) {
        const resolved2 = await resolveImpl(parsed2.items);
        const rec2 = reconcile(resolved2.items, { food: parsed2.food || parsed.food, confidence: parsed2.confidence });
        rec2.fdcStats = resolved2.stats;
        rec2.verified = true;
        // Keep the verified pass only if it actually reduced flags; else keep pass 1.
        if (rec2.flags.length <= rec.flags.length) rec = rec2;
      }
    } catch { /* keep pass-1 result */ }
  }

  // Final shape matches what DietForm expects, plus the new metadata.
  return sanitizeAIResult(rec) && rec;
}
