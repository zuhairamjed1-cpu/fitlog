// ─── EVAL HARNESS ───────────────────────────────────────────────────────────
// Runs the REAL production pipeline (src/api/foodAnalysis.js) headless against a
// folder of meal photos with known ground truth, and reports the metrics that
// actually tell you whether the tracker is accurate.
//
//   node eval/run.mjs                     # full pipeline, every meal in truth.json
//   node eval/run.mjs --only weighed      # only Tier-A weighed meals
//   node eval/run.mjs --repeat 3          # run each meal 3x → measure NON-DETERMINISM
//   node eval/run.mjs --oracle            # feed TRUE grams, skip AI portioning
//   node eval/run.mjs --model sonnet      # pin one model (no tiered escalation)
//
// WHY EACH METRIC MATTERS
//   MAPE / median APE  — the headline "how wrong are we" number.
//   BIAS (signed)      — THE most actionable number. If we're systematically -22%,
//                        that's hidden fats being missed, and it is CALIBRATABLE:
//                        multiply and you halve your error for free. Random error
//                        can't be fixed by a constant; bias can.
//   Within-range rate  — is calorieRange honest? If truth lands inside it only 40%
//                        of the time, our ranges are lying about our confidence.
//   Oracle gap         — full-pipeline error MINUS oracle error = how much of the
//                        error is PORTION ESTIMATION. This isolates the ceiling.
//   Escalation rate    — your cost dial (how often Haiku→Sonnet fires).
//   FDC hit rate       — how often the DB actually grounded an item.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeFood } from "../src/api/foodAnalysis.js";
import { reconcile } from "../src/engines/mealValidation.js";
import {
  imageToBase64, makeCallClaude, makeResolver, extractJSON,
  WEB_SEARCH_TOOL, MODELS, priceCalls,
} from "./adapters.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url)); // cross-platform (Windows-safe)
const args = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  const next = args[i + 1];
  return (!next || next.startsWith("--")) ? true : next;
};

const REPEAT = Number(flag("repeat", 1)) || 1;
const ORACLE = !!flag("oracle", false);
const ONLY = flag("only", null);
const PIN = flag("model", null); // "haiku" | "sonnet" | null (tiered)

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FDC_KEY = process.env.FDC_API_KEY;
if (!ANTHROPIC_KEY) { console.error("Missing ANTHROPIC_API_KEY"); process.exit(1); }
if (!FDC_KEY) console.warn("⚠ No FDC_API_KEY — every item will fall back to AI estimates (no DB grounding).");

// ── metric helpers ──────────────────────────────────────────────────────────
const pct = (pred, truth) => (truth > 0 ? ((pred - truth) / truth) * 100 : 0);
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = a => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sd = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map(x => (x - m) ** 2)));
};

// ── run one meal through the full pipeline ──────────────────────────────────
// TRUTH vs CLAIMED — the most important distinction in this file.
//   meal.truth   = VERIFIED (kitchen scale / nutrition label). Feeds MAPE + bias.
//   meal.claimed = someone's ESTIMATE (e.g. a PDF that says "approximations based
//                  on visual portion size"). Feeds an AGREEMENT metric only.
// These are never mixed. Scoring an estimator against another estimator's guess
// yields a flattering number that means nothing — both can be 30% wrong in the
// same direction, for the same reasons, and "agree" perfectly.
const verifiedCal = m => (!m.photoMismatch && m.truth?.calories > 0 ? m.truth.calories : null);
const claimedCal  = m => (!m.photoMismatch && m.claimed?.calories > 0 ? m.claimed.calories : null);

async function runFull(meal, deps) {
  const calls = [];
  const lookups = [];
  const d = {
    ...deps,
    callClaude: deps.makeCall(c => calls.push(c)),
    resolveImpl: deps.makeResolve(l => lookups.push(l)),
  };

  let img = null;
  if (meal.photo) {
    img = await imageToBase64(path.join(ROOT, "meals", meal.photo));
  }

  const t0 = Date.now();
  const rec = await analyzeFood({
    description: meal.description || "",
    imageBase64: img?.base64 || null,
    imageMediaType: img?.mediaType || null,
    useWeb: !!meal.useWeb,
    ...(PIN ? { model: MODELS[PIN] } : {}),
  }, d);
  const ms = Date.now() - t0;

  return { rec, calls, lookups, ms, usd: priceCalls(calls) };
}

