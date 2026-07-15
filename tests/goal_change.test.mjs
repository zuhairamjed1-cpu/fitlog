import assert from "node:assert";
import { recomputeOnGoalChange, MIN_DISPLAY_FLOOR_G } from "../src/lib/partitioning.js";

let pass = 0, fail = 0; const log = [];
const t = (name, fn) => { try { fn(); pass++; log.push("PASS " + name); } catch (e) { fail++; log.push("FAIL " + name + " → " + e.message); } };
const M = (c, p, f) => ({ carbsG: c, proteinG: p, fatG: f });
const clone = slots => slots.map(s => ({ ...s, macros: { ...s.macros } }));

// Round 1 setup — Gym·16:00, breakfast+lunch logged, floors+dinner planned
const R1 = () => ([
  { id: "bk", type: "flexible", status: "logged", macros: M(87, 56, 13) },
  { id: "ln", type: "flexible", status: "logged", macros: M(111, 37, 34) },
  { id: "pre", type: "floor", status: "planned", macros: M(40, 6, 0) },
  { id: "post", type: "floor", status: "planned", macros: M(48, 50, 2) },
  { id: "dn", type: "flexible", status: "planned", macros: M(94, 31, 28) },
]);

// ══ ROUND 1 — mid-day goal change ══
t("R1.1 logged breakfast+lunch byte-identical", () => {
  const s = R1(); const before = clone(s).filter(x => x.status === "logged");
  recomputeOnGoalChange(M(320, 180, 77), s);
  const after = s.filter(x => x.status === "logged");
  before.forEach((b, i) => assert.deepEqual(after[i].macros, b.macros));
});
t("R1.2 floors unchanged (40/48 carbs)", () => {
  const s = R1(); recomputeOnGoalChange(M(320, 180, 77), s);
  assert.equal(s.find(x => x.id === "pre").macros.carbsG, 40);
  assert.equal(s.find(x => x.id === "post").macros.carbsG, 48);
});
t("R1.3 dinner absorbs remaining = 34g carbs", () => {
  const s = R1(); recomputeOnGoalChange(M(320, 180, 77), s);
  assert.equal(s.find(x => x.id === "dn").macros.carbsG, 34);
});
t("R1.4 new daily total == 320g carbs", () => {
  const s = R1(); recomputeOnGoalChange(M(320, 180, 77), s);
  assert.equal(s.reduce((a, x) => a + x.macros.carbsG, 0), 320);
});

// ══ ROUND 2 — full phase change, 3 unlogged flexibles ══
const R2 = () => ([
  { id: "pre", type: "floor", status: "planned", macros: M(40, 6, 0) },
  { id: "post", type: "floor", status: "planned", macros: M(48, 50, 2) },
  { id: "bk", type: "flexible", status: "planned", macros: M(130, 40, 20) },
  { id: "ln", type: "flexible", status: "planned", macros: M(110, 40, 20) },
  { id: "dn", type: "flexible", status: "planned", macros: M(72, 40, 20) },
]);
t("R2.1 floors unchanged 40/48", () => { const s = R2(); recomputeOnGoalChange(M(250, 180, 77), s); assert.equal(s.find(x => x.id === "pre").macros.carbsG, 40); assert.equal(s.find(x => x.id === "post").macros.carbsG, 48); });
t("R2.2 flexible pool = 250 − 88 = 162", () => { const s = R2(); recomputeOnGoalChange(M(250, 180, 77), s); const flexCarbs = s.filter(x => x.type === "flexible").reduce((a, x) => a + x.macros.carbsG, 0); assert.ok(Math.abs(flexCarbs - 162) <= 1, `flex carbs ${flexCarbs}`); });
t("R2.3 proportional split (130/110/72 of 162)", () => {
  const s = R2(); recomputeOnGoalChange(M(250, 180, 77), s);
  const near = (id, exp) => { const v = s.find(x => x.id === id).macros.carbsG; assert.ok(Math.abs(v - exp) <= 1, `${id} ${v} vs ~${exp}`); };
  near("bk", 67.5); near("ln", 57.1); near("dn", 37.4);
});
t("R2.4 total == 250 within tolerance", () => { const s = R2(); recomputeOnGoalChange(M(250, 180, 77), s); const tot = s.reduce((a, x) => a + x.macros.carbsG, 0); assert.ok(Math.abs(tot - 250) <= 1, `total ${tot}`); });
// R2 regression: R1.3 + R1.4
t("R2·reg R1.3 dinner 34", () => { const s = R1(); recomputeOnGoalChange(M(320, 180, 77), s); assert.equal(s.find(x => x.id === "dn").macros.carbsG, 34); });
t("R2·reg R1.4 sum 320", () => { const s = R1(); recomputeOnGoalChange(M(320, 180, 77), s); assert.equal(s.reduce((a, x) => a + x.macros.carbsG, 0), 320); });

// ══ ROUND 3 — guard rail + edge ══
t("R3A.1-3 aggressive cut → dinner floored + warned, non-blocking", () => {
  const s = R1(); const res = recomputeOnGoalChange(M(200, 180, 77), s);
  const dn = s.find(x => x.id === "dn");
  assert.equal(dn.macros.carbsG, MIN_DISPLAY_FLOOR_G, "dinner floored, not negative");
  assert.ok(dn.macros.carbsG >= MIN_DISPLAY_FLOOR_G, "never negative/near-zero");
  assert.ok(res.warnings.includes("dn"), "insufficient-budget warning on dinner");
  assert.equal(res.mode, "recompute", "still functional, not an error");
});
t("R3B everything logged → read-only summary, no mutation", () => {
  const s = R1().map(x => x.type === "floor" || x.id === "dn" ? { ...x, status: "logged" } : x);
  const before = clone(s);
  const res = recomputeOnGoalChange(M(320, 180, 77), s);
  assert.equal(res.mode, "summary", "summary state, not recompute");
  assert.ok(res.actual && res.target, "comparison surfaced");
  s.forEach((x, i) => assert.deepEqual(x.macros, before[i].macros, "no slot mutated"));
});
// R3 regression: R1.3 + R2.3
t("R3·reg R1.3 dinner 34", () => { const s = R1(); recomputeOnGoalChange(M(320, 180, 77), s); assert.equal(s.find(x => x.id === "dn").macros.carbsG, 34); });
t("R3·reg R2.3 proportional split", () => { const s = R2(); recomputeOnGoalChange(M(250, 180, 77), s); assert.ok(Math.abs(s.find(x => x.id === "bk").macros.carbsG - 67.5) <= 1); });

console.log(log.join("\n"));
console.log(`\ngoal_change: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
