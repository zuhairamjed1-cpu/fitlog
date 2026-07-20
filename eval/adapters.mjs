// ─── EVAL ADAPTERS ──────────────────────────────────────────────────────────
// Headless HTTP + model/pricing glue that run.mjs injects into the REAL pipeline
// (src/api/foodAnalysis.js). Talks DIRECTLY to Anthropic + USDA FoodData Central
// — no /api proxy — so the eval exercises the same identify→resolve→reconcile
// →verify logic the app uses, just with node-side transport.
//
// Requires Node 18+ (global fetch). Env keys are passed in by run.mjs.
import fs from "node:fs/promises";
import sharp from "sharp";

// Model ids — mirror src/config.js MODELS. run.mjs passes these as the pipeline's
// `model` (via --model) and as currentModelId() (default cheap = haiku).
// NOTE: config.js still ships "claude-sonnet-4-20250514", which 404s on this key.
// The eval points the strong tier at the current flagship Sonnet so runs work; the
// stale prod id is a separate fix (config.js MODELS + api/chat.js allowlist).
export const MODELS = { haiku: "claude-haiku-4-5", sonnet: "claude-sonnet-5" };

// Mirror src/api/client.jsx WEB_SEARCH_TOOL.
export const WEB_SEARCH_TOOL = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];

// Approximate public list prices, USD per 1M tokens (input / output). Update if
// Anthropic pricing changes — these only affect the cost columns, not accuracy.
const PRICES = {
  "claude-haiku-4-5":         { in: 1.0, out: 5.0 },
  "claude-sonnet-5":          { in: 3.0, out: 15.0 },
  "claude-sonnet-4-20250514": { in: 3.0, out: 15.0 },
};

export function priceCalls(calls) {
  let usd = 0;
  for (const c of calls || []) {
    const p = PRICES[c.model] || { in: 0, out: 0 };
    usd += ((c.inputTokens || 0) / 1e6) * p.in + ((c.outputTokens || 0) / 1e6) * p.out;
  }
  return usd;
}

// Read a meal photo → { base64, mediaType }. sharp normalizes EVERY input
// (jpg/jpeg/png/webp/AVIF) to a right-side-up JPEG ≤1280px — matching the app's
// fileToResizedBase64 (1280 / q0.85). This is required: Anthropic can't ingest
// AVIF, and phone EXIF orientation would otherwise send rotated frames.
export async function imageToBase64(filePath) {
  const out = await sharp(filePath)
    .rotate()                                                   // auto-orient from EXIF, then strip it
    .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { base64: out.toString("base64"), mediaType: "image/jpeg" };
}