// ── ORACLE: give the pipeline the TRUE grams, skip AI portioning entirely.
//    Measures how good the DB layer is on its own. The gap between this and the
//    full run is your portion-estimation error — the thing depth would fix. ─────
async function runOracle(meal, deps) {
  if (!meal.ingredients?.length) return null;
  const lookups = [];
  const resolve = deps.makeResolve(l => lookups.push(l));
  const aiItems = meal.ingredients.map(g => ({
    food: g.name || g.query,
    fdcQuery: g.query,
    grams: g.grams,
    gramsRange: [g.grams, g.grams],
    calories: 0, protein: 0, carbs: 0, fat: 0,
  }));
  const { items, stats } = await resolve(aiItems);
  const rec = reconcile(items, { food: meal.name });
  rec.fdcStats = stats;
  return { rec, lookups };
}

// ── main ────────────────────────────────────────────────────────────────────
const truth = JSON.parse(await fs.readFile(path.join(ROOT, "truth.json"), "utf8"));
let meals = truth.meals;
if (ONLY && ONLY !== true) meals = meals.filter(m => m.tier === ONLY);

const deps = {
  extractJSON, WEB_SEARCH_TOOL,
  currentModelId: () => MODELS.haiku,
  cheapModel: MODELS.haiku,
  strongModel: MODELS.sonnet,
  makeCall: onCall => makeCallClaude({ apiKey: ANTHROPIC_KEY, onCall }),
  makeResolve: onLookup => makeResolver({
    apiKey: FDC_KEY, cachePath: path.join(ROOT, ".fdc-cache.json"), onLookup,
  }),
};

const rows = [];
const badMatches = [];
const failures = [];

console.log(`\nRunning ${meals.length} meal(s)${REPEAT > 1 ? ` × ${REPEAT} repeats` : ""}${ORACLE ? " [ORACLE MODE]" : ""}${PIN ? ` [pinned: ${PIN}]` : " [tiered haiku→sonnet]"}\n`);

for (const meal of meals) {
  const truthCal = verifiedCal(meal);   // VERIFIED only
  const claimCal = claimedCal(meal);    // someone's estimate — agreement only
  const refCal = truthCal ?? claimCal;  // for display/range checks only
  const runs = [];

  for (let r = 0; r < REPEAT; r++) {
    try {
      const out = await runFull(meal, deps);
      if (!out.rec) { failures.push({ meal: meal.id, why: "pipeline returned null" }); continue; }
      runs.push(out);
      // collect suspicious FDC matches for review
      for (const l of out.lookups) {
        if (l.hit && l.match) badMatches.push({ meal: meal.id, query: l.query, match: l.match });
      }
    } catch (e) {
      failures.push({ meal: meal.id, why: e.message });
    }
  }
  if (!runs.length) continue;

  const cals = runs.map(r => r.rec.calories);
  const first = runs[0].rec;

  let oracle = null;
  if (ORACLE && meal.ingredients?.length) {
    try { oracle = await runOracle(meal, deps); } catch {}
  }

  const predGrams = first.items.reduce((a, i) => a + (i.grams || 0), 0);
  const row = {
    id: meal.id,
    tier: meal.tier,
    name: first.food || meal.name,
    truth: truthCal,
    claimed: claimCal,
    photoMismatch: !!meal.photoMismatch,
    pred: Math.round(mean(cals)),
    predRuns: cals,
    predGrams,
    claimedGrams: meal.claimedGrams ?? null,
    gramsAgreePct: (meal.claimedGrams && predGrams) ? pct(predGrams, meal.claimedGrams) : null,
    spreadPct: (sd(cals) / Math.max(mean(cals), 1)) * 100,
    errPct: truthCal ? pct(mean(cals), truthCal) : null,          // ACCURACY (verified)
    agreePct: claimCal ? pct(mean(cals), claimCal) : null,        // AGREEMENT (estimate)
    range: first.calorieRange,
    inRange: truthCal ? (truthCal >= first.calorieRange[0] && truthCal <= first.calorieRange[1]) : null,
    tierUsed: first.tier,                 // which result we KEPT (cheap|strong)
    escalated: !!first.escalated,         // did we PAY for the strong model (independent of what we kept)
    flags: first.flags.map(f => f.code),
    fdc: first.fdcStats,
    items: first.items.map(i => ({ food: i.food, g: i.grams, src: i.source, kcal: i.calories, match: i.fdcMatch })),
    oracleCal: oracle?.rec?.calories ?? null,
    oracleErrPct: (oracle && truthCal) ? pct(oracle.rec.calories, truthCal) : null,
    ms: Math.round(mean(runs.map(r => r.ms))),
    usd: mean(runs.map(r => r.usd)),
  };
  rows.push(row);

  const e = row.errPct ?? row.agreePct;
  const isVerified = row.errPct != null;
  const mark = row.photoMismatch ? " ⚠ " : e == null ? "  ?  " : Math.abs(e) < 10 ? " ✓ " : Math.abs(e) < 25 ? " ~ " : " ✗ ";
  console.log(
    `${mark} ${row.id.padEnd(18)} ${isVerified ? "truth" : row.claimed ? "clm~ " : "  —  "} ${String(refCal ?? "—").padStart(5)}  pred ${String(row.pred).padStart(5)}` +
    `${e != null ? `  ${(e > 0 ? "+" : "") + e.toFixed(0)}%`.padStart(8) : "         "}` +
    `  [${row.range[0]}–${row.range[1]}]${row.inRange === true ? " in" : row.inRange === false ? " OUT" : ""}` +
    `  kept:${row.tierUsed}${row.escalated ? " esc→S" : "      "}  db ${row.fdc?.resolved ?? 0}/${row.fdc?.total ?? 0}  conf ${row.fdc?.conflicts ?? 0}  ${row.ms}ms  $${row.usd.toFixed(4)}`
  );
}

