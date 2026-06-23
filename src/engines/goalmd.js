// ─── GOAL PLAN MARKDOWN IMPORT (rich) ────────────────────────────────────────
// Reads a structured plan (markdown tables + sections) into a real multi-phase
// roadmap. Built for plans written by Claude or similar — it parses the phase
// table, monthly checkpoints, deload schedule, decision rules and a long-term
// (FFMI) target, then maps phases onto the goalPlan.phases[] structure the State
// and Adaptation engines already use.
//
// Honesty: it parses STRUCTURE (tables, headed sections, "Mon D – Mon D" dates,
// "A → B kg" weights). It does not "understand" free prose — `found` reports
// what it confidently extracted so the UI can stay honest about coverage.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const TYPE_MAP = [
  [/mini.?cut/i, "minicut"],
  [/reverse|confirm|maintain|mainten/i, "maintenance"],
  [/lean\s*bulk|bulk|muscle\s*gain|build/i, "leanbulk"],
  [/recomp/i, "recomp"],
  [/\bcut\b|fat\s*loss|deficit|shred/i, "cut"],
  [/strength|power|peak/i, "strength"],
];
const num = s => { if (s == null) return null; const m = String(s).replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const lastNum = s => { if (s == null) return null; const m = String(s).replace(/,/g, "").match(/\d+(\.\d+)?/g); return m ? parseFloat(m[m.length - 1]) : null; };

function typeOf(name) { for (const [re, k] of TYPE_MAP) if (re.test(name || "")) return k; return null; }

function mdToISO(s, year) {
  const m = String(s).match(/([A-Za-z]{3,})\.?\s+(\d{1,2})/);
  if (!m) return null;
  const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!mo) return null;
  return { iso: `${year}-${String(mo).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`, mo };
}

// generic markdown table parser → [{ header:[], rows:[[]] }]
function parseTables(text) {
  const out = []; let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\|/.test(line)) {
      const bare = line.replace(/\|/g, "").trim();
      if (/^[-:\s]+$/.test(bare)) continue; // separator row
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
      (cur = cur || { rows: [] }).rows.push(cells);
    } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter(t => t.rows.length >= 2).map(t => ({ header: t.rows[0].map(h => h.replace(/\*/g, "").toLowerCase()), rows: t.rows.slice(1) }));
}

