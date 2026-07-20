# Meal-analysis pipeline — audit report

Scope: the current AI meal-analysis pipeline in FitLog, for a redesign toward a Cal AI-style UX + SnapCalorie-style engineering (AI identifies foods + portions → verified DB resolves nutrition → hidden-ingredient modeling → multi-pass verification → eval harness).

Generated as a read-only audit. **No source code was changed.**

All 8 requested files exist at the requested paths — no path discrepancies. Note only: the request lists `src/config.js` (exists; there is no `config.jsx`).

---

## Part 1 — Full file contents (verbatim)

### 1. src/api/client.jsx

~~~~jsx
// ─── AI / API CLIENT ────────────────────────────────────────────────────────────
// All Claude calls + the helpers built on them (food/physique/plan analysis, JSON
// extraction, barcode lookup, markdown rendering, image resizing). Extracted from
// App.jsx so view modules — including lazily-loaded ones — can share one client
// without importing App.jsx.
import { currentModelId } from "../config";
import { supabase, hasSupabase } from "../supabase";
import { buildBrain, formatBrainText } from "../brain/brain";
import { daysAgo, WEEKDAYS } from "../lib/dates";

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

export async function analyzeFoodAI(description, imageBase64, imageMediaType, useWeb = false, brain = null) {
  const isImage = !!imageBase64;
  const brainText = brain ? formatBrainText(brain) : "";
  const todayPart = brain ? `\n\nFor context, the user's current day so far (don't waste tokens repeating these unless commenting on fit):\n${brainText}` : "";
  try {
    const raw = await callClaude({
      model: currentModelId(),
      maxTokens: useWeb ? 1500 : 1100,
      tools: useWeb ? WEB_SEARCH_TOOL : undefined,
      system: `You are a meticulous nutritionist analyzing real meals. Estimate nutrition as ACCURATELY as possible.

${isImage ? `STEP 1 — LOOK CAREFULLY AT THE PHOTO. Before estimating, identify:
- Every food item you can see (don't miss sides, drinks, condiments, garnishes)
- The cooking method (fried/grilled/baked/raw — affects calories a lot)
- Portion size (compare to plate/utensils/hand in frame)
- Visible ingredients like oil, butter, sauce, cheese, dressing
STEP 2 — Combine everything into total numbers for the whole meal shown.` : ""}

RULES:
- ${useWeb ? "For branded/restaurant/packaged foods, search the web for the official published nutrition facts and use those exact numbers." : "Use precise USDA-style values from your knowledge of real foods."}
- Account for cooking method, oil/butter, sauces, and realistic portion sizes.
- Be realistic — restaurant and fried foods are calorie-dense.
- If multiple items are visible, SUM them all.
- Break the meal into its individual foods/drinks in an "items" array (one entry per distinct item). If there's only one food, return a single-element "items" array. The top-level calories/protein/carbs/fat MUST equal the exact sum of the items — these top-level totals are the authoritative numbers.
- The "notes" field MUST comment on how this meal fits the user's remaining day using SPECIFIC numbers from the context (e.g. "puts you at 1850/2500 cal with 65g protein left", "uses most of today's fat budget — go lean at dinner"). Reference the CURRENT STRATEGY if it provides direction (cut → call out high-calorie hits; bulk → call out under-eating).
- If the meal contains anything in the user's allergies/restrictions, mention it in notes — but still return the estimate.

Reply with ONLY this JSON object (no prose before or after, no markdown fence):
{"items":[{"food":"<single food/drink name>","calories":<integer>,"protein":<integer grams>,"carbs":<integer grams>,"fat":<integer grams>}],"food":"<concise overall meal name>","calories":<integer total = sum of items>,"protein":<integer grams total>,"carbs":<integer grams total>,"fat":<integer grams total>,"confidence":"high|medium|low","notes":"<fit-to-day comment with concrete numbers, 1-2 sentences>"}${todayPart}`,
      userText: description
        ? `Analyze the nutrition of: "${description}".${useWeb ? " Search for official data if this is a branded or restaurant item." : ""}`
        : `Identify EVERY food item in this image and analyze the total nutrition for the whole meal shown.${useWeb ? " If you recognize a branded or restaurant dish, search for its official nutrition facts." : ""}`,
      imageBase64, imageMediaType,
    });
    if (!raw || !raw.trim()) return null;
    return extractJSON(raw);
  } catch (e) { return null; }
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

~~~~

### 2. src/views/DietForm.jsx

~~~~jsx
import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { fileToResizedBase64, lookupBarcode, barcodeScanSupported, analyzeFoodAI, lookupSupplement } from "../api/client";
import { buildBrain } from "../brain/brain";
import { MacroDonut, Card, toast } from "../components/primitives";
import { RecentList } from "../components/RecentList";
import { mealTypes } from "../config";
import { getDayContext } from "../engines/dayContext";
import { planFueling, reconcileFueling, sleepWindow, SESSION_TYPES } from "../engines/fueling";
import { estimateGlycemicLoad, dayGlycemicLoad } from "../engines/glycemic";
import { computeProteinDistribution } from "../engines/protein";
import { localDateStr, getTodayStr, formatShortDate, daysAgoFrom } from "../lib/dates";
import { haptic, SFX } from "../lib/fx";

// ===== extracted body =====
// ─── BARCODE SCANNER ──
function BarcodeScanner({ onResult, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const [status, setStatus] = useState("starting"); // starting | scanning | error | unsupported
  const [manual, setManual] = useState("");
  const supported = barcodeScanSupported();

  useEffect(() => {
    if (!supported) { setStatus("unsupported"); return; }
    let detector;
    let cancelled = false;
    (async () => {
      try {
        detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("scanning");
        const scan = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              const code = codes[0].rawValue;
              haptic([12, 30, 12]); SFX.success();
              cleanup();
              onResult(code);
              return;
            }
          } catch {}
          rafRef.current = requestAnimationFrame(scan);
        };
        rafRef.current = requestAnimationFrame(scan);
      } catch (e) {
        setStatus("error");
      }
    })();
    function cleanup() {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    }
    return cleanup;
    // eslint-disable-next-line
  }, []);

  function submitManual() {
    const code = manual.trim();
    if (code) onResult(code);
  }

  return (
    <div className="scan-overlay" onClick={onClose}>
      <div className="scan-modal" onClick={e => e.stopPropagation()}>
        <div className="scan-head">
          <span>Scan barcode</span>
          <button className="scan-x" onClick={onClose}>×</button>
        </div>

        {(status === "starting" || status === "scanning") && supported && (
          <div className="scan-view">
            <video ref={videoRef} className="scan-video" playsInline muted />
            <div className="scan-frame"><div className="scan-line" /></div>
            <p className="scan-hint">{status === "starting" ? "Starting camera…" : "Point at the barcode"}</p>
          </div>
        )}

        {status === "error" && (
          <div className="scan-fallback">
            <p className="scan-err">Couldn't access the camera. Check permissions, or type the barcode number below.</p>
          </div>
        )}

        {status === "unsupported" && (
          <div className="scan-fallback">
            <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
              Live scanning isn't supported on this browser (common on iPhone). Type the barcode number printed under the bars instead:
            </p>
          </div>
        )}

        {(status === "unsupported" || status === "error") && (
          <div className="scan-manual">
            <input
              type="number"
              inputMode="numeric"
              value={manual}
              onChange={e => setManual(e.target.value)}
              placeholder="e.g. 5449000000996"
              onKeyDown={e => { if (e.key === "Enter") submitManual(); }}
            />
            <button className="btn" onClick={submitManual} disabled={!manual.trim()}>Look up</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DIET FORM ──
// Supplement quick-log (sits under the meal card). Pick a saved supplement from
// the library, set the amount, and log it. The ＋ flow takes a free-text
// "brand + product", asks the AI (web search) to resolve the exact product, and
// saves it to the library so it's one tap next time.
function SupplementCard({ data, addEntry, deleteEntry }) {
  const lib = data.supplementLib || [];
  const today = getTodayStr();
  const [selId, setSelId] = useState("");
  const [amount, setAmount] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const sel = lib.find(s => s.id === selId) || null;

  const pick = id => { setSelId(id); const it = lib.find(s => s.id === id); if (it && !amount) setAmount(it.dose || ""); };

  const logIt = () => {
    if (!sel && !amount.trim()) return;
    const name = sel ? sel.name : "Supplement";
    const brand = sel ? (sel.brand || "") : "";
    const dose = amount.trim() || (sel ? (sel.dose || "") : "");
    addEntry("supplements")({ id: Date.now(), date: today, ts: Date.now(), name, brand, dose });
    haptic(12); SFX.tap();
    toast(`⊕ ${[brand, name].filter(Boolean).join(" ")} logged`, { silent: true });
    setAmount("");
  };

  const lookup = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    try {
      const r = await lookupSupplement(q);
      if (r && r.name) {
        const item = { id: Date.now(), name: r.name, brand: r.brand || "", dose: r.dose || "", form: r.form || "", serving: r.serving || "", notes: r.notes || "" };
        addEntry("supplementLib")(item);
        pick(item.id);
        setQuery("");
        haptic(10);
        toast(`✓ Added ${[item.brand, item.name].filter(Boolean).join(" ")}`, { silent: true });
      } else {
        toast("Couldn't find that product — try a fuller name", { silent: true });
      }
    } catch { toast("Lookup failed", { silent: true }); }
    setBusy(false);
  };

  const removeItem = id => {
    deleteEntry("supplementLib")(id);
    if (selId === id) { setSelId(""); setAmount(""); }
    haptic(8);
  };

  return (
    <Card
      title="Supplements"
      sub="Quick-log from your library, or add a product with AI"
      action={<button className="btn-ghost" title="Manage supplements" aria-label="Manage supplements" onClick={() => setManageOpen(true)} style={{ minWidth: 40, padding: "8px 12px" }}>＋</button>}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={selId} onChange={e => pick(e.target.value ? +e.target.value : "")} style={{ flex: "1 1 160px", minWidth: 140 }}>
          <option value="">{lib.length ? "Choose a supplement…" : "No saved supplements yet"}</option>
          {lib.map(s => <option key={s.id} value={s.id}>{[s.brand, s.name].filter(Boolean).join(" ")}</option>)}
        </select>
        <input placeholder="amount" value={amount} onChange={e => setAmount(e.target.value)} style={{ flex: "0 1 92px", minWidth: 72 }} />
        <button className="btn" onClick={logIt} disabled={!selId && !amount.trim()}>Log</button>
      </div>

      {sel && (sel.serving || sel.notes) && (
        <p className="muted small" style={{ marginTop: 8 }}>{[sel.serving && `Serving: ${sel.serving}`, sel.notes].filter(Boolean).join(" · ")}</p>
      )}

      {manageOpen && createPortal(
        <div className="modal-overlay" onClick={() => { setManageOpen(false); setQuery(""); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Supplement library</h3>
            <p className="muted small" style={{ marginBottom: 12 }}>Add a product with AI, or remove one you no longer take.</p>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <input autoFocus placeholder="Brand + product, e.g. “ON Gold Standard Creatine”" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") lookup(); }} style={{ flex: "1 1 200px", minWidth: 160 }} />
              <button className="btn" onClick={lookup} disabled={busy || !query.trim()}>{busy ? <span className="spinner" /> : "✦ Find"}</button>
            </div>

            {lib.length > 0 ? (
              <div className="list" style={{ maxHeight: 260, overflowY: "auto" }}>
                {lib.map(s => (
                  <div key={s.id} className="list-row">
                    <div className="list-main">
                      <div>{[s.brand, s.name].filter(Boolean).join(" ")}</div>
                      {(s.serving || s.notes) && <div className="muted small">{[s.serving && `Serving: ${s.serving}`, s.notes].filter(Boolean).join(" · ")}</div>}
                    </div>
                    <button className="x" aria-label={`Remove ${s.name}`} onClick={() => removeItem(s.id)}>×</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small" style={{ textAlign: "center", padding: "8px 0" }}>No saved supplements yet. Add one above.</p>
            )}

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn" onClick={() => { setManageOpen(false); setQuery(""); }}>Done</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </Card>
  );
}

// Protein timing card (B1) — shows today's feedings vs the MPS threshold.
function ProteinTimingCard({ data, goals, todayDiet = [] }) {
  const pd = computeProteinDistribution(data, goals);
  const gl = dayGlycemicLoad(todayDiet);
  if (!pd && !gl.hasData) return null;
  const t = pd?.today;
  const target = pd?.perMeal;
  return (
    <Card title="Today's protein & glycemic load" sub={pd ? `MPS-effective feedings · ~${target}g per-meal threshold${pd.bw ? "" : " (set your weight to personalize)"}` : "estimated load from today's meals"}>
      {pd && (
        <>
          <div className="center-stack">
            <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>
              {t.effective}<span className="muted" style={{ fontSize: 15, marginLeft: 6 }}>of 3–5 target</span>
            </div>
            <div className="muted small">{t.dayProtein}g protein logged today</div>
          </div>
          {t.feedings.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              {t.feedings.map((f, i) => {
                const pct = Math.min(100, Math.round((f.proteinG / Math.max(target, 1)) * 100));
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="muted small" style={{ width: 40, textAlign: "right" }}>{f.time || "—"}</span>
                    <div className="rt-bar" style={{ margin: 0, flex: 1 }}>
                      <div className="rt-bar-fill" style={{ width: `${pct}%`, ...(f.effective ? {} : { background: "var(--muted)" }) }} />
                    </div>
                    <span className="small" style={{ width: 50 }}>{f.proteinG}g {f.effective ? "✓" : ""}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="muted small" style={{ marginTop: 8 }}>No meals logged today yet.</div>
          )}
          {t.effective < 3 && t.feedings.length > 0 && (
            <div className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>
              Aim for 3–5 meals that each clear ~{target}g. Spreading protein across the day raises total muscle-building stimulus vs. one big hit — even at the same daily total.
            </div>
          )}
        </>
      )}
      {gl.hasData && (
        <div className="pt-gl">
          {pd && <div className="pt-divider" />}
          <div className="pt-gl-row">
            <span className="pt-gl-label">Glycemic load today</span>
            <span><span className="gl-pill" data-band={gl.band}>{gl.band}</span> <span className="muted small">~{gl.total}</span></span>
          </div>
          <div className="muted small" style={{ marginTop: 6, lineHeight: 1.45 }}>
            {gl.band === "high" ? "Carb-heavy day — pairing carbs with protein, fat or fibre flattens the spike." : gl.band === "low" ? "Gentle on blood sugar so far today." : "Moderate — fairly steady blood sugar."} Estimate from logged carbs + food type, not a lab value.
          </div>
        </div>
      )}
    </Card>
  );
}

// Estimated glycemic-load pill — appears on meals that have carb data.
function GLPill({ meal, showValue = true }) {
  const r = estimateGlycemicLoad(meal);
  if (!r.hasCarbs) return null;
  const src = r.source === "database" ? "matched to known GI data" : "rough estimate (food not in GI table)";
  const title = `Estimated glycemic load ~${r.gl} (${r.band})${r.blunted ? " — softened by the protein/fat in this meal" : ""}. ${src}. Not a blood-glucose measurement.`;
  return <span className="gl-pill" data-band={r.band} title={title}>GL {r.band}{showValue ? `\u00a0·\u00a0${r.gl}` : ""}</span>;
}

// Carbs-around-training card — only renders when you've trained recently and have
// timed meals to analyze. Honest: pre-fuel is a performance lever, daily total rules.
// ─── FUEL CARD (planner + adaptive energy check, sleep-aware) ───────────────
function FuelCard({ data, goals, addEntry, deleteEntry }) {
  const today = getTodayStr();
  const tomorrow = localDateStr(new Date(Date.now() + 86400000));
  const [planDate, setPlanDate] = useState(today);
  const [addType, setAddType] = useState(null);
  const [form, setForm] = useState({ time: "17:00", durationMin: "", intensity: "moderate" });
  const weightKg = goals?.profile?.weightKg;
  const sw = useMemo(() => sleepWindow(data), [data]);
  const sessions = (data.plannedSessions || []).filter(s => s.date === planDate).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const plan = useMemo(() => planFueling({ sessions, weightKg, goals, wakeMin: sw.wakeMin, sleepMin: sw.sleepMin }), [sessions, weightKg, goals, sw]);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isToday = planDate === today;
  // TODO(bio-day): filters by stored calendar `.date`, bypassing getDayContext()'s
  // biological-day bucketing — in bio-day mode this can group meals differently than
  // the rest of the app. Left as-is (pre-existing); see refactor report.
  const meals = (data.diet || []).filter(d => d.date === planDate);
  const rec = useMemo(() => (plan && plan.blocks) ? reconcileFueling({ plan, meals, nowMin: isToday ? nowMin : -1 }) : null, [plan, meals, nowMin, isToday]);

  const fmtH = m => `${Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, "0")}`;
  const timeToMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : 0; };

  function addSession() {
    if (!addType) return;
    addEntry("plannedSessions")({ id: Date.now(), date: planDate, type: addType, time: form.time, durationMin: +form.durationMin || SESSION_TYPES[addType].defMin, intensity: form.intensity });
    setAddType(null); setForm({ time: "17:00", durationMin: "", intensity: "moderate" }); haptic(8); toast("✦ Session added");
  }

  return (
    <Card title="Fuel" sub="meals & carbs timed to your sessions and sleep">
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={`seg-btn ${planDate === today ? "active" : ""}`} onClick={() => setPlanDate(today)}>Today</button>
        <button className={`seg-btn ${planDate === tomorrow ? "active" : ""}`} onClick={() => setPlanDate(tomorrow)}>Tomorrow</button>
      </div>

      {!weightKg && <div className="sleep-flag" style={{ marginBottom: 10 }}>⚠ Set your bodyweight in your profile — fuel targets scale with it.</div>}

      {sessions.length > 0 && (
        <div className="fuel-sessions">
          {sessions.map(s => (
            <div key={s.id} className="fuel-sess">
              <span>{(SESSION_TYPES[s.type] || {}).label || s.type} · {s.time} · {s.durationMin || (SESSION_TYPES[s.type] || {}).defMin}min · {s.intensity}</span>
              <button className="skin-x" onClick={() => deleteEntry("plannedSessions")(s.id)}>×</button>
            </div>
          ))}
        </div>
      )}

      {addType ? (
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="muted small">{SESSION_TYPES[addType].label} — when & how hard?</div>
          <div className="field-grid three">
            <label>Time<input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} /></label>
            <label>Mins<input type="number" inputMode="numeric" value={form.durationMin} onChange={e => setForm(f => ({ ...f, durationMin: e.target.value }))} placeholder={`${SESSION_TYPES[addType].defMin}`} /></label>
            <label>Intensity<select value={form.intensity} onChange={e => setForm(f => ({ ...f, intensity: e.target.value }))}><option value="light">Light</option><option value="moderate">Moderate</option><option value="hard">Hard</option></select></label>
          </div>
          <div className="row"><button className="btn-ghost flex" onClick={() => setAddType(null)}>Cancel</button><button className="btn flex" onClick={addSession}>Add session</button></div>
        </div>
      ) : (
        <div className="fuel-type-chips">
          {Object.entries(SESSION_TYPES).map(([k, v]) => <button key={k} className="fuel-type-chip" onClick={() => { setAddType(k); haptic(8); }}>+ {v.label}</button>)}
        </div>
      )}

      {plan && plan.blocks && (
        <div className="fuel-plan">
          <div className="fuel-totals">
            <div className="fuel-tot"><span className="fuel-tot-v">{plan.dailyCarbs}g</span><span className="fuel-tot-l">carbs · {plan.gPerKg} g/kg</span></div>
            <div className="fuel-tot"><span className="fuel-tot-v">{plan.dailyProtein}g</span><span className="fuel-tot-l">protein</span></div>
            <div className="fuel-tot"><span className="fuel-tot-v">{plan.loadLevel}</span><span className="fuel-tot-l">load</span></div>
          </div>

          {sw.hasData && <p className="muted small" style={{ margin: "0 0 12px" }}>Timed around your ~{fmtH(sw.wakeMin)} wake and ~{fmtH(sw.sleepMin)} sleep.</p>}

          {isToday && rec && (
            <div className="es-embed">
              <div className="es-bars">
                <div className="es-bar-row"><span className="es-bar-lab">Eaten</span><div className="rt-bar" style={{ margin: 0, flex: 1 }}><div className="rt-bar-fill" style={{ width: `${rec.carbPct}%` }} /></div><span className="es-bar-v">{rec.consumedCarbs}/{rec.dailyCarbs}g C</span></div>
                <div className="es-bar-row"><span className="es-bar-lab">Protein</span><div className="rt-bar" style={{ margin: 0, flex: 1 }}><div className="rt-bar-fill" style={{ width: `${rec.proteinPct}%`, background: "#b4a8e8" }} /></div><span className="es-bar-v">{rec.consumedProtein}/{rec.dailyProtein}g P</span></div>
              </div>
              <p className="es-status" data-tone={rec.tone}>{rec.status}</p>
              <p className="muted small" style={{ lineHeight: 1.5, marginTop: 4 }}>{rec.advice}</p>
              {rec.addPhrase && <p className="muted small" style={{ lineHeight: 1.5, marginTop: 6 }}>Roughly that's: <b>{rec.addPhrase}</b>.</p>}
            </div>
          )}

          <div className="fuel-timeline">
            {(rec ? rec.timeline : plan.blocks).map((b, i) => (
              b.kind === "session" ? (
                <div key={i} className="fuel-block fuel-session-row" data-kind="session">
                  <span className="fuel-time">{b.time}</span>
                  <div className="fuel-bd"><div className="fuel-label">🏋 {b.label}</div></div>
                </div>
              ) : (
                <div key={i} className={`fuel-block${b.done ? " done" : ""}${b.isNext ? " next" : ""}`} data-kind={b.kind}>
                  <span className="fuel-time">{b.time}</span>
                  <div className="fuel-bd">
                    <div className="fuel-label">{b.isNext ? "→ " : ""}{b.label} <span className="fuel-macros">{b.carbsG}g C{b.proteinG ? ` · ${b.proteinG}g P` : ""}</span>{b.carbType ? <span className={`carb-chip ${b.carbType}`}>{b.carbType}</span> : null}</div>
                    <div className="muted small" style={{ lineHeight: 1.4, marginTop: 2 }}>{b.done ? (b.foodsLine || "Logged.") : `${b.typeNote || b.baseNote || b.note || ""}${b.foodIdea ? ` — e.g. ${b.foodIdea}.` : ""}`}</div>
                  </div>
                </div>
              )
            ))}
          </div>
          {plan.notes.map((n, i) => <p key={i} className="muted small" style={{ lineHeight: 1.45, marginTop: 8 }}>{n}</p>)}
        </div>
      )}

      {sessions.length === 0 && !addType && (
        <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>Add your gym session or sport for {planDate === today ? "today" : "tomorrow"} and FitLog builds a carb-and-protein timeline around it — fitted to your sleep, with live tracking of what you've eaten and what to add.</p>
      )}
    </Card>
  );
}

export function DietForm({ onAdd, recent, goals, data, todayDiet: todayDietProp = [], addEntry, deleteEntry }) {
  // Running totals follow the ACTIVE day (biological or calendar) via the gateway.
  const dayCtx = getDayContext(data, goals);
  const todayDiet = data ? dayCtx.meals(dayCtx.currentDayKey()) : todayDietProp;
  const bioEnabled = goals?.nutrition?.biologicalDay !== false;
  const [date, setDate] = useState(getTodayStr());
  const [time, setTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [meal, setMeal] = useState("Breakfast");
  const [when, setWhen] = useState("today"); // today | yesterday | 2days | pick
  const [affectCoach, setAffectCoach] = useState(true); // past-day logs: include in coach analysis?
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState("text");
  const [useWeb, setUseWeb] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const fileRef = useRef();
  const cameraRef = useRef();

  // Barcode
  const [scanning, setScanning] = useState(false);
  const [bcLoading, setBcLoading] = useState(false);
  const [bcProduct, setBcProduct] = useState(null); // normalized OFF result
  const [bcNotFound, setBcNotFound] = useState(null); // barcode string when OFF has no match → offer label photo
  const [grams, setGrams] = useState(100); // for per-100g scaling
  const [useServing, setUseServing] = useState(false);

  function handleFile(f) {
    if (!f) return;
    setFile(f); setResult(null); setError("");
    const r = new FileReader();
    r.onload = ev => setPreview(ev.target.result);
    r.readAsDataURL(f);
  }

  async function onBarcode(code) {
    setScanning(false);
    setBcLoading(true); setError(""); setBcProduct(null); setBcNotFound(null); setResult(null);
    try {
      const prod = await lookupBarcode(code);
      if (!prod) { setBcNotFound(code); } // not a bug — Open Food Facts data gap → offer label photo
      else {
        setBcProduct(prod);
        setUseServing(!!prod.perServing);
        setGrams(100);
      }
    } catch { setError("Lookup failed. Check your connection and try again."); }
    setBcLoading(false);
  }

  // Compute scaled macros from the barcode product
  function bcMacros() {
    if (!bcProduct) return null;
    if (useServing && bcProduct.perServing) return bcProduct.perServing;
    const f = grams / 100;
    return {
      cal: Math.round(bcProduct.per100.cal * f),
      protein: Math.round(bcProduct.per100.protein * f),
      carbs: Math.round(bcProduct.per100.carbs * f),
      fat: Math.round(bcProduct.per100.fat * f),
    };
  }

  // Resolve the chosen "when" + time into stored {date,time,consumedAt}.
  // consumedAt (when eaten) is authoritative; loggedAt (Save pressed) is audit-only.
  function whenToStore() {
    const cur = dayCtx.currentDayKey();
    const isPast = when !== "now" && when !== "today";
    const key = when === "yesterday" ? daysAgoFrom(cur, 1) : when === "2days" ? daysAgoFrom(cur, 2) : when === "pick" ? date : cur;
    const r = dayCtx.resolveConsumedAt(key, time);
    if (isPast && !affectCoach) r.excludeFromCoach = true; // audit/totals only, hidden from coach reasoning
    return r;
  }

  function saveBarcode() {
    const m = bcMacros();
    if (!m || !bcProduct) return;
    const r = whenToStore();
    const portionNote = useServing && bcProduct.perServing ? `1 serving${bcProduct.servingSize ? ` (${bcProduct.servingSize})` : ""}` : `${grams}g`;
    onAdd({ date: r.date, time: r.time, ts: r.consumedAt, consumedAt: r.consumedAt, loggedAt: Date.now(), ...(r.excludeFromCoach ? { excludeFromCoach: true } : {}), meal, food: bcProduct.name, calories: m.cal, protein: m.protein, carbs: m.carbs, fat: m.fat, notes: `Barcode ${bcProduct.code} · ${portionNote}`, id: Date.now() });
    toast("◉ " + bcProduct.name.slice(0, 24) + " added");
    setBcProduct(null); setError("");
  }

  async function analyze() {
    if (mode === "text" && !text.trim()) return;
    if (mode === "image" && !file) return;
    setAnalyzing(true); setError(""); setResult(null);
    try {
      let b64 = null, mt = null;
      if (mode === "image" && file) {
        // Resize before sending — phone photos are huge and the API chokes on them.
        const resized = await fileToResizedBase64(file, 1280, 0.85);
        b64 = resized.base64;
        mt = resized.mediaType;
      }
      const brain = data && goals ? buildBrain(data, goals) : null;
      const r = await analyzeFoodAI(mode === "text" ? text : "", b64, mt, useWeb, brain);
      if (r && typeof r.calories === "number") setResult(withItems(r));
      else setError(mode === "image" ? "Couldn't read that photo well. Try a clearer shot, or describe the meal in words." : "Couldn't analyze that. Try being more specific (portion size, cooking method).");
    } catch (e) { setError("Network issue. Try again."); }
    setAnalyzing(false);
  }

  // ── Editable-result helpers ──────────────────────────────────────────────
  // coerceMacro is the SINGLE chokepoint that turns any field value into a safe
  // number — empty string / null / NaN / negative all collapse to 0. Item fields
  // hold the raw typed string mid-edit (so "", "12.", "12.5" stay editable);
  // totals are always recomputed THROUGH coerceMacro and rounded.
  const coerceMacro = (val) => { if (val === "" || val == null) return 0; const n = Number(val); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const recomputeTotals = (items) => ({
    calories: Math.round(items.reduce((s, i) => s + coerceMacro(i.calories), 0)),
    protein: Math.round(items.reduce((s, i) => s + coerceMacro(i.protein), 0)),
    carbs: Math.round(items.reduce((s, i) => s + coerceMacro(i.carbs), 0)),
    fat: Math.round(items.reduce((s, i) => s + coerceMacro(i.fat), 0)),
  });
  // Guarantee an items array so the editable list always has ≥1 row, even if the
  // model (or an older/odd response) returned only top-level totals.
  const withItems = (r) => (Array.isArray(r.items) && r.items.length)
    ? r
    : { ...r, items: [{ food: r.food, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat }] };
  const editItem = (i, key, val) => {
    const items = result.items.map((it, j) => j === i ? { ...it, [key]: val } : it); // raw string; coercion happens in totals/save
    setResult({ ...result, items, ...recomputeTotals(items) });
  };
  const addItem = () => {
    const items = [...(result.items || []), { food: "", calories: "", protein: "", carbs: "", fat: "" }];
    setResult({ ...result, items, ...recomputeTotals(items) });
  };
  const removeItem = (i) => {
    let items = result.items.filter((_, j) => j !== i);
    if (!items.length) items = [{ food: "", calories: "", protein: "", carbs: "", fat: "" }];
    setResult({ ...result, items, ...recomputeTotals(items) });
  };

  function save() {
    if (!result) return;
    // Drop blank rows (no name AND no calories); never persist non-finite totals.
    const cleanItems = (result.items || [])
      .filter(it => (it.food && it.food.trim()) || coerceMacro(it.calories) > 0)
      .map(it => ({ food: (it.food || "").trim(), calories: coerceMacro(it.calories), protein: coerceMacro(it.protein), carbs: coerceMacro(it.carbs), fat: coerceMacro(it.fat) }));
    const totalsOk = ["calories", "protein", "carbs", "fat"].every(k => Number.isFinite(result[k]));
    if (!totalsOk) return; // belt-and-suspenders: never write NaN/Infinity to the store
    const r = whenToStore();
    onAdd({ date: r.date, time: r.time, ts: r.consumedAt, consumedAt: r.consumedAt, loggedAt: Date.now(), ...(r.excludeFromCoach ? { excludeFromCoach: true } : {}), meal, food: result.food, calories: result.calories, protein: result.protein, carbs: result.carbs, fat: result.fat, notes: result.notes || "", items: cleanItems, id: Date.now() });
    toast("◉ " + (result.food || "Meal").slice(0, 24) + " added");
    setResult(null); setText(""); setFile(null); setPreview(null); setError("");
  }

  // Gauge/totals follow the "When" selection — the hero reflects the SAME day the
  // user is about to log into (today / yesterday / 2 days ago / picked date).
  const curDayKey = dayCtx.currentDayKey();
  const selDayKey = when === "yesterday" ? daysAgoFrom(curDayKey, 1)
    : when === "2days" ? daysAgoFrom(curDayKey, 2)
    : when === "pick" ? date
    : curDayKey;
  const selMeals = dayCtx.meals(selDayKey);
  const dayLabel = when === "yesterday" ? "Yesterday"
    : when === "2days" ? "2 days ago"
    : when === "pick" ? formatShortDate(date)
    : (dayCtx.mode === "biological" ? "Current bio day" : "Today");
  const dayCal = selMeals.reduce((a, m) => a + (m.calories || 0), 0);
  const dayP = selMeals.reduce((a, m) => a + (m.protein || 0), 0);
  const dayC = selMeals.reduce((a, m) => a + (m.carbs || 0), 0);
  const dayF = selMeals.reduce((a, m) => a + (m.fat || 0), 0);
  const calLeft = (goals?.calories || 0) - dayCal;
  const pLeft = (goals?.protein || 0) - dayP;

  // ── Gauge-hero geometry (semicircle) ──
  const goalCal = goals?.calories || 0;
  const calFrac = goalCal ? Math.min(1, Math.max(0, dayCal / goalCal)) : 0;
  const ARC = 264;
  const arcOffset = ARC * (1 - calFrac);
  const knobA = Math.PI * (1 - calFrac);
  const knobX = 100 + 84 * Math.cos(knobA), knobY = 100 - 84 * Math.sin(knobA);
  const pct = (v, g) => (g ? Math.min(100, Math.round((v / g) * 100)) : 0);
  const bioWeekday = new Date(dayCtx.currentDayKey() + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });

  return (
    <div className="stack meal-redesign">
    {goals && (
      <div className="semi">
        <div className="gauge-h"><i /> CALORIES · {dayLabel.toUpperCase()}</div>
        <div className="swrap">
          <svg viewBox="0 0 200 120" aria-hidden="true">
            <path d="M16,100 A84,84 0 0 1 184,100" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="13" strokeLinecap="round" />
            <path d="M16,100 A84,84 0 0 1 184,100" fill="none" stroke="var(--acc)" strokeWidth="13" strokeLinecap="round" strokeDasharray={ARC} strokeDashoffset={arcOffset} style={{ transition: "stroke-dashoffset .7s cubic-bezier(.22,1,.36,1)" }} />
            <circle cx={knobX} cy={knobY} r="7" fill="var(--acc)" stroke="#14161c" strokeWidth="3" />
          </svg>
          <div className="sc">
            <b>{calLeft >= 0 ? calLeft.toLocaleString() : `+${(-calLeft).toLocaleString()}`}</b>
            <span>{calLeft >= 0 ? "kcal left" : "kcal over"}</span>
          </div>
        </div>
        <div className="ends"><span>0</span><span>{goalCal.toLocaleString()}</span></div>
        <div className="batt">
          {[
            { l: "Protein", v: dayP, g: goals.protein, c: "#b4a8e8" },
            { l: "Carbs", v: dayC, g: goals.carbs, c: "#f9c97e" },
            { l: "Fat", v: dayF, g: goals.fat, c: "#f47e6e" },
          ].map(m => (
            <div className="cell" key={m.l}>
              <div className="vt"><i style={{ height: `${pct(m.v, m.g)}%`, background: m.c }} /></div>
              <b>{Math.round(m.v)}<small>g</small></b>
              <span>{m.l}</span>
            </div>
          ))}
        </div>
      </div>
    )}
    <div className="sheet">
      <div className="sheet-h">
        <b>Log meal</b>
        {dayCtx.mode === "biological"
          ? <span className="bio">◐ Bio day · {bioWeekday}</span>
          : <span className="bio" style={{ color: "var(--mut)", background: "transparent", border: "1px solid var(--line)" }}>Calendar day</span>}
      </div>

      {/* Meal type · When · Time */}
      <div className="row2">
        <div className="fld"><span>Meal</span>
          <select value={meal} onChange={e => setMeal(e.target.value)}>{[...mealTypes, "Custom"].map(m => <option key={m}>{m}</option>)}</select>
        </div>
        <div className="fld"><span>When</span>
          <select value={when} onChange={e => setWhen(e.target.value)}>
            <option value="today">{dayCtx.mode === "biological" ? "Current Bio Day" : "Today"}</option>
            <option value="yesterday">Yesterday</option>
            <option value="2days">2 Days Ago</option>
            <option value="pick">Pick Date…</option>
          </select>
        </div>
        <div className="fld"><span>Time</span>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} />
        </div>
      </div>
      {when === "pick" && (
        <div className="row2"><div className="fld" style={{ flex: 1 }}><span>Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div></div>
      )}
      {when !== "today" && (
        <label className="coach-affect"><input type="checkbox" checked={affectCoach} onChange={e => setAffectCoach(e.target.checked)} /> Affect that day's coach analysis</label>
      )}

      <div className="modes">
        <button className={`mode ${mode === "text" ? "on" : ""}`} onClick={() => { setMode("text"); setResult(null); setError(""); setBcProduct(null); }}>✎ Describe</button>
        <button className={`mode ${mode === "image" ? "on" : ""}`} onClick={() => { setMode("image"); setResult(null); setError(""); setBcProduct(null); }}>⊞ Photo</button>
        <button className={`mode ${mode === "barcode" ? "on" : ""}`} onClick={() => { setMode("barcode"); setResult(null); setError(""); }}>▒ Barcode</button>
      </div>

      {mode === "barcode" && !bcProduct && (
        <div className="bc-start">
          {bcLoading ? (
            <div className="loading-row"><span className="spinner" />Looking up product…</div>
          ) : bcNotFound ? (
            <>
              <p className="muted small" style={{ lineHeight: 1.5, textAlign: "center", marginBottom: 12 }}>
                No product found for barcode {bcNotFound}. Snap the nutrition label and AI will read it — or describe the food instead.
              </p>
              <button className="btn full" onClick={() => { setBcNotFound(null); setMode("image"); }}>📷 Photograph nutrition label</button>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn-ghost flex" onClick={() => { setBcNotFound(null); setScanning(true); }}>Scan again</button>
                <button className="btn-ghost flex" onClick={() => { setBcNotFound(null); setMode("text"); }}>Describe instead</button>
              </div>
            </>
          ) : (
            <>
              <button className="btn full" onClick={() => { setError(""); setBcNotFound(null); setScanning(true); }}>▒ Scan barcode</button>
              <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5, textAlign: "center" }}>
                Point your camera at a packaged food's barcode for exact nutrition. {barcodeScanSupported() ? "" : "(On iPhone you'll type the number — live scan isn't supported in Safari.)"}
              </p>
            </>
          )}
        </div>
      )}

      {mode === "barcode" && bcProduct && (
        <div className="ai-card">
          <div className="ai-card-label">From barcode <span className="conf-badge conf-high">database</span></div>
          <div className="ai-card-name">{bcProduct.name}</div>

          <div className="bc-portion">
            {bcProduct.perServing && (
              <div className="seg" style={{ marginBottom: 10 }}>
                <button className={`seg-btn ${useServing ? "active" : ""}`} onClick={() => setUseServing(true)}>Per serving{bcProduct.servingSize ? ` (${bcProduct.servingSize})` : ""}</button>
                <button className={`seg-btn ${!useServing ? "active" : ""}`} onClick={() => setUseServing(false)}>By weight</button>
              </div>
            )}
            {!useServing && (
              <label>Amount (g)
                <input type="number" value={grams} onChange={e => setGrams(Math.max(0, +e.target.value || 0))} />
              </label>
            )}
          </div>

          {(() => { const m = bcMacros(); return m ? (
            <div className="result-with-donut">
              <MacroDonut protein={m.protein} carbs={m.carbs} fat={m.fat} />
              <div className="macros macros-compact">
                <div className="macro"><span className="macro-v">{m.cal}</span><span className="macro-l">kcal</span></div>
                <div className="macro"><span className="macro-v" style={{ color: "#b4a8e8" }}>{m.protein}g</span><span className="macro-l">protein</span></div>
                <div className="macro"><span className="macro-v" style={{ color: "#f9c97e" }}>{m.carbs}g</span><span className="macro-l">carbs</span></div>
                <div className="macro"><span className="macro-v" style={{ color: "#f47e6e" }}>{m.fat}g</span><span className="macro-l">fat</span></div>
              </div>
            </div>
          ) : null; })()}

          {(() => { const m = bcMacros(); const r = m ? estimateGlycemicLoad({ ...m, carbs: m.carbs, food: bcProduct.name }) : null; return r && r.hasCarbs ? (
            <p className="ai-card-note" style={{ display: "flex", alignItems: "center", gap: 8 }}><GLPill meal={{ ...m, food: bcProduct.name }} /> <span className="muted small">estimate from carbs + food type</span></p>
          ) : null; })()}
          <div className="row">
            <button className="btn flex" onClick={saveBarcode}>+ Add to log</button>
            <button className="btn-ghost" onClick={() => { setBcProduct(null); setError(""); }}>Scan another</button>
          </div>
        </div>
      )}

      {mode === "text" && !result && (
        <div className="compose"><textarea value={text} onChange={e => setText(e.target.value)} placeholder='"2 eggs, toast, glass of OJ"' rows={3} /></div>
      )}

      {mode === "image" && !result && (
        <>
          {preview ? (
            <div className="upload has-img" onClick={() => fileRef.current.click()}>
              <img src={preview} alt="" className="upload-img" />
              <div className="upload-replace">Tap to replace</div>
            </div>
          ) : (
            <div className="photo-choices">
              <button className="photo-choice" onClick={() => cameraRef.current.click()}>
                <span className="photo-choice-icon">📷</span>
                <span>Take photo</span>
              </button>
              <button className="photo-choice" onClick={() => fileRef.current.click()}>
                <span className="photo-choice-icon">🖼️</span>
                <span>Choose photo</span>
              </button>
            </div>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={e => handleFile(e.target.files[0])} />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => handleFile(e.target.files[0])} />
        </>
      )}

      {!result && mode !== "barcode" && (
        <>
          <label className="web">
            <span className={`sw ${useWeb ? "on" : ""}`}><i /></span>
            <input type="checkbox" checked={useWeb} onChange={e => setUseWeb(e.target.checked)} hidden />
            🌐 Search web for exact branded data
          </label>
          <button className="analyze" onClick={analyze} disabled={analyzing || (mode === "text" ? !text.trim() : !file)}>
            {analyzing ? <><span className="spinner" />{useWeb ? "Researching nutrition…" : "Analyzing…"}</> : "✦ Analyze with AI"}
          </button>
        </>
      )}

      {scanning && <BarcodeScanner onResult={onBarcode} onClose={() => setScanning(false)} />}

      {error && <div className="err">{error}</div>}

      {result && (
        <div className="ai-card">
          <div className="ai-card-label">
            AI analysis
            {result.confidence && <span className={`conf-badge conf-${result.confidence}`}>{result.confidence} confidence</span>}
          </div>
          <input className="item-name-top" value={result.food || ""} onChange={e => setResult({ ...result, food: e.target.value })} placeholder="Meal name" />
          <div className="item-list">
            <div className="item-head"><span>Item</span><span>kcal</span><span>P</span><span>C</span><span>F</span><span /></div>
            {(result.items || []).map((it, i) => (
              <div className="item-row" key={i}>
                <input className="it-food" value={it.food ?? ""} onChange={e => editItem(i, "food", e.target.value)} placeholder="Food" />
                <input className="it-num" inputMode="numeric" value={it.calories ?? ""} onChange={e => editItem(i, "calories", e.target.value)} placeholder="0" />
                <input className="it-num" inputMode="numeric" value={it.protein ?? ""} onChange={e => editItem(i, "protein", e.target.value)} placeholder="0" />
                <input className="it-num" inputMode="numeric" value={it.carbs ?? ""} onChange={e => editItem(i, "carbs", e.target.value)} placeholder="0" />
                <input className="it-num" inputMode="numeric" value={it.fat ?? ""} onChange={e => editItem(i, "fat", e.target.value)} placeholder="0" />
                <button className="it-del" onClick={() => removeItem(i)} aria-label="Remove item">✕</button>
              </div>
            ))}
          </div>
          <button className="add-item" onClick={addItem}>+ Add item</button>
          <div className="result-with-donut" style={{ marginTop: 14 }}>
            <MacroDonut protein={result.protein} carbs={result.carbs} fat={result.fat} />
            <div className="macros macros-compact">
              <div className="macro"><span className="macro-v">{result.calories}</span><span className="macro-l">kcal</span></div>
              <div className="macro"><span className="macro-v" style={{ color: "#b4a8e8" }}>{result.protein}g</span><span className="macro-l">protein</span></div>
              <div className="macro"><span className="macro-v" style={{ color: "#f9c97e" }}>{result.carbs}g</span><span className="macro-l">carbs</span></div>
              <div className="macro"><span className="macro-v" style={{ color: "#f47e6e" }}>{result.fat}g</span><span className="macro-l">fat</span></div>
            </div>
          </div>
          {result.notes && <p className="ai-card-note">{result.notes}</p>}
          {(() => { const r = estimateGlycemicLoad(result); return r.hasCarbs ? (
            <p className="ai-card-note" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><GLPill meal={result} /> <span className="muted small">{r.blunted ? "softened by the protein/fat here" : r.band === "high" ? "carb-heavy — pair with protein/fat or fibre to flatten the spike" : "gentle on blood sugar"}</span></p>
          ) : null; })()}
          <div className="row">
            <button className="btn flex" onClick={save}>+ Add to log</button>
            <button className="btn-ghost" onClick={() => { setResult(null); }}>Redo</button>
          </div>
        </div>
      )}
      </div>
      <SupplementCard data={data} addEntry={addEntry} deleteEntry={deleteEntry} />
      <ProteinTimingCard data={data} goals={goals} todayDiet={todayDiet} />
      <FuelCard data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} />
      <RecentList
        entries={[
          ...(recent || []).map(m => ({ ...m, _kind: "meal", _t: m.consumedAt ?? m.ts ?? new Date(`${m.date}T${m.time || "12:00"}:00`).getTime() })),
          ...(data.supplements || []).map(s => ({ ...s, _kind: "supp", _t: s.ts ?? 0 })),
        ].sort((a, b) => (b._t || 0) - (a._t || 0)).slice(0, 5)}
        render={e => e._kind === "supp"
          ? <><span className="ra-main">⊕ {[e.brand, e.name].filter(Boolean).join(" ")}{e.dose ? ` · ${e.dose}` : ""}</span><span className="ra-date">{formatShortDate(e.date)}</span></>
          : <><span className="ra-main">{e.meal} · {e.calories} kcal · {e.food.slice(0, 26)}{e.food.length > 26 ? "…" : ""} <GLPill meal={e} showValue={false} /></span><span className="ra-date">{formatShortDate(e.date)}</span></>}
      />
    </div>
  );
}

~~~~

### 3. src/brain/brain.js

~~~~js
// ─── THE BRAIN ────────────────────────────────────────────────────────────
// Digests all engines + raw logs into structured signals (buildBrain) and
// flattens them to the text every AI call reads (formatBrainText).
import { daysAgo, daysAgoFrom, getTodayStr, localDateStr, formatDate, formatShortDate, WEEKDAYS } from "../lib/dates";
import { avgTimeMins, avgTimeHHMM, minsOfTime } from "../lib/time";
import { computeWeightTrend } from "../engines/weight";
import { parseWorkout } from "../engines/workout";
import { computeProteinDistribution } from "../engines/protein";
import { computeEnergyBalance } from "../engines/energy";
import { computeTraining } from "../engines/training";
import { computeSleep, estimateSleepNeed, sleepTST } from "../engines/sleep";
import { computeRecovery } from "../engines/recovery";
import { computeCircadian, todaysBioNutrition, bioDayKey } from "../engines/circadian";
import { computeVolume } from "../engines/volume";
import { computeHistoricalPhases } from "../engines/historyPhases";
import { suggestTransitions } from "../engines/transitions";
import { computeRecoveryCapacity } from "../engines/recoveryCapacity";
import { computeFatigue } from "../engines/fatigue";
import { computeNicotineStats } from "../engines/nicotine";
import { computeSkin } from "../engines/skin";
import { computeCarbTiming } from "../engines/carbtiming";
import { planFueling, reconcileFueling, sleepWindow } from "../engines/fueling";
import { getDayContext } from "../engines/dayContext";

export function insightCategory(text) {
  const t = (text || "").toLowerCase();
  if (/sleep|bedtime|rested|circadian|awake|deload|overtrain/.test(t)) return "sleep/recovery";
  if (/protein|mps|feeding|leucine/.test(t)) return "protein";
  if (/carb|glycogen/.test(t)) return "carbs";
  if (/trend weight|%bw|lean-gain|gaining fast|losing fast|surplus|deficit|maintenance|calorie|kcal|under-eat|fuel/.test(t)) return "energy/weight";
  if (/volume|rpe|days in a row|days straight|training/.test(t)) return "training";
  if (/hydration|water/.test(t)) return "hydration";
  return "other";
}

export function prioritizeInsights(insights) {
  const impactByPriority = { critical: 100, important: 60, notable: 30 };
  const actionCue = /\b(shift|add|move|consider|recheck|aim|spread|reduce|increase|swap|deload|smaller|protect|raise|cut|keep|prioriti|eat)\b/i;
  const scored = (insights || []).map((ins, idx) => {
    let score = impactByPriority[ins.priority] ?? 20;
    if (ins.text.includes("—") || ins.text.includes(" - ")) score += 8; // embeds a "what to do"
    if (actionCue.test(ins.text)) score += 7;
    return { ...ins, category: insightCategory(ins.text), score, _idx: idx };
  });
  const ranked = scored.slice().sort((a, b) => b.score - a.score || a._idx - b._idx);
  // headline focus: highest-scored per category, up to 5 (keeps the top list diverse)
  const seen = new Set();
  const top = [];
  for (const i of ranked) {
    if (seen.has(i.category)) continue;
    seen.add(i.category);
    top.push(i);
    if (top.length >= 5) break;
  }
  return { ranked, top };
}

export function buildBrain(data, goals) {
  const now = new Date();
  const today = getTodayStr();
  const yesterday = daysAgo(1);
  // Nutrition is bucketed by the ACTIVE day (biological or calendar) via the gateway.
  // Everything non-nutrition (sleep, training, water, streak, timelines) stays calendar.
  const dayCtx = getDayContext(data, goals);
  const nutriToday = dayCtx.currentDayKey();
  const bioMode = dayCtx.mode === "biological";
  const todayName = WEEKDAYS[(now.getDay() + 6) % 7];
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeNow = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const timeOfDay = hour < 5 ? "late night" : hour < 11 ? "morning" : hour < 14 ? "midday" : hour < 18 ? "afternoon" : hour < 22 ? "evening" : "night";
  const isWeekend = todayName === "Sat" || todayName === "Sun";

  // ── Time windows
  const inWindow = (arr, days) => arr.filter(i => i.date >= daysAgo(days - 1));
  const last7 = a => inWindow(a, 7);
  const last14 = a => inWindow(a, 14);
  const last30 = a => inWindow(a, 30);

  // Helper: parse HH:MM into minutes since midnight, or null
  const minsOf = t => { if (!t) return null; const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? +m[1] * 60 + +m[2] : null; };

  // ── TODAY: nutrition + intake so far (active day — biological or calendar)
  const todayDiet = dayCtx.meals(nutriToday);
  const todayCal = todayDiet.reduce((a, m) => a + (m.calories || 0), 0);
  const todayP = todayDiet.reduce((a, m) => a + (m.protein || 0), 0);
  const todayC = todayDiet.reduce((a, m) => a + (m.carbs || 0), 0);
  const todayF = todayDiet.reduce((a, m) => a + (m.fat || 0), 0);
  const calRemaining = (goals.calories || 0) - todayCal;
  const pRemaining = (goals.protein || 0) - todayP;
  const cRemaining = (goals.carbs || 0) - todayC;
  const fRemaining = (goals.fat || 0) - todayF;
  const todayWaterMl = data.water.filter(w => w.date === today).reduce((a, w) => a + w.ml, 0);
  const waterRemainingMl = (goals.waterGoalMl || 0) - todayWaterMl;
  const todaySupps = data.supplements.filter(s => s.date === today);
  const todaySleep = data.sleep.find(s => s.date === today);
  const yestSleep = data.sleep.find(s => s.date === yesterday);
  const todayWorkout = data.exercise.find(e => e.date === today);
  const todaySport = data.sports.find(s => s.date === today);

  // Time since last meal
  const todayMealsWithTime = todayDiet.filter(m => m.time).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const lastMealTime = todayMealsWithTime.length ? todayMealsWithTime[todayMealsWithTime.length - 1].time : null;
  const hoursSinceLastMeal = (() => {
    if (!lastMealTime) return null;
    const m = minsOf(lastMealTime);
    const nowMins = hour * 60 + minute;
    const diff = nowMins - m;
    return diff >= 0 ? +(diff / 60).toFixed(1) : null;
  })();

  // ── PLAN
  const plan = goals.plan || null;
  const isTrainingDay = plan?.trainingDays?.includes(todayName) || false;
  const todayPlanLabel = plan?.assignments?.[todayName] || (isTrainingDay ? "Training day" : "Rest day");
  const tomorrowName = WEEKDAYS[(now.getDay() + 7) % 7];
  const tomorrowPlanLabel = plan?.assignments?.[tomorrowName] || (plan?.trainingDays?.includes(tomorrowName) ? "Training" : "Rest");

  // ── DAILY TIMELINES — chronological event list per day (last 7 days)
  // This is the heart of "mapping everything out." Each day becomes a sequence:
  //   08:15 Breakfast 450kcal P25g | 10:30 Workout (Push) | 13:00 Lunch 700kcal | ...
  function buildTimeline(date) {
    const events = [];
    data.diet.filter(d => d.date === date).forEach(m => events.push({ t: m.time || "??:??", kind: "meal", text: `${m.meal} ${m.calories}kcal P${m.protein}g`, sortKey: minsOf(m.time) ?? 9999 }));
    data.exercise.filter(e => e.date === date).forEach(e => {
      const p = e._parsed || parseWorkout(e.text || "");
      events.push({ t: e.time || "??:??", kind: "workout", text: `Workout: ${e.label}${p.totalVolume ? ` (${p.totalVolume}kg vol)` : ""}${e.prs?.length ? ` 🏆${e.prs.length}` : ""}`, sortKey: minsOf(e.time) ?? 9999 });
    });
    data.sports.filter(s => s.date === date).forEach(s => events.push({ t: s.time || "??:??", kind: "sport", text: `${s.sport} ${s.duration}min ${s.intensity}${s.calories ? ` ${s.calories}kcal` : ""}`, sortKey: minsOf(s.time) ?? 9999 }));
    data.water.filter(w => w.date === date).forEach(w => {
      const t = w.ts ? new Date(w.ts) : null;
      const ts = t ? `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}` : "??:??";
      events.push({ t: ts, kind: "water", text: `Water ${w.ml}ml`, sortKey: t ? t.getHours() * 60 + t.getMinutes() : 9999 });
    });
    data.supplements.filter(s => s.date === date).forEach(s => {
      const t = s.ts ? new Date(s.ts) : null;
      const ts = t ? `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}` : "??:??";
      events.push({ t: ts, kind: "supp", text: `Supp: ${s.name}${s.dose ? ` ${s.dose}` : ""}`, sortKey: t ? t.getHours() * 60 + t.getMinutes() : 9999 });
    });
    const slp = data.sleep.find(s => s.date === date);
    if (slp) events.push({ t: slp.bedtime || "??:??", kind: "sleep", text: `Slept ${slp.duration}h (${slp.quality}) until ${slp.wakeTime || "?"}`, sortKey: 0 });
    return events.sort((a, b) => a.sortKey - b.sortKey);
  }

  // Aggregate water by day for compactness, since dozens of entries would bloat the timeline
  function compactTimeline(events) {
    const waters = events.filter(e => e.kind === "water");
    const totalWater = waters.reduce((a, e) => { const m = /Water (\d+)ml/.exec(e.text); return a + (m ? +m[1] : 0); }, 0);
    const out = events.filter(e => e.kind !== "water");
    if (totalWater > 0) out.push({ t: "—", kind: "water", text: `Total water ${totalWater}ml`, sortKey: 9999 });
    return out;
  }

  const timelines = Array.from({ length: 7 }, (_, i) => {
    const d = daysAgo(6 - i);
    const events = compactTimeline(buildTimeline(d));
    return { date: d, dayName: WEEKDAYS[(new Date(d + "T00:00:00").getDay() + 6) % 7], events };
  });

  // ── 7-DAY NUTRITION (bucketed by active day)
  const dietWin7 = dayCtx.window(7);
  const dietByDay7 = {};
  Object.keys(dietWin7).forEach(dayKey => {
    dietWin7[dayKey].forEach(d => {
      if (!dietByDay7[dayKey]) dietByDay7[dayKey] = { cal: 0, p: 0, c: 0, f: 0, meals: 0, firstMeal: null, lastMeal: null };
      const day = dietByDay7[dayKey];
      day.cal += d.calories || 0;
      day.p += d.protein || 0;
      day.c += d.carbs || 0;
      day.f += d.fat || 0;
      day.meals++;
      if (d.time) {
        if (!day.firstMeal || d.time < day.firstMeal) day.firstMeal = d.time;
        if (!day.lastMeal || d.time > day.lastMeal) day.lastMeal = d.time;
      }
    });
  });
  const dietDays7 = Object.values(dietByDay7);
  const avgCal7 = dietDays7.length ? Math.round(dietDays7.reduce((a, d) => a + d.cal, 0) / dietDays7.length) : null;
  const avgP7 = dietDays7.length ? Math.round(dietDays7.reduce((a, d) => a + d.p, 0) / dietDays7.length) : null;
  const proteinHits7 = dietDays7.filter(d => d.p >= (goals.protein || 0)).length;
  const calDeficit7 = avgCal7 != null ? (goals.calories || 0) - avgCal7 : null;
  // Average first/last meal times across the week
  const firstMealTimes = dietDays7.map(d => d.firstMeal).filter(Boolean);
  const lastMealTimes = dietDays7.map(d => d.lastMeal).filter(Boolean);
  const avgFirstMeal = firstMealTimes.length ? avgTimeHHMM(firstMealTimes) : null;
  const avgLastMeal = lastMealTimes.length ? avgTimeHHMM(lastMealTimes) : null;

  // ── 14-day calorie trend (rising/falling) — bucketed by active day
  const dietWin14 = dayCtx.window(14);
  const trendBucket = (start, end) => {
    const days = {};
    Object.keys(dietWin14).forEach(k => { if (k >= start && k <= end) days[k] = dietWin14[k].reduce((a, m) => a + (m.calories || 0), 0); });
    const vs = Object.values(days);
    return vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) : null;
  };
  const recentHalf = trendBucket(daysAgo(6), today);
  const olderHalf = trendBucket(daysAgo(13), daysAgo(7));
  const calorieTrend = (recentHalf && olderHalf) ? (recentHalf - olderHalf) : null;

  // ── SLEEP
  const sleepIntel = computeSleep(data, goals);
  const sleepNeed = (sleepIntel?.need?.hours) ?? estimateSleepNeed(data, goals).hours;
  const last7Sleep = last7(data.sleep);
  const avgSleep7 = last7Sleep.length ? +(last7Sleep.reduce((a, s) => a + s.duration, 0) / last7Sleep.length).toFixed(1) : null;
  const sleepDebt7 = last7Sleep.reduce((d, s) => d + (sleepNeed - sleepTST(s)), 0);
  const sleepPatternIssue = last7Sleep.length >= 3 && avgSleep7 != null && avgSleep7 < sleepNeed - 0.5;
  // Average bedtime / wake time across the week
  const bedtimes = last7Sleep.map(s => s.bedtime).filter(Boolean);
  const wakeTimes = last7Sleep.map(s => s.wakeTime).filter(Boolean);
  const avgBedtime = bedtimes.length ? avgTimeHHMM(bedtimes, true) : null;
  const avgWakeTime = wakeTimes.length ? avgTimeHHMM(wakeTimes) : null;
  // Weekend vs weekday sleep gap
  const weekdaySleeps = last7Sleep.filter(s => { const wd = WEEKDAYS[(new Date(s.date + "T00:00:00").getDay() + 6) % 7]; return wd !== "Sat" && wd !== "Sun"; });
  const weekendSleeps = last7Sleep.filter(s => { const wd = WEEKDAYS[(new Date(s.date + "T00:00:00").getDay() + 6) % 7]; return wd === "Sat" || wd === "Sun"; });
  const wkdayAvgSleep = weekdaySleeps.length ? +(weekdaySleeps.reduce((a, s) => a + s.duration, 0) / weekdaySleeps.length).toFixed(1) : null;
  const wkendAvgSleep = weekendSleeps.length ? +(weekendSleeps.reduce((a, s) => a + s.duration, 0) / weekendSleeps.length).toFixed(1) : null;

  // ── TRAINING
  const last7Lifts = last7(data.exercise);
  const last7Sports = last7(data.sports);
  const last14Lifts = last14(data.exercise);
  const last7TotalSessions = last7Lifts.length + last7Sports.length;
  const volume7 = last7Lifts.reduce((sum, e) => sum + ((e._parsed || parseWorkout(e.text || "")).totalVolume || 0), 0);
  const volume7_olderHalf = inWindow(data.exercise, 14).filter(e => e.date < daysAgo(6)).reduce((sum, e) => sum + ((e._parsed || parseWorkout(e.text || "")).totalVolume || 0), 0);
  const volumeTrend = (volume7 && volume7_olderHalf) ? volume7 - volume7_olderHalf : null;
  // Average session RPE over last 7 days (from parsed Strong RPE), if logged
  const rpe7vals = last7Lifts.map(e => (e._parsed || parseWorkout(e.text || "")).avgRPE).filter(v => v != null);
  const avgRPE7 = rpe7vals.length ? +(rpe7vals.reduce((a, b) => a + b, 0) / rpe7vals.length).toFixed(1) : null;
  const trainingDates = new Set([...data.exercise.map(e => e.date), ...data.sports.map(s => s.date)]);
  let consecutiveTrained = 0;
  {
    let cur = new Date(); if (!trainingDates.has(getTodayStr())) cur.setDate(cur.getDate() - 1);
    for (;;) { const ds = localDateStr(cur); if (trainingDates.has(ds)) { consecutiveTrained++; cur.setDate(cur.getDate() - 1); } else break; }
  }
  const daysSinceLastRest = (() => {
    let c = 0; const cur = new Date();
    for (let i = 0; i < 14; i++) {
      const ds = localDateStr(cur);
      if (trainingDates.has(ds)) c++; else return c;
      cur.setDate(cur.getDate() - 1);
    }
    return c;
  })();
  const recentPRs = last14Lifts.flatMap(e => (e.prs || []).map(pr => ({ date: e.date, ...pr }))).slice(0, 5);

  // ── WATER PATTERNS
  const last7Water = last7(data.water);
  const waterByDay7 = {};
  last7Water.forEach(w => { waterByDay7[w.date] = (waterByDay7[w.date] || 0) + w.ml; });
  const avgWaterMl7 = Object.values(waterByDay7).length ? Math.round(Object.values(waterByDay7).reduce((a, b) => a + b, 0) / Object.values(waterByDay7).length) : null;

  // ── STREAK
  const dayHas = {};
  [...data.diet, ...data.sleep, ...data.exercise, ...data.sports, ...data.water, ...data.supplements].forEach(e => { if (e.date) dayHas[e.date] = true; });
  let streak = 0;
  {
    let cur = new Date(); if (!dayHas[getTodayStr()]) cur.setDate(cur.getDate() - 1);
    for (;;) { const ds = localDateStr(cur); if (dayHas[ds]) { streak++; cur.setDate(cur.getDate() - 1); } else break; }
  }

  // ── CROSS-CATEGORY PATTERNS
  // Sleep-on-training-day vs rest-day
  const trainNightSleep = last7Sleep.filter(s => trainingDates.has(s.date));
  const restNightSleep = last7Sleep.filter(s => !trainingDates.has(s.date));
  const trainNightAvg = trainNightSleep.length ? +(trainNightSleep.reduce((a, s) => a + s.duration, 0) / trainNightSleep.length).toFixed(1) : null;
  const restNightAvg = restNightSleep.length ? +(restNightSleep.reduce((a, s) => a + s.duration, 0) / restNightSleep.length).toFixed(1) : null;

  // ── WEIGHT TREND (A1 engine)
  const weightTrend = computeWeightTrend(data);

  // ── PROTEIN DISTRIBUTION / MPS (B1 engine)
  const proteinDist = computeProteinDistribution(data, goals);

  // ── RECOVERY (D1 engine — now fed to the Coach, not just the Plan card)
  const recovery = computeRecovery(data, goals);

  // ── ENERGY BALANCE / ADAPTIVE TDEE
  const energy = computeEnergyBalance(data, goals);

  // ── TRAINING INTELLIGENCE (per-lift progression + per-muscle volume)
  const training = computeTraining(data, goals);

  // ── SKIN INTELLIGENCE (separate lens — kept out of the physiology insight pool)
  const skin = computeSkin(data, goals);
  const carbTiming = computeCarbTiming(data, goals);
  const _sw = sleepWindow(data);
  const fuelPlan = planFueling({ sessions: (data.plannedSessions || []).filter(s => s.date === getTodayStr()), weightKg: goals && goals.profile && goals.profile.weightKg, goals, wakeMin: _sw.wakeMin, sleepMin: _sw.sleepMin });
  const fuelStatus = (fuelPlan && fuelPlan.blocks) ? reconcileFueling({ plan: fuelPlan, meals: dayCtx.meals(nutriToday), nowMin: new Date().getHours() * 60 + new Date().getMinutes() }) : null;

  // ── EJAC (private metric — neutral data only, NO insights/judgments generated)
  const ejacAll = data.ejac || [];
  const ejac30 = ejacAll.filter(e => e.date >= daysAgo(29));
  const ejacSummary = ejacAll.length ? {
    last7: ejacAll.filter(e => e.date >= daysAgo(6)).length,
    last30: ejac30.length,
    avgPerDay30: +(ejac30.length / 30).toFixed(2),
    pornPct30: ejac30.length ? Math.round(ejac30.filter(e => e.porn).length / ejac30.length * 100) : 0,
    goonPct30: ejac30.length ? Math.round(ejac30.filter(e => e.gooning).length / ejac30.length * 100) : 0,
  } : null;

  // ── DERIVED INSIGHTS — high-signal flags
  // Insights are now { text, priority: "critical" | "important" | "notable" }
  // Critical = recovery is at risk or strategy is broken; Important = clear pattern worth acting on;
  // Notable = mention only if the user's question is in that area.
  const insights = [];
  const wins = []; // things going well — used to reinforce positive behavior

  // --- CRITICAL: recovery / safety / strategy breaks ---
  if (consecutiveTrained >= 5) insights.push({ text: `Trained ${consecutiveTrained} days in a row with no rest — overtraining risk, deload strongly suggested`, priority: "critical" });
  else if (consecutiveTrained >= 4) insights.push({ text: `Trained ${consecutiveTrained} days in a row with no rest — deload signal`, priority: "important" });
  if (sleepDebt7 > 8) insights.push({ text: `Sleep debt accumulating fast: ${sleepDebt7.toFixed(1)}h short over last week — recovery compromised`, priority: "critical" });
  else if (sleepDebt7 > 5) insights.push({ text: `Sleep debt: ${sleepDebt7.toFixed(1)}h short over last week`, priority: "important" });
  if (sleepPatternIssue) insights.push({ text: `Avg sleep ${avgSleep7}h is below your ~${sleepNeed}h need — recovery limiter`, priority: avgSleep7 < sleepNeed - 1.5 ? "critical" : "important" });
  // Sleep Intelligence Engine — fold in the NEW dimensions (regularity, continuity,
  // disorder screening, cross-domain coupling) that the legacy sleep insights above
  // don't cover. Quantity is already handled above, so skip those to avoid dupes.
  if (sleepIntel) {
    sleepIntel.insights.filter(i => i.axis !== "quantity").forEach(i => insights.push({ text: i.text, priority: i.priority }));
  }
  // Adaptive TDEE / energy-balance insights (real maintenance, deficit/surplus, plateau, under-logging)
  if (energy && energy.ready) energy.insights.forEach(i => insights.push(i));
  // Training intelligence insights (stalls, neglected muscles, imbalances, progress)
  if (training) training.insights.forEach(i => insights.push(i));

  // --- IMPORTANT: nutrition and trend issues ---
  if (calDeficit7 != null && Math.abs(calDeficit7) > 400) {
    insights.push({ text: `7-day avg calories ${avgCal7} is ${Math.abs(calDeficit7)}kcal ${calDeficit7 > 0 ? "BELOW" : "ABOVE"} target — large gap from plan`, priority: "important" });
  } else if (calDeficit7 != null && Math.abs(calDeficit7) > 200) {
    insights.push({ text: `7-day avg calories ${avgCal7} is ${Math.abs(calDeficit7)}kcal ${calDeficit7 > 0 ? "below" : "above"} target`, priority: "notable" });
  }
  if (avgP7 != null && goals.protein && avgP7 < goals.protein * 0.75) {
    insights.push({ text: `Protein well below target: ${avgP7}g avg vs ${goals.protein}g target (${proteinHits7}/${dietDays7.length} days hit goal)`, priority: "important" });
  } else if (avgP7 != null && goals.protein && avgP7 < goals.protein * 0.85) {
    insights.push({ text: `Protein consistently a bit low: ${avgP7}g avg vs ${goals.protein}g target`, priority: "notable" });
  }
  if (calorieTrend != null && Math.abs(calorieTrend) > 300) {
    insights.push({ text: `Calorie intake ${calorieTrend > 0 ? "rising" : "falling"} sharply: ${calorieTrend > 0 ? "+" : ""}${calorieTrend}kcal/day vs prev week`, priority: "important" });
  }
  if (volumeTrend != null && Math.abs(volumeTrend) > 2000) {
    insights.push({ text: `Training volume ${volumeTrend > 0 ? "UP" : "DOWN"} ${Math.round(Math.abs(volumeTrend)).toLocaleString()}kg vs previous week`, priority: "important" });
  }
  if (last7TotalSessions === 0 && plan?.trainingDays?.length) {
    insights.push({ text: `No training in 7 days despite ${plan.trainingDays.length}-day/week plan`, priority: "important" });
  }
  if (avgWaterMl7 != null && goals.waterGoalMl && avgWaterMl7 < goals.waterGoalMl * 0.6) {
    insights.push({ text: `Hydration low: avg ${avgWaterMl7}ml/day vs ${goals.waterGoalMl}ml target`, priority: "important" });
  }

  // --- weight trend vs intent (only once there's enough signal) ---
  if (weightTrend && weightTrend.confidence !== "Low" && weightTrend.ratePerWeekG != null) {
    const pct = weightTrend.pctBWPerWeek;
    const goalLower = (goals.goal || "").toLowerCase();
    const phase = (goals.strategy?.phase || "").toLowerCase();
    const wantGain = goalLower.includes("muscle") || /bulk|surplus|gain/.test(phase);
    const wantLose = goalLower.includes("fat") || goalLower.includes("lose") || /cut|deficit/.test(phase);
    const rateStr = `${weightTrend.ratePerWeekG > 0 ? "+" : ""}${weightTrend.ratePerWeekG}g/wk`;
    if (wantGain && weightTrend.direction !== "gaining") {
      insights.push({ text: `Goal is to build muscle but trend weight is ${weightTrend.direction} (${rateStr}) — not the surplus the plan assumes; recheck intake vs true maintenance`, priority: "important" });
    } else if (wantLose && weightTrend.direction !== "losing") {
      insights.push({ text: `Goal is fat loss but trend weight is ${weightTrend.direction} (${rateStr}) — the intended deficit isn't translating to weight change`, priority: "important" });
    }
    if (pct != null && pct > 1.0) insights.push({ text: `Gaining fast: trend +${pct}%BW/wk, above the ~0.25–0.5%/wk lean-gain range — more of this is likely fat than muscle`, priority: "notable" });
    if (pct != null && pct < -1.2) insights.push({ text: `Losing fast: trend ${pct}%BW/wk — aggressive enough to risk muscle loss; a smaller deficit may protect lean mass`, priority: "notable" });
  }

  // --- protein distribution / MPS (B1 — no new data needed) ---
  if (proteinDist && proteinDist.confidence !== "Low") {
    const pd = proteinDist;
    const hittingTotal = pd.proteinGoal && pd.avgProtein >= pd.proteinGoal * 0.9;
    if (hittingTotal && pd.avgEffective < 3) {
      insights.push({ text: `Protein TOTAL is on point (${pd.avgProtein}g/day) but distribution isn't: only ${pd.avgEffective} of your meals/day cross the ~${pd.perMeal}g MPS threshold (aim 3–5). Same protein, more growth stimulus if you shift some earlier.`, priority: "important" });
    } else if (pd.avgEffective < 3 && pd.daysWithMeals >= 4) {
      insights.push({ text: `Few MPS-effective protein feedings: ${pd.avgEffective}/day cross ~${pd.perMeal}g (aim 3–5)`, priority: "notable" });
    }
    if (pd.avgSkew != null && pd.avgSkew >= 50) insights.push({ text: `Protein skewed: ~${pd.avgSkew}% of the day's protein lands in one meal — spreading it raises total daily MPS`, priority: "notable" });
    if (pd.avgLargestGap != null && pd.avgLargestGap >= 6) insights.push({ text: `Long protein gaps: ~${pd.avgLargestGap}h between feedings on average — a mid-gap feeding keeps MPS elevated`, priority: "notable" });
    if (pd.preEligibleDays >= 3 && pd.preOKDays / pd.preEligibleDays < 0.4) insights.push({ text: `Rarely a protein feeding near bedtime (${pd.preOKDays}/${pd.preEligibleDays} nights) — a ~30–40g pre-sleep dose may support overnight recovery`, priority: "notable" });
  }

  // --- NOTABLE: contextual patterns the AI should mention if relevant ---
  if (avgLastMeal && minsOf(avgLastMeal) > 21 * 60) insights.push({ text: `Eating late: avg last meal at ${avgLastMeal} — may affect sleep quality`, priority: "notable" });
  if (trainNightAvg != null && restNightAvg != null && Math.abs(trainNightAvg - restNightAvg) > 0.8) {
    insights.push({ text: `Sleep ${trainNightAvg > restNightAvg ? "BETTER" : "WORSE"} on training nights (${trainNightAvg}h vs ${restNightAvg}h on rest nights)`, priority: "notable" });
  }
  if (wkdayAvgSleep != null && wkendAvgSleep != null && Math.abs(wkdayAvgSleep - wkendAvgSleep) > 1.5) {
    insights.push({ text: `Weekend sleep ${wkendAvgSleep > wkdayAvgSleep ? "much longer" : "much shorter"} than weekdays (${wkdayAvgSleep}h vs ${wkendAvgSleep}h) — circadian disruption`, priority: "notable" });
  }

  // --- WINS: reinforce what's working ---
  if (avgP7 != null && goals.protein && avgP7 >= goals.protein * 0.95 && dietDays7.length >= 4) wins.push(`Protein dialed in: ${avgP7}g/day avg vs ${goals.protein}g target, ${proteinHits7}/${dietDays7.length} days on goal`);
  if (avgSleep7 != null && avgSleep7 >= 7.5) wins.push(`Sleep solid: ${avgSleep7}h/day avg`);
  if (last7TotalSessions >= (plan?.trainingDays?.length || 3) && plan?.trainingDays?.length) wins.push(`Training consistent: ${last7TotalSessions} sessions in the last 7 days`);
  if (recentPRs.length > 0) wins.push(`${recentPRs.length} recent PR${recentPRs.length === 1 ? "" : "s"}: ${recentPRs.slice(0, 2).map(p => `${p.name} ${p.weight}${p.unit}×${p.reps}`).join(", ")}`);
  if (streak >= 7) wins.push(`${streak}-day logging streak`);
  if (avgWaterMl7 != null && goals.waterGoalMl && avgWaterMl7 >= goals.waterGoalMl * 0.9) wins.push(`Hydration consistent: ${avgWaterMl7}ml/day avg`);
  if (weightTrend && weightTrend.confidence !== "Low" && weightTrend.pctBWPerWeek != null) {
    const pct = weightTrend.pctBWPerWeek, gl = (goals.goal || "").toLowerCase();
    if (gl.includes("muscle") && pct >= 0.15 && pct <= 0.6) wins.push(`Lean-gain pace dialed in: trend +${pct}%BW/wk`);
    if ((gl.includes("fat") || gl.includes("lose")) && pct <= -0.4 && pct >= -1.0) wins.push(`Fat-loss pace dialed in: trend ${pct}%BW/wk`);
  }
  if (proteinDist && proteinDist.confidence !== "Low" && proteinDist.avgEffective >= 3.5 && proteinDist.daysWithMeals >= 4) {
    wins.push(`Protein distribution dialed: ~${proteinDist.avgEffective} MPS-effective feedings/day`);
  }

  return {
    // Real-time awareness
    now: { iso: now.toISOString(), date: today, dayName: todayName, time: timeNow, hour, timeOfDay, isWeekend },
    circadian: (() => {      const c = computeCircadian(data, today);
      // NOTE: bio-day nutrition totals now live in todayProgress (bucketed by the
      // active day via DayContext). We only expose the boundary description here to
      // avoid double-counting the same calories with a second (possibly rounded) total.
      return {
        ready: c.ready, tier: c.tier, confidence: c.confidence,
        biologicalDayStart: c.biologicalDayStart, biologicalDayEnd: c.biologicalDayEnd,
        avgSleepTime: c.avgSleepTime, avgWakeTime: c.avgWakeTime, sleepConsistency: c.sleepConsistency,
        active: bioMode,
      };
    })(),
    weeklyVolume: (() => {
      const v = computeVolume(data, goals, today);
      if (!v.ready) return null;
      return {
        weekStart: v.weekStart,
        belowTarget: v.muscles.filter(m => m.target && m.thisWeek < m.target).map(m => ({ muscle: m.label, sets: m.thisWeek, target: m.target })),
        weakPoints: v.weakPoints.map(w => ({ muscle: w.label, sets: w.sets })),
        highest: v.summary.highest, lowest: v.summary.lowest, totalSets: v.summary.totalSets, musclesTrained: v.summary.musclesTrained,
        push: v.balance.push, pull: v.balance.pull, upper: v.balance.upper, lower: v.balance.lower,
      };
    })(),
    goal: goals.goal,
    strategicBrain: (() => {
      const hist = computeHistoricalPhases(data, goals.profile || {}, today);
      const rec = computeRecoveryCapacity(data, goals, today);
      const fat = computeFatigue(data, goals, today);
      const currentKind = hist.ready && hist.current ? hist.current.label : (goals.goal || "");
      const trans = currentKind ? suggestTransitions(currentKind, { weeksInPhase: hist.ready && hist.current ? hist.current.weeks : null }) : null;
      return {
        historicalPhases: hist.ready ? { tier: hist.tier, phases: hist.phases.map(p => ({ phase: p.label, start: p.start, end: p.end, weeks: p.weeks, avgCalories: p.avgCalories, rateKgWk: p.avgRateKgWk, estMaintenance: p.estMaintenance, tier: p.tier })), current: hist.current ? hist.current.label : null } : null,
        recoveryCapacity: rec.ready ? { score: rec.score, band: rec.band, confidence: rec.confidence, limiter: rec.limiter, eaCapped: rec.eaCapped, components: rec.components, tier: "estimate" } : null,
        fatigue: fat.ready ? { score: fat.finalFatigue, band: fat.band, confidence: fat.confidence, readiness: fat.readiness, e1rmTrendPct: fat.performance.e1rmTrendPct, loadRatio: fat.load.ratio, deloadRecommended: fat.deload.recommended, deloadCorroborators: fat.deload.corroborators, overreachedMuscles: fat.overreached, tier: "estimate" } : null,
        transitionSuggestion: trans ? { from: trans.fromLabel, recommended: trans.recommendedLabel, options: trans.options.map(o => o.label) } : null,
      };
    })(),
    targets: { calories: goals.calories, protein: goals.protein, carbs: goals.carbs, fat: goals.fat, waterMl: goals.waterGoalMl },
    todayProgress: {
      cal: todayCal, protein: todayP, carbs: todayC, fat: todayF,
      calRemaining, pRemaining, cRemaining, fRemaining,
      waterMl: todayWaterMl, waterRemainingMl,
      supplements: todaySupps.map(s => `${s.name}${s.dose ? ` (${s.dose})` : ""}`),
      sleep: todaySleep ? { duration: todaySleep.duration, quality: todaySleep.quality, bedtime: todaySleep.bedtime, wakeTime: todaySleep.wakeTime } : null,
      yesterdaySleep: yestSleep ? { duration: yestSleep.duration, quality: yestSleep.quality, bedtime: yestSleep.bedtime, wakeTime: yestSleep.wakeTime } : null,
      workoutLogged: !!todayWorkout, sportLogged: !!todaySport,
      meals: todayDiet.filter(d => !d.excludeFromCoach).map(d => ({ time: d.time, meal: d.meal, food: d.food, cal: d.calories, p: d.protein })),
      lastMealTime, hoursSinceLastMeal,
    },
    plan: plan ? { split: plan.split, todayLabel: todayPlanLabel, tomorrowLabel: tomorrowPlanLabel, trainingDays: plan.trainingDays, isTrainingDay, tomorrowName } : null,
    timelines, // chronological event sequence for each of the last 7 days
    week: {
      avgCal: avgCal7, avgProtein: avgP7, proteinHitDays: proteinHits7, daysLogged: dietDays7.length,
      avgSleep: avgSleep7, sleepDebt: +sleepDebt7.toFixed(1),
      avgBedtime, avgWakeTime, wkdayAvgSleep, wkendAvgSleep,
      avgFirstMeal, avgLastMeal,
      sessions: last7TotalSessions, volumeKg: Math.round(volume7), volumeTrend, calorieTrend, avgRPE: avgRPE7,
      consecutiveTrained, daysSinceLastRest,
      recentPRs, streak,
      avgWaterMl: avgWaterMl7,
      trainNightSleep: trainNightAvg, restNightSleep: restNightAvg,
    },
    insights,
    topInsights: prioritizeInsights(insights).top,
    wins,
    weight: weightTrend,
    proteinDist,
    sleepIntel,
    sleepScreen: goals.sleepScreen || null,
    energy,
    training,
    skin,
    carbTiming,
    fuelPlan,
    fuelStatus,
    recovery: {
      verdict: recovery.verdict,
      readiness: recovery.readiness,
      limiter: recovery.limiter,
      plannedToday: recovery.plannedToday,
      todayLabel: recovery.todayLabel,
      topNeg: recovery.reasons.filter(r => r.dir === "neg").slice(0, 4).map(r => r.text),
    },
    ejac: ejacSummary,
    profile: goals.profile || {},
    strategy: goals.strategy || {},
    nicotine: (() => {
      if (!data.nicotine || data.nicotine.length === 0) return null;
      const ns = computeNicotineStats(data);
      const plans = (data.nicotinePlans || []).filter(p => p.when && new Date(p.when) >= new Date(Date.now() - 3600000))
        .sort((a, b) => a.when.localeCompare(b.when)).slice(0, 3);
      return {
        today: ns.today.count, avg7: ns.avgCount7, mg7: ns.avg7, mg30: ns.avg30,
        last7: ns.w7.count, last30: ns.w30.count,
        types: ns.typeTotals, topContexts: ns.topContexts.map(([c]) => c),
        plannedSessions: plans.map(p => ({ when: p.when, label: p.label })),
      };
    })(),
    journal: (() => {
      const j = (data.journal || []).filter(e => e.date >= daysAgo(13)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      if (!j.length) return null;
      // Keep it bounded: most recent ~8 entries, trimmed.
      return j.slice(0, 8).map(e => ({ date: e.date, text: e.text.length > 280 ? e.text.slice(0, 280) + "…" : e.text }));
    })(),
  };
}

export function formatBrainText(brain) {
  const tp = brain.todayProgress;
  const w = brain.week;
  const n = brain.now;
  const lines = [];

  // ─── RIGHT NOW ────────────────────────────────────────────────────────────
  // The model is trained to hedge about real-time access by default. Tell it
  // explicitly that this block is authoritative.
  lines.push(`== RIGHT NOW (current real-time clock from user's device — this is authoritative; never claim you don't know what time/day it is) ==`);
  lines.push(`Date: ${n.date} (${n.dayName}${n.isWeekend ? ", weekend" : ""}) | Time: ${n.time} (${n.timeOfDay}) | Local ISO: ${n.iso}`);
  lines.push(`Goal: ${brain.goal}`);
  lines.push(`Targets — ${brain.targets.calories}kcal | P${brain.targets.protein}g C${brain.targets.carbs}g F${brain.targets.fat}g | water ${brain.targets.waterMl}ml`);
  if (brain.plan) {
    lines.push(`Plan: ${brain.plan.split} | Today: ${brain.plan.todayLabel} | Tomorrow (${brain.plan.tomorrowName}): ${brain.plan.tomorrowLabel} | Training days: ${brain.plan.trainingDays.join(", ")}`);
  }
  if (brain.circadian && brain.circadian.ready) {
    const cc = brain.circadian;
    lines.push(`Biological day (Calculated, ${cc.confidence} confidence): runs ${cc.biologicalDayStart} → ${cc.biologicalDayEnd} (avg sleep ${cc.avgSleepTime}, wake ${cc.avgWakeTime}, consistency ${cc.sleepConsistency}/100). Late-night meals before ${cc.biologicalDayEnd} count toward the prior day.${cc.active ? " The nutrition totals below ('TODAY SO FAR') are ALREADY bucketed by this biological day." : " (Biological-day grouping is currently OFF — nutrition totals below use calendar days.)"}`);
  }
  if (brain.weeklyVolume) {
    const wv = brain.weeklyVolume;
    const bt = wv.belowTarget.length ? ` Below goal-plan target: ${wv.belowTarget.map(b => `${b.muscle} ${b.sets}/${b.target}`).join(", ")}.` : "";
    const wk = wv.weakPoints.length ? ` Low/untrained (<6 sets): ${wv.weakPoints.slice(0, 4).map(w => `${w.muscle} ${w.sets}`).join(", ")}.` : "";
    lines.push(`Weekly muscle volume (Estimated, Mon–Sun hard sets): ${wv.totalSets} total across ${wv.musclesTrained}/28 muscles${wv.highest ? `, most ${wv.highest.label} (${wv.highest.sets})` : ""}. Volume balance — push ${wv.push} / pull ${wv.pull}, upper ${wv.upper} / lower ${wv.lower}.${bt}${wk} Reference this when the user asks about training volume or weak points; note these set→muscle counts are estimates.`);
  }

  if (brain.strategicBrain) {
    const sb = brain.strategicBrain;
    if (sb.historicalPhases && sb.historicalPhases.phases.length) {
      const ph = sb.historicalPhases.phases.slice(-5).map(p => `${p.phase} (${formatShortDate(p.start)}→${formatShortDate(p.end)}${p.rateKgWk != null ? `, ${p.rateKgWk > 0 ? "+" : ""}${p.rateKgWk}kg/wk` : ""})`).join(" → ");
      lines.push(`Where they came from — historical phases (${sb.historicalPhases.tier}, from intake + measured weight): ${ph}. Current physiological state: ${sb.historicalPhases.current}. Use this to ground any forward recommendation in where they actually are.`);
    }
    if (sb.recoveryCapacity) {
      const rc = sb.recoveryCapacity;
      lines.push(`Recovery capacity (Estimated, ${rc.confidence} confidence): ${rc.score}/100 — ${rc.band}${rc.limiter ? `, limited by ${rc.limiter}` : ""}${rc.eaCapped ? ", CAPPED by critically-low energy availability" : ""}. This is capacity to recover, NOT fatigue. Stress/mood isn't logged so that component is neutral.`);
    }
    if (sb.fatigue) {
      const ft = sb.fatigue;
      lines.push(`Fatigue (Estimated, ${ft.confidence} confidence): ${ft.score}/100 — ${ft.band}. Acute readiness ${ft.readiness}.${ft.e1rmTrendPct != null ? ` e1RM trend ${ft.e1rmTrendPct > 0 ? "+" : ""}${ft.e1rmTrendPct}%.` : ""}${ft.loadRatio != null ? ` Load ratio ${ft.loadRatio} (acute÷chronic).` : ""}${ft.deloadRecommended ? ` DELOAD recommended — ${ft.deloadCorroborators.join("; ")}.` : " No deload indicated."}${ft.overreachedMuscles.length ? ` Overreached: ${ft.overreachedMuscles.join(", ")}.` : ""} Energy/mood/soreness aren't logged, so wellness is a sleep proxy.`);
    }
    if (sb.transitionSuggestion && sb.transitionSuggestion.recommended) {
      lines.push(`Phase transition (suggestion only, never auto-applied): from ${sb.transitionSuggestion.from}, a sensible next phase is ${sb.transitionSuggestion.recommended} (options: ${sb.transitionSuggestion.options.join(", ")}).`);
    }
  }

  // ─── ABOUT THE USER (profile + strategy) ─────────────────────────────────
  const p = brain.profile || {};
  const s = brain.strategy || {};
  const profileBits = [];
  if (p.sex) profileBits.push(p.sex);
  if (p.age) profileBits.push(`${p.age}y`);
  if (p.heightCm) profileBits.push(`${p.heightCm}cm`);
  if (p.weightKg) profileBits.push(`${p.weightKg}kg`);
  if (p.trainingExp) profileBits.push(`${p.trainingExp} lifter`);
  const hasProfile = profileBits.length || p.injuries || p.allergies || p.equipment || p.preferences || p.lifeContext || p.liftingBackground;
  if (hasProfile) {
    lines.push("");
    lines.push("== ABOUT THE USER ==");
    if (profileBits.length) lines.push(`Body: ${profileBits.join(", ")}`);
    if (p.liftingBackground) lines.push(`Lifting background (historical, not current strategy):\n${p.liftingBackground}`);
    if (p.injuries) lines.push(`Injuries / limitations: ${p.injuries}  ← respect these. Avoid suggesting movements that conflict.`);
    if (p.allergies) lines.push(`Food allergies / restrictions: ${p.allergies}  ← never recommend foods on this list.`);
    if (p.equipment) lines.push(`Equipment access: ${p.equipment}`);
    if (p.preferences) lines.push(`Preferences: ${p.preferences}`);
    if (p.lifeContext) lines.push(`Current life context: ${p.lifeContext}  ← factor this into expectations and advice.`);
  }
  const hasStrategy = s.phase || s.focus || s.blockStarted || s.notes;
  if (hasStrategy) {
    lines.push("");
    lines.push("== CURRENT STRATEGY ==");
    const bits = [];
    if (s.phase) bits.push(`Phase: ${s.phase}`);
    if (s.focus) bits.push(`Focus: ${s.focus}`);
    if (s.blockStarted && s.blockWeeks) {
      // Compute which week of the block we're in
      const startMs = new Date(s.blockStarted + "T00:00:00").getTime();
      const weeksIn = Math.max(1, Math.floor((Date.now() - startMs) / (7 * 86400000)) + 1);
      bits.push(`Block: week ${weeksIn} of ${s.blockWeeks}`);
    } else if (s.blockStarted) {
      bits.push(`Block started: ${s.blockStarted}`);
    }
    if (bits.length) lines.push(bits.join(" | "));
    if (s.notes) lines.push(`Strategy notes: ${s.notes}`);
    lines.push(`Evaluate progress AGAINST this strategy — not in a vacuum.`);
  }

  // ─── TODAY SO FAR ─────────────────────────────────────────────────────────
  lines.push("");
  const bioActive = brain.circadian && brain.circadian.active;
  lines.push(`== TODAY SO FAR ==${bioActive ? " (Nutrition = the CURRENT BIOLOGICAL DAY, so a late-night meal logged after midnight still counts toward the day it belongs to. Water/supplements/sleep/workout below are calendar-day for " + n.date + ".)" : ` (${n.date} only — counts ONLY events dated ${n.date}, never yesterday)`}`);
  lines.push(`Nutrition consumed ${bioActive ? "this biological day" : "today"}: ${tp.cal}/${brain.targets.calories} kcal (${tp.calRemaining >= 0 ? tp.calRemaining + " remaining today" : Math.abs(tp.calRemaining) + " OVER today's target"}) | P ${tp.protein}/${brain.targets.protein}g (${tp.pRemaining > 0 ? tp.pRemaining + "g to go" : "hit"}) | C ${tp.carbs}g | F ${tp.fat}g`);
  lines.push(`Water today: ${tp.waterMl}/${brain.targets.waterMl}ml (${tp.waterRemainingMl > 0 ? tp.waterRemainingMl + "ml to go" : "hit"})`);
  if (tp.supplements.length) lines.push(`Supplements today: ${tp.supplements.join(", ")}`);
  if (tp.sleep) lines.push(`Slept last night: ${tp.sleep.duration}h (${tp.sleep.quality})${tp.sleep.bedtime ? `, ${tp.sleep.bedtime}→${tp.sleep.wakeTime}` : ""}`);
  else if (tp.yesterdaySleep) lines.push(`Most recent sleep log: ${tp.yesterdaySleep.duration}h (${tp.yesterdaySleep.quality}) — note: nothing logged for last night yet`);
  if (tp.workoutLogged) lines.push(`✓ Workout logged today`);
  if (tp.sportLogged) lines.push(`✓ Sport logged today`);
  if (tp.lastMealTime) lines.push(`Last meal today: ${tp.lastMealTime}${tp.hoursSinceLastMeal != null ? ` (${tp.hoursSinceLastMeal}h ago)` : ""}`);
  else lines.push(`No meals logged for today yet.`);

  // ─── KEY SIGNALS — ranked top priorities, then the rest grouped by tier ─────
  const topInsights = brain.topInsights || [];
  const topTexts = new Set(topInsights.map(i => i.text));
  const rest = brain.insights.filter(i => !topTexts.has(i.text));
  const critical = rest.filter(i => i.priority === "critical");
  const important = rest.filter(i => i.priority === "important");
  const notable = rest.filter(i => i.priority === "notable");
  if (topInsights.length || critical.length || important.length || notable.length) {
    lines.push("");
    lines.push("== KEY SIGNALS ==");
    if (topInsights.length) {
      lines.push("TOP PRIORITIES (ranked highest-leverage first — lead with #1 unless the user asks about something else):");
      topInsights.forEach((i, n) => lines.push(`  ${n + 1}. ${i.text}`));
    }
    if (critical.length) {
      lines.push("Other CRITICAL (address even if not asked):");
      critical.forEach(i => lines.push("  • " + i.text));
    }
    if (important.length) {
      lines.push("Other IMPORTANT (lead with if relevant):");
      important.forEach(i => lines.push("  • " + i.text));
    }
    if (notable.length) {
      lines.push("Notable (mention if the user's question is in this area):");
      notable.forEach(i => lines.push("  • " + i.text));
    }
  }

  // ─── WINS — what's going well, reinforce when natural ────────────────────
  if (brain.wins?.length) {
    lines.push("");
    lines.push("== WINS (acknowledge briefly when relevant, don't force) ==");
    brain.wins.forEach(w => lines.push("  ✓ " + w));
  }

  // ─── 7-DAY OVERVIEW ───────────────────────────────────────────────────────
  lines.push("");
  lines.push("== 7-DAY OVERVIEW ==");
  lines.push(`Calories: ${w.avgCal ?? "—"} avg (target ${brain.targets.calories}) across ${w.daysLogged} logged days${w.calorieTrend != null ? ` | trend vs prev wk: ${w.calorieTrend > 0 ? "+" : ""}${w.calorieTrend}kcal/day` : ""}`);
  lines.push(`Protein: ${w.avgProtein ?? "—"}g avg, hit goal ${w.proteinHitDays}/${w.daysLogged} days`);
  lines.push(`Sleep: ${w.avgSleep ?? "—"}h avg, debt ${w.sleepDebt}h${w.avgBedtime ? ` | avg bedtime ${w.avgBedtime}, wake ${w.avgWakeTime}` : ""}`);
  if (w.wkdayAvgSleep != null && w.wkendAvgSleep != null) {
    lines.push(`  Weekday sleep ${w.wkdayAvgSleep}h vs weekend ${w.wkendAvgSleep}h`);
  }
  if (w.trainNightSleep != null && w.restNightSleep != null) {
    lines.push(`  Sleep on training nights ${w.trainNightSleep}h vs rest nights ${w.restNightSleep}h`);
  }
  if (w.avgFirstMeal && w.avgLastMeal) {
    lines.push(`Meal timing: avg first meal ${w.avgFirstMeal}, avg last meal ${w.avgLastMeal} (eating window ~${meanGap(w.avgFirstMeal, w.avgLastMeal)}h)`);
  }
  lines.push(`Training: ${w.sessions} sessions | ${w.volumeKg.toLocaleString()}kg volume${w.volumeTrend != null ? ` (${w.volumeTrend > 0 ? "+" : ""}${w.volumeTrend.toLocaleString()}kg vs prev wk)` : ""} | ${w.consecutiveTrained}-day streak | ${w.daysSinceLastRest} days since rest`);
  if (w.avgRPE != null) lines.push(`Avg session RPE (last 7d): ${w.avgRPE}/10`);
  if (w.avgWaterMl != null) lines.push(`Water: ${w.avgWaterMl}ml/day avg`);
  if (w.recentPRs.length) lines.push(`Recent PRs: ${w.recentPRs.slice(0, 3).map(p => `${p.name} ${p.weight}${p.unit}×${p.reps} on ${p.date}`).join("; ")}`);
  lines.push(`Logging streak: ${w.streak} day${w.streak === 1 ? "" : "s"}`);

  // ─── BODYWEIGHT ───────────────────────────────────────────────────────────
  if (brain.weight) {
    const wt = brain.weight;
    lines.push("");
    lines.push("== BODYWEIGHT (trend weight is the smoothed line — it reflects real tissue change; the raw daily number is mostly water/glycogen/gut) ==");
    const rateStr = wt.ratePerWeekG != null
      ? `${wt.ratePerWeekG > 0 ? "+" : ""}${wt.ratePerWeekG}g/wk${wt.pctBWPerWeek != null ? ` (${wt.pctBWPerWeek > 0 ? "+" : ""}${wt.pctBWPerWeek}%BW/wk)` : ""}`
      : "rate not yet estimable";
    lines.push(`Trend weight: ${wt.current}kg | latest scale: ${wt.latestRaw}kg (${wt.latestDate}) | ${wt.nDays} weigh-ins over ${wt.spanDays}d | confidence: ${wt.confidence}`);
    lines.push(`Direction: ${wt.direction} — ${rateStr}`);
    if (Math.abs(wt.divergence) >= 0.6) {
      lines.push(`Note: latest scale reading is ${wt.divergence > 0 ? "above" : "below"} the trend by ${Math.abs(wt.divergence)}kg — likely water/glycogen, not real tissue change. Judge progress by the trend, not the daily number.`);
    }
    lines.push(`Use the TREND weight + rate for any energy-balance reasoning.${wt.confidence === "Low" ? " Confidence is Low (few weigh-ins) — treat the rate as provisional and avoid strong conclusions." : ""}`);
  }

  // ─── PROTEIN DISTRIBUTION (MPS) ───────────────────────────────────────────
  if (brain.proteinDist) {
    const pd = brain.proteinDist;
    lines.push("");
    lines.push("== PROTEIN DISTRIBUTION / MPS (distribution is a SEPARATE lever from daily total — 3–5 feedings each crossing the per-meal threshold beats the same protein skewed into 1–2 meals) ==");
    lines.push(`Per-meal MPS threshold: ~${pd.perMeal}g (${pd.bw ? `0.4g/kg × ${pd.bw}kg` : "default — no bodyweight set"}) | avg effective feedings/day: ${pd.avgEffective} (target 3–5) | avg daily protein: ${pd.avgProtein}g${pd.proteinGoal ? ` (goal ${pd.proteinGoal}g, hit ${pd.goalHitDays}/${pd.daysWithMeals}d)` : ""} | confidence: ${pd.confidence}`);
    if (pd.avgSkew != null) lines.push(`Skew: ~${pd.avgSkew}% of daily protein in the single biggest meal${pd.avgLargestGap != null ? ` | avg largest gap between feedings: ${pd.avgLargestGap}h` : ""}`);
    if (pd.preEligibleDays >= 1) lines.push(`Pre-sleep protein: ${pd.preOKDays}/${pd.preEligibleDays} nights had a ≥20g feeding within 3h of bedtime`);
    lines.push(`When advising on protein, treat DISTRIBUTION (per-meal dose + timing) separately from total grams — if the total is already met, the lever is spreading it, not "eat more protein".${pd.confidence === "Low" ? " Confidence Low (few logged days) — keep it gentle." : ""}`);
  }

  // ─── RECOVERY ─────────────────────────────────────────────────────────────
  if (brain.recovery) {
    const rc = brain.recovery;
    const vlabel = rc.verdict === "go" ? "good to train" : rc.verdict === "caution" ? "train with caution" : "rest";
    lines.push("");
    lines.push("== RECOVERY (today's training readiness) ==");
    lines.push(`Verdict: ${vlabel} | readiness: ${rc.readiness}/100 | plan today: ${rc.plannedToday ? rc.todayLabel : "rest day"}`);
    if (rc.limiter) {
      lines.push(`#1 LIMITER right now: ${rc.limiter.label}${rc.limiter.topReason ? ` — ${rc.limiter.topReason}` : ""}. If recovery comes up, name THIS specific bottleneck rather than generic "rest more" advice.`);
      const others = (rc.topNeg || []).filter(t => t !== rc.limiter.topReason).slice(0, 3);
      if (others.length) lines.push(`Other drags on recovery: ${others.join("; ")}`);
    } else {
      lines.push(`Nothing is meaningfully limiting recovery right now — fine to train as planned.`);
    }
  }

  // ─── SLEEP (the intelligence engine — three axes + cross-domain coupling) ──
  if (brain.sleepIntel) {
    const sl = brain.sleepIntel;
    const q = sl.quantity, r = sl.regularity, c = sl.continuity;
    lines.push("");
    lines.push("== SLEEP (modelled as 3 separate problems: quantity vs the user's OWN need, regularity/timing, and continuity/quality — never assume 8h is their target) ==");
    lines.push(`Personal sleep need: ${sl.need.hours}h (${sl.need.source}${sl.need.source === "learned" ? `, from ${sl.need.nGood} best nights` : ""}) | overall confidence: ${sl.confidence}`);
    lines.push(`Quantity: avg ${q.avgTST7 ?? "—"}h asleep/night (7d) vs ${q.need}h need — ${q.label}${q.debt7 > 0.5 ? `, ~${q.debt7}h debt this week` : ""}`);
    if (r.status) lines.push(`Regularity: ${r.label} (mid-sleep varies ±${r.midSD}min${r.socialJetlag != null ? `, social jetlag ${r.socialJetlag}h` : ""})${r.anchorWake ? ` | their anchor wake time ≈ ${r.anchorWake}` : ""}`);
    if (c.status) lines.push(`Continuity/quality: ${c.label}${c.avgEff != null ? ` (efficiency ${c.avgEff}%)` : ""}${c.avgLatency != null ? `, ~${c.avgLatency}min to fall asleep` : ""}${c.unrefreshing ? " — UNREFRESHING-SLEEP flag (enough hours, poor quality; possible disorder — encourage a clinician check, do NOT diagnose)" : ""}`);
    if (sl.coupling.length) {
      lines.push(`How sleep is shaping the rest of their body (correlations from their own data — never state as proven causation):`);
      sl.coupling.forEach(co => lines.push(`  • ${co.text}`));
    }
    if (sl.topLever) lines.push(`Biggest sleep lever right now: ${sl.topLever.text}`);
    if (brain.sleepScreen?.risk && brain.sleepScreen.risk.band !== "low") {
      const sk = brain.sleepScreen.risk;
      lines.push(`Sleep screen flagged: ${sk.osaCluster ? "possible OSA cluster; " : ""}${sk.insomniaCluster ? "insomnia pattern (CBT-I-treatable); " : ""}${sk.rls ? "restless-legs symptoms; " : ""}worth a clinician conversation. Reference supportively if sleep comes up; never diagnose.`);
    }
    lines.push(`SLEEP COACHING RULES: Treat the three axes as separate levers. If total sleep is fine but timing is irregular, the fix is regularity, not "sleep more". Anchor a fixed wake time as the #1 move. Do not chase sleep-stage/deep-sleep numbers (unreliable). Under a deficit, frame sleep as a muscle-retention tool.`);
  }

  // ─── ENERGY BALANCE / ADAPTIVE TDEE ───────────────────────────────────────
  if (brain.energy) {
    const en = brain.energy;
    lines.push("");
    if (!en.ready) {
      lines.push("== ENERGY BALANCE / TDEE ==");
      lines.push(`Not enough data to measure maintenance yet: ${en.reason} Do NOT estimate their TDEE from a formula or guess — say it's still being measured from their logs.`);
    } else {
      lines.push("== ENERGY BALANCE / TDEE (measured from their OWN intake + weight trend — this is real, not a Mifflin estimate) ==");
      lines.push(`Measured maintenance: ~${en.tdee} kcal/day | confidence: ${en.confidence} (${en.loggedDays} logged days, ${Math.round(en.completeness * 100)}% complete) | their target: ${en.currentTarget ?? "—"}`);
      lines.push(`At ~${en.meanIntake} kcal/day they're in a real ${en.realDelta < 0 ? `deficit of ~${Math.abs(en.realDelta)}` : en.realDelta > 0 ? `surplus of ~${en.realDelta}` : "neutral balance"}/day | trend weight ${en.weightRateKgWk > 0 ? "+" : ""}${en.weightRateKgWk}kg/wk | suggested intake for ${en.intent}: ~${en.recommendedIntake}`);
      if (en.underLogging) lines.push(`⚠ UNDER-LOGGING SUSPECTED: measured maintenance is implausibly low — their food logs are probably incomplete. Gently flag this; don't trust the deficit until logging tightens.`);
      if (en.plateau) lines.push(`PLATEAU: fat loss has stalled despite an apparent deficit — adaptation or under-logging. Reference this if they ask why the scale isn't moving.`);
      lines.push(`Use the MEASURED maintenance (not formulas) for any calorie-target advice. If their target and measured maintenance disagree, trust the measured number. Confidence ${en.confidence} — ${en.confidence === "Low" ? "treat as provisional and say so" : "solid enough to act on"}.`);
    }
  }

  // ─── TRAINING INTELLIGENCE (per-lift progression + per-muscle weekly volume) ─
  if (brain.training) {
    const tr = brain.training;
    lines.push("");
    lines.push("== TRAINING (progression = est-1RM trend per lift; volume = working sets/muscle/week. Progressive overload + weekly volume are the two evidence-based drivers. MEV/MAV/MRV landmark numbers are soft heuristics — guide with them, don't dictate) ==");
    if (tr.progression.lifts.length) {
      lines.push(`Lift progression (8wk): ${tr.progression.lifts.map(l => `${l.name} ${l.status}${l.status === "progressing" ? ` +${l.slopePct}%/wk` : ""} (~${l.e1rmNow}kg)`).join("; ")}`);
      if (tr.progression.stalls.length) lines.push(`STALLED/REGRESSING — needs a variable changed: ${tr.progression.stalls.map(l => l.name).join(", ")}. Suggest concrete fixes (add a set, change rep range + load, or deload), not generic "push harder".`);
    } else {
      lines.push(`Not enough repeated sessions yet to trend any single lift (need a lift logged 3+ times over 2+ weeks).`);
    }
    if (tr.week.trained.length) {
      lines.push(`This week's volume (working sets, fractional for secondary): ${tr.week.sortedVol.map(m => `${m.label} ${m.sets}`).join(", ")} — ${tr.week.sessions} sessions.`);
      if (tr.week.neglected.length) lines.push(`Under-trained majors (<6 sets): ${tr.week.neglected.join(", ")}.`);
      if (tr.week.imbalances.length) lines.push(`Imbalance: ${tr.week.imbalances[0]}.`);
    }
    if (tr.week.unmapped.length) lines.push(`Couldn't map these lifts to muscles (name didn't match): ${tr.week.unmapped.slice(0, 5).join(", ")} — their volume isn't counted, so don't claim total-body volume is complete.`);
    lines.push(`TRAINING COACHING RULES: For a stall, the fix is a changed variable, not more effort. ~10–20 hard sets/muscle/week is the rough productive range for growth; treat it as guidance, not law. Volume landmarks are individual.`);
  }

  // ─── PERSONAL METRIC (EJAC) — neutral data only, with guardrails ──────────
  if (brain.ejac) {
    const e = brain.ejac;
    lines.push("");
    lines.push("== PERSONAL METRIC (EJAC) — private behavioral tracker ==");
    lines.push(`Last 7d: ${e.last7} sessions | last 30d: ${e.last30} (avg ${e.avgPerDay30}/day) | porn ${e.pornPct30}% | gooning ${e.goonPct30}%`);
    lines.push(`GUARDRAILS: This is a neutral self-tracked metric. Only discuss it if the user explicitly raises it. Do NOT moralize, pathologize, judge, congratulate, shame, or give unsolicited health/behavioral advice about it. If the user asks, report the numbers factually and matter-of-factly.`);
  }

  // ─── NICOTINE ─────────────────────────────────────────────────────────────
  if (brain.nicotine) {
    const nic = brain.nicotine;
    lines.push("");
    lines.push("== NICOTINE ==");
    lines.push(`Today: ${nic.today} entries | 7-day: ${nic.last7} entries (${nic.avg7}/day) | 30-day: ${nic.last30} entries`);
    lines.push(`Est. nicotine load: ${nic.mg7}mg/day (7d), ${nic.mg30}mg/day (30d)`);
    const typeBits = Object.entries(nic.types).filter(([, v]) => v > 0).map(([t, v]) => `${t} ${v}`);
    if (typeBits.length) lines.push(`Type mix (30d): ${typeBits.join(", ")}`);
    if (nic.topContexts.length) lines.push(`Common triggers: ${nic.topContexts.join(", ")}`);
    if (nic.plannedSessions.length) {
      lines.push(`PLANNED sessions (user told you in advance — treat as EXPECTED, do NOT nag about these; instead help protect training/sleep around them):`);
      nic.plannedSessions.forEach(p => {
        const d = new Date(p.when);
        lines.push(`  • ${p.label} — ${d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`);
      });
    }
    lines.push(`NICOTINE COACHING RULES: The user is NOT trying to quit (maybe reduce). Do not lecture or push abstinence. Your job is timing guidance — help them keep intake away from the ~1-2h before training, the post-workout recovery window, and the 1-2h before sleep, since those are when it most blunts gains and recovery. When you cite effects on their data, be honest these are correlations not proven causation. Never invent precise figures like "X% of gains lost".`);
  }

  // ─── JOURNAL — the user's own words, the context behind the numbers ───
  if (brain.journal?.length) {
    lines.push("");
    lines.push("== JOURNAL (recent notes in the user's own words — use these for context; reference them naturally when relevant, e.g. how they've been feeling, life stress, injuries, what they tried) ==");
    brain.journal.forEach(e => lines.push(`[${e.date}] ${e.text}`));
    lines.push(`(These are personal reflections. Weigh them alongside the data — if they wrote they're stressed or hurt, factor that into recovery expectations. Don't quote them back verbatim unless it helps; weave the context in.)`);
  }


  // ─── DAY-BY-DAY TIMELINES — the chronological "map" the user asked for ───
  // For each of the last 7 days, list every event in order. Lets the model
  // see meal-to-workout gaps, late dinners, training-after-poor-sleep, etc.
  if (brain.timelines?.length) {
    lines.push("");
    lines.push("== DAY-BY-DAY TIMELINE (last 7 days, chronological) ==");
    lines.push("Each day shows events as they happened. Look for cross-category patterns: meal timing vs sleep, training vs energy intake, water gaps, etc.");
    brain.timelines.forEach(day => {
      if (!day.events.length) {
        lines.push(`${day.date} (${day.dayName}): no logs`);
        return;
      }
      lines.push(`${day.date} (${day.dayName}):`);
      day.events.forEach(e => {
        lines.push(`  ${e.t}  ${e.text}`);
      });
    });
  }

  // ─── FUEL PLAN (today's planned sessions → timed carb/protein targets) ────
  if (brain.fuelPlan && brain.fuelPlan.blocks && brain.fuelPlan.blocks.length) {
    const fp = brain.fuelPlan;
    lines.push("");
    lines.push("== TODAY'S FUEL PLAN (the user has planned sessions today; this is their periodized fuelling target. Honest: evidence-based starting points scaled to bodyweight + load, not exact truth — adjust by performance/gut. Help them follow or adapt it; for weight-cut/boxing defer to individual guidance) ==");
    lines.push(`Load: ${fp.loadLevel} → ~${fp.gPerKg} g/kg = ${fp.dailyCarbs}g carbs, ${fp.dailyProtein}g protein (~${fp.dailyCalories} kcal). Sessions: ${fp.sessions.map(s => `${s.label} ${s.time} ${s.durMin}min ${s.intensity}`).join("; ")}.`);
    lines.push("Timeline: " + fp.blocks.map(b => `${b.time} ${b.label} ${b.carbsG}gC${b.proteinG ? `/${b.proteinG}gP` : ""}`).join(" | "));
    if (brain.fuelStatus) {
      const fs = brain.fuelStatus;
      lines.push(`So far today: ${fs.consumedCarbs}g carbs / ${fs.consumedProtein}g protein eaten; ${fs.carbsLeft}g carbs + ${fs.proteinLeft}g protein still to go. Status: ${fs.status}. ${fs.advice}`);
    }
  }

  // ─── CARB TIMING (diet × training; honest — daily total dominates) ───────
  if (brain.carbTiming && brain.carbTiming.analyzed > 0) {
    const ct = brain.carbTiming;
    lines.push("");
    lines.push("== CARB TIMING (peri-workout carbs. HONESTY RULES: total daily carbs/protein dominate recovery & growth; the post-workout 'anabolic window' is largely a myth for once-a-day lifters — do NOT push it. The one real lever is PRE-fuel for hard/long sessions. Reassure when timing is fine) ==");
    lines.push(`Last ${ct.analyzed} sessions: avg ${ct.avgPre}g carbs in the 3h before, ${ct.avgPost}g in the 2h after. Fueled going in: ${ct.fueledPct}%. Trained essentially fasted: ${ct.fastedPct}%.${ct.morningFasted >= 2 ? " Fasted sessions cluster in the morning." : ""}`);
    lines.push(`Read: ${ct.status}. ${ct.lever}`);
  }

  // ─── SKIN (separate lens — guarded: non-diagnostic, no prescribing) ───────
  if (brain.skin) {
    const sk = brain.skin;
    lines.push("");
    lines.push("== SKIN (a separate domain; physiology-aware. NEVER diagnose a skin condition, NEVER recommend prescription actives or procedures — defer those to a dermatologist. Frame correlations as personal, not proven) ==");
    const skTrend = sk.condTrend != null ? `, trend ${sk.condTrend > 0 ? "+" : ""}${sk.condTrend}` : "";
    const skBreak = sk.breakouts14 != null ? ` | breakouts ~${sk.breakouts14}/log` : "";
    lines.push(`Condition (1–5, higher better): ${sk.avgCond14 ?? "—"} avg (14d)${skTrend}${skBreak} | confidence ${sk.confidence}`);
    if (sk.correlations.length) {
      lines.push(`Cross-domain patterns from their OWN data (correlation, not cause — and this is the unfair advantage no skincare app has):`);
      sk.correlations.forEach(c => lines.push(`  • [${c.evidence} evidence] ${c.text}`));
    }
    if (sk.conflicts.length) lines.push(`Routine conflicts flagged: ${sk.conflicts.join(" | ")}`);
    if (sk.procedures && sk.procedures.length) lines.push(`Procedures logged (most recent first): ${sk.procedures.map(p => `${p.type}${p.date ? ` on ${p.date}` : ""}${p.notes ? ` (${p.notes})` : ""}`).join(" | ")}`);
    lines.push(`SKIN COACHING RULES: lead with the best-evidenced levers (nicotine, sun/SPF strong; dairy/glycemic-load moderate; hydration weak — don't push water-for-skin). Suggest one-variable experiments over shotgun changes.`);
    lines.push(`ON PROCEDURES (microneedling, PRP, peels, lasers, etc.): you CAN educate — explain what a procedure does, the rough state of evidence, typical recovery/aftercare, how it interacts with their actives and physiology (e.g. don't microneedle over active retinoid irritation; nicotine slows healing), and what to ask a provider. You may help them weigh options against their goals and data. You must NOT prescribe a specific medical protocol, settings, depths, or substitute for an in-person assessment — send them to a qualified provider/dermatologist for the actual treatment decision and anything that looks medical (cystic/persistent acne, suspicious lesions, prescription actives).`);
  }

  return lines.join("\n");
}

export function meanGap(first, last) {
  const m1 = /^(\d{1,2}):(\d{2})/.exec(first);
  const m2 = /^(\d{1,2}):(\d{2})/.exec(last);
  if (!m1 || !m2) return "?";
  const mins = (+m2[1] * 60 + +m2[2]) - (+m1[1] * 60 + +m1[2]);
  return Math.max(0, +(mins / 60).toFixed(1));
}

~~~~

### 4. src/engines/glycemic.js

~~~~js
// ─── GLYCEMIC LOAD ESTIMATION ───────────────────────────────────────────────
// Honest by construction. This is NOT a lab-measured glycemic index and NOT your
// blood glucose. True GI requires standardized testing of each food; we don't
// have that. What we DO have is the carbs you logged — and carb QUANTITY is the
// dominant driver of glycemic load (GL), the meal-level metric that actually
// matters more than GI. So we estimate:
//     GL ≈ effectiveGI × carbs / 100
// where effectiveGI starts from a coarse food-type heuristic (keyword match on
// the meal name) and is then BLUNTED by the protein + fat in the same meal,
// which slow gastric emptying and flatten the spike. Always shown as an estimate.

import { lookupGI } from "./gi-database";

const GI_HIGH_RE = /\b(white rice|jasmine rice|sticky rice|fried rice|white bread|bagel|baguette|naan|roti|potato|mashed|fries|chips|crisps|corn ?flakes|cereal|granola|sugar|candy|sweets|soda|cola|soft drink|juice|\boj\b|smoothie|honey|jam|jelly|donut|doughnut|cake|cookie|biscuit|pastry|croissant|muffin|pretzel|cracker|rice cake|watermelon|pineapple|mango|dates|raisin|maple|syrup|gatorade|sports drink|energy drink|ice cream|pizza|pasta|noodle|ramen)\b/i;
const GI_LOW_RE = /\b(lentil|chickpea|chick pea|bean|kidney|hummus|oat|oatmeal|porridge|steel ?cut|quinoa|barley|bulgur|sweet potato|yam|berry|berries|strawberr|blueberr|raspberr|apple|pear|orange|cherry|plum|peach|grapefruit|yogurt|yoghurt|greek yog|milk|nut|almond|peanut|walnut|cashew|pistachio|avocado|broccoli|spinach|kale|lettuce|salad|greens|cucumber|tomato|pepper|carrot|cauliflower|zucchini|courgette|asparagus|cabbage|mushroom|\begg|chicken|beef|steak|pork|lamb|fish|salmon|tuna|shrimp|tofu|tempeh|cheese|cottage)\b/i;

export function estimateMealGI(meal) {
  const name = `${meal.food || meal.name || meal.label || meal.text || ""}`;
  // 1) Try the curated GI database first (real published values).
  const db = lookupGI(name);
  if (db) return { gi: db.gi, cls: db.gi >= 70 ? "high" : db.gi <= 45 ? "low" : "medium", source: "database", matches: db.matches };
  // 2) Fall back to the coarse keyword heuristic only when nothing's recognized.
  if (GI_HIGH_RE.test(name)) return { gi: 70, cls: "high", source: "estimate" };
  if (GI_LOW_RE.test(name)) return { gi: 38, cls: "low", source: "estimate" };
  return { gi: 55, cls: "medium", source: "estimate" };
}

// Per-meal estimated glycemic load. Returns hasCarbs:false when there's no carb
// data to work from (we don't invent a number in that case).
export function estimateGlycemicLoad(meal) {
  const carbs = Math.max(0, meal?.carbs || 0);
  if (carbs <= 0) return { gl: 0, band: "none", gi: null, hasCarbs: false };
  const { gi, cls, source, matches } = estimateMealGI(meal);
  const protein = Math.max(0, meal.protein || 0);
  const fat = Math.max(0, meal.fat || 0);
  // protein + fat alongside the carbs slows absorption — cap the blunt at 30%.
  const blunt = Math.min(1, (protein + fat) / Math.max(carbs, 1));
  const effGI = gi * (1 - 0.3 * blunt);
  const gl = Math.round((effGI * carbs) / 100);
  const band = gl < 10 ? "low" : gl < 20 ? "moderate" : "high";
  return { gl, band, gi: Math.round(effGI), baseGI: gi, giClass: cls, source, matches, blunted: blunt > 0.45, hasCarbs: true };
}

// Day total. Daily bands are deliberately loose (rough guidance, not a standard).
export function dayGlycemicLoad(meals) {
  let total = 0, any = false;
  (meals || []).forEach(m => { const r = estimateGlycemicLoad(m); if (r.hasCarbs) { total += r.gl; any = true; } });
  const band = !any ? "none" : total < 80 ? "low" : total <= 120 ? "moderate" : "high";
  return { total, band, hasData: any };
}

~~~~

### 5. src/engines/gi-database.js

~~~~js
// ─── GLYCEMIC INDEX REFERENCE DATABASE ──────────────────────────────────────
// Representative published GI values (glucose = 100) for common foods, drawn
// from the international GI tables (Atkinson/Foster-Powell/Brand-Miller). These
// are population-average lab values — real foods vary by ripeness, processing,
// and the person — so they feed an ESTIMATE, never a measured blood-glucose claim.
//
// Ordered SPECIFIC → GENERIC. The matcher consumes matched text as it goes, so
// "brown rice" is scored before the generic "rice" can catch the leftovers, and
// "sweet potato" before "potato".

export const GI_DB = [
  // ── rice (specific first) ──
  { re: /sweet potato fr/, gi: 63 },
  { re: /fried rice/, gi: 75 },
  { re: /brown rice/, gi: 68 },
  { re: /basmati/, gi: 58 },
  { re: /jasmine rice/, gi: 89 },
  { re: /(sticky|glutinous) rice/, gi: 86 },
  { re: /wild rice/, gi: 57 },
  { re: /rice noodle/, gi: 53 },
  { re: /rice cake/, gi: 82 },
  { re: /rice krispies/, gi: 82 },
  // ── bread ──
  { re: /(whole ?wheat|wholemeal|whole ?grain|multigrain) bread/, gi: 74 },
  { re: /white bread/, gi: 75 },
  { re: /sourdough/, gi: 54 },
  { re: /rye bread|pumpernickel/, gi: 56 },
  { re: /garlic bread/, gi: 70 },
  { re: /\bnaan\b/, gi: 71 },
  { re: /\bpita\b/, gi: 57 },
  { re: /baguette|french bread/, gi: 95 },
  { re: /\bbagel/, gi: 69 },
  { re: /corn tortilla/, gi: 46 },
  { re: /tortilla|wrap\b/, gi: 30 },
  // ── breakfast cereals / oats ──
  { re: /steel ?cut oat/, gi: 52 },
  { re: /instant oat|quick oat/, gi: 79 },
  { re: /(rolled )?oat|oatmeal|porridge|overnight oat/, gi: 55 },
  { re: /corn ?flakes/, gi: 81 },
  { re: /bran flakes|all.?bran/, gi: 74 },
  { re: /weetabix/, gi: 74 },
  { re: /muesli/, gi: 57 },
  { re: /granola/, gi: 55 },
  { re: /\bcereal/, gi: 74 },
  // ── pasta / noodles ──
  { re: /(whole ?wheat|wholemeal) pasta/, gi: 42 },
  { re: /spaghetti|pasta|penne|macaroni|fusilli|linguine/, gi: 49 },
  { re: /lasagna|lasagne/, gi: 50 },
  { re: /instant noodle|ramen/, gi: 47 },
  { re: /udon|noodle/, gi: 55 },
  // ── potato ──
  { re: /sweet potato|yam\b/, gi: 63 },
  { re: /mashed potato/, gi: 87 },
  { re: /baked potato|jacket potato/, gi: 85 },
  { re: /(french )?fries|chips\b/, gi: 75 },
  { re: /potato (chip|crisp)|crisps/, gi: 56 },
  { re: /\bpotato/, gi: 78 },
  // ── grains ──
  { re: /quinoa/, gi: 53 },
  { re: /barley/, gi: 28 },
  { re: /bulgur/, gi: 48 },
  { re: /couscous/, gi: 65 },
  { re: /millet/, gi: 71 },
  { re: /buckwheat/, gi: 45 },
  { re: /polenta|cornmeal/, gi: 68 },
  { re: /popcorn/, gi: 65 },
  { re: /sweet ?corn|\bcorn\b/, gi: 52 },
  // ── legumes ──
  { re: /baked beans/, gi: 40 },
  { re: /kidney bean/, gi: 24 },
  { re: /black bean/, gi: 30 },
  { re: /pinto bean/, gi: 39 },
  { re: /chick ?pea|garbanzo/, gi: 28 },
  { re: /hummus/, gi: 6 },
  { re: /lentil|dal\b|daal/, gi: 32 },
  { re: /soy ?bean|soya|edamame/, gi: 18 },
  { re: /\bbean/, gi: 30 },
  { re: /\bpeas\b/, gi: 51 },
  // ── fruit ──
  { re: /watermelon/, gi: 76 },
  { re: /pineapple/, gi: 59 },
  { re: /\bmango/, gi: 51 },
  { re: /banana/, gi: 51 },
  { re: /\bapple\b/, gi: 36 },
  { re: /\borange\b/, gi: 43 },
  { re: /grapefruit/, gi: 25 },
  { re: /grape/, gi: 46 },
  { re: /strawberr/, gi: 41 },
  { re: /blueberr/, gi: 53 },
  { re: /raspberr|blackberr/, gi: 32 },
  { re: /cherr/, gi: 20 },
  { re: /peach|nectarine/, gi: 42 },
  { re: /\bpear\b/, gi: 38 },
  { re: /\bplum/, gi: 24 },
  { re: /kiwi/, gi: 50 },
  { re: /melon|cantaloupe/, gi: 65 },
  { re: /dried apricot/, gi: 30 },
  { re: /apricot/, gi: 34 },
  { re: /raisin/, gi: 64 },
  { re: /\bdate\b|dates|medjool/, gi: 55 },
  // ── dairy ──
  { re: /greek yog/, gi: 11 },
  { re: /yog(h)?urt/, gi: 36 },
  { re: /chocolate milk/, gi: 42 },
  { re: /(skim|skimmed|low.?fat) milk/, gi: 32 },
  { re: /\bmilk\b/, gi: 31 },
  { re: /ice ?cream/, gi: 51 },
  // ── sweets / drinks ──
  { re: /dark chocolate/, gi: 23 },
  { re: /chocolate|nutella/, gi: 40 },
  { re: /\bhoney\b/, gi: 58 },
  { re: /maple syrup/, gi: 54 },
  { re: /agave/, gi: 15 },
  { re: /\bsugar\b/, gi: 65 },
  { re: /\bjam\b|jelly|marmalade/, gi: 50 },
  { re: /cola|soda|soft drink|pepsi|coke\b|sprite|fanta/, gi: 63 },
  { re: /gatorade|powerade|sports drink/, gi: 78 },
  { re: /energy drink|red bull|monster/, gi: 70 },
  { re: /(orange|apple|grape|cranberry) juice/, gi: 46 },
  { re: /\bjuice\b/, gi: 50 },
  { re: /smoothie/, gi: 55 },
  // ── baked goods / snacks ──
  { re: /croissant/, gi: 67 },
  { re: /donut|doughnut/, gi: 76 },
  { re: /muffin/, gi: 60 },
  { re: /pancake|waffle/, gi: 67 },
  { re: /pretzel/, gi: 83 },
  { re: /cracker|crispbread/, gi: 70 },
  { re: /cookie|biscuit/, gi: 55 },
  { re: /\bcake\b/, gi: 60 },
  { re: /pastry|croissant|danish/, gi: 59 },
  { re: /\bpizza/, gi: 36 },
  // ── veg with notable carbs ──
  { re: /pumpkin|squash/, gi: 75 },
  { re: /beet(root)?/, gi: 64 },
  { re: /parsnip/, gi: 52 },
  { re: /\bcarrot/, gi: 39 },
  // ── low-carb proteins/fats (rarely contribute, but anchor "low") ──
  { re: /peanut|almond|cashew|walnut|pistachio|\bnuts?\b/, gi: 15 },
  { re: /\btofu\b|tempeh/, gi: 15 },
  // ── generic grains last ──
  { re: /\brice\b/, gi: 73 },
  { re: /\bbread\b|toast/, gi: 73 },
];

// Look up a GI for a free-text food name. Returns null if nothing matches.
// Consumes matched substrings so generic patterns don't double-count specifics.
export function lookupGI(rawName) {
  let s = " " + String(rawName || "").toLowerCase() + " ";
  const hits = [];
  for (const e of GI_DB) {
    if (e.re.test(s)) {
      hits.push(e.gi);
      s = s.replace(e.re, " ");
    }
  }
  if (!hits.length) return null;
  const gi = Math.round(hits.reduce((a, b) => a + b, 0) / hits.length);
  return { gi, matches: hits.length };
}

~~~~

### 6. src/engines/dayContext.js

~~~~js
// ─── DAY CONTEXT — the single source of truth for "what day is this?" ─────────
// Every NUTRITION calculation goes through here instead of reading data.diet or
// comparing date strings directly. One gateway means there is exactly one place
// that decides how a meal maps to a day — calendar or biological.
//
// Biological day = a day that resets at the user's habitual sleep ONSET, not at
// midnight. The onset boundary is FROZEN PER ISO-WEEK from a rolling sleep mean:
// a meal logged in week N always uses week N's boundary forever, so historical
// totals never silently shift as the user's sleep schedule drifts. Future weeks
// adapt automatically.
//
// `consumedAt` (when the food was eaten) is authoritative. `loggedAt` (when Save
// was pressed) is audit-only and never used for bucketing.
import { localDateStr, daysAgoFrom } from "../lib/dates";
import { avgTimeMins, minsOfTime } from "../lib/time";
import { computeCircadian } from "./circadian";

const DAY = 86400000;

// ── authoritative timestamp for a meal (tolerates legacy rows: no consumedAt/ts/id) ──
export function mealTs(m) {
  if (!m) return null;
  if (m.consumedAt != null) return m.consumedAt;
  if (m.ts != null) return m.ts;
  if (m.date) return new Date(`${m.date}T${m.time || "12:00"}:00`).getTime();
  return null;
}

// Derive consumedAt/loggedAt for the write path. Never stores biologicalDayId
// (the boundary moves; a stored key would go stale). Read-time only.
export function normMeal(m) {
  const consumedAt = mealTs(m);
  const looksEpoch = typeof m.id === "number" && m.id > 1e12;
  const loggedAt = m.loggedAt ?? (looksEpoch ? m.id : consumedAt);
  return { ...m, consumedAt, loggedAt };
}

// ── ISO-week key (Thursday-based), lexically sortable: "2026-W07" ──
function isoWeekKey(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (date.getDay() + 6) % 7;          // Mon=0
  date.setDate(date.getDate() - day + 3);        // Thursday of this week
  const firstThu = new Date(date.getFullYear(), 0, 4);
  const fday = (firstThu.getDay() + 6) % 7;
  firstThu.setDate(firstThu.getDate() - fday + 3);
  const week = 1 + Math.round((date - firstThu) / (7 * DAY));
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── period-frozen boundary history, memoized by data.sleep identity ──
const _histCache = new WeakMap();
export function buildBoundaryHistory(data) {
  const sleepArr = (data && data.sleep) || [];
  const cached = _histCache.get(sleepArr);
  if (cached) return cached;

  const sleeps = sleepArr
    .filter(s => s && s.bedtime && s.date && minsOfTime(s.bedtime) != null)
    .map(s => ({ date: s.date, bed: s.bedtime }))   // avgTimeMins parses "HH:MM" strings
    .sort((a, b) => a.date.localeCompare(b.date));

  let result;
  if (sleeps.length < 3) {
    result = { byWeek: {}, weekKeys: [], latest: null, ready: false };
  } else {
    const wkOf = s => isoWeekKey(new Date(s.date + "T12:00:00"));
    const weeks = [...new Set(sleeps.map(wkOf))].sort();
    const byWeek = {};
    for (const wk of weeks) {
      const upto = sleeps.filter(s => wkOf(s) <= wk).slice(-21);   // trailing 21 as of week-end
      if (upto.length >= 3) byWeek[wk] = avgTimeMins(upto.map(s => s.bed)); // circular mean (minutes)
    }
    const last21 = sleeps.slice(-21);
    const latest = last21.length >= 3 ? avgTimeMins(last21.map(s => s.bed)) : null;
    const weekKeys = Object.keys(byWeek).sort();
    result = { byWeek, weekKeys, latest, ready: latest != null };
  }
  _histCache.set(sleepArr, result);
  return result;
}

// Frozen onset boundary (minute-of-day) for the week a timestamp falls in.
export function boundaryForTs(ts, history) {
  if (!history || !history.ready) return null;
  const wk = isoWeekKey(new Date(ts));
  if (history.byWeek[wk] != null) return history.byWeek[wk];
  let best = null;                                  // nearest earlier week
  for (const k of history.weekKeys) { if (k <= wk) best = history.byWeek[k]; else break; }
  if (best != null) return best;
  return history.weekKeys.length ? history.byWeek[history.weekKeys[0]] : history.latest;
}

// ── DayContext provider, memoized by (data identity + toggle) ──
let _ctxCache = null; // { data, enabled, ctx }
export function getDayContext(data, goals) {
  const enabled = goals?.nutrition?.biologicalDay !== false; // default ON
  if (_ctxCache && _ctxCache.data === data && _ctxCache.enabled === enabled) return _ctxCache.ctx;

  const history = enabled ? buildBoundaryHistory(data) : null;
  const circ = enabled ? computeCircadian(data) : null;        // display only (live average)
  const mode = enabled && history && history.ready ? "biological" : "calendar";
  const diet = (data && data.diet) || [];

  const boundaryFor = ts => (mode === "biological" ? boundaryForTs(ts, history) : null);

  // Single cut at the sleep-ONSET boundary, labeled by the day you're awake for.
  // AM onset (sleeps after midnight, b<12:00): early hours before onset belong to the
  //   PREVIOUS calendar day (a 1 AM snack still counts toward yesterday's waking day).
  // PM onset (sleeps in the evening, b>=12:00): the bio day ends at onset, so anything
  //   AT/AFTER onset rolls into the NEXT calendar day; daytime stays put.
  const dayKeyOf = meal => {
    const ts = mealTs(meal);
    if (ts == null) return meal?.date ?? null;
    if (mode === "calendar") return localDateStr(new Date(ts));
    const b = boundaryFor(ts);
    if (b == null) return localDateStr(new Date(ts));
    const d = new Date(ts);
    const tod = d.getHours() * 60 + d.getMinutes();
    if (b >= 720) return tod >= b ? localDateStr(new Date(ts + DAY)) : localDateStr(d);
    return tod < b ? localDateStr(new Date(ts - DAY)) : localDateStr(d);
  };

  const currentDayKey = (now) => dayKeyOf({ consumedAt: now == null ? Date.now() : now });

  let _bucket = null;
  const bucket = () => {
    if (_bucket) return _bucket;
    const out = {};
    diet.forEach(m => { const k = dayKeyOf(m); if (k != null) (out[k] = out[k] || []).push(m); });
    _bucket = out;
    return out;
  };
  const meals = dayKey => bucket()[dayKey] || [];
  const totals = dayKey => meals(dayKey).reduce((a, m) => ({
    cal: a.cal + (m.calories || 0), protein: a.protein + (m.protein || 0),
    carbs: a.carbs + (m.carbs || 0), fat: a.fat + (m.fat || 0),
  }), { cal: 0, protein: 0, carbs: 0, fat: 0 });

  // last n active days, inclusive of the current day → { dayKey: Meal[] }
  const window = nDays => {
    const b = bucket();
    const lo = daysAgoFrom(currentDayKey(), nDays - 1);
    const out = {};
    Object.keys(b).forEach(k => { if (k >= lo) out[k] = b[k]; });
    return out;
  };

  const ctx = {
    mode, circ, history,
    mealTs, dayKeyOf, currentDayKey, meals, bucket, totals, window, boundaryFor,
    // resolve a chosen day-key + clock time into a stored {date,time,consumedAt}.
    // A time before that day's onset boundary belongs to the NEXT calendar date.
    resolveConsumedAt(dayKey, time) {
      const mins = minsOfTime(time);
      let calDate = dayKey;
      if (mode === "biological" && mins != null) {
        const b = boundaryForTs(new Date(`${dayKey}T12:00:00`).getTime(), history);
        if (b != null) {
          if (b >= 720 && mins >= b) calDate = daysAgoFrom(dayKey, 1);       // PM onset, after onset → prev calendar date
          else if (b < 720 && mins < b) calDate = daysAgoFrom(dayKey, -1);   // AM onset, early hours → next calendar date
        }
      }
      const t = time || "12:00";
      return { date: calDate, time: t, consumedAt: new Date(`${calDate}T${t}:00`).getTime() };
    },
  };

  _ctxCache = { data, enabled, ctx };
  return ctx;
}

~~~~

### 7. src/config.js

~~~~js
// ─── APP CONFIG / CONSTANTS ─────────────────────────────────────────────────────
// Pure, dependency-light constants shared across views. Extracted from App.jsx so
// lazily-loaded view modules can import these directly without pulling in App.jsx.
import { STORAGE_KEY } from "./lib/keys";

export const TABS = ["Home", "Log", "History", "Coach", "Journal", "Settings", "Ejac"];

// Single source of truth for the fallback sleep need (hours) when nothing is
// learned or set. Imported by sleep.js, sleepScore.js, and GoalPlan.jsx.
export const DEFAULT_SLEEP_NEED_H = 8;

export const defaultData = { sleep: [], diet: [], exercise: [], sports: [], water: [], supplements: [], supplementLib: [], nicotine: [], nicotinePlans: [], journal: [], weight: [], ejac: [], skin: [], skinResearch: [], skinProcedures: [], plannedSessions: [], skinRoutineLogs: [], skinProductIntros: [], skinRoutineChanges: [], skinCoachPlans: [], goalSnapshots: [], goalReports: [], completedPhases: [], decisionLog: [], constraintSnapshots: [] };

export const defaultProfile = {
  // Body
  sex: "", age: "", heightCm: "", weightKg: "",
  // Background
  trainingExp: "", // beginner | intermediate | advanced
  liftingBackground: "", // free text — historical PRs, years lifting, lifetime context (not strategy)
  // Constraints
  injuries: "", // free text
  allergies: "", // free text
  equipment: "", // gym | home | minimal | other
  // Preferences and short-term life context
  preferences: "", // free text
  lifeContext: "", // free text - "stressful work month", "sister's wedding in 8wks", etc
  // Sleep
  sleepNeedH: "", // optional override of learned individual sleep need (hours)
};

export const defaultStrategy = {
  phase: "", // bulk | cut | maintenance | recomp | performance | (empty)
  focus: "", // strength | hypertrophy | conditioning | fat loss | general
  blockStarted: "", // YYYY-MM-DD when current block started
  blockWeeks: "", // target length of current block, e.g. "6"
  notes: "", // free text — anything else the AI should know about strategy right now
};

export const defaultGoals = { calories: 2500, protein: 180, carbs: 250, fat: 80, goal: "Build Muscle", waterGoalMl: 2500, profile: defaultProfile, strategy: defaultStrategy, sleepScreen: null, sleepExperiment: null, skinRoutine: { am: [], pm: [] }, skinExperiment: null, goalPlan: null, macroMode: "manual", nutrition: { biologicalDay: true } };
export const fitnessGoals = ["Build Muscle", "Lose Fat", "Improve Endurance", "Maintain Weight", "Athletic Performance"];
export const mealTypes = ["Breakfast", "Pre-workout", "Post-workout", "Lunch", "Dinner", "Snack"];
export const sportsOptions = ["Running","Football","Basketball","Tennis","Swimming","Cycling","Yoga","Boxing","Soccer","Volleyball","Badminton","Table Tennis","Golf","Martial Arts","Hiking","Walking","Rowing","Climbing","Other"];
export const sleepQuality = ["Poor", "Fair", "Good", "Great", "Excellent"];
export const intensityLevels = ["Light", "Moderate", "Intense", "All-out"];

// ─── NICOTINE ─────────────────────────────────────────────────────────────────
export const NIC_TYPES = [
  { key: "cigarette", label: "Cigarette", icon: "🚬", unit: "cigarettes", combustion: true },
  { key: "vape", label: "Vape", icon: "💨", unit: "puffs", combustion: false },
  { key: "pouch", label: "Pouch", icon: "⬜", unit: "pouches", combustion: false },
];
export const NIC_CONTEXTS = ["craving", "stress", "social", "post-meal", "post-workout", "boredom", "drinking", "after waking"];
// One-tap defaults shown as quick-add chips. User's common entries.
export const NIC_QUICK = [
  { type: "cigarette", amount: 1, label: "1 cig" },
  { type: "vape", amount: 10, label: "Vape (10 puffs)" },
  { type: "vape", amount: 1, label: "1 puff" },
  { type: "pouch", amount: 1, mg: 6, label: "Pouch 6mg" },
];

// ─── WORKOUT PLANNING ─────────────────────────────────────────────────────────
export const SPLIT_TYPES = [
  "Push / Pull / Legs",
  "Upper / Lower",
  "Full Body",
  "Bro Split (1 muscle/day)",
  "Arnold Split",
  "Custom",
];
export const defaultPlan = { split: "Push / Pull / Legs", trainingDays: ["Mon", "Tue", "Thu", "Fri", "Sat"], assignments: {}, notes: "" };

export const TYPE_DOT = { sleep: "#6ee7f7", diet: "#f9c97e", exercise: "#f47e6e", sports: "#8fd989", water: "#5cc8df", supplements: "#b4a8e8", nicotine: "#d98fa8", weight: "#e8c97e", ejac: "#9aa8e8" };
export const TYPE_ICON = { sleep: "◐", diet: "◉", exercise: "◆", sports: "◇", water: "◊", supplements: "⊕" };

// ─── AI MODEL PREFERENCE ──────────────────────────────────────────────────────
export const MODELS = {
  haiku: { id: "claude-haiku-4-5", label: "Haiku", desc: "Fast & cheap — great for everyday logging" },
  sonnet: { id: "claude-sonnet-4-20250514", label: "Sonnet", desc: "Smartest — best accuracy, costs ~12x more" },
};
let _currentModel = (() => { try { return localStorage.getItem(STORAGE_KEY + "_model") === "sonnet" ? "sonnet" : "haiku"; } catch { return "haiku"; } })();
export function loadModelPref() {
  try { return localStorage.getItem(STORAGE_KEY + "_model") === "sonnet" ? "sonnet" : "haiku"; } catch { return "haiku"; }
}
export function saveModelPref(key) { localStorage.setItem(STORAGE_KEY + "_model", key); _currentModel = key; }
export function currentModelId() { return MODELS[_currentModel]?.id || MODELS.haiku.id; }

~~~~

### 8. src/types/models.ts

~~~~ts
// ─── PERSISTED DATA MODEL ───────────────────────────────────────────────────
// Types for everything FitLog stores in localStorage (keys `fitlog_v5*`) and
// mirrors to Supabase. Hand-derived from the write paths in the log forms and
// the defaults in config.js. Fields are marked optional where legacy rows (or
// certain code paths) may omit them — the goal is to describe reality, not to
// force a shape the running app doesn't already produce.

/** `YYYY-MM-DD` in the user's LOCAL timezone (see lib/dates.localDateStr). */
export type ISODate = string;
/** Epoch milliseconds (Date.now()). */
export type Millis = number;

/** Common fields on every log row. `id` is Date.now() at creation time. */
export interface BaseEntry {
  id: number;
  date: ISODate;
  /** Wall-clock creation timestamp. For meals this equals `consumedAt`. */
  ts?: Millis;
}

// ─── NUTRITION ──────────────────────────────────────────────────────────────
/** One resolved food line inside a multi-item meal capture. */
export interface DietItem {
  food: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * A logged meal.
 *
 * TIMESTAMP CONTRACT (the known silent-corruption risk — see report):
 *  - `consumedAt` = when the food was actually eaten. AUTHORITATIVE for all
 *    biological-day bucketing and protein-feeding ordering.
 *  - `ts`         = legacy/compat timestamp. New rows are written with
 *    `ts === consumedAt`; older rows may have `ts` but no `consumedAt`.
 *  - `loggedAt`   = when Save was pressed. Audit-only; never used for bucketing.
 *  Always resolve a meal's real time through engines/dayContext.mealTs(), which
 *  falls back consumedAt → ts → epoch(id). Reading `.ts` directly is only safe
 *  when the row is known to be new (ts === consumedAt).
 */
export interface DietEntry extends BaseEntry {
  meal: string;                 // meal type, e.g. "Breakfast" (see config.mealTypes)
  food: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  time?: string;                // "HH:MM" clock time
  consumedAt?: Millis;          // authoritative — may be absent on legacy rows
  loggedAt?: Millis;            // audit-only
  when?: string;                // the "When" selector choice at log time
  affectCoach?: boolean;
  excludeFromCoach?: boolean;
  items?: DietItem[];           // multi-item editable capture
  confidence?: "high" | "medium" | "low";
  notes?: string;
}

export interface WaterEntry extends BaseEntry {
  ml: number;
}

export interface SupplementEntry extends BaseEntry {
  name: string;
  dose: string;
  brand?: string;               // set when logged from a library item
}

/** A saved supplement definition (the "library"), added via AI product lookup. */
export interface SupplementLibItem {
  id: number;
  name: string;
  brand?: string;
  dose?: string;                // default single serving
  form?: string;                // powder | capsule | tablet | liquid | gummy | other
  serving?: string;             // serving-size text from the label
  notes?: string;               // key active + amount per serving
}

// ─── TRAINING ───────────────────────────────────────────────────────────────
export interface PR {
  name: string;
  weight: number;
  unit: string;
  reps: number;
}

/** One set within a parsed exercise. `rpe` present only when the user logged it. */
export interface ParsedSet {
  weight?: number;
  unit?: string;
  reps?: number;
  rpe?: number | null;
}

export interface ParsedExercise {
  name: string;
  sets: ParsedSet[];
}

/** Output of engines/workout.parseWorkout(), cached on the entry as `_parsed`. */
export interface ParsedWorkout {
  exercises: ParsedExercise[];
  totalVolume?: number;
  avgRPE?: number | null;
}

export interface ExerciseEntry extends BaseEntry {
  time?: string;
  label?: string;               // session label, e.g. "Push day"
  text: string;                 // raw pasted Strong-format text
  _parsed?: ParsedWorkout;      // cached parse
  prs?: PR[];
}

export interface SportsEntry extends BaseEntry {
  sport: string;
  duration: number;             // minutes
  intensity?: string;           // see config.intensityLevels
  calories?: number;
  time?: string;
  opponent?: string;
  score?: string;
  result?: string;
  notes?: string;
}

// ─── WELLNESS ───────────────────────────────────────────────────────────────
export interface SleepEntry extends BaseEntry {
  duration: number;             // hours in bed (TIB), NOT sleep time
  quality?: string;             // see config.sleepQuality
  bedtime?: string;             // "HH:MM"
  wakeTime?: string;            // "HH:MM"
  latencyMin?: number;          // mins to fall asleep (optional detail)
  wakeMin?: number;             // mins awake in the night (optional detail)
  notes?: string;
  alarmUsed?: boolean;          // true/false only if the user tapped; omitted when untouched
}

export type NicotineType = "cigarette" | "vape" | "pouch";

export interface NicotineEntry extends BaseEntry {
  type: NicotineType;
  amount: number;
  mg?: number;                  // pouch strength
  contexts?: string[];          // see config.NIC_CONTEXTS
}

export interface WeightEntry extends BaseEntry {
  kg: number;
}

export interface EjacEntry extends BaseEntry {
  porn: boolean;
  gooning: boolean;
}

// ─── GOALS / PROFILE / STRATEGY ─────────────────────────────────────────────
export interface Profile {
  sex: string;
  age: string | number;
  heightCm: string | number;
  weightKg: string | number;
  trainingExp: string;          // beginner | intermediate | advanced
  liftingBackground: string;
  injuries: string;
  allergies: string;
  equipment: string;            // gym | home | minimal | other
  preferences: string;
  lifeContext: string;
  sleepNeedH: string | number;
}

export interface Strategy {
  phase: string;                // bulk | cut | maintenance | recomp | performance | ""
  focus: string;
  blockStarted: string;         // YYYY-MM-DD
  blockWeeks: string | number;
  notes: string;
}

export interface TrainingPlan {
  split: string;                // see config.SPLIT_TYPES
  trainingDays: string[];       // weekday abbreviations, e.g. "Mon"
  assignments: Record<string, unknown>;
  dayReasons?: Record<string, string>;
  notes: string;
}

export interface NutritionSettings {
  biologicalDay: boolean;
}

/**
 * The Goal Plan V3 phase-based planner. Its internal phase shape is large and
 * lives in engines/phaseV3; kept loose here since it is not part of the
 * timestamp-correctness surface this migration targets.
 */
export interface GoalPlanV3 {
  active?: boolean;
  phases?: unknown[];
  [key: string]: unknown;
}

export interface Goals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  goal: string;                 // see config.fitnessGoals
  waterGoalMl: number;
  macroMode: "manual" | "auto";
  nutritionOverride?: boolean;
  profile: Profile;
  strategy: Strategy;
  plan?: TrainingPlan;
  nutrition: NutritionSettings;
  sleepScreen?: unknown | null;
  sleepExperiment?: unknown | null;
  skinRoutine?: { am: unknown[]; pm: unknown[] };
  skinExperiment?: unknown | null;
  goalPlan?: unknown | null;    // legacy V1 plan
  goalPlanV3?: GoalPlanV3 | null;
  exerciseMap?: Record<string, string>;
  onboarded?: boolean;
  sleepNeedH?: number;
}

// ─── TOP-LEVEL STORE SHAPE ──────────────────────────────────────────────────
/** Everything under the `fitlog_v5` localStorage key (see config.defaultData). */
export interface AppData {
  sleep: SleepEntry[];
  diet: DietEntry[];
  exercise: ExerciseEntry[];
  sports: SportsEntry[];
  water: WaterEntry[];
  supplements: SupplementEntry[];
  /** User's saved supplement library (definitions), populated via AI product lookup. */
  supplementLib: SupplementLibItem[];
  nicotine: NicotineEntry[];
  nicotinePlans: unknown[];
  journal: unknown[];
  weight: WeightEntry[];
  ejac: EjacEntry[];
  skin: unknown[];
  skinResearch: unknown[];
  skinProcedures: unknown[];
  plannedSessions: unknown[];
  skinRoutineLogs: unknown[];
  skinProductIntros: unknown[];
  skinRoutineChanges: unknown[];
  skinCoachPlans: unknown[];
  goalSnapshots: unknown[];
  goalReports: unknown[];
  completedPhases: unknown[];
  decisionLog: unknown[];
  constraintSnapshots: unknown[];
}

/** A key of AppData whose value is an array of log rows. */
export type EntryType = keyof AppData;

~~~~

---

## Part 2 — The AI contract

### 2.1 Model, provider, transport

`analyzeFoodAI` → `callClaude` → `fetch("/api/chat")`. The browser never talks to Anthropic directly. It POSTs to a **same-origin Vercel serverless proxy** (`api/chat.js`) that injects the key server-side and forwards to `https://api.anthropic.com/v1/messages`.

**Model id** comes from `currentModelId()` (`src/config.js:85`):

~~~~js
export const MODELS = {
  haiku:  { id: "claude-haiku-4-5",         label: "Haiku",  desc: "Fast & cheap — great for everyday logging" },
  sonnet: { id: "claude-sonnet-4-20250514", label: "Sonnet", desc: "Smartest — best accuracy, costs ~12x more" },
};
// default is haiku unless the user picked sonnet in settings
export function currentModelId() { return MODELS[_currentModel]?.id || MODELS.haiku.id; }
~~~~

**Default model is Haiku** (`claude-haiku-4-5`) — the cheapest/weakest tier. Sonnet is opt-in.

**Request builder** — `callClaude` (`src/api/client.jsx:57-82`):

~~~~js
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
  const resp = await fetch("/api/chat", { method: "POST", headers, body: JSON.stringify(body) });
  const data = await resp.json();
  return data.content?.filter(b => b.type === "text").map(b => b.text || "").join("") || "";
}
~~~~

**The food-analysis call** — `analyzeFoodAI` (`src/api/client.jsx:213-241`):

~~~~js
const raw = await callClaude({
  model: currentModelId(),
  maxTokens: useWeb ? 1500 : 1100,
  tools: useWeb ? WEB_SEARCH_TOOL : undefined,
  system: `...` /* full prompt quoted in 2.2 */,
  userText: description
    ? `Analyze the nutrition of: "${description}".${useWeb ? " Search for official data if this is a branded or restaurant item." : ""}`
    : `Identify EVERY food item in this image and analyze the total nutrition for the whole meal shown.${useWeb ? " If you recognize a branded or restaurant dish, search for its official nutrition facts." : ""}`,
  imageBase64, imageMediaType,
});
~~~~

So per call: `model` = currentModelId (haiku default), `max_tokens` = **1100** (no web) or **1500** (web), `tools` = web-search only when `useWeb`.

**Proxy enforcement** (`api/chat.js`): model allowlist `{claude-haiku-4-5, claude-sonnet-4-20250514}`, `MAX_TOKENS_CAP = 4000`, `MAX_BODY_BYTES = 5 MB`, `MAX_MESSAGES = 100`, best-effort in-memory rate limit 30/min per user-or-IP, origin allowlist, optional Supabase JWT verification. It forwards **only** `model, max_tokens, messages, system, tools` — drops anything else the client sends.

### 2.2 The entire food-analysis prompt (verbatim)

`useWeb` and `isImage` are booleans; `${todayPart}` is the flattened brain text (see 2.6) appended to the **system** prompt. System prompt (`src/api/client.jsx:217-236`):

~~~~text
You are a meticulous nutritionist analyzing real meals. Estimate nutrition as ACCURATELY as possible.

[if image] STEP 1 — LOOK CAREFULLY AT THE PHOTO. Before estimating, identify:
- Every food item you can see (don't miss sides, drinks, condiments, garnishes)
- The cooking method (fried/grilled/baked/raw — affects calories a lot)
- Portion size (compare to plate/utensils/hand in frame)
- Visible ingredients like oil, butter, sauce, cheese, dressing
STEP 2 — Combine everything into total numbers for the whole meal shown.

RULES:
- [useWeb] For branded/restaurant/packaged foods, search the web for the official published nutrition facts and use those exact numbers.
  [no web] Use precise USDA-style values from your knowledge of real foods.
- Account for cooking method, oil/butter, sauces, and realistic portion sizes.
- Be realistic — restaurant and fried foods are calorie-dense.
- If multiple items are visible, SUM them all.
- Break the meal into its individual foods/drinks in an "items" array (one entry per distinct item). If there's only one food, return a single-element "items" array. The top-level calories/protein/carbs/fat MUST equal the exact sum of the items — these top-level totals are the authoritative numbers.
- The "notes" field MUST comment on how this meal fits the user's remaining day using SPECIFIC numbers from the context (e.g. "puts you at 1850/2500 cal with 65g protein left", "uses most of today's fat budget — go lean at dinner"). Reference the CURRENT STRATEGY if it provides direction (cut → call out high-calorie hits; bulk → call out under-eating).
- If the meal contains anything in the user's allergies/restrictions, mention it in notes — but still return the estimate.

Reply with ONLY this JSON object (no prose before or after, no markdown fence):
{"items":[{"food":"<single food/drink name>","calories":<integer>,"protein":<integer grams>,"carbs":<integer grams>,"fat":<integer grams>}],"food":"<concise overall meal name>","calories":<integer total = sum of items>,"protein":<integer grams total>,"carbs":<integer grams total>,"fat":<integer grams total>,"confidence":"high|medium|low","notes":"<fit-to-day comment with concrete numbers, 1-2 sentences>"}
[+ todayPart: the flattened brain text, prefixed "For context, the user's current day so far ..."]
~~~~

User prompt: text mode → `Analyze the nutrition of: "<description>".`; image mode → `Identify EVERY food item in this image and analyze the total nutrition for the whole meal shown.` (each with an extra web-search clause when `useWeb`).

### 2.3 Expected response schema + parsing/validation

**Schema** (one line, `src/api/client.jsx:236`):

~~~~json
{"items":[{"food":"str","calories":int,"protein":int,"carbs":int,"fat":int}],
 "food":"str","calories":int,"protein":int,"carbs":int,"fat":int,
 "confidence":"high|medium|low","notes":"str"}
~~~~

**Extraction** — `extractJSON` (`src/api/client.jsx:111-137`) with `scanBalancedObject` (`90-107`). Strategy: strip ```` ``` ```` fences → slice first `{` … last `}` → drop trailing commas → `JSON.parse`; on failure retry with smart-quotes normalized; then a balanced-brace salvage scan tolerating trailing prose. If all fail it **throws**.

**On malformed output**: `analyzeFoodAI` wraps the whole thing in `try/catch` and the empty-string guard (`242-244`):

~~~~js
if (!raw || !raw.trim()) return null;
return extractJSON(raw);
// } catch (e) { return null; }
~~~~

So any parse failure → `null`. `DietForm.analyze()` (`src/views/DietForm.jsx:521-522`) then shows a generic error and nothing is logged/retried:

~~~~js
if (r && typeof r.calories === "number") setResult(withItems(r));
else setError(mode === "image" ? "Couldn't read that photo well. ..." : "Couldn't analyze that. ...");
~~~~

**The only ingest validation is `typeof r.calories === "number"`.** There is **no check that the top-level totals equal the sum of `items`**, and no clamping/rounding of the raw AI numbers on ingest.

**Confidence** is taken verbatim from the model's `confidence` string and rendered as a badge (`src/views/DietForm.jsx:787`). It is never validated, defaulted, or used to gate/re-prompt.

**`withItems`** guarantees an items array exists (`src/views/DietForm.jsx:541-543`) but passes the model's numbers straight through.

### 2.4 Images (resize, media types, size)

`fileToResizedBase64` (`src/api/client.jsx:11-34`):

~~~~js
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
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg", preview: dataUrl });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
~~~~

- Longest side clamped to **1280 px**, **JPEG q0.85**, always re-encoded to `image/jpeg`. Never upscales.
- Sent as a base64 `image` content block (`callClaude:60-63`).
- Call site passes defaults (`DietForm.jsx:515`: `fileToResizedBase64(file, 1280, 0.85)`).
- No client-side byte check; the only size limit is the proxy's **5 MB** body cap (`api/chat.js:22`), sized to fit one inline image.
- **No EXIF-orientation handling** — the canvas draw can mis-orient some phone photos.

### 2.5 What the web-search toggle changes

`useWeb` (a UI checkbox, default off) flips three things (`src/api/client.jsx:215-239`):

~~~~js
maxTokens: useWeb ? 1500 : 1100,
tools:     useWeb ? WEB_SEARCH_TOOL : undefined,
// RULE line swaps to: "...search the web for the official published nutrition facts..."
// userText gains: " Search for official data if this is a branded or restaurant item."
~~~~

`WEB_SEARCH_TOOL` (`src/api/client.jsx:85`):

~~~~js
export const WEB_SEARCH_TOOL = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
~~~~

`callClaude` only reads `.type === "text"` blocks from the response, discarding the web-search result blocks (`client.jsx:81`).

### 2.6 What context the model actually receives (`buildBrain` → `formatBrainText`)

`analyzeFoodAI` receives a `brain` object (built by `buildBrain(data, goals)` in `DietForm.analyze()` at `DietForm.jsx:519`), flattens it with `formatBrainText`, and appends it to the system prompt as `todayPart` (`client.jsx:210-211`). So the model gets **the entire day-brain as text**, not just the meal.

`buildBrain` returns a large structured object (`src/brain/brain.js:406-512`) with keys:

`now, circadian, weeklyVolume, goal, strategicBrain, targets, todayProgress, plan, timelines, week, insights, topInsights, wins, weight, proteinDist, sleepIntel, sleepScreen, energy, training, skin, carbTiming, fuelPlan, fuelStatus, recovery, ejac, profile, strategy, nicotine, journal`.

`formatBrainText` (`src/brain/brain.js:515-871`) turns that into a long plaintext block with sections: `RIGHT NOW`, `ABOUT THE USER`, `CURRENT STRATEGY`, `TODAY SO FAR`, `KEY SIGNALS`, `WINS`, `7-DAY OVERVIEW`, `BODYWEIGHT`, `PROTEIN DISTRIBUTION`, `RECOVERY`, `SLEEP`, `ENERGY BALANCE`, `TRAINING`, `DAY-BY-DAY TIMELINE`, `FUEL PLAN`, `CARB TIMING`, `SKIN`, etc.

Illustrative (fake-data) excerpt of the text the model sees appended to the food prompt:

~~~~text
== RIGHT NOW (current real-time clock from user's device — authoritative...) ==
Date: 2026-07-08 (Wed) | Time: 13:20 (midday) | Local ISO: 2026-07-08T13:20:...
Goal: Build Muscle
Targets — 2500kcal | P180g C250g F80g | water 2500ml
Plan: Push / Pull / Legs | Today: Push | Tomorrow (Thu): Pull | Training days: Mon, Tue, Thu, Fri, Sat

== ABOUT THE USER ==
Body: male, 27y, 178cm, 80kg, intermediate lifter
Food allergies / restrictions: shellfish  ← never recommend foods on this list.

== CURRENT STRATEGY ==
Phase: bulk | Focus: hypertrophy | Block: week 3 of 6
Evaluate progress AGAINST this strategy — not in a vacuum.

== TODAY SO FAR == (Nutrition = the CURRENT BIOLOGICAL DAY...)
Nutrition consumed this biological day: 1850/2500 kcal (650 remaining today) | P 120/180g (60g to go) | C 210g | F 55g
Water today: 1500/2500ml (1000ml to go)
Supplements today: Creatine (5 g)
Slept last night: 6.6h (Fair), 01:10→07:40
Last meal today: 12:30 (0.8h ago)

== KEY SIGNALS ==
TOP PRIORITIES (lead with #1 ...):
  1. Avg sleep 6.6h is below your ~7.6h need — recovery limiter
...
== DAY-BY-DAY TIMELINE (last 7 days, chronological) ==
2026-07-08 (Wed):
  08:15  Breakfast 450kcal P25g
  12:30  Lunch 700kcal P40g
...
~~~~

For the meal task this brain block only matters to the `notes` field, yet it is sent on **every** analyze call — adding latency/token cost and (potentially) crowding the nutrition task.

---

## Part 3 — Data + persistence constraints

### 3.1 The exact meal row written on save

`DietForm.save()` (`src/views/DietForm.jsx:558-570`) and `saveBarcode()` (`502`) both call `onAdd(...)` = `addEntry("diet")`. The written shape (typed as `DietEntry`, `models.ts:44-60`):

~~~~js
onAdd({
  date: r.date,               // local YYYY-MM-DD, possibly shifted ±1 by bio-day resolve
  time: r.time,               // "HH:MM"
  ts: r.consumedAt,           // = consumedAt (new rows)
  consumedAt: r.consumedAt,   // authoritative timestamp for bucketing
  loggedAt: Date.now(),       // audit-only
  ...(r.excludeFromCoach ? { excludeFromCoach: true } : {}),
  meal,                       // "Breakfast" | ... | "Custom"
  food: result.food,          // overall meal name
  calories, protein, carbs, fat,   // top-level totals (from AI/barcode, NOT recomputed on save unless edited)
  notes: result.notes || "",  // ("" for barcode; barcode uses notes = "Barcode <code> · <portion>")
  items: cleanItems,          // [{food,calories,protein,carbs,fat}] — barcode path writes NO items
  id: Date.now(),
});
~~~~

`addEntry` (`App.jsx:183`) prepends it to `data.diet`; `setData` triggers localStorage save + debounced Supabase sync.

**Consumers of `meal.items` / per-item macros (grepped across `src/`):**
- **Only `DietForm.jsx` itself** reads `result.items` and per-item macros — all **pre-save, in-memory** (`recomputeTotals` 533-538, `editItem` 545, `removeItem` 553, `withItems` 541).
- **No persisted consumer reads `meal.items`.** Every downstream reader — `brain.js` timelines/nutrition (`buildTimeline` 124, `todayProgress.meals` 454, `dietByDay7` 164-177), `protein.js`, `energy.js`, `glycemic.js`, `RecentList` (`DietForm.jsx:834`) — reads **only the top-level** `m.calories / m.protein / m.carbs / m.fat / m.food`.
- Net: **`items` is effectively write-only after save.** The per-food breakdown is persisted but nothing consumes it later (meals aren't reopened for edit). Any future per-item verification currently has no reader to break.

### 3.2 Barcode normalization (Open Food Facts)

`lookupBarcode` (`src/api/client.jsx:172-201`):

~~~~js
const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments,serving_size,quantity`;
const resp = await fetch(url, { headers: { "User-Agent": "FitLog/1.0 (personal fitness tracker)" } });
const data = await resp.json();
if (data.status !== 1 || !data.product) return null;
const p = data.product; const n = p.nutriments || {};
const name = [p.brands, p.product_name].filter(Boolean).join(" ").trim() || p.product_name || "Unknown product";
const per100 = {
  cal:     Math.round(n["energy-kcal_100g"] ?? (n["energy_100g"] ? n["energy_100g"] / 4.184 : 0)),
  protein: Math.round((n["proteins_100g"] ?? 0)),
  carbs:   Math.round((n["carbohydrates_100g"] ?? 0)),
  fat:     Math.round((n["fat_100g"] ?? 0)),
};
const hasServing = n["energy-kcal_serving"] != null || n["proteins_serving"] != null;
const perServing = hasServing ? { cal, protein, carbs, fat /* same shape, _serving fields */ } : null;
if (!per100.cal && !perServing?.cal) return null; // no usable nutrition data
return { name, per100, perServing, servingSize: p.serving_size || null, quantity: p.quantity || null, code };
~~~~

Portion scaling happens later in `DietForm.bcMacros()` (`474-484`): per-serving verbatim if chosen + available, else `per100 × grams/100`.

### 3.3 Existing nutrition DB / cache / USDA integration?

**None for calories/macros.** Exhaustive search (`usda|fooddata|fdc|nutritionix|edamam|cache`) found:
- `"USDA-style"` appears **only as prompt wording** (`client.jsx:227`) — no USDA FoodData Central API call anywhere.
- The only structured food data in the repo is `src/engines/gi-database.js` — a ~130-entry **glycemic-index** regex table (GI, not calories/macros), used solely by `glycemic.js` for the GL pill.
- Barcode → Open Food Facts is the **only** DB-verified nutrition route, and it is not cached.
- **No caching of AI results.** Identical foods re-hit the LLM every time.

### 3.4 Supabase schema for meals

**No relational meals/diet schema exists in the repo.** No `supabase/` dir, no `.sql`, no migrations. Persistence is a **single-blob** model (`src/state/store.ts:38-54`): the whole `{ data, goals, chat }` object is `upsert`-ed into one table `fitlog_data` keyed by `user_id` (`onConflict: "user_id"`). Meals live inside the JSON column `data.diet` — there is no per-meal row, no server-side nutrition schema, and no server validation of meal contents.

---

## Part 4 — Environment constraints

### 4.1 Framework / build / deploy

- **React 18 + Vite 5**, deployed on **Vercel** (confirmed by the serverless function in `/api` and the live `*.vercel.app` prod alias).
- `package.json`:

~~~~json
{
  "name": "fitlog", "private": true, "version": "1.0.0", "type": "module",
  "engines": { "node": "20.x" },
  "scripts": {
    "dev": "vite", "build": "vite build", "preview": "vite preview",
    "typecheck": "tsc --noEmit", "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "react": "^18.3.1", "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1", "typescript": "^5.6.3",
    "vite": "^5.4.0", "vitest": "^2.1.8"
  }
}
~~~~

- Tiny dependency surface (React + Supabase only). No React Router, no state lib, no fetch/query lib. No `vercel.json`. **Node 20.x is flagged deprecated by Vercel** (builds fail after 2026-10-01 unless bumped to 24.x).

### 4.2 API-key handling / server-side surface

**There is a real server surface** — `api/chat.js`, a Vercel serverless function. `ANTHROPIC_API_KEY` lives **server-side only**; the browser calls the same-origin `/api/chat` proxy. Controls: origin allowlist, optional Supabase JWT verification, model allowlist, `max_tokens` cap (4000), 5 MB body cap, in-memory rate limit.

**Implication for the redesign:** a **USDA FoodData Central** (or any keyed nutrition DB) call can be added safely as **another serverless function under `/api`** (e.g. `api/fdc.js`), keeping the FDC key server-side and reusing the same origin/JWT guards. Everything else is a static client + `localStorage` + browser-side Supabase.

### 4.3 Test setup

- **Vitest** is installed and wired (`"test": "vitest run"`, `vitest ^2.1.8`). No vitest config file (defaults).
- **Only two test files exist**, both for the creatine feature: `src/engines/creatineModel.test.js`, `src/engines/creatineIntakeAdapter.test.js`.
- **Zero tests touch the meal pipeline.** No eval harness, no golden dataset, no accuracy regression suite.
- (Pre-existing broken file `tests/engines.test.mjs` imports a renamed path and loads 0 tests — unrelated to meals.)

### 4.4 Browser/Node APIs relied on

- `BarcodeDetector` (feature-detected via `barcodeScanSupported()`; absent on iOS Safari → manual entry fallback).
- `navigator.mediaDevices.getUserMedia` (live scan camera).
- `FileReader`, `Image`, `<canvas>` `getContext("2d")` + `toDataURL("image/jpeg")` (resize path).
- `requestAnimationFrame` (scan loop).
- `fetch`, `localStorage`, `createPortal` (modals), Supabase JS SDK.
- Server: Node fetch in the Vercel function; in-memory `Map` for rate limiting (per warm instance only).

---

## Part 5 — Honest weaknesses (accuracy + robustness)

**Estimation architecture**
1. **Single-pass, single-model estimation.** One LLM call returns final numbers (`client.jsx:213-241`). No second/verification pass, no self-consistency, no ensemble. This is the biggest gap vs the SnapCalorie approach.
2. **No database resolution of AI-identified foods.** The model both *identifies* and *quantifies* — nothing maps "grilled chicken breast" to a verified per-gram nutrition record. The only DB-verified path is barcode (OFF); everything typed/photographed is model memory.
3. **Default model is Haiku** (`config.js:80`) — cheapest, weakest vision/nutrition tier. Accuracy is capped unless the user manually switches to Sonnet. The proxy allowlist (`api/chat.js:15-18`) also only permits haiku-4-5/sonnet-4, so upgrading the vision model is a server change too.
4. **Web search off by default** (`client.jsx:216`). Branded/restaurant foods are estimated from memory unless the user opts in per-log.

**Validation / data integrity**
5. **Top-level totals are never validated against the item sum on ingest.** The prompt *asks* the model to make `calories == sum(items)` (`client.jsx:231,236`), but code trusts it. `withItems` (`DietForm.jsx:541-543`) passes model numbers straight to state; `save()` (`567`) persists `result.calories` etc. `recomputeTotals`/`coerceMacro` only run when the **user manually edits** a field (`editItem:544-547`). A model that returns mismatched totals → mismatched totals persisted.
6. **Only ingest guard is `typeof r.calories === "number"`** (`DietForm.jsx:521`). No range sanity checks (e.g. 5000 kcal from "an apple"), no non-negative/again-finite check on the raw AI object, no per-macro plausibility (e.g. protein·4+carb·4+fat·9 ≈ calories).
7. **Confidence is unvalidated model self-report** (`DietForm.jsx:787`) — displayed only. It never gates a re-prompt, a DB fallback, or a "please confirm" step.
8. **`items` is write-only after save** (Part 3.1) — no downstream consumer reads it, so today there's no per-food verification, correction, or DB re-resolution surface.

**Portion + hidden-ingredient modeling**
9. **No portion grounding.** Text mode has zero portion anchoring. Image mode asks the model to "compare to plate/utensils/hand" (`client.jsx:222`) but there is no fiducial marker, depth, or reference-object pipeline — the known weak spot Cal AI/SnapCalorie invest heavily in.
10. **Hidden fats/oils rely on the model remembering** (`client.jsx:223,228`). No systematic cooking-oil/butter/dressing add-on model; no structured hidden-ingredient step.
11. **Single point estimate, no ranges/error bars.** Users get one hard number, not a confidence interval — over-states precision and prevents downstream reconciliation.

**Robustness / ops**
12. **Silent failure.** Parse failure → `null` → generic error string (`client.jsx:244`, `DietForm.jsx:522`). No logging, no telemetry, no retry/backoff, no capture of the raw response for debugging.
13. **No caching / dedupe.** Every identical food re-hits the LLM (cost + latency + nondeterminism). No food cache, no embedding dedupe, no "you logged this before" reuse.
14. **No eval harness or accuracy regression tests** for meals (Part 4.3). There is no golden dataset of photos/descriptions → known macros, so any prompt/model change ships blind.
15. **EXIF orientation not handled** in resize (`client.jsx:11-34`); some phone photos reach the model rotated, hurting identification.
16. **Barcode data quality is unguarded.** OFF is crowd-sourced and patchy; per-serving vs per-100g depends on which OFF fields exist (`client.jsx:189-195`), rounded to integers, with no USDA cross-check or outlier rejection.
17. **Brain context tax on every analyze.** The full day-brain is appended to the food system prompt (`client.jsx:210-211`) though it only affects `notes`. Adds tokens/latency to every log and risks distracting the nutrition task on the weakest (Haiku) tier.
18. **GL estimator is name-regex only** (`glycemic.js`, `gi-database.js`) — decoupled from calorie accuracy and won't help macro correctness; it's a separate display concern.

**Redesign leverage points (from the above):** add an `/api/fdc.js` verified-nutrition resolver (4.2), introduce an ingest reconciliation step that recomputes totals from resolved per-item data (5.5/5.8), gate low-confidence results into a second pass or DB lookup (5.7), attach ranges (5.11), cache resolved foods (5.13), and stand up a photo/description→macros eval set under vitest before touching prompts (5.14).
