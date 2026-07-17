// ─── STOOL TRACKER ENGINE (pure) ────────────────────────────────────────────
// logEntry(raw) → assess(entry) → prescribe(status). Checks run in priority
// order: the first match wins, so a red flag always beats a mild issue.

// 1) ASSESS — turn one entry into a single status.
export function assess(e) {
  const f = e.flags || [];

  // RED: stop, see a doctor
  if (f.includes("blood") || e.color === "black" || e.color === "red") return "red";

  // ABSORPTION: greasy/floating or pale stool → doctor territory
  if (f.includes("greasy") || e.color === "pale") return "absorption";

  if (e.bristol <= 2 || e.ease === "strained") return "constipation";
  if (e.bristol >= 6) return "looseness";
  if (f.includes("undigested")) return "breakdown";

  // HEALTHY (Bristol 3–5, brown/green, no flags)
  return "healthy";
}

// 2) PRESCRIBE — map a status to fixed lifestyle actions + a verdict.
// tone: 'healthy' | 'watch' | 'alert' drives the colour of the card.
export const RX = {
  healthy: {
    title: "Healthy", tone: "healthy",
    sub: "Bristol 3–5 · no flags · nothing to change",
    actions: [
      "Keep water, fiber, and meal timing where they are.",
      "This is your baseline — log it so drift is easy to spot later.",
    ],
  },
  constipation: {
    title: "Constipation-leaning", tone: "watch",
    sub: "Hard · strained · small volume",
    actions: [
      "Drink more water — aim for pale-yellow urine as your gauge.",
      "Add soluble + insoluble fiber (oats, beans, chia, veg, skins), ramped up slowly.",
      "Move daily — even a walk gets the bowels going.",
      "Don't ignore the urge; holding it backs things up.",
      "Magnesium citrate if diet changes alone don't resolve it.",
    ],
  },
  looseness: {
    title: "Looseness-leaning", tone: "watch",
    sub: "Bristol 6–7 · fast transit",
    actions: [
      "Cut the usual triggers: excess caffeine, alcohol, sugar alcohols (sorbitol/xylitol).",
      "Add soluble fiber — it firms things up rather than loosening.",
      "Check dairy/lactose, common with whey-heavy diets.",
      "Space out large meals so your gut isn't rushed.",
    ],
  },
  breakdown: {
    title: "Poor breakdown", tone: "watch",
    sub: "Undigested food present",
    actions: [
      "Chew thoroughly and slow down — digestion starts in the mouth.",
      "Smaller, more frequent meals instead of giant ones.",
      "Don't chug protein shakes on the way out the door.",
    ],
  },
  absorption: {
    title: "Absorption concern", tone: "watch",
    sub: "Greasy · floating · pale",
    actions: [
      "This one isn't a reliable DIY fix.",
      "If it shows up repeatedly, see a doctor to rule out bile / pancreatic / gut causes.",
    ],
  },
  red: {
    title: "See a doctor", tone: "alert",
    sub: "Blood · black · red stool",
    actions: [
      "Stop here — this isn't something to fix with diet.",
      "Book a doctor. Note when it started and anything that might explain it (e.g. iron, beets).",
    ],
  },
};

export const prescribe = status => RX[status];

// Absorption read for the muscle-growth angle.
// "good" = well-formed, no flags → you're absorbing what you eat.
export function absorptionRead(e) {
  const f = e.flags || [];
  const bad = e.bristol >= 6 || f.includes("undigested") || f.includes("greasy");
  return bad ? "compromised" : "good";
}

// ── reference data ──
export const BRISTOL = [
  { v: 1, label: "Separate hard lumps", glyph: "•••" },
  { v: 2, label: "Lumpy sausage", glyph: "▪▪▪" },
  { v: 3, label: "Cracked sausage", glyph: "▬▬" },
  { v: 4, label: "Smooth, soft snake", glyph: "━━━" },
  { v: 5, label: "Soft blobs, clear edges", glyph: "◖◗" },
  { v: 6, label: "Mushy, ragged edges", glyph: "≈≈" },
  { v: 7, label: "Watery, no solid pieces", glyph: "∿∿" },
];

export const STOOL_COLORS = [
  { v: "brown", hex: "#7A5230", label: "brown" },
  { v: "dark", hex: "#4B3320", label: "dark" },
  { v: "black", hex: "#211C1A", label: "black" },
  { v: "red", hex: "#9E3B32", label: "red" },
  { v: "green", hex: "#5C7A4A", label: "green" },
  { v: "pale", hex: "#C9BEA5", label: "pale · clay" },
  { v: "yellow", hex: "#C9A94A", label: "yellow" },
];

export const STOOL_FLAGS = [
  { v: "blood", label: "blood" },
  { v: "mucus", label: "mucus" },
  { v: "undigested", label: "undigested food" },
  { v: "greasy", label: "greasy · floating" },
  { v: "foul", label: "foul smell" },
];