function sectionBody(text, headingRe) {
  const lines = text.split(/\r?\n/);
  let i = lines.findIndex(l => /^#{1,4}\s/.test(l) && headingRe.test(l));
  if (i < 0) return null;
  const body = [];
  for (let j = i + 1; j < lines.length; j++) { if (/^#{1,4}\s/.test(lines[j])) break; body.push(lines[j]); }
  return body.join("\n");
}

function bulletsIn(body) {
  if (!body) return [];
  return body.split(/\r?\n/).filter(l => /^\s*[-*]\s+/.test(l)).map(l => l.replace(/^\s*[-*]\s+/, "").replace(/\*\*/g, "").trim()).filter(Boolean);
}

export function parseGoalMarkdown(text) {
  const t = String(text || "");
  const found = [];
  const baseYear = (t.match(/\b(20\d{2})\b/) || [])[1] ? +(t.match(/\b(20\d{2})\b/)[1]) : new Date().getFullYear();
  const tables = parseTables(t);

  // ── meta (starting stats line) ──
  const meta = {};
  const statsLine = (t.match(/starting stats[^\n]*/i) || [])[0] || "";
  const hM = statsLine.match(/(\d{3})\s*cm/i); if (hM) meta.heightCm = +hM[1];
  const wM = statsLine.match(/(\d{2,3}(?:\.\d)?)\s*kg/i); if (wM) meta.startWeight = parseFloat(wM[1]);
  const bfM = statsLine.match(/(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?\s*%/); if (bfM) meta.bodyFatPct = bfM[2] ? `${bfM[1]}–${bfM[2]}` : bfM[1];
  const ffM = statsLine.match(/ffmi\s*[≈~=]*\s*(\d{1,2}(?:\.\d)?)/i); if (ffM) meta.ffmi = parseFloat(ffM[1]);
  const mnt = statsLine.match(/maintenance\s*[≈~=]*\s*([\d,]{3,5})/i); if (mnt) meta.maintenance = num(mnt[1]);
  const freqM = t.match(/(\d)\s*(?:x|×|days?)\s*(?:\/|per|a)?\s*(?:wk|week)/i); const freq = freqM ? +freqM[1] : null;
  if (Object.keys(meta).length) found.push("starting stats");

  // ── phases (table with Phase + Dates) ──
  const phases = [];
  const phaseTbl = tables.find(tb => tb.header.some(h => /phase/.test(h)) && tb.header.some(h => /date/.test(h)));
  if (phaseTbl) {
    const col = name => phaseTbl.header.findIndex(h => name.test(h));
    const ci = { name: col(/phase/), dates: col(/date/), cal: col(/cal/), prot: col(/protein/), wt: col(/weight/) };
    let year = baseYear, lastMo = 0;
    phaseTbl.rows.forEach((r, idx) => {
      const nameRaw = (r[ci.name] || "").replace(/\*\*/g, "").replace(/^\s*\d+\s*·\s*/, "").trim();
      const datesRaw = r[ci.dates] || "";
      const parts = datesRaw.split(/[–—\->→]| to /).map(s => s.trim()).filter(Boolean);
      const sP = mdToISO(parts[0] || "", year);
      if (sP && sP.mo < lastMo) { year++; }            // year wrap
      const s2 = mdToISO(parts[0] || "", year);
      let eYear = year; const eTry = mdToISO(parts[1] || "", year);
      if (eTry && s2 && eTry.mo < s2.mo) eYear++;
      const e2 = mdToISO(parts[1] || "", eYear);
      if (s2) lastMo = s2.mo;
      const weeks = (datesRaw.match(/(\d+)\s*wk/) || [])[1];
      const wtCell = r[ci.wt] || "";
      const wNums = wtCell.replace(/,/g, "").match(/\d{2,3}(?:\.\d)?/g) || [];
      phases.push({
        id: 1000 + idx, name: nameRaw, type: typeOf(nameRaw) || "leanbulk",
        startDate: s2 ? s2.iso : null, endDate: e2 ? e2.iso : null, weeks: weeks ? +weeks : null,
        calories: ci.cal >= 0 ? lastNum(r[ci.cal]) : null,
        protein: ci.prot >= 0 ? num(r[ci.prot]) : null,
        startWeight: wNums[0] != null ? parseFloat(wNums[0]) : null,
        goalWeight: wNums[1] != null ? parseFloat(wNums[1]) : null,
        raw: { dates: datesRaw, weight: wtCell, cal: r[ci.cal], prot: r[ci.prot] },
      });
    });
    if (phases.length) found.push(`${phases.length} phases`);
  }

  // ── monthly checkpoints (table with Date + Target) ──
  let checkpoints = [];
  const cpTbl = tables.find(tb => tb.header.some(h => /date/.test(h)) && tb.header.some(h => /target|weight/.test(h)) && !tb.header.some(h => /phase|ffmi/.test(h)));
  if (cpTbl) {
    const di = cpTbl.header.findIndex(h => /date/.test(h));
    const ti = cpTbl.header.findIndex(h => /target|weight/.test(h));
    const ni = cpTbl.header.findIndex(h => /note/.test(h));
    let year = baseYear, lastMo = 0;
    checkpoints = cpTbl.rows.map(r => {
      const p = mdToISO(r[di] || "", year); if (p && p.mo < lastMo) year++;
      const p2 = mdToISO(r[di] || "", year); if (p2) lastMo = p2.mo;
      return { date: p2 ? p2.iso : (r[di] || null), label: r[di] || "", target: num(r[ti]), note: ni >= 0 ? (r[ni] || "") : "" };
    }).filter(c => c.target != null);
    if (checkpoints.length) found.push("monthly checkpoints");
  }

  // ── deload schedule ──
  let deloads = [];
  const deloadBody = sectionBody(t, /deload/i);
  if (deloadBody) {
    const dl = deloadBody.match(/[A-Z][a-z]{2}\s+\d{1,2}\s*[–-]\s*(?:[A-Z][a-z]{2}\s+)?\d{1,2}/g);
    if (dl) deloads = dl;
    if (deloads.length) found.push("deloads");
  }

  // ── decision / tracking rules ──
  const rules = bulletsIn(sectionBody(t, /tracking rules/i));
  if (rules.length) found.push("decision rules");

  // ── long-term FFMI target ──
  const longTerm = {};
  const ffNow = t.match(/ffmi\s*now\s*[≈~=]*\s*(\d{1,2}(?:\.\d)?)/i); if (ffNow) longTerm.currentFFMI = parseFloat(ffNow[1]);
  const ffTarget = t.match(/ffmi\s*[~≈]?\s*(\d{2})\s*[–-]\s*(\d{2})\s*[≈~=]?\s*(\d{2,3})\s*[–-]\s*(\d{2,3})\s*kg/i);
  if (ffTarget) { longTerm.targetFFMI = `${ffTarget[1]}–${ffTarget[2]}`; longTerm.targetWeight = `${ffTarget[3]}–${ffTarget[4]}`; }
  const yrs = t.match(/(\d)\s*[–-]\s*(\d)\s*years?/i); if (yrs) longTerm.timeline = `${yrs[1]}–${yrs[2]} years`;
  const leanAdd = t.match(/adding\s*\*{0,2}\s*[~]?(\d{1,2})\s*[–-]\s*(\d{1,2})\s*kg of lean/i); if (leanAdd) longTerm.leanToAdd = `${leanAdd[1]}–${leanAdd[2]} kg`;
  if (Object.keys(longTerm).length) found.push("long-term FFMI target");

  // ── derived top-level fields (back-compat with the simple importer) ──
  const firstP = phases[0], lastP = phases[phases.length - 1];
  const type = (phases.find(p => p.type === "leanbulk") || firstP || {}).type || typeOf(t) || null;
  let startWeight = (firstP && firstP.startWeight) ?? meta.startWeight ?? null;
  let goalWeight = (lastP && lastP.goalWeight) ?? null;
  let startDate = (firstP && firstP.startDate) || null;
  let targetDate = (lastP && lastP.endDate) || null;

  // prose fallbacks when there's no phase table
  if (startWeight == null || goalWeight == null) {
    const sp = t.match(/(\d{2,3}(?:\.\d)?)\s*kg?\s*(?:->|→|to|–|-)\s*(\d{2,3}(?:\.\d)?)\s*kg/i) || t.match(/from\s*(\d{2,3}(?:\.\d)?)\s*(?:kg)?\s*to\s*(\d{2,3}(?:\.\d)?)\s*kg/i);
    if (sp) { if (startWeight == null) { startWeight = parseFloat(sp[1]); found.push("start weight"); } if (goalWeight == null) { goalWeight = parseFloat(sp[2]); found.push("goal weight"); } }
  } else { if (!found.includes(`${phases.length} phases`)) { found.push("start weight", "goal weight"); } }
  if (!startDate) { const m = t.match(/(?:start|starting|begin)\s*(?:date)?[:\s]+(\d{4}-\d{2}-\d{2})/i); if (m) { startDate = m[1]; found.push("start date"); } }
  if (!targetDate) { const m = t.match(/(?:target|end|by|goal|finish)\s*(?:date)?[:\s]+(\d{4}-\d{2}-\d{2})/i); if (m) { targetDate = m[1]; found.push("target date"); } }
  if (type && !found.includes("goal type") && !phases.length) found.push("goal type");
  if (freq && !found.includes("training days")) found.push("training days");

  // macros: from the active-ish first bulk phase, else loose match
  let macros = null;
  const bulkP = phases.find(p => p.calories) ;
  const calLoose = num((t.match(/cal(?:orie)?s?[:\s]+([\d,]{3,5})/i) || [])[1]);
  const protLoose = num((t.match(/protein[:\s]+(\d{2,3})/i) || [])[1]);
  const calories = (bulkP && bulkP.calories) || calLoose || null;
  const protein = (bulkP && bulkP.protein) || protLoose || null;
  if (calories || protein) { macros = { calories, protein, carbs: null, fat: null }; if (!found.includes("macros")) found.push("macros"); }

  return {
    type, startWeight, goalWeight, startDate, targetDate, freq, macros,
    meta, phases, checkpoints, deloads, rules, longTerm,
    found, anyFound: found.length > 0, hasRoadmap: phases.length > 0,
  };
}
