import { describe, it, expect } from "vitest";
import { buildTimeline, TIGHT_GAP_THRESHOLD_MINUTES, MEAL_FLOOR_BUFFER_MINUTES, minToTime } from "./partitioning.js";

function zoneOf(startMin, dur = 60) {
  return { lo: (startMin - 45) - MEAL_FLOOR_BUFFER_MINUTES, hi: (startMin + dur + 15) + MEAL_FLOOR_BUFFER_MINUTES };
}

describe("flexible meals avoid the gym + pre/post floors", () => {
  for (const gym of ["11:00", "13:00", "16:00", "18:30"]) {
    it(`gym ${gym}: no flexible meal inside the padded training zone, no tight pairs`, () => {
      const r = buildTimeline({
        dayKey: "2026-07-20",
        totals: { carbsG: 250, proteinG: 180, fatG: 70 },
        sessions: [{ id: "g1", type: "strength", time: gym, durationMin: 60, intensity: "moderate" }],
        wakeMin: 7 * 60, sleepMin: 23 * 60,
      });
      const start = +gym.slice(0, 2) * 60 + +gym.slice(3);
      const z = zoneOf(start);
      const flex = r.slots.filter(s => s.type === "flexible");
      for (const m of flex) {
        expect(m.plannedMin > z.lo && m.plannedMin < z.hi, `${m.mealName}@${minToTime(m.plannedMin)} inside zone`).toBe(false);
      }
      // no flexible↔floor tight pair survives (they're spaced out now)
      const floorIds = new Set(r.slots.filter(s => s.type === "floor").map(s => s.id));
      const flexIds = new Set(flex.map(s => s.id));
      const flexFloorTight = r.tightPairs.filter(([a, b]) => (floorIds.has(a) && flexIds.has(b)) || (floorIds.has(b) && flexIds.has(a)));
      expect(flexFloorTight.length).toBe(0);
    });
  }

  it("preserves the daily macro invariant (Σ slots == target)", () => {
    const totals = { carbsG: 250, proteinG: 180, fatG: 70 };
    const r = buildTimeline({ dayKey: "2026-07-20", totals, sessions: [{ id: "g1", type: "strength", time: "13:00", durationMin: 60 }], wakeMin: 420, sleepMin: 1380 });
    for (const k of ["carbsG", "proteinG", "fatG"]) {
      const sum = r.slots.reduce((a, s) => a + s.macros[k], 0);
      expect(sum).toBe(totals[k]);
    }
  });
});
