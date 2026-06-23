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
  const str = String(s);
  // "Mon D" / "Month D"  (Jun 23, January 7) — (?!\d) so a year (Jul 2026) isn't read as day 20
  let m = str.match(/([A-Za-z]{3,})\.?\s+(\d{1,2})(?!\d)/);
  let mo, day;
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) { mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; day = +m[2]; }
  // "D Mon" / "D of Month"  (23 Jun, 7th of July)
  if (!mo) { m = str.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,})/); if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) { mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; day = +m[1]; } }
  // numeric "M/D" or "M-D" (6/23) — assume month/day
  if (!mo) { m = str.match(/\b(\d{1,2})[\/.](\d{1,2})\b/); if (m && +m[1] >= 1 && +m[1] <= 12) { mo = +m[1]; day = +m[2]; } }
  if (!mo || !day) return null;
  return { iso: `${year}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`, mo };
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

// Map a parsed roadmap's phases onto the goalPlan.phases[] shape the State,
// Roadmap and Adaptation engines consume. Pure + exported so the UI and the test
// suite run the exact same code (no drift between "what parses" and "what shows").
export function buildRoadmapPhases(parsed, today) {
  const t = today || new Date().toISOString().slice(0, 10);
  if (!parsed || !Array.isArray(parsed.phases) || !parsed.phases.length) return [];
  return parsed.phases.map(x => ({
    id: x.id, type: x.type, name: x.name,
    startDate: x.startDate, endDate: x.endDate,
    startWeight: x.startWeight, goalWeight: x.goalWeight,
    calories: x.calories, protein: x.protein,
    targetRate: x.targetRate ?? null, focus: x.focus ?? null,
    status: (x.endDate && x.endDate < t) ? "done"
      : (x.startDate && x.startDate <= t && (!x.endDate || x.endDate >= t)) ? "active"
        : "planned",
    origin: "import",
  }));
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

  // ── phases (table with a Phase/Block column + a Dates/Window column) ──
  const phases = [];
  const reName = /phase|block|stage|meso|mesocycle/;
  const reDate = /date|window|when|timing|period|month/;
  const phaseTbl = tables.find(tb => tb.header.some(h => reName.test(h)) && tb.header.some(h => reDate.test(h)));
  if (phaseTbl) {
    const col = re => phaseTbl.header.findIndex(h => re.test(h));
    const ci = { name: col(reName), dates: col(reDate), cal: col(/cal|kcal|energy|intake/), prot: col(/protein|\bpro\b/), wt: col(/weight|goal|target|\bbw\b/) };
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
      const weeks = (datesRaw.match(/(\d+)\s*(?:wk|week)/) || [])[1];
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

  // ── fallback: phases written as headed sections (## Phase 1: Lean Bulk … ) ──
  // Many AI-written plans use headings + bullets instead of a table. Scan for
  // headings that name a phase and pull dates / calories / protein / weight from
  // the lines beneath each, up to the next heading.
  if (!phases.length) {
    const lines = t.split(/\r?\n/);
    const heads = [];
    // a heading is a "phase" if it names a phase concept OR is a numbered/dated block heading
    const phaseHead = l => /(phase|block|stage|mesocycle|meso|cycle|month|week)\b/i.test(l) || /^#{2,4}\s*\*{0,2}\s*\d+\s*[:.)·\-]/.test(l) || /^#{2,4}.*\b(bulk|cut|recomp|maintenance|maintain|deficit|surplus|lean\s*gain|mini.?cut|reverse|taper|peak|strength|build)\b/i.test(l);
    lines.forEach((l, i) => { if (/^#{2,4}\s/.test(l) && phaseHead(l)) heads.push(i); });
    let year = baseYear, lastMo = 0;
    heads.forEach((hi, idx) => {
      const headTxt = lines[hi].replace(/^#{2,4}\s*/, "").replace(/\*\*/g, "").replace(/^\s*(?:phase|block|stage|month|week)\s*\d+\s*(?:[:\-·.)]|\([^)]*\))?\s*/i, "").replace(/^\s*\d+\s*[:.)·\-]\s*/, "").replace(/\([^)]*\)\s*$/, "").trim();
      const end = idx + 1 < heads.length ? heads[idx + 1] : lines.length;
      const body = lines.slice(hi, end).join("\n");
      const dateLine = (body.match(/(?:dates?|window|timing|period|when)\s*[:\-]?\s*([^\n]+)/i) || [])[1] || body.match(/[A-Za-z]{3,}\.?\s+\d{1,2}\s*(?:[–—\-]|to|→)\s*[A-Za-z0-9]/i)?.[0] || lines[hi].match(/[A-Za-z]{3,}\.?\s+\d{1,2}\s*(?:[–—\-]|to|→)\s*[A-Za-z0-9][^|]*/i)?.[0] || "";
      const parts = String(dateLine).split(/[–—\->→]| to /).map(s => s.trim()).filter(Boolean);
      const sP = mdToISO(parts[0] || "", year); if (sP && sP.mo < lastMo) year++;
      const s2 = mdToISO(parts[0] || "", year);
      let eYear = year; const eTry = mdToISO(parts[1] || "", year); if (eTry && s2 && eTry.mo < s2.mo) eYear++;
      const e2 = mdToISO(parts[1] || "", eYear); if (s2) lastMo = s2.mo;
      // calories: prefer "2900 kcal" (number before unit) over "Calories: ~2900"
      const cal = lastNum((body.match(/(\d[\d,]{2,4})\s*(?:kcal|cal(?:orie)?s)\b/i) || body.match(/(?:cal(?:orie)?s?|kcal|energy|intake)[^\d\n]{0,5}(\d[\d,]{2,4})/i) || [])[1]);
      // protein: prefer "165g protein" (number before word) over "protein: 165" / "protein at 180g"
      const prot = num((body.match(/(\d{2,3})\s*g?\s*(?:of\s+)?protein/i) || body.match(/protein[^\d\n]{0,8}(\d{2,3})/i) || [])[1]);
      const wM = body.match(/(\d{2,3}(?:\.\d)?)\s*(?:kg)?\s*(?:->|→|to|–|—|-)\s*~?(\d{2,3}(?:\.\d)?)\s*kg/i);
      const weeks = (body.match(/(\d+)\s*(?:wk|week)/i) || lines[hi].match(/(\d+)\s*(?:wk|week)/i) || [])[1];
      const rateM = body.match(/(?:target|gain|loss|rate|aim)\D{0,12}([+\-]?\d?\.?\d+)\s*(?:kg|kilos?)\s*\/?\s*(?:wk|week)/i);
      const targetRate = rateM ? parseFloat(rateM[1]) : null;
      const focus = ((body.match(/focus\s*:?\s*\n?\s*([^\n]+)/i) || [])[1] || "").replace(/\*\*/g, "").trim() || null;
      const hasTypeWord = /(bulk|cut|recomp|maintenance|maintain|deficit|surplus|lean\s*gain|mini.?cut|reverse|taper|peak|strength|build|phase|block|mesocycle)/i.test(headTxt + " " + lines[hi]);
      const hasSignal = (s2 || cal != null || prot != null || wM || weeks) && (hasTypeWord || s2 || cal != null || wM);
      if (!hasSignal) return; // skip a heading that isn't really a plan phase
      phases.push({
        id: 1000 + idx, name: headTxt, type: typeOf(headTxt) || "leanbulk",
        startDate: s2 ? s2.iso : null, endDate: e2 ? e2.iso : null, weeks: weeks ? +weeks : null,
        calories: cal, protein: prot, targetRate, focus,
        startWeight: wM ? parseFloat(wM[1]) : null, goalWeight: wM ? parseFloat(wM[2]) : null,
        raw: { dates: dateLine },
      });
    });
    if (phases.length) found.push(`${phases.length} phases`);
  }

  // ── fallback 2: plain "Month/Phase block" format (no markdown headings) ──
  //   Month 1-2:           Phase 3:
  //   Lean bulk            Mini cut
  //   Calories: 2900       Calories:
  //   Target: +0.25kg/wk      2400         ← value may sit on its own line
  //   Focus: bench         ...
  if (!phases.length) {
    const lines = t.split(/\r?\n/);
    const TYPEWORD = /^(lean\s*bulk|mini.?cut|recomp|maintenance|maintain|reverse|taper|peak|strength|deficit|cut|bulk|build)\b/i;
    const boundary = l => /^\s*(?:\*{0,2})\s*(?:month|week|phase|block|stage)\s*[\d\s\-–to]*\s*[:.)]?\s*\*{0,2}\s*$/i.test(l);
    const heads = [];
    lines.forEach((l, i) => { if (boundary(l)) heads.push(i); });
    let year = baseYear, lastMo = 0;
    heads.forEach((hi, idx) => {
      const end = idx + 1 < heads.length ? heads[idx + 1] : lines.length;
      const block = lines.slice(hi, end).join("\n");
      const label = lines[hi].replace(/[*:]/g, "").trim();                 // "Month 1-2"
      const typeLine = lines.slice(hi + 1, end).find(l => TYPEWORD.test(l.trim()));
      const typeName = typeLine ? typeLine.replace(/[*:]/g, "").trim() : label;
      const name = typeName && TYPEWORD.test(typeName) ? typeName : label;
      const cal = lastNum((block.match(/(\d[\d,]{2,4})\s*(?:kcal|cal(?:orie)?s)\b/i) || block.match(/(?:cal(?:orie)?s?|kcal)[^\d\n]{0,6}\n?\s*(\d[\d,]{2,4})/i) || [])[1]);
      const prot = num((block.match(/(\d{2,3})\s*g?\s*(?:of\s+)?protein/i) || block.match(/protein[^\d\n]{0,8}\n?\s*(\d{2,3})/i) || [])[1]);
      const rateM = block.match(/(?:target|gain|loss|rate|aim)[^\d+\-\n]{0,12}\n?\s*([+\-]?\d?\.?\d+)\s*(?:kg|kilos?)\s*\/?\s*(?:wk|week)/i);
      const targetRate = rateM ? parseFloat(rateM[1]) : null;
      const focus = ((block.match(/focus\s*:?\s*\n?\s*([^\n]+)/i) || [])[1] || "").replace(/\*\*/g, "").trim() || null;
      const wM = block.match(/(\d{2,3}(?:\.\d)?)\s*(?:kg)?\s*(?:->|→|to|–|—|-)\s*~?(\d{2,3}(?:\.\d)?)\s*kg/i);
      const dl = label.match(/[A-Za-z]{3,}\.?\s+\d{1,2}.*$/) ? label : (block.match(/[A-Za-z]{3,}\.?\s+\d{1,2}\s*(?:[–—\-]|to|→)/i) || [])[0] || "";
      const parts = String(dl).split(/[–—\->→]| to /).map(s => s.trim()).filter(Boolean);
      const s2 = mdToISO(parts[0] || "", year); if (s2 && s2.mo < lastMo) year++;
      const s3 = mdToISO(parts[0] || "", year); let eY = year; const eT = mdToISO(parts[1] || "", year); if (eT && s3 && eT.mo < s3.mo) eY++;
      const e3 = mdToISO(parts[1] || "", eY); if (s3) lastMo = s3.mo;
      if (cal == null && targetRate == null && !wM && !(typeName && TYPEWORD.test(typeName))) return; // not a real phase block
      phases.push({
        id: 2000 + idx, name, type: typeOf(name) || typeOf(block) || "leanbulk",
        startDate: s3 ? s3.iso : null, endDate: e3 ? e3.iso : null, weeks: null,
        calories: cal, protein: prot, targetRate, focus,
        startWeight: wM ? parseFloat(wM[1]) : null, goalWeight: wM ? parseFloat(wM[2]) : null,
        raw: { label },
      });
    });
    if (phases.length) found.push(`${phases.length} phases`);
  }
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

  // duration ("Duration: 6 months", "6-month plan", "24 weeks") → weeks
  let durationWeeks = null;
  const durM = t.match(/duration\s*[:\-]?\s*(\d+)\s*(month|week|wk)/i) || t.match(/(\d+)\s*-?\s*month\b/i) || t.match(/over\s+(\d+)\s*(month|week|wk)/i);
  if (durM) { const n = +durM[1]; const unit = (durM[2] || "month").toLowerCase(); durationWeeks = /month/.test(unit) ? Math.round(n * 4.345) : n; if (!found.includes("duration")) found.push("duration"); }

  // macros: prefer the phase that covers TODAY (so imported targets match where
  // you actually are in the plan), else the first non-maintenance phase with
  // calories, else any phase with calories, else a loose prose match.
  const today = new Date().toISOString().slice(0, 10);
  const inWindow = p => p.startDate && p.startDate <= today && (!p.endDate || p.endDate >= today);
  let activePhaseIdx = phases.findIndex(p => p.calories && inWindow(p));
  if (activePhaseIdx < 0) activePhaseIdx = phases.findIndex(p => p.calories && p.type !== "maintenance");
  if (activePhaseIdx < 0) activePhaseIdx = phases.findIndex(p => p.calories);
  const activeP = activePhaseIdx >= 0 ? phases[activePhaseIdx] : null;
  let macros = null;
  const calLoose = num((t.match(/cal(?:orie)?s?[:\s]+([\d,]{3,5})/i) || [])[1]);
  const protLoose = num((t.match(/protein[:\s]+(\d{2,3})/i) || [])[1]);
  const calories = (activeP && activeP.calories) || calLoose || null;
  const protein = (activeP && activeP.protein) || protLoose || null;
  if (calories || protein) { macros = { calories, protein, carbs: null, fat: null }; if (!found.includes("macros")) found.push("macros"); }

  // ── human-readable analysis summary (for the import preview) ──
  const fmt = n => (n == null ? "?" : n.toLocaleString());
  const summary = [];
  if (phases.length) {
    summary.push(`${phases.length} phase${phases.length > 1 ? "s" : ""}${startDate || targetDate ? `, ${startDate || "?"} → ${targetDate || "?"}` : ""}`);
    if (startWeight != null || goalWeight != null) summary.push(`${startWeight ?? "?"} kg → ${goalWeight ?? "?"} kg${type ? ` (${type})` : ""}`);
    if (activeP) summary.push(`Active now: ${activeP.name || activeP.type}${activeP.calories ? ` — ${fmt(activeP.calories)} kcal` : ""}${activeP.protein ? `, ${activeP.protein} g protein` : ""}`);
  } else if (startWeight != null || goalWeight != null) {
    summary.push(`${startWeight ?? "?"} kg → ${goalWeight ?? "?"} kg${type ? ` (${type})` : ""}${targetDate ? ` by ${targetDate}` : ""}`);
    if (macros && (macros.calories || macros.protein)) summary.push(`Targets: ${macros.calories ? fmt(macros.calories) + " kcal" : ""}${macros.calories && macros.protein ? ", " : ""}${macros.protein ? macros.protein + " g protein" : ""}`);
  }
  const extras = [];
  if (checkpoints.length) extras.push(`${checkpoints.length} checkpoint${checkpoints.length > 1 ? "s" : ""}`);
  if (deloads.length) extras.push(`${deloads.length} deload${deloads.length > 1 ? "s" : ""}`);
  if (rules.length) extras.push(`${rules.length} rule${rules.length > 1 ? "s" : ""}`);
  if (extras.length) summary.push(extras.join(" · "));
  if (longTerm.targetFFMI) summary.push(`Long-term: FFMI ${longTerm.targetFFMI}${longTerm.targetWeight ? ` (~${longTerm.targetWeight} kg)` : ""}`);

  // strategy notes: per-phase Focus lines + any "Focus/Note/Strategy:" prose — kept verbatim
  const strategyNotes = [];
  phases.forEach(p => { if (p.focus) strategyNotes.push(`${p.name || p.type}: ${p.focus}`); });
  (t.match(/^\s*(?:focus|note|strategy|priority|emphasis)\s*:\s*(.+)$/gim) || []).forEach(l => {
    const v = l.replace(/^\s*\w+\s*:\s*/i, "").replace(/\*\*/g, "").trim();
    if (v && !strategyNotes.some(s => s.includes(v))) strategyNotes.push(v);
  });

  return {
    type, startWeight, goalWeight, startDate, targetDate, freq, macros, activePhaseIdx, durationWeeks,
    meta, phases, checkpoints, deloads, rules, longTerm, summary, strategyNotes,
    sourceMarkdown: t,
    found, anyFound: found.length > 0, hasRoadmap: phases.length > 0,
  };
}
