// ─── GOAL PLAN MARKDOWN IMPORT ───────────────────────────────────────────────
// Best-effort extractor: pulls recognisable goal fields out of a free-form .md
// plan (written by Claude or anything else). It does NOT pretend to understand
// arbitrary prose — it surfaces what it confidently recognises and leaves the
// rest for the user to confirm. `found` lists what was extracted so the UI can
// be honest about coverage.

const TYPE_MAP = [
  [/lean\s*bulk|muscle\s*gain|bulk(?!ing\s*down)|gaining?\s*phase/i, "leanbulk"],
  [/recomp|body\s*recomp/i, "recomp"],
  [/\bcut\b|fat\s*loss|deficit|shred|lean\s*down/i, "cut"],
  [/strength|powerbuild|peak/i, "strength"],
  [/mainten|maintain/i, "maintenance"],
];

function firstWeight(text, labels) {
  for (const re of labels) { const m = text.match(re); if (m) { const v = parseFloat(m[1]); if (v > 25 && v < 400) return v; } }
  return null;
}

function firstDate(text, labels) {
  for (const re of labels) {
    const m = text.match(re);
    if (m) {
      const iso = m[1].match(/^\d{4}-\d{2}-\d{2}$/) ? m[1] : toISO(m[1]);
      if (iso) return iso;
    }
  }
  return null;
}

function toISO(s) {
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return null;
}

function num(text, re) { const m = text.match(re); if (m) { const v = parseFloat(m[1]); return Number.isFinite(v) ? Math.round(v) : null; } return null; }

export function parseGoalMarkdown(text) {
  const t = String(text || "");
  const found = [];

  let type = null;
  for (const [re, k] of TYPE_MAP) { if (re.test(t)) { type = k; break; } }
  if (type) found.push("goal type");

  // "from 74 to 77", "74kg → 77kg"
  let startWeight = null, goalWeight = null;
  const span = t.match(/(\d{2,3}(?:\.\d)?)\s*kg?\s*(?:->|→|to|–|-)\s*(\d{2,3}(?:\.\d)?)\s*kg/i) || t.match(/from\s*(\d{2,3}(?:\.\d)?)\s*(?:kg)?\s*to\s*(\d{2,3}(?:\.\d)?)\s*kg/i);
  if (span) { startWeight = parseFloat(span[1]); goalWeight = parseFloat(span[2]); }
  if (startWeight == null) startWeight = firstWeight(t, [/(?:start|current|starting)\s*(?:weight)?[:\s]*?(\d{2,3}(?:\.\d)?)\s*kg/i]);
  if (goalWeight == null) goalWeight = firstWeight(t, [/(?:goal|target|end)\s*(?:weight)?[:\s]*?(\d{2,3}(?:\.\d)?)\s*kg/i]);
  if (startWeight != null) found.push("start weight");
  if (goalWeight != null) found.push("goal weight");

  const startDate = firstDate(t, [/(?:start|starting|begin)\s*(?:date)?[:\s]*?(\d{4}-\d{2}-\d{2})/i, /start[:\s]+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/]);
  const targetDate = firstDate(t, [/(?:target|end|goal|by|finish)\s*(?:date)?[:\s]*?(\d{4}-\d{2}-\d{2})/i, /(?:by|target)[:\s]+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/]);
  if (startDate) found.push("start date");
  if (targetDate) found.push("target date");

  const freq = num(t, /(\d)\s*(?:x|×|days?)\s*(?:\/|per|a)?\s*(?:wk|week)/i) || num(t, /train(?:ing)?[:\s]+(\d)\s*(?:x|days)/i);
  if (freq) found.push("training days");

  const calories = num(t, /cal(?:orie)?s?[:\s]+(\d{3,4})/i) || num(t, /(\d{3,4})\s*(?:kcal|cal)\b/i);
  const protein = num(t, /protein[:\s]+(\d{2,3})\s*g?/i);
  const carbs = num(t, /carb(?:ohydrate)?s?[:\s]+(\d{2,3})\s*g?/i);
  const fat = num(t, /fat[:\s]+(\d{2,3})\s*g?/i);
  const macros = (calories || protein || carbs || fat) ? { calories, protein, carbs, fat } : null;
  if (macros) found.push("macros");

  return {
    type, startWeight, goalWeight, startDate, targetDate, freq, macros, found,
    anyFound: found.length > 0,
  };
}
