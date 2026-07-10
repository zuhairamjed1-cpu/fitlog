// ─── AI / API CLIENT ────────────────────────────────────────────────────────────
// All Claude calls + the helpers built on them (food/physique/plan analysis, JSON
// extraction, barcode lookup, markdown rendering, image resizing). Extracted from
// App.jsx so view modules — including lazily-loaded ones — can share one client
// without importing App.jsx.
import { currentModelId } from "../config";
import { supabase, hasSupabase } from "../supabase";
import { buildBrain, formatBrainText } from "../brain/brain";
import { daysAgo, WEEKDAYS } from "../lib/dates";
import { analyzeFood } from "./foodAnalysis";

export async function fileToResizedBase64(file, maxDim = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        // Use JPEG for photos — much smaller than PNG
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg", preview: dataUrl });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ─── COACHING PRINCIPLES ──────────────────────────────────────────────────────
// The opinionated philosophy injected into every AI system prompt. This is what
// separates a "smart calculator" from a coach with a point of view.
export const COACH_PRINCIPLES = `COACHING PRINCIPLES — apply consistently:
- Recovery is the LEADING indicator of progress. Sleep and food fuel adaptation; training without them is just damage.
- Consistency beats intensity. 80% effort sustained beats occasional 100%.
- Protein consistency > calorie exactness. Hit protein every day; calories average out across a week.
- Compound lifts and progressive overload over isolation and novelty.
- Sleep debt is non-negotiable. If sleep is broken, fix it before adding training volume.
- Respect deload signals. Pushing through warnings shortens the runway.
- The body adapts to specific stimulus over time, not in a single workout.

LANGUAGE — coach like a coach, not a chatbot:
- Give CONCRETE actions with numbers. "Eat 6 extra eggs tomorrow" not "consider adding more protein."
- Never use "consider", "you might", "aim for" — say what to do.
- Reference the user's ACTUAL numbers from the data block in every recommendation.
- Lead with the ONE thing that matters most right now. Resist listing everything.
- Use the user's profile and strategy (if provided). Respect their injuries, allergies, equipment, and current life context.
- Honor the WINS — acknowledge what's working when it fits naturally. Don't only point at problems.`;

// ─── CLAUDE API ───────────────────────────────────────────────────────────────
export async function callClaude({ system, userText, imageBase64, imageMediaType, maxTokens = 1000, conversationMessages, tools, model }) {
  const useModel = model || currentModelId();
  const apiMessages = conversationMessages || [{
    role: "user",
    content: imageBase64
      ? [{ type: "image", source: { type: "base64", media_type: imageMediaType, data: imageBase64 } }, { type: "text", text: userText }]
      : userText
  }];
  const body = { model: useModel, max_tokens: maxTokens, system, messages: apiMessages };
  if (tools) body.tools = tools;
  const headers = { "Content-Type": "application/json" };
  if (hasSupabase) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    } catch { /* anonymous — proceed without token */ }
  }
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  // Concatenate all text blocks (web search adds extra block types we ignore here)
  return data.content?.filter(b => b.type === "text").map(b => b.text || "").join("") || "";
}

// The web search tool — lets Claude look up real nutrition data for branded/restaurant foods.
export const WEB_SEARCH_TOOL = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];

// Scan from the first "{" and return the first BALANCED {...} object, respecting
// string literals/escapes. Recovers a clean object even when the model appends
// trailing prose or an extra stray brace after valid JSON. Returns null if none.
function scanBalancedObject(str) {
  const i = str.indexOf("{");
  if (i < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < str.length; j++) {
    const ch = str[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return str.slice(i, j + 1); }
  }
  return null; // never balanced
}

