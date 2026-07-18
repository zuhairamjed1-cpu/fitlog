// ─── PRE-WORKOUT QUICK-LOG PRESET (§10.5) ───────────────────────────────────
// Mirrors the post-workout preset, but carb-defined for the 60–100g pre floor.
// Fast-digesting fructose-heavy recipe for a ~30-min pre-workout window.
// (Note: bananas + honey + OJ are all fructose-heavy — documented, not enforced.)

export const PRE_WORKOUT_PRESET = {
  items: [
    { id: "banana", name: "Banana", unit: "medium", defaultQty: 2, checked: true, carbsPerUnit: 27 },
    { id: "honey", name: "Honey", unit: "tbsp", defaultQty: 1, checked: true, carbsPerUnit: 17 },
    { id: "oj", name: "Orange juice", unit: "cup (240ml)", defaultQty: 1, checked: true, carbsPerUnit: 26 },
  ],
  target: { carbsG: { min: 60, max: 100 } }, // the pre-workout carb floor
};

// Sum carbs across checked rows at current quantity.
export function computeCarbs(rows) {
  return Math.round(rows.reduce((c, r) => c + (r.checked ? (r.carbsPerUnit || 0) * (r.qty || 0) : 0), 0));
}

// Green at/above the floor minimum (a load, not a cap — overshoot isn't a fail).
export const inCarbRange = (current, target) => target != null && current >= (target.min || 0);

// Convert checked rows → the editable-item-table shape the DietForm pipeline
// expects: [{ food, calories, protein, carbs, fat }]. Carb-only preset.
export function toLineItems(rows) {
  return rows.filter(r => r.checked && (r.qty || 0) > 0).map(r => {
    const q = r.qty || 0;
    const carbs = Math.round((r.carbsPerUnit || 0) * q);
    return { food: `${r.name} ×${q} ${r.unit}`, calories: Math.round(carbs * 4), protein: 0, carbs, fat: 0 };
  });
}
