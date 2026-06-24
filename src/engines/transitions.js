// ─── PHASE TRANSITION ENGINE ─────────────────────────────────────────────────
// "What should happen next?" Maps the user's CURRENT physiological phase to the
// sensible next phases, with a rationale for each. Context (weeks in phase, body
// fat, leanness) nudges which option is recommended. This NEVER auto-modifies a
// plan — it only generates suggestions the user can choose to act on.

// Normalize any phase descriptor (history key, plan phase type, or free text) to
// a canonical phase kind.
export function normalizePhaseKind(s) {
  const x = (s || "").toLowerCase();
  if (/aggressive deficit|full cut|long cut|aggressive cut/.test(x)) return "fullCut";
  if (/mini.?cut/.test(x)) return "miniCut";
  if (/deficit|cut|fat loss/.test(x)) return "cut";
  if (/aggressive surplus|dirty bulk|massing/.test(x)) return "bulk";
  if (/lean bulk|lean gain|slow bulk/.test(x)) return "leanBulk";
  if (/recomp/.test(x)) return "recomp";
  if (/contest|peak|prep/.test(x)) return "contestPrep";
  if (/strength block|strength phase/.test(x)) return "strengthBlock";
  if (/hypertrophy|growth block/.test(x)) return "hypertrophyBlock";
  if (/maintain|maintenance/.test(x)) return "maintenance";
  if (/plateau/.test(x)) return "bulkPlateau";
  return "maintenance";
}

const PHASE_LABEL = {
  fullCut: "Full Cut", miniCut: "Mini Cut", cut: "Cut", bulk: "Bulk", leanBulk: "Lean Bulk",
  recomp: "Recomp", contestPrep: "Contest Prep", strengthBlock: "Strength Block",
  hypertrophyBlock: "Hypertrophy Block", maintenance: "Maintenance", bulkPlateau: "Bulk Plateau",
  reverseDiet: "Reverse Diet", improvementSeason: "Improvement Season",
};

// from-kind → ordered candidate next phases, each with a rationale.
const TRANSITIONS = {
  fullCut: [
    { to: "reverseDiet", why: "After an aggressive/long cut, calories are best raised gradually to restore metabolic rate and hormones before any surplus." },
    { to: "maintenance", why: "Hold at the new lower weight to consolidate the loss and let the body adapt before deciding the next direction." },
  ],
  cut: [
    { to: "maintenance", why: "Spend time at maintenance to lock in the leaner physique and recover diet fatigue before reversing direction." },
    { to: "leanBulk", why: "If you're lean enough and recovered, a controlled surplus turns the recovered state into new muscle." },
    { to: "reverseDiet", why: "Walk calories up slowly to undo any metabolic adaptation from the deficit." },
  ],
  miniCut: [
    { to: "leanBulk", why: "A mini cut's job is to make room for growth — resume a lean bulk to use the freed-up surplus window." },
    { to: "maintenance", why: "Stabilize briefly if you want to bank the leanness before pushing calories again." },
  ],
  leanBulk: [
    { to: "miniCut", why: "If body fat has crept up, a short mini cut resets insulin sensitivity and partitioning, then you bulk again leaner." },
    { to: "leanBulk", why: "If you're still lean and gaining at target rate, continuing the lean bulk is the highest-return option." },
    { to: "maintenance", why: "Pause to maintain if you've hit a good weight and want to settle before the next block." },
  ],
  bulk: [
    { to: "miniCut", why: "After a faster bulk, a mini cut trims accumulated fat and restores partitioning before more gaining." },
    { to: "leanBulk", why: "Slow the surplus to a lean bulk to keep gaining muscle while limiting further fat gain." },
  ],
  bulkPlateau: [
    { to: "bulk", why: "A genuine plateau usually means maintenance has risen — nudge calories up to resume gaining." },
    { to: "miniCut", why: "If the plateau coincides with higher body fat, a mini cut first will make the next bulk more productive." },
  ],
  maintenance: [
    { to: "leanBulk", why: "If the goal is to add muscle and you're at a reasonable body fat, a lean bulk is the next step." },
    { to: "cut", why: "If body fat is higher than you'd like, a moderate cut is the cleaner next move." },
    { to: "recomp", why: "If you're a beginner or returning, a recomp can add muscle and lose fat simultaneously near maintenance." },
  ],
  recomp: [
    { to: "leanBulk", why: "Once recomp progress slows, a dedicated surplus accelerates muscle gain." },
    { to: "cut", why: "If you'd rather reveal the muscle built, transition into a cut." },
  ],
  contestPrep: [
    { to: "improvementSeason", why: "Post-show, reverse out of the deficit into a maintenance/improvement season to recover and grow before the next prep." },
  ],
  strengthBlock: [
    { to: "hypertrophyBlock", why: "Follow a strength block with higher-volume hypertrophy work to build the tissue that future strength is built on." },
  ],
  hypertrophyBlock: [
    { to: "strengthBlock", why: "Convert newly built muscle into strength with a lower-rep, higher-intensity block." },
  ],
};

// ctx: { weeksInPhase, bodyFatPct, leanish, rateOnTarget }
export function suggestTransitions(currentDescriptor, ctx = {}) {
  const from = normalizePhaseKind(currentDescriptor);
  const opts = (TRANSITIONS[from] || TRANSITIONS.maintenance).map(o => ({ to: o.to, label: PHASE_LABEL[o.to], why: o.why }));

  // pick a recommendation from context (suggestion only)
  let recommended = opts[0] ? opts[0].to : null;
  const wks = ctx.weeksInPhase;
  if (from === "leanBulk") {
    if ((ctx.bodyFatPct != null && ctx.bodyFatPct >= 17) || (wks != null && wks >= 16)) recommended = "miniCut";
    else recommended = "leanBulk";
  } else if (from === "bulk") {
    recommended = (ctx.bodyFatPct != null && ctx.bodyFatPct >= 18) ? "miniCut" : "leanBulk";
  } else if (from === "cut" || from === "fullCut") {
    recommended = (ctx.leanish || (ctx.bodyFatPct != null && ctx.bodyFatPct <= 12)) ? (from === "fullCut" ? "reverseDiet" : "leanBulk") : (from === "fullCut" ? "reverseDiet" : "maintenance");
  } else if (from === "maintenance") {
    if (ctx.bodyFatPct != null && ctx.bodyFatPct >= 18) recommended = "cut";
    else recommended = "leanBulk";
  }

  return {
    from, fromLabel: PHASE_LABEL[from], options: opts, recommended,
    recommendedLabel: recommended ? PHASE_LABEL[recommended] : null,
    tier: "estimate",
    note: "Suggestions only — FitLog never changes your plan automatically.",
  };
}

export { PHASE_LABEL };