// ── aggregate ───────────────────────────────────────────────────────────────
const withTruth = rows.filter(r => r.errPct != null);   // VERIFIED only
const apes = withTruth.map(r => Math.abs(r.errPct));
const signed = withTruth.map(r => r.errPct);
// AGREEMENT — vs someone else's ESTIMATE. Reported separately, never as accuracy.
const withClaim = rows.filter(r => r.agreePct != null);
const agrees = withClaim.map(r => Math.abs(r.agreePct));
const agreeSigned = withClaim.map(r => r.agreePct);
const gramRows = rows.filter(r => r.gramsAgreePct != null);
const gramAgrees = gramRows.map(r => Math.abs(r.gramsAgreePct));
const inRange = withTruth.filter(r => r.inRange).length;
const escalated = rows.filter(r => r.escalated).length;
const fdcResolved = rows.reduce((a, r) => a + (r.fdc?.resolved || 0), 0);
const fdcTotal = rows.reduce((a, r) => a + (r.fdc?.total || 0), 0);
const oracleApes = withTruth.filter(r => r.oracleErrPct != null).map(r => Math.abs(r.oracleErrPct));
const spreads = rows.filter(r => r.spreadPct != null && REPEAT > 1).map(r => r.spreadPct);

const summary = {
  meals: rows.length,
  withGroundTruth: withTruth.length,
  mape: mean(apes),
  medianApe: median(apes),
  bias: mean(signed),
  within10: apes.filter(a => a < 10).length,
  within25: apes.filter(a => a < 25).length,
  inRangeRate: withTruth.length ? (inRange / withTruth.length) * 100 : 0,
  escalationRate: rows.length ? (escalated / rows.length) * 100 : 0,
  fdcHitRate: fdcTotal ? (fdcResolved / fdcTotal) * 100 : 0,
  oracleMape: oracleApes.length ? mean(oracleApes) : null,
  portionGap: (oracleApes.length && apes.length) ? mean(apes) - mean(oracleApes) : null,
  avgSpreadPct: spreads.length ? mean(spreads) : null,
  avgMs: Math.round(mean(rows.map(r => r.ms))),
  avgUsd: mean(rows.map(r => r.usd)),
  totalUsd: rows.reduce((a, r) => a + r.usd, 0),
  failures: failures.length,
  // agreement (NOT accuracy)
  withClaimed: withClaim.length,
  agreementMape: agrees.length ? mean(agrees) : null,
  agreementBias: agreeSigned.length ? mean(agreeSigned) : null,
  gramsAgreement: gramAgrees.length ? mean(gramAgrees) : null,
  gramsBias: gramRows.length ? mean(gramRows.map(r => r.gramsAgreePct)) : null,
};