// Robustly pull a JSON object out of a response that may contain prose around it,
// markdown fences, trailing commas, or smart quotes.
export function extractJSON(raw) {
  if (!raw || typeof raw !== "string") throw new Error("Empty AI response");
  const fenceStripped = raw.replace(/```(?:json)?/gi, "").trim();
  let s = fenceStripped;
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  s = s.replace(/,\s*([}\]])/g, "$1"); // remove trailing commas
  const tryParse = str => { try { return JSON.parse(str); } catch { return undefined; } };
  // 1) direct  2) smart quotes normalized — these reproduce the original behavior exactly
  let r = tryParse(s);
  if (r !== undefined) return r;
  const sq = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  r = tryParse(sq);
  if (r !== undefined) return r;
  // 3) SALVAGE — brace-match the first complete object from the fence-stripped text
  //    (smart quotes normalized first), tolerating trailing prose / a stray brace
  //    that the outer indexOf/lastIndexOf slice would otherwise mangle.
  const salvaged = scanBalancedObject(fenceStripped.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
  if (salvaged) {
    r = tryParse(salvaged.replace(/,\s*([}\]])/g, "$1"));
    if (r !== undefined) return r;
  }
  // All attempts failed — throw, exactly as before. Callers like analyzeFoodAI
  // catch this and return null, so external behavior is unchanged.
  throw new Error("Could not parse JSON from AI response");
}

export async function estimateSportsCalories(sport, duration, intensity, weight) {
  try {
    const raw = await callClaude({
      model: currentModelId(),
      maxTokens: 600,
      system: "You are a sports physiologist. Calculate calories burned using the correct MET (metabolic equivalent) value for the given sport and intensity. Formula: calories = MET × weight(kg) × hours. Use standard Compendium of Physical Activities MET values. Be accurate, not generous. Reply with ONLY the JSON object.",
      userText: `Calculate calories burned: sport="${sport}", duration=${duration} min, intensity="${intensity}", bodyweight=${weight}kg. Return JSON: {"calories":<number>,"met":<number>,"note":"<the MET used, 1 sentence>"}`,
    });
    return extractJSON(raw);
  } catch { return { calories: 0, note: "Could not estimate." }; }
}

// ─── SUPPLEMENT PRODUCT LOOKUP ────────────────────────────────────────────────
// Given a free-text "brand + product" query, web-search the exact product and
// return normalized label facts to store in the user's supplement library.
export async function lookupSupplement(query) {
  try {
    const raw = await callClaude({
      model: currentModelId(),
      maxTokens: 800,
      tools: WEB_SEARCH_TOOL,
      system: "You are a supplement label assistant. Given a brand + product name, use web search to find the EXACT product and read its Supplement Facts panel. Prefer the manufacturer's own listing. Reply with ONLY the JSON object, no prose.",
      userText: `Find the exact supplement product: "${query}". Return JSON: {"name":"<clean product name, no brand>","brand":"<brand>","dose":"<one serving as label states, e.g. '5 g' or '2 capsules'>","form":"<powder|capsule|tablet|liquid|gummy|other>","serving":"<serving size text from the label>","notes":"<one short sentence: the key active + amount per serving>"}. If you truly cannot identify it, return the same shape with your best structured estimate and say so in notes.`,
    });
    const r = extractJSON(raw);
    if (!r || !r.name) return null;
    return r;
  } catch { return null; }
}

// useWeb = true only when the user opts in (branded/restaurant foods). Keeps cost low by default.
// ─── BARCODE LOOKUP (Open Food Facts) ────────────────────────────────────────
// Free, no API key. Returns normalized nutrition or null if not found.
export async function lookupBarcode(code) {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments,serving_size,quantity`;
    const resp = await fetch(url, { headers: { "User-Agent": "FitLog/1.0 (personal fitness tracker)" } });
    const data = await resp.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const n = p.nutriments || {};
    const name = [p.brands, p.product_name].filter(Boolean).join(" ").trim() || p.product_name || "Unknown product";
    // Per-100g values (most reliable, always present if any nutrition data exists)
    const per100 = {
      cal: Math.round(n["energy-kcal_100g"] ?? (n["energy_100g"] ? n["energy_100g"] / 4.184 : 0)),
      protein: Math.round((n["proteins_100g"] ?? 0)),
      carbs: Math.round((n["carbohydrates_100g"] ?? 0)),
      fat: Math.round((n["fat_100g"] ?? 0)),
    };
    // Per-serving if available
    const hasServing = n["energy-kcal_serving"] != null || n["proteins_serving"] != null;
    const perServing = hasServing ? {
      cal: Math.round(n["energy-kcal_serving"] ?? (n["energy_serving"] ? n["energy_serving"] / 4.184 : 0)),
      protein: Math.round((n["proteins_serving"] ?? 0)),
      carbs: Math.round((n["carbohydrates_serving"] ?? 0)),
      fat: Math.round((n["fat_serving"] ?? 0)),
    } : null;
    if (!per100.cal && !perServing?.cal) return null; // no usable nutrition data
    return { name, per100, perServing, servingSize: p.serving_size || null, quantity: p.quantity || null, code };
  } catch {
    return null;
  }
}

