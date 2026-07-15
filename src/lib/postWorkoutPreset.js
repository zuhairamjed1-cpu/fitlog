// ─── POST-WORKOUT QUICK-LOG PRESET ──────────────────────────────────────────
// Whole-food fast-shake reference meal (spec §5.1). Numbers are estimates, not
// lab-precise — never present as exact. Seed data; editable per-item in the UI.

export const POST_WORKOUT_PRESET = {
  items: [
    { id: "whey", name: "Whey protein", unit: "scoop", defaultQty: 2, checked: true,
      macrosPerUnit: { proteinG: 24, glucoseG: 0, fructoseG: 0 } },
    { id: "yogurt", name: "Greek yogurt", unit: "1/2 cup", defaultQty: 1, checked: true,
      macrosPerUnit: { proteinG: 11, glucoseG: 0, fructoseG: 0 } },
    { id: "banana", name: "Banana", unit: "whole", defaultQty: 1, checked: true,
      macrosPerUnit: { proteinG: 1, glucoseG: 7, fructoseG: 8 } },
    { id: "bread", name: "White bread", unit: "slice", defaultQty: 2, checked: false,
      macrosPerUnit: { proteinG: 3, glucoseG: 11, fructoseG: 1 } },
    { id: "salt_honey", name: "Salt + honey, blended", unit: "serving", defaultQty: 1, checked: true,
      combined: true, note: "1/2 tsp salt, 1 tbsp honey, warm water",
      macrosPerUnit: { proteinG: 0, glucoseG: 7, fructoseG: 8, saltTsp: 0.5 } },
    { id: "fish_oil", name: "Liquid fish oil", unit: "dose", defaultQty: 1, checked: true,
      macrosPerUnit: { proteinG: 0, glucoseG: 0, fructoseG: 0, omega3Mg: 400 } },
  ],
  targets: {
    proteinG: { min: 50, max: null },
    glucoseG: { min: 30, max: 40 },
    fructoseG: { min: 15, max: 20 },
    saltTsp: { min: 0.5, max: null },
    omega3Mg: { min: 300, max: 500 },
  },
};

export const MICRO_KEYS = ["proteinG", "glucoseG", "fructoseG", "saltTsp", "omega3Mg"];

// Sum a micro across checked rows at current quantity (combined items = qty 1).
export function computeTotals(rows) {
  const t = { proteinG: 0, glucoseG: 0, fructoseG: 0, saltTsp: 0, omega3Mg: 0 };
  rows.forEach(r => {
    if (!r.checked) return;
    const q = r.combined ? 1 : (r.qty || 0);
    MICRO_KEYS.forEach(k => { t[k] += (r.macrosPerUnit[k] || 0) * q; });
  });
  // round sensibly (salt in 0.25 steps, others whole)
  t.saltTsp = Math.round(t.saltTsp * 4) / 4;
  ["proteinG", "glucoseG", "fructoseG", "omega3Mg"].forEach(k => { t[k] = Math.round(t[k]); });
  return t;
}

// Green when at/above the floor minimum (overshooting a max is not a fail — these
// are floors, not caps).
export const inRange = (current, target) => target != null && current >= (target.min || 0);

// Convert checked rows → the editable-item-table format the DietForm log pipeline
// expects: [{ food, calories, protein, carbs, fat }]. Carbs = glucose + fructose.
export function toLineItems(rows) {
  return rows.filter(r => r.checked && (r.combined || (r.qty || 0) > 0)).map(r => {
    const q = r.combined ? 1 : (r.qty || 0);
    const m = r.macrosPerUnit;
    const protein = Math.round((m.proteinG || 0) * q);
    const carbs = Math.round(((m.glucoseG || 0) + (m.fructoseG || 0)) * q);
    const fat = 0; // preset micros don't model fat; keep macro table honest
    return {
      food: `${r.name}${r.combined ? "" : ` ×${q} ${r.unit}`}`,
      calories: Math.round(protein * 4 + carbs * 4 + fat * 9),
      protein, carbs, fat,
    };
  });
}
