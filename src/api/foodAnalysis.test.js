import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveItems } from "./fdcResolver";
import { analyzeFood } from "./foodAnalysis";

// jsdom provides localStorage in vitest's default env; clear between tests.
beforeEach(() => { try { localStorage.clear(); } catch {} });

// ─── fdcResolver ────────────────────────────────────────────────────────────
describe("resolveItems", () => {
  it("prices items from FDC and tags them usda", async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          { source: "usda", per100: { cal: 165, protein: 31, carbs: 0, fat: 4 }, matched: { fdcId: 1, description: "Chicken breast, grilled" } },
          { source: "usda", per100: { cal: 130, protein: 3, carbs: 28, fat: 0 }, matched: { fdcId: 2, description: "Rice, white, cooked" } },
        ],
      }),
    }));
    const ai = [
      { food: "chicken", fdcQuery: "chicken breast grilled", grams: 200, gramsRange: [170, 230], calories: 999 },
      { food: "rice", fdcQuery: "white rice cooked", grams: 150, gramsRange: [120, 180], calories: 999 },
    ];
    const { items, stats } = await resolveItems(ai, { fetchImpl: fakeFetch });
    expect(stats.resolved).toBe(2);
    // chicken: 165 * 200/100 = 330, NOT the AI's 999
    expect(items[0].calories).toBe(330);
    expect(items[0].source).toBe("usda");
    expect(items[1].calories).toBe(195); // 130 * 150/100
  });

  it("falls back to the AI estimate on a DB miss", async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ source: "miss" }] }),
    }));
    const ai = [{ food: "obscure regional dish", fdcQuery: "obscure dish", grams: 300, calories: 540, protein: 20, carbs: 60, fat: 22 }];
    const { items, stats } = await resolveItems(ai, { fetchImpl: fakeFetch });
    expect(stats.resolved).toBe(0);
    expect(items[0].source).toBe("ai");
    expect(items[0].calories).toBe(540); // kept the AI estimate
  });

  it("falls back to AI for every item when the network throws", async () => {
    const fakeFetch = vi.fn(async () => { throw new Error("offline"); });
    const ai = [{ food: "eggs", fdcQuery: "eggs", grams: 100, calories: 143, protein: 13, carbs: 1, fat: 10 }];
    const { items } = await resolveItems(ai, { fetchImpl: fakeFetch });
    expect(items[0].source).toBe("ai");
    expect(items[0].calories).toBe(143);
  });

  it("skips hidden-fat lines from DB lookup and keeps them as AI", async () => {
    const fakeFetch = vi.fn(async () => ({ ok: true, json: async () => ({ results: [] }) }));
    const ai = [{ food: "cooking oil (hidden)", grams: 14, calories: 120, fat: 14, hidden: true }];
    const { items } = await resolveItems(ai, { fetchImpl: fakeFetch });
    expect(fakeFetch).not.toHaveBeenCalled(); // nothing to fetch
    expect(items[0].source).toBe("ai");
    expect(items[0].hidden).toBe(true);
  });

  it("serves a repeat query from cache without a second fetch", async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ source: "usda", per100: { cal: 52, protein: 0, carbs: 14, fat: 0 }, matched: { fdcId: 9, description: "Apple, raw" } }] }),
    }));
    const ai = [{ food: "apple", fdcQuery: "apple raw", grams: 150 }];
    await resolveItems(ai, { fetchImpl: fakeFetch });
    await resolveItems(ai, { fetchImpl: fakeFetch });
    expect(fakeFetch).toHaveBeenCalledTimes(1); // second call hit the cache
  });
});

// ─── analyzeFood pipeline ───────────────────────────────────────────────────
function makeDeps({ pass1, pass2, resolve }) {
  let call = 0;
  return {
    currentModelId: () => "claude-sonnet-4-20250514",
    WEB_SEARCH_TOOL: [{ type: "web_search_20250305", name: "web_search" }],
    extractJSON: (s) => JSON.parse(s),
    callClaude: vi.fn(async () => {
      call += 1;
      return call === 1 ? JSON.stringify(pass1) : JSON.stringify(pass2 || pass1);
    }),
    resolveImpl: resolve,
  };
}

describe("analyzeFood", () => {
  it("returns DB-grounded totals from a clean single pass", async () => {
    const pass1 = {
      food: "chicken and rice",
      confidence: "high",
      items: [
        { food: "chicken", fdcQuery: "chicken breast", grams: 200, gramsRange: [180, 220], calories: 999, protein: 60, carbs: 0, fat: 8, confidence: "high" },
        { food: "rice", fdcQuery: "white rice cooked", grams: 150, gramsRange: [130, 170], calories: 999, protein: 3, carbs: 33, fat: 0, confidence: "high" },
      ],
    };
    const resolve = async (items) => ({
      items: items.map((it, i) => ({
        ...it,
        calories: i === 0 ? 330 : 195,
        protein: i === 0 ? 62 : 4, carbs: i === 0 ? 0 : 44, fat: i === 0 ? 7 : 0,
        source: "usda",
      })),
      stats: { resolved: 2, missed: 0, total: 2 },
    });
    const deps = makeDeps({ pass1, resolve });
    const rec = await analyzeFood({ description: "chicken and rice" }, deps);
    expect(rec.calories).toBe(525); // 330 + 195, DB-grounded
    expect(rec.resolved).toBe(true);
    expect(deps.callClaude).toHaveBeenCalledTimes(1); // no verify pass needed
  });

  it("triggers a verify pass when the first result is flagged", async () => {
    // Pass 1: an item whose macros can't explain its calories (atwater fail).
    const pass1 = {
      food: "mystery plate", confidence: "low",
      items: [{ food: "mystery", fdcQuery: "mystery", grams: 100, gramsRange: [80, 120], calories: 1200, protein: 5, carbs: 5, fat: 5, confidence: "low" }],
    };
    // Pass 2: corrected, sane item.
    const pass2 = {
      food: "pasta", confidence: "medium",
      items: [{ food: "pasta", fdcQuery: "pasta cooked", grams: 250, gramsRange: [220, 280], calories: 360, protein: 12, carbs: 70, fat: 3, confidence: "medium" }],
    };
    const resolve = async (items) => ({
      items: items.map(it => ({ ...it, source: "ai" })), // force AI path so numbers = model's
      stats: { resolved: 0, missed: items.length, total: items.length },
    });
    const deps = makeDeps({ pass1, pass2, resolve });
    const rec = await analyzeFood({ description: "a plate of pasta" }, deps);
    expect(deps.callClaude).toHaveBeenCalledTimes(2); // verify pass ran
    expect(rec.verified).toBe(true);
    expect(rec.calories).toBe(360); // took the corrected pass
  });

  it("returns null when identification yields nothing", async () => {
    const deps = makeDeps({ pass1: { items: [] }, resolve: async () => ({ items: [], stats: {} }) });
    const rec = await analyzeFood({ description: "" }, deps);
    expect(rec).toBe(null);
  });
});
