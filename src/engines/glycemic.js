// ─── GLYCEMIC LOAD ESTIMATION ───────────────────────────────────────────────
// Honest by construction. This is NOT a lab-measured glycemic index and NOT your
// blood glucose. True GI requires standardized testing of each food; we don't
// have that. What we DO have is the carbs you logged — and carb QUANTITY is the
// dominant driver of glycemic load (GL), the meal-level metric that actually
// matters more than GI. So we estimate:
//     GL ≈ effectiveGI × carbs / 100
// where effectiveGI starts from a coarse food-type heuristic (keyword match on
// the meal name) and is then BLUNTED by the protein + fat in the same meal,
// which slow gastric emptying and flatten the spike. Always shown as an estimate.

const GI_HIGH_RE = /\b(white rice|jasmine rice|sticky rice|fried rice|white bread|bagel|baguette|naan|roti|potato|mashed|fries|chips|crisps|corn ?flakes|cereal|granola|sugar|candy|sweets|soda|cola|soft drink|juice|\boj\b|smoothie|honey|jam|jelly|donut|doughnut|cake|cookie|biscuit|pastry|croissant|muffin|pretzel|cracker|rice cake|watermelon|pineapple|mango|dates|raisin|maple|syrup|gatorade|sports drink|energy drink|ice cream|pizza|pasta|noodle|ramen)\b/i;
const GI_LOW_RE = /\b(lentil|chickpea|chick pea|bean|kidney|hummus|oat|oatmeal|porridge|steel ?cut|quinoa|barley|bulgur|sweet potato|yam|berry|berries|strawberr|blueberr|raspberr|apple|pear|orange|cherry|plum|peach|grapefruit|yogurt|yoghurt|greek yog|milk|nut|almond|peanut|walnut|cashew|pistachio|avocado|broccoli|spinach|kale|lettuce|salad|greens|cucumber|tomato|pepper|carrot|cauliflower|zucchini|courgette|asparagus|cabbage|mushroom|\begg|chicken|beef|steak|pork|lamb|fish|salmon|tuna|shrimp|tofu|tempeh|cheese|cottage)\b/i;

export function estimateMealGI(meal) {
  const name = `${meal.food || meal.name || meal.label || meal.text || ""}`;
  if (GI_HIGH_RE.test(name)) return { gi: 70, cls: "high" };
  if (GI_LOW_RE.test(name)) return { gi: 38, cls: "low" };
  return { gi: 55, cls: "medium" };
}

// Per-meal estimated glycemic load. Returns hasCarbs:false when there's no carb
// data to work from (we don't invent a number in that case).
export function estimateGlycemicLoad(meal) {
  const carbs = Math.max(0, meal?.carbs || 0);
  if (carbs <= 0) return { gl: 0, band: "none", gi: null, hasCarbs: false };
  const { gi, cls } = estimateMealGI(meal);
  const protein = Math.max(0, meal.protein || 0);
  const fat = Math.max(0, meal.fat || 0);
  // protein + fat alongside the carbs slows absorption — cap the blunt at 30%.
  const blunt = Math.min(1, (protein + fat) / Math.max(carbs, 1));
  const effGI = gi * (1 - 0.3 * blunt);
  const gl = Math.round((effGI * carbs) / 100);
  const band = gl < 10 ? "low" : gl < 20 ? "moderate" : "high";
  return { gl, band, gi: Math.round(effGI), giClass: cls, blunted: blunt > 0.45, hasCarbs: true };
}

// Day total. Daily bands are deliberately loose (rough guidance, not a standard).
export function dayGlycemicLoad(meals) {
  let total = 0, any = false;
  (meals || []).forEach(m => { const r = estimateGlycemicLoad(m); if (r.hasCarbs) { total += r.gl; any = true; } });
  const band = !any ? "none" : total < 80 ? "low" : total <= 120 ? "moderate" : "high";
  return { total, band, hasData: any };
}
