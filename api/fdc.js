// ─── USDA FOODDATA CENTRAL PROXY ────────────────────────────────────────────
// Serverless function (Vercel) that fronts the USDA FDC API so the FDC key stays
// server-side, mirroring the security posture of /api/chat.js. The browser POSTs
// a batch of { query, grams } items; we search FDC, pick the best per-100g match,
// and return normalized per-100g macros + the scaled per-item macros.
//
// FDC is free (data.gov key). We DO NOT trust the client for anything but the
// search terms + grams. No AI numbers touch this file — resolution is DB-only.
//
// ENV: FDC_API_KEY (required). Get one at https://fdc.nal.usda.gov/api-key-signup

const FDC_SEARCH = "https://api.nal.usda.gov/fdc/v1/foods/search";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
const MAX_ITEMS = 30;          // one meal's worth of line items
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30d — nutrition data is static

// Warm-instance memo. Not durable, but cuts repeat FDC calls within an instance.
const _cache = new Map(); // key: normalized query → { at, food }

// Prefer data types in this order: SR Legacy + Foundation are lab-analyzed and
// cleanest; Survey (FNDDS) covers mixed/prepared dishes; Branded last (noisy).
const TYPE_RANK = { sr_legacy_food: 0, foundation_food: 1, survey_fndds_food: 2, branded_food: 3 };
const DATATYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"];

function normKey(q) { return String(q || "").toLowerCase().replace(/\s+/g, " ").trim(); }

// Pull the four macros (per 100g) out of an FDC food's nutrient array.
// FDC nutrient numbers: 208 kcal, 203 protein, 204 fat, 205 carbs.
function macrosPer100(food) {
  const by = {};
  const arr = food.foodNutrients || [];
  for (const n of arr) {
    const num = n.nutrientNumber || n.nutrient?.number;
    const val = n.value ?? n.amount;
    if (num != null && val != null) by[String(num)] = val;
  }
  const cal = by["208"];
  if (cal == null) return null; // no energy → unusable
  return {
    cal: Math.round(cal),
    protein: Math.round(by["203"] ?? 0),
    carbs: Math.round(by["205"] ?? 0),
    fat: Math.round(by["204"] ?? 0),
  };
}

// Score a candidate: prefer cleaner data types, then closer name matches.
function pickBest(foods, query) {
  const q = normKey(query);
  const scored = [];
  for (const f of foods) {
    const per100 = macrosPer100(f);
    if (!per100) continue;
    const desc = normKey(f.description);
    const typeRank = TYPE_RANK[f.dataType?.toLowerCase().replace(/[()\s]+/g, "_").replace(/_+$/, "")] ?? 5;
    // crude relevance: exact-ish desc match beats partial; shorter desc (less
    // qualified) usually = the base food the user meant.
    let rel = 0;
    if (desc === q) rel = 0;
    else if (desc.startsWith(q)) rel = 1;
    else if (desc.includes(q)) rel = 2;
    else rel = 3;
    scored.push({ f, per100, score: typeRank * 10 + rel * 2 + Math.min(4, desc.length / 40) });
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

async function resolveOne(item, key) {
  const query = normKey(item.query);
  const grams = Number(item.grams) > 0 ? Number(item.grams) : null;
  if (!query) return { query: item.query, grams, matched: null, source: "none" };

  const ck = query;
  let food = null;
  const hit = _cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) food = hit.food;

  if (!food) {
    const url = `${FDC_SEARCH}?api_key=${encodeURIComponent(key)}`;
    const body = {
      query,
      dataType: DATATYPES,
      pageSize: 10,
      requireAllWords: false,
    };
    let resp;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return { query: item.query, grams, matched: null, source: "error", error: "fetch_failed" };
    }
    if (!resp.ok) return { query: item.query, grams, matched: null, source: "error", error: `fdc_${resp.status}` };
    const data = await resp.json();
    food = pickBest(data.foods || [], query);
    if (food) _cache.set(ck, { at: Date.now(), food });
  }

  if (!food) return { query: item.query, grams, matched: null, source: "miss" };

  // Scale to grams if we have them; else return per-100g only (client decides).
  const scaled = grams != null ? {
    cal: Math.round(food.per100.cal * grams / 100),
    protein: Math.round(food.per100.protein * grams / 100),
    carbs: Math.round(food.per100.carbs * grams / 100),
    fat: Math.round(food.per100.fat * grams / 100),
  } : null;

  return {
    query: item.query,
    grams,
    matched: { fdcId: food.fdcId, description: food.description, dataType: food.dataType },
    per100: food.per100,
    scaled,
    source: "usda",
  };
}

export default async function handler(req, res) {
  // CORS / origin guard — same posture as /api/chat.js
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: "origin_not_allowed" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const key = process.env.FDC_API_KEY;
  if (!key) return res.status(500).json({ error: "fdc_key_missing" });

  let items;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    items = body?.items;
  } catch { return res.status(400).json({ error: "bad_json" }); }
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "no_items" });
  if (items.length > MAX_ITEMS) items = items.slice(0, MAX_ITEMS);

  try {
    const results = await Promise.all(items.map(it => resolveOne(it, key)));
    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: "resolve_failed" });
  }
}
