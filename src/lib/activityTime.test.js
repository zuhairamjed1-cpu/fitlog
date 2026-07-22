import { describe, it, expect } from "vitest";
import { TIMED_TYPES, isTimed, nowHHMM, addMinutesHHMM, rangeDurationMin, isValidRange, decorateWithTime } from "./activityTime.js";

describe("time-logging feature", () => {
  // 1 — only meal/workout/sport trigger the prompt; nothing else does
  it("gates the prompt to diet/exercise/sports only", () => {
    expect(["diet", "exercise", "sports"].every(isTimed)).toBe(true);
    expect(["water", "weight", "sleep", "nicotine", "supplements", "journal", "skin"].some(isTimed)).toBe(false);
    expect(TIMED_TYPES.size).toBe(3);
  });

  // 2 — a normal range computes the right duration
  it("computes duration for a same-day range", () => {
    expect(rangeDurationMin("16:00", "17:00")).toBe(60);
    expect(rangeDurationMin("12:38", "13:23")).toBe(45);
    expect(rangeDurationMin("09:15", "09:20")).toBe(5);
  });

  // 3 — a range crossing midnight wraps instead of going negative
  it("wraps a range past midnight", () => {
    expect(rangeDurationMin("23:30", "00:15")).toBe(45);
    expect(rangeDurationMin("22:00", "01:00")).toBe(180);
  });

  // 4 — equal start/end is a zero-minute range, not invalid
  it("treats equal start/end as 0 minutes", () => {
    expect(rangeDurationMin("08:00", "08:00")).toBe(0);
    expect(isValidRange("08:00", "08:00")).toBe(true);
  });

  // 5 — invalid / missing times yield null duration and block Save
  it("returns null and is invalid for bad input", () => {
    for (const [a, b] of [["", "10:00"], ["10:00", ""], ["25:00", "10:00"], ["10:70", "11:00"], ["abc", "def"], [undefined, undefined]]) {
      expect(rangeDurationMin(a, b)).toBeNull();
      expect(isValidRange(a, b)).toBe(false);
    }
  });

  // 6 — addMinutesHHMM (used to prefill End = Start + 45)
  it("adds minutes and wraps around midnight", () => {
    expect(addMinutesHHMM("12:38", 45)).toBe("13:23");
    expect(addMinutesHHMM("23:50", 45)).toBe("00:35");
    expect(addMinutesHHMM("00:10", -20)).toBe("23:50");
    expect(addMinutesHHMM("", 45)).toBe("");
  });

  // 7 — decorateWithTime attaches the range and sets time=start
  it("decorates an entry with the time range", () => {
    const entry = { id: 1, date: "2026-07-20", meal: "Lunch", calories: 700 };
    const out = decorateWithTime(entry, { timeStart: "13:00", timeEnd: "13:30" });
    expect(out).toMatchObject({ id: 1, calories: 700, time: "13:00", timeStart: "13:00", timeEnd: "13:30", durationMin: 30 });
  });

  // 8 — decoration is non-destructive (original entry untouched, fields preserved)
  it("does not mutate the original entry and keeps existing fields", () => {
    const entry = { id: 2, meal: "Dinner", protein: 40 };
    const out = decorateWithTime(entry, { timeStart: "19:00", timeEnd: "19:45" });
    expect(entry.time).toBeUndefined();       // original untouched
    expect(out.protein).toBe(40);             // existing field preserved
    expect(out).not.toBe(entry);              // new object
  });

  // 9 — decoration overrides any pre-existing time with the chosen start
  it("overrides a pre-existing time with timeStart", () => {
    const entry = { id: 3, time: "10:00", sport: "Basketball" };
    const out = decorateWithTime(entry, { timeStart: "18:30", timeEnd: "19:30" });
    expect(out.time).toBe("18:30");
    expect(out.durationMin).toBe(60);
  });

  // 10 — nowHHMM formats local wall-clock with zero-padding
  it("formats nowHHMM as zero-padded HH:MM", () => {
    expect(nowHHMM(new Date(2026, 6, 20, 9, 5))).toBe("09:05");
    expect(nowHHMM(new Date(2026, 6, 20, 23, 59))).toBe("23:59");
    expect(nowHHMM(new Date(2026, 6, 20, 0, 0))).toBe("00:00");
    expect(/^\d{2}:\d{2}$/.test(nowHHMM())).toBe(true);
  });
});