// Is live barcode scanning supported on this device? (Chrome/Android yes, iOS Safari no)
export function barcodeScanSupported() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

// Back-compat signature. Now a thin wrapper over the multi-pass, DB-grounded
// pipeline (identify+portion → USDA resolve → reconcile → conditional verify).
// Returns a reconciled meal (mealValidation shape: items[], DERIVED totals,
// calorieRange, confidence, flags[], resolved, hasEstimated, fdcStats) or null.
// `brain` is intentionally dropped — it only fed the old AI notes field and taxed
// every call; notes are computed locally from totals + goals if wanted.
// `model` lets the caller force a stronger model for the image path.
export async function analyzeFoodAI(description, imageBase64, imageMediaType, useWeb = false, _brain = null, model = undefined) {
  return analyzeFood(
    { description, imageBase64, imageMediaType, useWeb, model },
    { callClaude, extractJSON, WEB_SEARCH_TOOL, currentModelId }
  );
}

export async function analyzeAllData(data, goals) {
  const brain = buildBrain(data, goals);
  const system = `You are this user's coach reviewing the last 14 days. Score them honestly and surface the ONE thing that will move them the most. Goal: ${goals.goal}.

Use the KEY SIGNALS (ranked by priority) and the ABOUT THE USER + CURRENT STRATEGY sections if provided. Respect their constraints (injuries, allergies). Evaluate progress against their stated strategy.

${COACH_PRINCIPLES}

Return ONLY JSON:
{"overallScore":<1-10>,"summary":"<2-3 sentences referencing specific numbers and their strategy if relevant>","sections":[{"category":"Sleep & Recovery","score":<1-10>,"status":"good|warning|critical","insight":"<specific with their numbers>","tips":["<concrete action with numbers>","<tip>","<tip>"]},{"category":"Nutrition","score":<1-10>,"status":"good|warning|critical","insight":"<specific>","tips":["<tip>","<tip>","<tip>"]},{"category":"Training","score":<1-10>,"status":"good|warning|critical","insight":"<specific>","tips":["<tip>","<tip>","<tip>"]},{"category":"Calorie Balance","score":<1-10>,"status":"good|warning|critical","insight":"<specific>","tips":["<tip>","<tip>","<tip>"]}],"priorityAction":"<the SINGLE most impactful action this week — concrete and specific>"}`;
  const raw = await callClaude({ system, maxTokens: 2200, userText: formatBrainText(brain) });
  return extractJSON(raw);
}

// Suggests which split day goes on each chosen training day.
export async function suggestSplitSchedule(plan, goals) {
  const sys = `You are a strength coach. The user follows a "${plan.split}" split and can train on these days: ${plan.trainingDays.join(", ")}. Goal: ${goals.goal}.
Assign a specific workout to each available training day, optimizing recovery (don't put two heavy overlapping sessions back-to-back; space out muscle groups). Days NOT in their available list are rest days.
Return ONLY JSON mapping each available day to a short workout label:
{"assignments":{${plan.trainingDays.map(d => `"${d}":"<label>"`).join(",")}},"rationale":"<1-2 sentence explanation of the arrangement>"}`;
  const raw = await callClaude({ system: sys, maxTokens: 700, userText: `Arrange my ${plan.split} across: ${plan.trainingDays.join(", ")}.` });
  return extractJSON(raw);
}

