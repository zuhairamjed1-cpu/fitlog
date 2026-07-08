import { describe, it, expect, vi } from "vitest";
import {
  parseDoseToGrams,
  supplementsToCreatineDays,
  isCreatine,
  GRAMS_PER_SERVING,
} from "./creatineIntakeAdapter";

const supp = (date, dose, extra = {}) => ({ id: date + dose, date, name: "Creatine Monohydrate", dose, ...extra });

describe("isCreatine", () => {
  it("matches on name or brand, case-insensitive", () => {
    expect(isCreatine({ name: "Creatine Monohydrate" })).toBe(true);
    expect(isCreatine({ name: "Whey", brand: "Bulk Creatine" })).toBe(true);
    expect(isCreatine({ name: "Vitamin D" })).toBe(false);
  });
});

describe("parseDoseToGrams — unit conversion", () => {
  it("grams and bare numbers", () => {
    expect(parseDoseToGrams("5 g")).toBe(5);
    expect(parseDoseToGrams("5g")).toBe(5);
    expect(parseDoseToGrams("5")).toBe(5);
    expect(parseDoseToGrams("3.5 grams")).toBe(3.5);
  });
  it("milligrams → grams", () => {
    expect(parseDoseToGrams("500 mg")).toBe(0.5);
    expect(parseDoseToGrams("2000mg")).toBe(2);
  });
  it("scoops/servings → grams via GRAMS_PER_SERVING", () => {
    expect(parseDoseToGrams("1 scoop")).toBe(GRAMS_PER_SERVING);
    expect(parseDoseToGrams("2 servings")).toBe(2 * GRAMS_PER_SERVING);
    expect(parseDoseToGrams("1 scoop", 3)).toBe(3);
  });
  it("empty / unparseable → 0", () => {
    expect(parseDoseToGrams("")).toBe(0);
    expect(parseDoseToGrams(null)).toBe(0);
    expect(parseDoseToGrams("a lot")).toBe(0);
  });
  it("unknown unit → warns and treats the number as grams", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseDoseToGrams("2 caps")).toBe(2);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("supplementsToCreatineDays", () => {
  it("returns [] when no creatine ever logged (new user)", () => {
    expect(supplementsToCreatineDays([], { today: "2026-01-10" })).toEqual([]);
    expect(supplementsToCreatineDays([{ name: "Whey", dose: "30 g", date: "2026-01-01" }], { today: "2026-01-10" }))
      .toEqual([]);
  });

  it("sums multiple same-day doses into one day", () => {
    const days = supplementsToCreatineDays([
      supp("2026-01-01", "5 g"), supp("2026-01-01", "5 g"),
      supp("2026-01-01", "5 g"), supp("2026-01-01", "5 g"),
    ], { today: "2026-01-01" });
    expect(days).toEqual([{ date: "2026-01-01", doseGrams: 20 }]);
  });

  it("gap-fills missing days as zero (continuous series)", () => {
    const days = supplementsToCreatineDays([
      supp("2026-01-01", "5 g"), supp("2026-01-04", "5 g"),
    ], { today: "2026-01-04" });
    expect(days.map(d => d.doseGrams)).toEqual([5, 0, 0, 5]);
    expect(days.map(d => d.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  });

  it("extends the series to today with trailing zeros", () => {
    const days = supplementsToCreatineDays([supp("2026-01-01", "5 g")], { today: "2026-01-03" });
    expect(days).toEqual([
      { date: "2026-01-01", doseGrams: 5 },
      { date: "2026-01-02", doseGrams: 0 },
      { date: "2026-01-03", doseGrams: 0 },
    ]);
  });

  it("sorts out-of-order entries chronologically", () => {
    const days = supplementsToCreatineDays([
      supp("2026-01-03", "3 g"), supp("2026-01-01", "1 g"), supp("2026-01-02", "2 g"),
    ], { today: "2026-01-03" });
    expect(days).toEqual([
      { date: "2026-01-01", doseGrams: 1 },
      { date: "2026-01-02", doseGrams: 2 },
      { date: "2026-01-03", doseGrams: 3 },
    ]);
  });

  it("buckets by the stored local date, and by local date of ts when date is absent", () => {
    // ts at 23:30 local on 2026-01-02; entry has no `date` field.
    const ts = new Date(2026, 0, 2, 23, 30).getTime();
    const days = supplementsToCreatineDays([
      { name: "Creatine", dose: "5 g", ts },
    ], { today: "2026-01-02" });
    expect(days).toEqual([{ date: "2026-01-02", doseGrams: 5 }]);
  });

  it("caps history to the lookback window", () => {
    const days = supplementsToCreatineDays([
      supp("2026-01-01", "5 g"), supp("2026-03-30", "5 g"),
    ], { today: "2026-03-31", lookbackDays: 7 });
    expect(days.length).toBe(7);
    expect(days[0].date).toBe("2026-03-25"); // 7-day window ending 2026-03-31
    expect(days[days.length - 1].date).toBe("2026-03-31");
  });
});
