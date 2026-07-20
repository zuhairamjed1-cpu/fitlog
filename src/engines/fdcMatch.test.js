import { describe, it, expect } from "vitest";
import { macrosPer100, pickBest, crossCheck, KCAL_PER_100G_MAX } from "./fdcMatch";

// Helper: build an FDC-shaped food record.
const food = (description, dataType, nutrients) => ({
  fdcId: Math.floor(Math.random() * 1e6),
  description, dataType,
  foodNutrients: Object.entries(nutrients).map(([num, spec]) => ({
    nutrientNumber: num,
    unitName: spec.unit ?? (num === "208" ? "KCAL" : "G"),
    value: spec.v ?? spec,
  })),
});

describe("GATE 1 — energy unit", () => {
  it("accepts a KCAL energy value", () => {
    const m = macrosPer100(food("Chicken breast", "SR Legacy", { "208": { v: 165, unit: "KCAL" }, "203": 31, "205": 0, "204": 4 }));
    expect(m.cal).toBe(165);
  });
  it("REJECTS a kJ value masquerading as energy — the suspected pickle bug", () => {
    // 690 kJ = 165 kcal. Read as kcal it inflates the food 4.2x.
    const m = macrosPer100(food("Something", "Branded", { "208": { v: 690, unit: "KJ" }, "203": 5 }));
    expect(m).toBe(null);
  });
});

describe("GATE 2 — physics", () => {
  it("lets the 533 kcal/100g pickle through — physics alone CANNOT catch it", () => {
    // 533 < 900, so it's not physically impossible, just wrong. This is exactly
    // why gate 2 is insufficient on its own and the cross-check (gate 3) exists.
    const m = macrosPer100(food("Dill pickle slices", "Branded", { "208": { v: 533 }, "203": 0, "205": 2, "204": 0 }));
    expect(m.cal).toBe(533);          // passes physics...
    expect(crossCheck(m, { grams: 30, calories: 5 }).ok).toBe(false); // ...caught here
  });
  it("rejects anything denser than pure fat", () => {
    expect(macrosPer100(food("Bad record", "Branded", { "208": { v: 1200 } }))).toBe(null);
    expect(macrosPer100(food("Olive oil", "SR Legacy", { "208": { v: 884 }, "204": 100 })).cal).toBe(884);
  });
});

describe("name overlap — stops the broth/strips class of mismatch", () => {
  it("REJECTS 'Beef broth' for a 'beef stir-fried strips' query (the REAL 31-kcal failure)", () => {
    const candidates = [
      food("Beef broth, canned", "SR Legacy", { "208": { v: 26 }, "203": 2 }),      // 120g → 31 kcal. WRONG.
      food("Beef, strips, stir-fried", "SR Legacy", { "208": { v: 250 }, "203": 26, "204": 16 }),
    ];
    const best = pickBest(candidates, "beef stir-fried strips");
    expect(best.description).toMatch(/strips/i);
    expect(best.per100.cal).toBe(250); // not 26
  });
  it("returns null when nothing genuinely matches", () => {
    const candidates = [food("Cheese, cheddar", "SR Legacy", { "208": { v: 400 } })];
    expect(pickBest(candidates, "broccoli")).toBe(null);
  });
  it("prefers SR Legacy over Branded for the same food", () => {
    const candidates = [
      food("Broccoli, chopped, frozen", "Branded", { "208": { v: 35 } }),
      food("Broccoli, raw", "SR Legacy", { "208": { v: 34 } }),
    ];
    expect(pickBest(candidates, "broccoli").dataType).toBe("SR Legacy");
  });
});

describe("GATE 3 — cross-check vs the AI's own estimate", () => {
  it("CATCHES the 533 kcal/100g pickle (AI said ~17/100g)", () => {
    // AI: 30g pickle ≈ 5 kcal → 17 kcal/100g. FDC: 533. Ratio 32x → refuse.
    const r = crossCheck({ cal: 533 }, { grams: 30, calories: 5 });
    expect(r.ok).toBe(false);
    expect(r.ratio).toBeGreaterThan(10);
  });
  it("CATCHES the 223 kcal/100g broccoli (AI said ~35/100g)", () => {
    const r = crossCheck({ cal: 223 }, { grams: 160, calories: 56 });
    expect(r.ok).toBe(false);
  });
  it("CATCHES the 26 kcal/100g beef (AI said ~250/100g)", () => {
    const r = crossCheck({ cal: 26 }, { grams: 120, calories: 300 });
    expect(r.ok).toBe(false);
  });
  it("ACCEPTS a normal small disagreement — we don't want it trigger-happy", () => {
    // AI guessed 180 kcal/100g for chicken, FDC says 165. Fine.
    const r = crossCheck({ cal: 165 }, { grams: 200, calories: 360 });
    expect(r.ok).toBe(true);
    expect(r.ratio).toBeLessThan(1.5);
  });
  it("accepts the DB when the AI gave no usable estimate", () => {
    expect(crossCheck({ cal: 165 }, { grams: 0, calories: 0 }).ok).toBe(true);
  });
  it("is symmetric — catches disagreement in both directions", () => {
    expect(crossCheck({ cal: 400 }, { grams: 100, calories: 50 }).ok).toBe(false);  // DB too high
    expect(crossCheck({ cal: 50 }, { grams: 100, calories: 400 }).ok).toBe(false);  // DB too low
  });
});