// Conversational plan builder — the user describes what they want in plain English,
// and the AI designs the entire week: which days to train, the split, day-by-day workouts, and why.
export async function buildPlanFromPrompt(prompt, goals, current, data) {
  const brain = data ? buildBrain(data, goals) : null;
  const brainText = brain ? `\n\n=== USER'S CURRENT STATE (factor in: recovery, experience, injuries, strategy) ===\n${formatBrainText(brain)}` : "";

  // Auto-detect sports the user actually logs, and which weekday they fall on.
  let sportsPattern = "";
  if (data?.sports?.length) {
    const byDay = {};
    data.sports.filter(s => s.date >= daysAgo(60)).forEach(s => {
      const wd = WEEKDAYS[(new Date(s.date + "T00:00:00").getDay() + 6) % 7];
      byDay[wd] = byDay[wd] || {};
      byDay[wd][s.sport] = (byDay[wd][s.sport] || 0) + 1;
    });
    const patterns = [];
    Object.entries(byDay).forEach(([wd, sports]) => {
      Object.entries(sports).forEach(([sport, n]) => { if (n >= 2) patterns.push(`${sport} on ${wd} (logged ${n}× recently)`); });
    });
    if (patterns.length) sportsPattern = `\n\n=== SPORTS THE USER REGULARLY PLAYS (auto-detected from their logs — protect related muscles around these days; e.g. don't put heavy legs the day before/after football) ===\n${patterns.join("\n")}`;
  }

  const sys = `You are this user's elite strength coach. They've described, in their own words, how they want their training week. Turn that into a concrete weekly split.

Their stated fitness goal: ${goals.goal}.
${current?.trainingDays?.length ? `Their current plan: split="${current.split}", training days=${current.trainingDays.join(", ")}. They may want to keep or change it.` : ""}

=== HARD RULES (follow exactly) ===
1. PARSE MESSY INPUT CHARITABLY. The user may have typos, slang, shorthand, no punctuation ("futbol", "trian", "shldrs", "chest n arms", "anteriro posteriro", "fridyas"). Always interpret their intent — NEVER return a generic template that ignores what they said, and never reply that you didn't understand. Extract: how many days, which specific days (if named, including misspelled weekdays like "fridyas"=Friday, "tuseday"=Tuesday), muscle/movement priorities, sports, time limits, injuries, and the SPLIT TYPE they named.
   - Recognize any named split even if misspelled or uncommon: Push/Pull/Legs, Upper/Lower, Full Body, Bro Split, Arnold, and ANTERIOR/POSTERIOR (front-chain vs back-chain: anterior = quads, chest, front delts, biceps; posterior = hamstrings, glutes, back, rear delts, triceps). If they name a split, BUILD THAT SPLIT — do not substitute a different one.
   - If they give a clear instruction like "6 days, anterior/posterior, rest on Friday", that is fully specified — build it directly. Six days with Friday rest means train Mon-Thu + Sat-Sun, alternating anterior/posterior.
2. HONOR THE LITERAL REQUEST. If they said a number of days, a specific day, or a focus — that is non-negotiable unless it's clearly unsafe.
3. SUGGEST BETTER, BUT THEY OVERRULE. If their request is suboptimal (e.g. legs the day before their football, or 6 hard days while showing sleep debt), build the SAFER version as your primary plan AND set "alternativeNote" explaining what you changed and why. But if their request is explicit and they'd clearly insist, still respect it — put your concern in "alternativeNote", don't silently override a clear instruction.
4. YOU PICK THE NUMBER OF TRAINING DAYS when the user doesn't specify — based on their goal, experience level, and current recovery (don't prescribe 6 days to someone with sleep debt or a beginner).
5. PROPOSE rest-day placement, but the user makes the final call — so place rest days sensibly and explain the placement; they'll adjust if they want.
6. PROTECT SPORTS: auto-detected sports (below) are real recurring commitments. Keep heavy related muscles away from the day before AND after (football/soccer/running → no heavy legs adjacent).
7. NO ORPHAN MUSCLES: every major muscle group gets trained across the week unless the user explicitly wants a focus/specialization.
8. SENSIBLE SPACING: never the same muscle hard on consecutive days; place rest where fatigue is highest.
9. RESPECT injuries/equipment/life-context from ABOUT THE USER. Honor CURRENT STRATEGY (e.g. deload if late in a block).
10. EXPLAIN EVERY TRAINING DAY with a one-line "why" in dayReasons.

Use the 7 day keys EXACTLY: Mon, Tue, Wed, Thu, Fri, Sat, Sun.
Omit rest days from "assignments" (only include training days). Keep labels short ("Push", "Upper A", "Legs + Core").

${COACH_PRINCIPLES}

Return ONLY valid JSON, no markdown:
{
  "split": "<chosen split name>",
  "trainingDays": ["Mon","Wed",...],
  "assignments": {"Mon":"Push","Wed":"Pull",...},
  "dayReasons": {"Mon":"<one-line why this day is what it is>","Wed":"...","Tue":"Rest — <why>",...},
  "summary": "<2-3 sentences explaining the plan and why it fits THEIR words + data>",
  "alternativeNote": "<if you adjusted or have a concern about their request, explain here — else empty string>",
  "tips": ["<concrete actionable tip>","<tip>"]
}${sportsPattern}${brainText}`;

  const raw = await callClaude({
    model: currentModelId(),
    system: sys,
    maxTokens: 1500,
    userText: `Here's what I want for my training week, in my own words:\n\n"${prompt}"\n\nParse it carefully (typos and all) and design my week.`,
  });
  return extractJSON(raw);
}

