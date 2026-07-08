import { describe, it, expect } from "vitest";
import {
  computeSaturation,
  recommendedDose,
  needsLoading,
  isLoadingComplete,
  daysSinceLastDose,
  consecutiveDosingDays,
  DEFAULT_SETTINGS,
} from "./creatineModel";

const round = n => Math.round(n);
// Build a CreatineDay[] of `n` days each at `g` grams (dates are irrelevant to the model).
const week = (g, n) => Array.from({ length: n }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, doseGrams: g }));

describe("computeSaturation — literature anchors", () => {
  it("20 g/day loading → ≈99% by day 5", () => {
    const s = computeSaturation(week(20, 7), DEFAULT_SETTINGS);
    expect(round(s[4])).toBeGreaterThanOrEqual(97); // day 5 (0-based index 4)
    expect(round(s[4])).toBeLessThanOrEqual(100);
  });

  it("5 g/day steady → ≥90% plateau by ~day 28", () => {
    const s = computeSaturation(week(5, 28), DEFAULT_SETTINGS);
    expect(round(s[27])).toBeGreaterThanOrEqual(90); // day 28
    expect(round(s[27])).toBeLessThanOrEqual(100);
  });

  it("saturate then a 6-week gap of 0 g → back near baseline", () => {
    const days = [...week(20, 7), ...week(0, 42)];
    const s = computeSaturation(days, DEFAULT_SETTINGS);
    const final = round(s[s.length - 1]);
    expect(final).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.baselineSaturation); // never below baseline
    expect(final).toBeLessThan(72); // "near baseline" — inside the reload band
  });

  it("never drops below baseline and never exceeds MAX", () => {
    const days = [...week(20, 3), ...week(0, 10), ...week(50, 3)];
    const s = computeSaturation(days, DEFAULT_SETTINGS);
    for (const v of s) {
      expect(v).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.baselineSaturation);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe("needsLoading", () => {
  it("is true for a brand-new user (no history)", () => {
    expect(needsLoading([], 65)).toBe(true);
  });

  it("is true after a 3-day gap since the last dose", () => {
    const history = [...week(5, 5), ...week(0, 3)]; // last real dose 3 days ago
    expect(daysSinceLastDose(history)).toBe(3);
    expect(needsLoading(history, 90)).toBe(true);
  });

  it("is true when saturation has fallen near baseline", () => {
    const history = week(5, 5);
    expect(needsLoading(history, 70)).toBe(true);
  });

  it("is false when dosing recently and well-saturated", () => {
    const history = week(5, 10);
    expect(needsLoading(history, 94)).toBe(false);
  });
});

describe("isLoadingComplete", () => {
  it("requires ≥5 consecutive dosing days AND ≥95% saturation", () => {
    expect(isLoadingComplete(5, 95)).toBe(true);
    expect(isLoadingComplete(4, 99)).toBe(false);
    expect(isLoadingComplete(6, 94)).toBe(false);
  });

  it("consecutiveDosingDays counts the trailing dosing streak", () => {
    expect(consecutiveDosingDays([...week(0, 2), ...week(5, 4)])).toBe(4);
    expect(consecutiveDosingDays(week(0, 3))).toBe(0);
  });
});

// Note: dose-string parsing moved to creatineIntakeAdapter.test.js.

describe("recommendedDose", () => {
  it("defaults to 20 g loading / 5 g maintenance without body weight", () => {
    expect(recommendedDose(DEFAULT_SETTINGS, "loading")).toBe(20);
    expect(recommendedDose(DEFAULT_SETTINGS, "maintenance")).toBe(5);
  });

  it("scales with body weight and floors maintenance at 3 g", () => {
    expect(recommendedDose({ bodyWeightKg: 80 }, "loading")).toBe(24);   // 0.3 * 80
    expect(recommendedDose({ bodyWeightKg: 80 }, "maintenance")).toBe(3); // round(2.4) -> floor 3
    expect(recommendedDose({ bodyWeightKg: 100 }, "maintenance")).toBe(3);
  });
});
