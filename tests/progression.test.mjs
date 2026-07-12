// FitLog progression engine tests — run with:  node tests/progression.test.mjs
// The acceptance table from the build spec. `@N` in the spec means N RIR; the app
// parser reads `@N` as RPE, so RIR = 10 - RPE. To express "2 RIR" as parser input
// we write RPE 8 (@8), "1 RIR" → @9, "0 RIR" → @10, "4 RIR" → @6.

import { computeProgression, canonKey } from "../src/engines/progression.js";
import { daysAgo } from "../src/lib/dates";

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log("  ✗", name, "—", JSON.stringify(got)); } };

// entry helper: mk(n_days_ago, "Exercise\n80kg x 8 @8\n...")
const mk = (n, text) => ({ id: `x${n}`, date: daysAgo(n), text });
const D = (exercise) => ({ exercise });          // data wrapper
const G = (exerciseMap) => ({ exerciseMap: exerciseMap || {} });
// two-session run for one exercise
function run(name, prevText, currText, prevN = 7, currN = 0, map) {
  return computeProgression(D([mk(prevN, `${name}\n${prevText}`), mk(currN, `${name}\n${currText}`)]), G(map));
}
const rowOf = rows => rows[0];

// 1. Reps up: 80×8,8,6 @2 → 80×8,8,7 @1  ⇒ up, reps, reps lit
{
  const r = rowOf(run("Bench", "80kg x 8 @8\n80kg x 8 @8\n80kg x 6 @8", "80kg x 8 @9\n80kg x 8 @9\n80kg x 7 @9"));
  ok("1 reps-up verdict", r.verdict === "up", r.verdict);
  ok("1 decidedBy reps", r.decidedBy === "reps", r.decidedBy);
  ok("1 reps lit", r.axes.reps.lit === true && r.axes.wt.lit === false && r.axes.rir.lit === false, r.axes);
}

// 2. Weight up, reps held: 30×10,10 @0 → 32×10,10 @1 ⇒ up, wt
{
  const r = rowOf(run("Curl", "30kg x 10 @10\n30kg x 10 @10", "32kg x 10 @9\n32kg x 10 @9"));
  ok("2 wt-up verdict", r.verdict === "up", r.verdict);
  ok("2 decidedBy wt", r.decidedBy === "wt", r.decidedBy);
  ok("2 wt lit", r.axes.wt.lit === true, r.axes);
}

// 3. Masked decline: 70×10,10 @2 → 70×10,10 @0 ⇒ down, rir
{
  const r = rowOf(run("Row", "70kg x 10 @8\n70kg x 10 @8", "70kg x 10 @10\n70kg x 10 @10"));
  ok("3 masked-decline verdict", r.verdict === "down", r.verdict);
  ok("3 decidedBy rir", r.decidedBy === "rir", r.decidedBy);
  ok("3 rir lit", r.axes.rir.lit === true, r.axes);
}

// 4. Genuine flat: 60×12,12 @1 → 60×12,12 @1 ⇒ flat, rir, no lit
{
  const r = rowOf(run("Press", "60kg x 12 @9\n60kg x 12 @9", "60kg x 12 @9\n60kg x 12 @9"));
  ok("4 flat verdict", r.verdict === "flat", r.verdict);
  ok("4 decidedBy rir", r.decidedBy === "rir", r.decidedBy);
  ok("4 no lit cell", !r.axes.wt.lit && !r.axes.reps.lit && !r.axes.rir.lit, r.axes);
}

// 5. Same work, more headroom: 70×10,10 @0 → 70×10,10 @2 ⇒ up, rir
{
  const r = rowOf(run("Pulldown", "70kg x 10 @10\n70kg x 10 @10", "70kg x 10 @8\n70kg x 10 @8"));
  ok("5 headroom-up verdict", r.verdict === "up", r.verdict);
  ok("5 decidedBy rir", r.decidedBy === "rir", r.decidedBy);
}

// 6. Deadband wash: 85×8,8 @1 → 90×6,6 @0 ⇒ flat, e1rm, no lit, note both e1RMs
{
  const r = rowOf(run("Squat", "85kg x 8 @9\n85kg x 8 @9", "90kg x 6 @10\n90kg x 6 @10"));
  ok("6 deadband verdict", r.verdict === "flat", r.verdict);
  ok("6 decidedBy e1rm", r.decidedBy === "e1rm", r.decidedBy);
  ok("6 no lit cell", !r.axes.wt.lit && !r.axes.reps.lit && !r.axes.rir.lit, r.axes);
  ok("6 note has both e1RMs", /107\.7.*108\.0/.test(r.note || ""), r.note);
}