// Looks at recent training + sleep to recommend whether to train, go light, or rest/deload today.
export async function recommendRest(data, goals) {
  const brain = buildBrain(data, goals);
  const sys = `You are this user's coach deciding TODAY'S call: "train" (go as planned), "light" (active recovery / reduce volume), or "rest" (full rest or deload). Goal: ${goals.goal}.

Decision rules:
- If their plan says rest day → default rest unless data clearly says train.
- Under-eating + heavy recent training → lean toward light/rest.
- Sleep debt + consecutive training days → lean toward rest.
- Well-fed + slept well + on a training day per plan → train.
- Respect injuries/limitations from the ABOUT THE USER section.
- Evaluate against CURRENT STRATEGY if provided (e.g. week 5 of 6 in a strength block likely warrants a deload soon).
- Reference the user's ACTUAL numbers in your reason.

${COACH_PRINCIPLES}

Return ONLY JSON: {"recommendation":"train|light|rest","reason":"<2-3 sentences with concrete numbers>","tip":"<one CONCRETE action — specific, not vague>"}`;
  const raw = await callClaude({
    system: sys,
    maxTokens: 700,
    userText: `${formatBrainText(brain)}\n\nWhat should I do today?`,
  });
  return extractJSON(raw);
}

// Analyzes a physique photo and recommends specific actions toward the user's goal.
export async function analyzePhysique(imageBase64, imageMediaType, goals, brain = null) {
  const brainText = brain ? formatBrainText(brain) : "";
  const sys = `You are this user's physique coach. They've shared a photo and want honest, grounded feedback toward their goal: ${goals.goal}.

You have their actual training and nutrition data. USE it. If they've been undereating for weeks, mention how that affects what you see. If training volume is low, factor that in. If protein has been on point, acknowledge it. Tie everything back to their actual numbers and strategy.

Use the ABOUT THE USER section if provided — respect injuries, allergies, equipment access. Use CURRENT STRATEGY to align advice with their current phase.

Be respectful but honest. Avoid generic flattery. Avoid generic advice when their data tells part of the story.

If you can't clearly see the body or the photo isn't appropriate for physique analysis, say so politely and ask for a better photo (relaxed front-facing in good light, fitted clothing or shirtless if comfortable).

${COACH_PRINCIPLES}

Reply with ONLY this JSON, no markdown fence:
{
  "observations": ["<short specific visual observation>", "<observation>", "<observation>"],
  "strengths": ["<what's already developed/looking good>", "<...>"],
  "focusAreas": ["<specific muscle group or aspect to prioritize>", "<...>"],
  "nutritionAdvice": "<2-3 sentences with CONCRETE diet direction, referencing their actual numbers>",
  "trainingAdvice": "<2-3 sentences with CONCRETE training priorities, referencing their actual current week/volume>",
  "summary": "<1 sentence honest overall take + an encouraging closer>"
}${brainText ? `\n\nUser's current state:\n${brainText}` : ""}`;
  const raw = await callClaude({
    model: currentModelId(),
    maxTokens: 1600,
    system: sys,
    userText: `My goal is ${goals.goal}. Give me your honest physique analysis grounded in my actual training and nutrition data.`,
    imageBase64, imageMediaType,
  });
  return extractJSON(raw);
}