// ── extractJSON — pure copy of src/api/client.jsx (no React import) ────────────
function scanBalancedObject(str) {
  const i = str.indexOf("{");
  if (i < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < str.length; j++) {
    const ch = str[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return str.slice(i, j + 1); }
  }
  return null;
}
export function extractJSON(raw) {
  if (!raw || typeof raw !== "string") throw new Error("Empty AI response");
  const fenceStripped = raw.replace(/```(?:json)?/gi, "").trim();
  let s = fenceStripped;
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  s = s.replace(/,\s*([}\]])/g, "$1");
  const tryParse = str => { try { return JSON.parse(str); } catch { return undefined; } };
  let r = tryParse(s);
  if (r !== undefined) return r;
  const sq = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  r = tryParse(sq);
  if (r !== undefined) return r;
  const salvaged = scanBalancedObject(fenceStripped.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
  if (salvaged) {
    r = tryParse(salvaged.replace(/,\s*([}\]])/g, "$1"));
    if (r !== undefined) return r;
  }
  throw new Error("Could not parse JSON from AI response");
}

// ── Claude call → concatenated text. Records token usage via onCall for pricing.
export function makeCallClaude({ apiKey, onCall }) {
  return async function callClaude({ system, userText, imageBase64, imageMediaType, maxTokens = 1000, tools, model }) {
    const content = imageBase64
      ? [{ type: "image", source: { type: "base64", media_type: imageMediaType, data: imageBase64 } }, { type: "text", text: userText }]
      : userText;
    const body = { model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] };
    if (tools) body.tools = tools;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.error) throw new Error(`anthropic: ${data.error.message || JSON.stringify(data.error)}`);
    if (onCall) onCall({ model, inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 });
    return (data.content || []).filter(b => b.type === "text").map(b => b.text || "").join("") || "";
  };
}

// ── USDA FDC resolver — mirrors api/fdc.js pickBest, with a JSON file cache ─────
const FDC_SEARCH = "https://api.nal.usda.gov/fdc/v1/foods/search";
const TYPE_RANK = { sr_legacy_food: 0, foundation_food: 1, survey_fndds_food: 2, branded_food: 3 };
const DATATYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"];
function normKey(q) { return String(q || "").toLowerCase().replace(/\s+/g, " ").trim(); }
function macrosPer100(food) {
  const by = {};
  for (const n of food.foodNutrients || []) {
    const num = n.nutrientNumber || n.nutrient?.number;
    const val = n.value ?? n.amount;
    if (num != null && val != null) by[String(num)] = val;
  }
  const cal = by["208"];
  if (cal == null) return null;
  return { cal: Math.round(cal), protein: Math.round(by["203"] ?? 0), carbs: Math.round(by["205"] ?? 0), fat: Math.round(by["204"] ?? 0) };
}
function pickBest(foods, query) {
  const q = normKey(query);
  const scored = [];
  for (const f of foods) {
    const per100 = macrosPer100(f);
    if (!per100) continue;
    const desc = normKey(f.description);
    const typeRank = TYPE_RANK[f.dataType?.toLowerCase().replace(/[()\s]+/g, "_").replace(/_+$/, "")] ?? 5;
    let rel = 3;
    if (desc === q) rel = 0; else if (desc.startsWith(q)) rel = 1; else if (desc.includes(q)) rel = 2;
    scored.push({ f, per100, score: typeRank * 10 + rel * 2 + Math.min(4, desc.length / 40) });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  return { fdcId: best.f.fdcId, description: best.f.description, dataType: best.f.dataType, per100: best.per100 };
}
function grounded(it, per100, matched, grams) {
  return {
    food: it.food, grams, gramsRange: it.gramsRange || [grams, grams],
    calories: Math.round((per100.cal * grams) / 100),
    protein: Math.round((per100.protein * grams) / 100),
    carbs: Math.round((per100.carbs * grams) / 100),
    fat: Math.round((per100.fat * grams) / 100),
    source: "usda", confidence: it.confidence || null, hidden: !!it.hidden,
    fdcMatch: matched?.description || null, fdcId: matched?.fdcId || null,
  };
}
function aiFallback(it) {
  const grams = Number(it.grams) > 0 ? Number(it.grams) : null;
  return {
    food: it.food, ...(grams != null ? { grams, gramsRange: it.gramsRange || [grams, grams] } : {}),
    calories: Number(it.calories) || 0, protein: Number(it.protein) || 0, carbs: Number(it.carbs) || 0, fat: Number(it.fat) || 0,
    source: "ai", confidence: it.confidence || null, hidden: !!it.hidden,
  };
}
// Returns a resolveImpl(aiItems) → { items, stats } matching fdcResolver's contract.
export function makeResolver({ apiKey, cachePath, onLookup }) {
  let cache = null;
  const load = async () => { if (cache) return cache; try { cache = JSON.parse(await fs.readFile(cachePath, "utf8")); } catch { cache = {}; } return cache; };
  const save = async () => { try { await fs.writeFile(cachePath, JSON.stringify(cache)); } catch { /* ignore */ } };
  return async function resolve(aiItems) {
    const items = Array.isArray(aiItems) ? aiItems : [];
    if (!items.length) return { items: [], stats: { resolved: 0, missed: 0, total: 0 } };
    const c = await load();
    const out = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const grams = Number(it.grams) > 0 ? Number(it.grams) : null;
      if (it.hidden) { out[i] = aiFallback(it); continue; }        // hidden-fat lines skip the DB
      const q = normKey(it.fdcQuery || it.food);
      let per100 = null, matched = null;
      const hit = c[q];
      if (hit && hit.per100) { per100 = hit.per100; matched = hit.matched; }
      else if (apiKey) {
        try {
          const resp = await fetch(`${FDC_SEARCH}?api_key=${encodeURIComponent(apiKey)}`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ query: q, dataType: DATATYPES, pageSize: 10, requireAllWords: false }),
          });
          if (resp.ok) {
            const data = await resp.json();
            const best = pickBest(data.foods || [], q);
            if (best) { per100 = best.per100; matched = { fdcId: best.fdcId, description: best.description, dataType: best.dataType }; c[q] = { per100, matched }; }
          }
        } catch { /* miss → AI fallback */ }
      }
      if (onLookup) onLookup({ query: q, hit: !!per100, match: matched?.description || null });
      out[i] = (per100 && grams) ? grounded(it, per100, matched, grams) : aiFallback(it);
    }
    await save();
    const resolved = out.filter(x => x.source === "usda").length;
    return { items: out, stats: { resolved, missed: out.length - resolved, total: out.length } };
  };
}