// 7. Real e1RM gain: 85×8,8 @1 → 100×5,5 @0 ⇒ up, e1rm (>2%)
{
  const r = rowOf(run("Squat", "85kg x 8 @9\n85kg x 8 @9", "100kg x 5 @10\n100kg x 5 @10"));
  ok("7 e1rm-gain verdict", r.verdict === "up", r.verdict);
  ok("7 decidedBy e1rm", r.decidedBy === "e1rm", r.decidedBy);
}

// 8. Reps down: 20×12,12 @1 → 20×11,12 @0 ⇒ down, reps
{
  const r = rowOf(run("Fly", "20kg x 12 @9\n20kg x 12 @9", "20kg x 11 @10\n20kg x 12 @10"));
  ok("8 reps-down verdict", r.verdict === "down", r.verdict);
  ok("8 decidedBy reps", r.decidedBy === "reps", r.decidedBy);
}

// 9. Weight down: 100×8 @1 → 95×10 @1 ⇒ mixed → e1RM deadband, NOT auto-down
{
  const r = rowOf(run("Deadlift", "100kg x 8 @9", "95kg x 10 @9"));
  ok("9 decidedBy e1rm (not auto-down)", r.decidedBy === "e1rm", r.decidedBy);
  ok("9 not down", r.verdict !== "down", r.verdict);
}

// 10. Stale: only one session ⇒ stale, no lit, not red
{
  const r = rowOf(computeProgression(D([mk(14, "Ohp\n40kg x 8 @9")]), G()));
  ok("10 stale verdict", r.verdict === "stale", r.verdict);
  ok("10 stale no lit", !r.axes.wt.lit && !r.axes.reps.lit && !r.axes.rir.lit, r.axes);
  ok("10 stale note days", /14d/.test(r.note || ""), r.note);
}

// 11. Low-effort baseline: 80×8 @4 → 80×8 @1 ⇒ stale (prior wasn't near failure)
{
  const r = rowOf(run("Incline", "80kg x 8 @6", "80kg x 8 @9"));
  ok("11 low-effort baseline stale", r.verdict === "stale", r.verdict);
}

// 12. Warm-ups present: 40×10, 60×5, 80×8,8 ⇒ top 80, reps 16
{
  const r = rowOf(computeProgression(D([mk(3, "Squat\n40kg x 10\n60kg x 5\n80kg x 8\n80kg x 8")]), G()));
  ok("12 top weight 80", r.curr.weightKg === 80, r.curr.weightKg);
  ok("12 reps 16 (warmups excluded)", r.curr.reps === 16, r.curr.reps);
}

// 13. Exercise identity: punctuation variance collapses to one key
{
  ok("13a canon strips parens punctuation", canonKey("Bench Press (Barbell)") === "bench press barbell", canonKey("Bench Press (Barbell)"));
  ok("13b canon dash == parens", canonKey("Bench Press - Barbell") === canonKey("Bench Press (Barbell)"), canonKey("Bench Press - Barbell"));
  const rows = computeProgression(D([
    mk(7, "Bench Press (Barbell)\n80kg x 8 @9"),
    mk(0, "Bench Press - Barbell\n82kg x 8 @9"),
  ]), G());
  ok("13c same key merges history (1 row)", rows.length === 1, rows.map(x => x.key));
}

// 14. Rest days: bench 4d ago, legs yesterday, bench today ⇒ bench compares to 4d ago
{
  const rows = computeProgression(D([
    mk(4, "Bench Press\n80kg x 8 @9"),
    mk(1, "Squat\n140kg x 5 @9"),
    mk(0, "Bench Press\n82kg x 8 @9"),
  ]), G());
  const bench = rows.find(r => r.key === "bench press");
  ok("14 bench baseline is 4d-ago", bench && bench.prev && bench.prev.date === daysAgo(4), bench && bench.prev && bench.prev.date);
  ok("14 bench verdict up", bench && bench.verdict === "up", bench && bench.verdict);
}

console.log(`\nprogression: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
