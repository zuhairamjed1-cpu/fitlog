// ─── FDC RESOLVER (client) ──────────────────────────────────────────────────
// Turns AI-identified items ({ food, fdcQuery, grams, gramsRange, ...ai macros })
// into DB-grounded items priced from USDA FoodData Central via /api/fdc.
//
// Contract with mealValidation:
//   - On a DB hit  → item.source = "usda", macros come from FDC × grams.
//   - On a miss    → item.source = "ai",   macros fall back to the AI estimate.
//   - gramsRange is preserved so mealValidation can derive a calorie range.
//
// Caching: a localStorage layer keyed by normalized query keeps identical foods
// from re-hitting the network (the audit flagged zero caching). Safe-guarded so
// a storage failure never breaks resolution.

const LS_KEY = "fitlog_fdc_cache_v1";
const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30d

function norm(q) { return String(q || "").toLowerCase().replace(/\s+/g, " ").trim(); }

function loadCache() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}
function saveCache(c) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* quota / private mode — ignore */ }
}

// Scale a cached per-100g record to the item's grams.
function scaleFrom(per100, grams) {
  if (!per100 || !(grams > 0)) return null;
  return {
    calories: Math.round(per100.cal * grams / 100),
    protein: Math.round(per100.protein * grams / 100),
    carbs: Math.round(per100.carbs * grams / 100),
    fat: Math.round(per100.fat * grams / 100),
  };
}

// Build the resolved item in mealValidation's shape.
function resolvedItem(aiItem, per100, matched) {
  const grams = Number(aiItem.grams) > 0 ? Number(aiItem.grams) : null;
  const scaled = scaleFrom(per100, grams);
  if (!scaled) {
    // DB hit but no grams — can't scale; keep AI macros, note the match for display.
    return { ...aiItem, source: "ai", fdcMatch: matched?.description || null };
  }
  return {
    food: aiItem.food,
    grams,
    gramsRange: aiItem.gramsRange || [grams, grams],
    calories: scaled.calories,
    protein: scaled.protein,
    carbs: scaled.carbs,
    fat: scaled.fat,
    source: "usda",
    confidence: aiItem.confidence || null,
    hidden: !!aiItem.hidden,
    fdcMatch: matched?.description || null,
    fdcId: matched?.fdcId || null,
  };
}

// Fallback: keep the AI's own numbers, tagged as an estimate.
function aiFallback(aiItem) {
  const grams = Number(aiItem.grams) > 0 ? Number(aiItem.grams) : null;
  return {
    food: aiItem.food,
    ...(grams != null ? { grams, gramsRange: aiItem.gramsRange || [grams, grams] } : {}),
    calories: Number(aiItem.calories) || 0,
    protein: Number(aiItem.protein) || 0,
    carbs: Number(aiItem.carbs) || 0,
    fat: Number(aiItem.fat) || 0,
    source: "ai",
    confidence: aiItem.confidence || null,
    hidden: !!aiItem.hidden,
  };
}

// Resolve a list of AI items against FDC. Returns { items, stats }.
// Never throws — on total network failure, every item falls back to AI.
export async function resolveItems(aiItems, { fetchImpl = fetch } = {}) {
  const items = Array.isArray(aiItems) ? aiItems : [];
  if (!items.length) return { items: [], stats: { resolved: 0, missed: 0, total: 0 } };

  const cache = loadCache();
  const out = new Array(items.length);
  const toFetch = []; // { i, query }

  // 1) serve from cache
  items.forEach((it, i) => {
    const q = norm(it.fdcQuery || it.food);
    // hidden-fat lines (oil/butter guesses) skip the DB — they're intentional
    // AI estimates, not lookups. Keep them as-is.
    if (it.hidden) { out[i] = aiFallback(it); return; }
    const c = cache[q];
    if (c && Date.now() - c.at < TTL_MS && c.per100) {
      out[i] = resolvedItem(it, c.per100, c.matched);
    } else {
      toFetch.push({ i, query: q, grams: Number(it.grams) > 0 ? Number(it.grams) : null });
    }
  });

  // 2) batch-resolve the misses via the serverless proxy
  if (toFetch.length) {
    let results = null;
    try {
      const resp = await fetchImpl("/api/fdc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: toFetch.map(t => ({ query: t.query, grams: t.grams })) }),
      });
      if (resp.ok) results = (await resp.json()).results;
    } catch { /* fall through → AI fallback below */ }

    toFetch.forEach((t, k) => {
      const r = results && results[k];
      const aiItem = items[t.i];
      if (r && r.source === "usda" && r.per100) {
        cache[t.query] = { at: Date.now(), per100: r.per100, matched: r.matched };
        out[t.i] = resolvedItem(aiItem, r.per100, r.matched);
      } else {
        out[t.i] = aiFallback(aiItem); // miss or error → keep AI estimate
      }
    });
    saveCache(cache);
  }

  const resolved = out.filter(it => it.source === "usda").length;
  return {
    items: out,
    stats: { resolved, missed: out.length - resolved, total: out.length },
  };
}