const L = [];
L.push("\n" + "═".repeat(66));
L.push("  ACCURACY  (vs VERIFIED truth — scale-weighed or label)");
L.push("═".repeat(66));
if (!summary.withGroundTruth) {
  L.push("  ⚠  NO VERIFIED GROUND TRUTH IN THIS SET.");
  L.push("     Accuracy CANNOT be computed. Anything below is agreement with");
  L.push("     someone else's estimate — a mirror, not a ruler. Two estimators");
  L.push("     can be 30% wrong in the same direction and agree perfectly.");
  L.push("     Add weighed meals with a `truth` block to measure real error.");
}
L.push(`  Meals with verified truth : ${summary.withGroundTruth}`);
if (summary.withGroundTruth) {
L.push(`  MAPE (mean abs error)   : ${summary.mape.toFixed(1)}%`);
L.push(`  Median abs error        : ${summary.medianApe.toFixed(1)}%`);
L.push(`  BIAS (signed mean)      : ${summary.bias > 0 ? "+" : ""}${summary.bias.toFixed(1)}%  ← ${
  Math.abs(summary.bias) > 8
    ? `SYSTEMATIC — calibrate by ×${(100 / (100 + summary.bias)).toFixed(2)} to halve your error`
    : "low, mostly random error"}`);
L.push(`  Within ±10%             : ${summary.within10}/${summary.withGroundTruth}`);
L.push(`  Within ±25%             : ${summary.within25}/${summary.withGroundTruth}`);
L.push(`  Truth inside our range  : ${summary.inRangeRate.toFixed(0)}%  ← ${
  summary.inRangeRate < 60 ? "ranges are TOO NARROW (overconfident)" :
  summary.inRangeRate > 95 ? "ranges may be too wide (uninformative)" : "honest"}`);
}

// ── AGREEMENT (explicitly NOT accuracy) ──
if (summary.withClaimed) {
  L.push("");
  L.push("═".repeat(66));
  L.push("  AGREEMENT  (vs CLAIMED estimates — NOT ACCURACY)");
  L.push("═".repeat(66));
  L.push(`  ⚠  These reference values are themselves visual guesses. Agreement`);
  L.push(`     here does NOT mean you are correct — it means you guess like they`);
  L.push(`     guess. Use for spotting DISAGREEMENT (someone's badly wrong), not`);
  L.push(`     for claiming accuracy.`);
  L.push(`  Meals compared          : ${summary.withClaimed}`);
  L.push(`  Calorie disagreement    : ${summary.agreementMape.toFixed(1)}% mean abs`);
  L.push(`  Calorie skew            : ${summary.agreementBias > 0 ? "+" : ""}${summary.agreementBias.toFixed(1)}%  (we read ${summary.agreementBias > 0 ? "HIGHER" : "LOWER"} than they do)`);
  if (summary.gramsAgreement != null) {
    L.push(`  PORTION disagreement    : ${summary.gramsAgreement.toFixed(1)}% mean abs  ← the number that matters`);
    L.push(`  Portion skew            : ${summary.gramsBias > 0 ? "+" : ""}${summary.gramsBias.toFixed(1)}%  (we see ${summary.gramsBias > 0 ? "MORE" : "LESS"} food than they do)`);
  }
  const bad = rows.filter(r => r.agreePct != null && Math.abs(r.agreePct) > 40);
  if (bad.length) {
    L.push(`  Big disagreements (>40%) — investigate these:`);
    bad.forEach(r => L.push(`    • ${r.id}: we say ${r.pred}, they say ${r.claimed} (${r.agreePct > 0 ? "+" : ""}${r.agreePct.toFixed(0)}%)`));
  }
  const mm = rows.filter(r => r.photoMismatch);
  if (mm.length) L.push(`  Excluded (photo ≠ stated portion): ${mm.map(r => r.id).join(", ")}`);
}
if (summary.oracleMape != null) {
  L.push("");
  L.push(`  Oracle MAPE (true grams): ${summary.oracleMape.toFixed(1)}%  ← error from the DB layer alone`);
  L.push(`  PORTION-ERROR GAP       : ${summary.portionGap.toFixed(1)} pts  ← how much error AI portioning adds`);
}
if (summary.avgSpreadPct != null) {
  L.push("");
  L.push(`  Run-to-run spread       : ${summary.avgSpreadPct.toFixed(1)}%  ← nondeterminism floor (${REPEAT} repeats)`);
}
L.push("");
L.push("═".repeat(66));
L.push("  PIPELINE / COST");
L.push("═".repeat(66));
L.push(`  Escalation rate (→Sonnet): ${summary.escalationRate.toFixed(0)}%  ← your cost dial`);
L.push(`  FDC hit rate             : ${summary.fdcHitRate.toFixed(0)}%  (${fdcResolved}/${fdcTotal} items grounded)`);
L.push(`  Avg latency              : ${summary.avgMs}ms`);
L.push(`  Avg cost / meal          : $${summary.avgUsd.toFixed(4)}`);
L.push(`  Total spend this run     : $${summary.totalUsd.toFixed(3)}`);
L.push(`  Failures                 : ${summary.failures}`);
L.push("═".repeat(66) + "\n");
console.log(L.join("\n"));

