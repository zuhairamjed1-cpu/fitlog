import { describe, it, expect } from "vitest";
import { stepDay, saturationSeries, washoutProjection, doseGrams } from "./creatine";

const firstDayAtLeast = (series, thresh) => series.findIndex(s => s >= thresh) + 1; // 1-based; 0 => never
const fullSat = () => {
  // 6 days loading @20g then 20 days @5g → effectively saturated
  const s = saturationSeries([...Array(6).fill(20), ...Array(20).fill(5)]);
  return s[s.length - 1];
};

describe("creatine saturation — empirical anchors (±~15%)", () => {
  it("20 g/day from empty → ≥95% saturated in 5–7 days", () => {
    const s = saturationSeries(Array(10).fill(20));
    const day = firstDayAtLeast(s, 0.95);
    expect(day).toBeGreaterThanOrEqual(4);
    expect(day).toBeLessThanOrEqual(8);
  });

  it("3 g/day from empty (no loading) → ≥95% in ~28 days (same ceiling, slower)", () => {
    const s = saturationSeries(Array(45).fill(3));
    const day = firstDayAtLeast(s, 0.95);
    expect(day).toBeGreaterThanOrEqual(22);
    expect(day).toBeLessThanOrEqual(34);
  });

  it("after full, stopping completely → <10% in ~4–6 weeks", () => {
    let s = fullSat();
    let day = 0;
    while (s >= 0.10 && day < 120) { s = stepDay(s, 0); day++; }
    expect(day).toBeGreaterThanOrEqual(24);
    expect(day).toBeLessThanOrEqual(46);
  });

  it("~2 g/day indefinitely holds full saturation", () => {
    // exact hold: at s=1, 2 g/day neither fills nor drains
    expect(stepDay(1, 2)).toBeCloseTo(1, 3);
    // and it stays full over a month from full
    let s = fullSat();
    for (let i = 0; i < 30; i++) s = stepDay(s, 2);
    expect(s).toBeGreaterThan(0.9);
  });
});

describe("washout projection thresholds (from full)", () => {
  const cross = washoutProjection(fullSat());
  it("orders the crossings 90% → 50% → 5%", () => {
    expect(cross.below90).toBeLessThan(cross.below50);
    expect(cross.below50).toBeLessThan(cross.below5);
  });
  it("fully unsaturated (<5%) in ~4–6 weeks", () => {
    expect(cross.below5).toBeGreaterThanOrEqual(24);
    expect(cross.below5).toBeLessThanOrEqual(46);
  });
  it("loses a meaningful chunk (<90%) within a few days", () => {
    expect(cross.below90).toBeGreaterThanOrEqual(1);
    expect(cross.below90).toBeLessThanOrEqual(10);
  });
});

describe("dose parsing", () => {
  it("reads grams from common dose strings", () => {
    expect(doseGrams("5 g")).toBe(5);
    expect(doseGrams("5g")).toBe(5);
    expect(doseGrams("1 scoop (5g)")).toBe(5);
    expect(doseGrams("3")).toBe(3);
    expect(doseGrams("")).toBe(0);
  });
});