// ─── MARKDOWN ─────────────────────────────────────────────────────────────────
export function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split("\n");
  const blocks = [];
  let buf = null;
  const flush = () => { if (buf) { blocks.push({ type: buf.type, items: buf.items }); buf = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const b = line.match(/^[-•]\s+(.+)$/);
    const n = line.match(/^\d+\.\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const h1 = line.match(/^#\s+(.+)$/);
    if (b) { if (!buf || buf.type !== "ul") { flush(); buf = { type: "ul", items: [] }; } buf.items.push(b[1]); }
    else if (n) { if (!buf || buf.type !== "ol") { flush(); buf = { type: "ol", items: [] }; } buf.items.push(n[1]); }
    else if (h1) { flush(); blocks.push({ type: "h1", text: h1[1] }); }
    else if (h2) { flush(); blocks.push({ type: "h2", text: h2[1] }); }
    else { flush(); blocks.push({ type: "p", text: line }); }
  }
  flush();
  const inline = (s, key) => {
    const parts = []; let last = 0; const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g; let m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) parts.push({ t: "text", v: s.slice(last, m.index) });
      const tok = m[0];
      if (tok.startsWith("**")) parts.push({ t: "b", v: tok.slice(2, -2) });
      else if (tok.startsWith("`")) parts.push({ t: "code", v: tok.slice(1, -1) });
      else parts.push({ t: "i", v: tok.slice(1, -1) });
      last = m.index + tok.length;
    }
    if (last < s.length) parts.push({ t: "text", v: s.slice(last) });
    return parts.map((p, i) => {
      const k = `${key}-${i}`;
      if (p.t === "b") return <strong key={k}>{p.v}</strong>;
      if (p.t === "i") return <em key={k}>{p.v}</em>;
      if (p.t === "code") return <code key={k} className="md-code">{p.v}</code>;
      return <span key={k}>{p.v}</span>;
    });
  };
  return blocks.map((b, i) => {
    if (b.type === "h1") return <h4 key={i} className="md-h1">{inline(b.text, `h1${i}`)}</h4>;
    if (b.type === "h2") return <h5 key={i} className="md-h2">{inline(b.text, `h2${i}`)}</h5>;
    if (b.type === "p") return <p key={i} className="md-p">{inline(b.text, `p${i}`)}</p>;
    if (b.type === "ul") return <ul key={i} className="md-ul">{b.items.map((it, j) => <li key={j}>{inline(it, `ul${i}${j}`)}</li>)}</ul>;
    if (b.type === "ol") return <ol key={i} className="md-ol">{b.items.map((it, j) => <li key={j}>{inline(it, `ol${i}${j}`)}</li>)}</ol>;
    return null;
  });
}