if (failures.length) {
  console.log("FAILURES:");
  failures.forEach(f => console.log(`  ✗ ${f.meal}: ${f.why}`));
  console.log("");
}

// ── artifacts ───────────────────────────────────────────────────────────────
await fs.writeFile(path.join(ROOT, "results.json"), JSON.stringify({ summary, rows, failures }, null, 2));

const md = [];
md.push(`# EVAL LOG — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
md.push(`\nMode: ${ORACLE ? "oracle" : "full"} · ${PIN ? `pinned ${PIN}` : "tiered haiku→sonnet"} · ${REPEAT} repeat(s)\n`);
md.push(`## Summary\n`);
md.push(`| metric | value |`);
md.push(`|---|---|`);
md.push(`| MAPE | ${summary.mape.toFixed(1)}% |`);
md.push(`| Median APE | ${summary.medianApe.toFixed(1)}% |`);
md.push(`| **Bias (signed)** | **${summary.bias > 0 ? "+" : ""}${summary.bias.toFixed(1)}%** |`);
md.push(`| Within ±25% | ${summary.within25}/${summary.withGroundTruth} |`);
md.push(`| Truth in range | ${summary.inRangeRate.toFixed(0)}% |`);
if (summary.portionGap != null) md.push(`| Portion-error gap | ${summary.portionGap.toFixed(1)} pts |`);
md.push(`| Escalation rate | ${summary.escalationRate.toFixed(0)}% |`);
md.push(`| FDC hit rate | ${summary.fdcHitRate.toFixed(0)}% |`);
md.push(`| Avg cost/meal | $${summary.avgUsd.toFixed(4)} |`);
md.push(`\n## Per-meal\n`);
md.push(`| meal | tier | truth | pred | err | range | in? | model | db | flags |`);
md.push(`|---|---|---|---|---|---|---|---|---|---|`);
for (const r of rows) {
  md.push(`| ${r.id} | ${r.tier || "—"} | ${r.truth ?? "—"} | ${r.pred} | ${r.errPct != null ? (r.errPct > 0 ? "+" : "") + r.errPct.toFixed(0) + "%" : "—"} | ${r.range[0]}–${r.range[1]} | ${r.inRange === true ? "✓" : r.inRange === false ? "✗" : "—"} | ${r.tierUsed} | ${r.fdc?.resolved}/${r.fdc?.total} | ${r.flags.join(",") || "—"} |`);
}
md.push(`\n## Item-level detail (check for bad FDC matches)\n`);
for (const r of rows) {
  md.push(`\n**${r.id}** — ${r.name}`);
  for (const i of r.items) {
    md.push(`- ${i.food} · ${i.g ?? "?"}g · **${i.src}** · ${i.kcal} kcal${i.match ? ` → _${i.match}_` : ""}`);
  }
}
if (failures.length) {
  md.push(`\n## Failures\n`);
  failures.forEach(f => md.push(`- **${f.meal}**: ${f.why}`));
}
await fs.writeFile(path.join(ROOT, "EVAL_LOG.md"), md.join("\n"));

console.log(`Wrote eval/results.json and eval/EVAL_LOG.md\n`);
