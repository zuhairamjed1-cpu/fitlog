import { describe, it, expect } from "vitest";
import { num, atwaterCheck, sumItems, sumRanges, reconcile, sanitizeAIResult } from "./mealValidation";

describe("num", () => {
  it("coerces junk to 0", () => {
    for (const v of ["", null, undefined, NaN, -5]) expect(num(v)).toBe(0);
    expect(num("12.5")).toBe(12.5);
    expect(num(3)).toBe(3);
  });
});
describe("atwaterCheck", () => {
  it("passes a clean set", () => { expect(atwaterCheck({ calories: 370, protein: 40, carbs: 30, fat: 10 }).ok).toBe(true); });
  it("flags an impossible set", () => {
    const r = atwaterCheck({ calories: 1200, protein: 40, carbs: 30, fat: 10 });
    expect(r.ok).toBe(false); expect(r.deltaPct).toBeGreaterThan(50);
  });
  it("tolerates small gaps", () => { expect(atwaterCheck({ calories: 350, protein: 40, carbs: 30, fat: 10 }).ok).toBe(true); });
});
describe("sumItems / sumRanges", () => {
  const items = [
    { food: "chicken", calories: 300, protein: 56, carbs: 0, fat: 7, grams: 180, gramsRange: [150, 210] },
    { food: "rice", calories: 200, protein: 4, carbs: 44, fat: 0, grams: 150, gramsRange: [120, 180] },
  ];
  it("derives totals", () => { expect(sumItems(items)).toEqual({ calories: 500, protein: 60, carbs: 44, fat: 7 }); });
  it("derives a calorie range", () => { const [lo, hi] = sumRanges(items); expect(lo).toBeLessThan(500); expect(hi).toBeGreaterThan(500); });
});
describe("reconcile", () => {
  it("flags but surfaces a bad total", () => {
    const r = reconcile([{ food: "apple", calories: 5000, protein: 1, carbs: 25, fat: 0 }]);
    expect(r.flags.some(f => f.code === "atwater")).toBe(true);
    expect(r.flags.some(f => f.code === "meal_high")).toBe(true);
    expect(r.calories).toBe(5000);
  });
  it("marks resolved when db-sourced", () => {
    const r = reconcile([
      { food: "chicken", calories: 300, protein: 56, carbs: 0, fat: 7, source: "usda" },
      { food: "rice", calories: 200, protein: 4, carbs: 44, fat: 0, source: "usda" },
    ]);
    expect(r.resolved).toBe(true); expect(r.hasEstimated).toBe(false);
  });
  it("rolls confidence to weakest", () => {
    const r = reconcile([
      { food: "chicken", calories: 300, confidence: "high", source: "usda" },
      { food: "sauce", calories: 90, confidence: "low", source: "ai" },
    ]);
    expect(r.confidence).toBe("low"); expect(r.hasEstimated).toBe(true);
  });
});
describe("sanitizeAIResult", () => {
  it("rejects garbage", () => {
    expect(sanitizeAIResult(null)).toBe(null);
    expect(sanitizeAIResult({ items: [{ food: "x", calories: 0 }], food: "x" })).toBe(null);
  });
  it("accepts legacy single-total", () => {
    const r = sanitizeAIResult({ food: "toast", calories: 90, protein: 3, carbs: 16, fat: 1 });
    expect(r.calories).toBe(90); expect(r.items).toHaveLength(1);
  });
  it("recomputes totals when model lies", () => {
    const r = sanitizeAIResult({ food: "plate", calories: 9999, protein: 0, carbs: 0, fat: 0,
      items: [{ food: "eggs", calories: 140, protein: 12, carbs: 1, fat: 10 }, { food: "toast", calories: 90, protein: 3, carbs: 16, fat: 1 }] });
    expect(r.calories).toBe(230);
  });
});
