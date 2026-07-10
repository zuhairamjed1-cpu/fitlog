export const ATWATER = { protein: 4, carbs: 4, fat: 9 };
export function num(v) {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function normRange(point, range) {
  const p = num(point);
  if (!Array.isArray(range) || range.length !== 2) return [p, p];
  let lo = num(range[0]), hi = num(range[1]);
  if (hi < lo) [lo, hi] = [hi, lo];
  return [Math.min(lo, p), Math.max(hi, p)];
}
export function sanitizeItem(it = {}) {
  const calories = num(it.calories), protein = num(it.protein), carbs = num(it.carbs), fat = num(it.fat);
  const grams = it.grams != null ? num(it.grams) : null;
  const out = {
    food: (it.food || it.name || "").toString().trim(),
    calories, protein, carbs, fat,
    source: it.source || "ai", confidence: it.confidence || null, hidden: !!it.hidden,
  };
  if (grams != null) { out.grams = grams; out.gramsRange = normRange(grams, it.gramsRange); }
  if (Array.isArray(it.caloriesRange) && it.caloriesRange.length === 2) {
    out.caloriesRange = normRange(calories, it.caloriesRange);
  } else if (out.grams && out.grams > 0) {
    const perG = calories / out.grams;
    out.caloriesRange = [Math.round(perG * out.gramsRange[0]), Math.round(perG * out.gramsRange[1])];
  } else { out.caloriesRange = [calories, calories]; }
  return out;
}
export function sanitizeItems(items) { return (Array.isArray(items) ? items : []).map(sanitizeItem); }
export function sumItems(items) {
  return sanitizeItems(items).reduce((a, it) => ({
    calories: a.calories + it.calories, protein: a.protein + it.protein,
    carbs: a.carbs + it.carbs, fat: a.fat + it.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}
export function sumRanges(items) {
  const r = sanitizeItems(items).reduce((a, it) => ({ lo: a.lo + it.caloriesRange[0], hi: a.hi + it.caloriesRange[1] }), { lo: 0, hi: 0 });
  return [Math.round(r.lo), Math.round(r.hi)];
}
export function atwaterCheck(macros, tolerancePct = 15) {
  const predicted = num(macros.protein) * ATWATER.protein + num(macros.carbs) * ATWATER.carbs + num(macros.fat) * ATWATER.fat;
  const stated = num(macros.calories);
  if (stated <= 0 && predicted <= 0) return { ok: true, predicted: 0, stated: 0, deltaPct: 0 };
  const deltaPct = Math.round(Math.abs(predicted - stated) / Math.max(stated, 1) * 100);
  return { ok: deltaPct <= tolerancePct, predicted: Math.round(predicted), stated, deltaPct };
}
const SANE = { itemKcal: 1500, mealKcal: 4000, itemProteinG: 250 };
export function reconcile(rawItems, { food = "", notes = "", confidence = null } = {}) {
  const items = sanitizeItems(rawItems).filter(it => it.food || it.calories > 0);
  const totals = sumItems(items);
  const range = sumRanges(items);
  const atwater = atwaterCheck(totals);
  const flags = [];
  if (!atwater.ok) flags.push({ level: "warn", code: "atwater", msg: `Macros imply ~${atwater.predicted} kcal but the total says ${atwater.stated} (${atwater.deltaPct}% off). Check portions.` });
  if (totals.calories > SANE.mealKcal) flags.push({ level: "warn", code: "meal_high", msg: `${totals.calories} kcal is very high for one meal.` });
  items.forEach((it, i) => {
    if (it.calories > SANE.itemKcal) flags.push({ level: "warn", code: "item_high", item: i, msg: `"${it.food}" at ${it.calories} kcal looks high.` });
    if (it.protein > SANE.itemProteinG) flags.push({ level: "warn", code: "item_protein", item: i, msg: `"${it.food}" at ${it.protein}g protein looks off.` });
  });
  const rank = { low: 0, medium: 1, high: 2 };
  const itemConfs = items.map(i => i.confidence).filter(Boolean);
  const rolledConf = confidence || (itemConfs.length ? itemConfs.reduce((a, b) => (rank[b] < rank[a] ? b : a)) : null);
  const anyAI = items.some(it => it.source === "ai");
  const allResolved = items.length > 0 && items.every(it => ["usda", "branded", "barcode"].includes(it.source));
  return { food, notes, items, ...totals, calorieRange: range, confidence: rolledConf, atwater, flags, resolved: allResolved, hasEstimated: anyAI, ok: flags.every(f => f.level !== "error") };
}
export function sanitizeAIResult(r) {
  if (!r || typeof r !== "object") return null;
  const items = Array.isArray(r.items) && r.items.length ? r.items : [{ food: r.food, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat }];
  const rec = reconcile(items, { food: r.food || "", notes: r.notes || "", confidence: r.confidence || null });
  if (rec.calories <= 0 && rec.items.every(it => it.calories <= 0)) return null;
  return rec;
}
