import { useState, useEffect, useRef, useMemo } from "react";
import { supabase, hasSupabase } from "./supabase";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TABS = ["Home", "Log", "History", "Coach", "Settings"];
const STORAGE_KEY = "fitlog_v5";
const defaultData = { sleep: [], diet: [], exercise: [], sports: [], water: [], supplements: [] };
const defaultGoals = { calories: 2500, protein: 180, carbs: 250, fat: 80, goal: "Build Muscle", waterGoalMl: 2500 };
const fitnessGoals = ["Build Muscle", "Lose Fat", "Improve Endurance", "Maintain Weight", "Athletic Performance"];
const mealTypes = ["Breakfast", "Lunch", "Dinner", "Snack"];
const sportsOptions = ["Football","Basketball","Tennis","Swimming","Running","Cycling","Yoga","Boxing","Soccer","Volleyball","Badminton","Table Tennis","Golf","Martial Arts","Other"];
const sleepQuality = ["Poor", "Fair", "Good", "Great", "Excellent"];
const intensityLevels = ["Light", "Moderate", "Intense", "All-out"];

const TYPE_DOT = { sleep: "#6ee7f7", diet: "#f9c97e", exercise: "#f47e6e", sports: "#8fd989", water: "#5cc8df", supplements: "#b4a8e8" };
const TYPE_ICON = { sleep: "◐", diet: "◉", exercise: "◆", sports: "◇", water: "◊", supplements: "⊕" };

// ─── AI MODEL PREFERENCE ──────────────────────────────────────────────────────
const MODELS = {
  haiku: { id: "claude-haiku-4-5", label: "Haiku", desc: "Fast & cheap — great for everyday logging" },
  sonnet: { id: "claude-sonnet-4-20250514", label: "Sonnet", desc: "Smartest — best accuracy, costs ~12x more" },
};
function loadModelPref() {
  try { return localStorage.getItem(STORAGE_KEY + "_model") === "sonnet" ? "sonnet" : "haiku"; } catch { return "haiku"; }
}
function saveModelPref(key) { localStorage.setItem(STORAGE_KEY + "_model", key); _currentModel = key; }
let _currentModel = (() => { try { return localStorage.getItem(STORAGE_KEY + "_model") === "sonnet" ? "sonnet" : "haiku"; } catch { return "haiku"; } })();
function currentModelId() { return MODELS[_currentModel]?.id || MODELS.haiku.id; }

// ─── STORAGE ──────────────────────────────────────────────────────────────────
function loadData() {
  try { const r = localStorage.getItem(STORAGE_KEY); const p = r ? JSON.parse(r) : defaultData; return { ...defaultData, ...p }; }
  catch { return defaultData; }
}
function loadGoals() {
  try { const r = localStorage.getItem(STORAGE_KEY + "_goals"); const p = r ? JSON.parse(r) : defaultGoals; return { ...defaultGoals, ...p }; }
  catch { return defaultGoals; }
}
const saveData = d => localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
const saveGoals = g => localStorage.setItem(STORAGE_KEY + "_goals", JSON.stringify(g));

// ─── CLOUD SYNC ───────────────────────────────────────────────────────────────
// Tracks the currently signed-in user so any localStorage write can trigger a sync.
let _currentUserId = null;
function setCurrentUser(id) { _currentUserId = id; }

// Pushes the full {data, goals, chat} bundle to Supabase for the logged-in user.
// Debounced so rapid edits don't spam the server.
let _syncTimer = null;
function cloudSync(userId) {
  const uid = userId || _currentUserId;
  if (!hasSupabase || !uid) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(async () => {
    try {
      const payload = {
        user_id: uid,
        data: loadData(),
        goals: loadGoals(),
        chat: JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]"),
        updated_at: new Date().toISOString(),
      };
      await supabase.from("fitlog_data").upsert(payload, { onConflict: "user_id" });
    } catch (e) { /* offline — will retry on next change */ }
  }, 1200);
}

// Pulls cloud data into localStorage. Returns true if cloud had data.
async function cloudPull(userId) {
  if (!hasSupabase || !userId) return false;
  const { data: row, error } = await supabase.from("fitlog_data").select("*").eq("user_id", userId).maybeSingle();
  if (error || !row) return false;
  const cloudData = row.data || {};
  const hasAny = Object.values(cloudData).some(arr => Array.isArray(arr) && arr.length > 0);
  if (!hasAny && (!row.chat || row.chat.length <= 1)) return false; // cloud effectively empty
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultData, ...cloudData }));
  localStorage.setItem(STORAGE_KEY + "_goals", JSON.stringify({ ...defaultGoals, ...(row.goals || {}) }));
  if (row.chat) localStorage.setItem(STORAGE_KEY + "_chat", JSON.stringify(row.chat));
  return true;
}

// Pushes current local data up immediately (used on first sign-in when cloud is empty).
async function cloudPushNow(userId) {
  if (!hasSupabase || !userId) return;
  try {
    await supabase.from("fitlog_data").upsert({
      user_id: userId,
      data: loadData(),
      goals: loadGoals(),
      chat: JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]"),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  } catch (e) {}
}

const getTodayStr = () => new Date().toISOString().split("T")[0];
const formatDate = ds => new Date(ds + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const formatShortDate = ds => new Date(ds + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split("T")[0]; };

// ─── CLAUDE API ───────────────────────────────────────────────────────────────
async function callClaude({ system, userText, imageBase64, imageMediaType, maxTokens = 1000, conversationMessages, tools, model }) {
  const useModel = model || currentModelId();
  const apiMessages = conversationMessages || [{
    role: "user",
    content: imageBase64
      ? [{ type: "image", source: { type: "base64", media_type: imageMediaType, data: imageBase64 } }, { type: "text", text: userText }]
      : userText
  }];
  const body = { model: useModel, max_tokens: maxTokens, system, messages: apiMessages };
  if (tools) body.tools = tools;
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  // Concatenate all text blocks (web search adds extra block types we ignore here)
  return data.content?.filter(b => b.type === "text").map(b => b.text || "").join("") || "";
}

// The web search tool — lets Claude look up real nutrition data for branded/restaurant foods.
const WEB_SEARCH_TOOL = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];

// Robustly pull a JSON object out of a response that may contain prose around it.
function extractJSON(raw) {
  let s = raw.replace(/```json|```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

async function estimateSportsCalories(sport, duration, intensity, weight) {
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

// useWeb = true only when the user opts in (branded/restaurant foods). Keeps cost low by default.
async function analyzeFoodAI(description, imageBase64, imageMediaType, useWeb = false) {
  try {
    const raw = await callClaude({
      model: currentModelId(),
      maxTokens: useWeb ? 1500 : 700,
      tools: useWeb ? WEB_SEARCH_TOOL : undefined,
      system: `You are a meticulous nutritionist. Estimate nutrition as ACCURATELY as possible.
RULES:
- ${useWeb ? "For branded/restaurant/packaged foods, search the web for the official published nutrition facts and use those exact numbers." : "Use precise USDA-style values from your knowledge."}
- Account for cooking method, oil, and realistic portion sizes.
- If a portion is vague, assume a typical real-world serving and note it.
- Do NOT round down to be "nice" — restaurant and fried foods are calorie-dense. Be realistic.
- If multiple items, sum them.
Reply with ONLY this JSON (after any research):
{"food":"<concise name>","calories":<n>,"protein":<n>,"carbs":<n>,"fat":<n>,"confidence":"high|medium|low","notes":"<source or assumptions, brief>"}`,
      userText: description
        ? `Analyze the nutrition of: "${description}".${useWeb ? " Search for official data if this is a branded or restaurant item." : ""}`
        : `Identify the food in this image and analyze its nutrition.${useWeb ? " If it's a specific brand or restaurant dish, search for its official nutrition facts." : ""}`,
      imageBase64, imageMediaType,
    });
    return extractJSON(raw);
  } catch { return null; }
}

async function analyzeAllData(data, goals) {
  const cut = new Date(); cut.setDate(cut.getDate() - 14);
  const last14 = arr => arr.filter(i => new Date(i.date + "T00:00:00") >= cut);
  const sleepLines = last14(data.sleep).map(s => `${s.date}: ${s.duration}h (${s.quality})`).join("\n") || "No data";
  const dietLines = last14(data.diet).map(d => `${d.date} ${d.meal}: ${d.food} — ${d.calories}kcal P:${d.protein}g`).join("\n") || "No data";
  const exLines = last14(data.exercise).map(e => `${e.date}: ${e.label}\n${(e.text||"").slice(0,200)}`).join("\n\n") || "No data";
  const spLines = last14(data.sports).map(s => `${s.date}: ${s.sport} ${s.duration}min ${s.intensity}`).join("\n") || "No data";

  const system = `You are an elite personal trainer and sports nutritionist. Analyze real fitness data and give specific, actionable advice for ${goals.goal}. Return ONLY JSON:
{"overallScore":<1-10>,"summary":"<2-3 sentences>","sections":[{"category":"Sleep & Recovery","score":<1-10>,"status":"good|warning|critical","insight":"<specific>","tips":["<tip>","<tip>","<tip>"]},{"category":"Nutrition","score":<1-10>,"status":"good|warning|critical","insight":"<specific>","tips":["<tip>","<tip>","<tip>"]},{"category":"Training","score":<1-10>,"status":"good|warning|critical","insight":"<specific>","tips":["<tip>","<tip>","<tip>"]},{"category":"Calorie Balance","score":<1-10>,"status":"good|warning|critical","insight":"<specific>","tips":["<tip>","<tip>","<tip>"]}],"priorityAction":"<one impactful thing>"}`;

  const raw = await callClaude({ system, maxTokens: 2000, userText: `Goal: ${goals.goal}\nCalorie target: ${goals.calories}kcal\nMacros: P${goals.protein}g C${goals.carbs}g F${goals.fat}g\n\nSLEEP:\n${sleepLines}\n\nDIET:\n${dietLines}\n\nEXERCISE:\n${exLines}\n\nSPORTS:\n${spLines}` });
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

// ─── MARKDOWN ─────────────────────────────────────────────────────────────────
function renderMarkdown(text) {
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

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────
function Ring({ pct, label, value, unit, big }) {
  const size = big ? 130 : 88, stroke = big ? 9 : 7;
  const r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const filled = Math.min(1, pct / 100) * circ;
  return (
    <div className="ring">
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke}
          strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray .8s cubic-bezier(.4,0,.2,1)" }} />
      </svg>
      <div className="ring-center">
        <div className={`ring-val ${big ? "big" : ""}`}>{value}<span className="ring-unit">{unit}</span></div>
      </div>
      <div className="ring-label">{label}</div>
    </div>
  );
}

function MiniChart({ points, height = 70, showGoal = null }) {
  if (!points || points.length === 0) return <div className="muted-center">No data</div>;
  const W = 320, H = height, padX = 4, padY = 8;
  const vals = points.map(p => p.value).filter(v => v != null);
  if (vals.length === 0) return <div className="muted-center">Not enough data</div>;
  let min = Math.min(...vals), max = Math.max(...vals);
  if (showGoal != null) { min = Math.min(min, showGoal); max = Math.max(max, showGoal); }
  if (max === min) max = min + 1;
  const range = max - min; min -= range * 0.1; max += range * 0.1;
  const sx = i => padX + (i / Math.max(1, points.length - 1)) * (W - 2 * padX);
  const sy = v => H - padY - ((v - min) / (max - min)) * (H - 2 * padY);
  const segments = [];
  let cur = [];
  points.forEach((p, i) => {
    if (p.value != null) cur.push({ x: sx(i), y: sy(p.value) });
    else if (cur.length) { segments.push(cur); cur = []; }
  });
  if (cur.length) segments.push(cur);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chart">
      {showGoal != null && (
        <line x1={padX} x2={W - padX} y1={sy(showGoal)} y2={sy(showGoal)} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" opacity=".35" />
      )}
      {segments.map((seg, si) => {
        const path = seg.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
        const area = seg.length > 1 ? `${path} L${seg[seg.length-1].x.toFixed(1)},${H - padY} L${seg[0].x.toFixed(1)},${H - padY} Z` : null;
        return (
          <g key={si}>
            {area && <path d={area} fill="var(--accent)" opacity=".08" />}
            <path d={path} stroke="var(--accent)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            {seg.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2" fill="var(--accent)" />)}
          </g>
        );
      })}
    </svg>
  );
}

function Card({ title, sub, action, children, className = "" }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-hd">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {sub && <p className="card-sub">{sub}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function Empty({ icon = "✦", title, hint, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action}
    </div>
  );
}

// ─── TOAST (global, no context needed) ────────────────────────────────────────
let _toastFn = null;
function toast(msg) { if (_toastFn) _toastFn(msg); }

function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    _toastFn = (msg) => {
      const id = Date.now() + Math.random();
      setItems(it => [...it, { id, msg }]);
      setTimeout(() => setItems(it => it.filter(x => x.id !== id)), 2200);
    };
    return () => { _toastFn = null; };
  }, []);
  return (
    <div className="toast-host">
      {items.map(t => <div key={t.id} className="toast">{t.msg}</div>)}
    </div>
  );
}

// ─── CONFIRM MODAL ────────────────────────────────────────────────────────────
function ConfirmModal({ open, title, body, confirmLabel = "Confirm", danger, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        {body && <p className="modal-body">{body}</p>}
        <div className="modal-actions">
          <button className="btn-ghost flex" onClick={onCancel}>Cancel</button>
          <button className={danger ? "btn-danger flex" : "btn flex"} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// Hook for confirm flow
function useConfirm() {
  const [state, setState] = useState({ open: false });
  const confirm = (opts) => new Promise(resolve => {
    setState({
      open: true, ...opts,
      onConfirm: () => { setState({ open: false }); resolve(true); },
      onCancel: () => { setState({ open: false }); resolve(false); },
    });
  });
  const modal = <ConfirmModal {...state} />;
  return [confirm, modal];
}

// ─── HOME TAB ─────────────────────────────────────────────────────────────────
function HomeTab({ data, goals, onAddWater, onNav }) {
  const today = getTodayStr();
  const now = new Date();
  const hr = now.getHours();
  const greeting = hr < 5 ? "Late night" : hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : hr < 21 ? "Good evening" : "Good night";

  const todayDiet = data.diet.filter(d => d.date === today);
  const todayCal = todayDiet.reduce((a, m) => a + m.calories, 0);
  const todayProtein = todayDiet.reduce((a, m) => a + (m.protein || 0), 0);
  const todayWaterMl = data.water.filter(w => w.date === today).reduce((a, w) => a + w.ml, 0);
  const todaySleep = data.sleep.find(s => s.date === today);
  const todayWorkout = data.exercise.find(e => e.date === today);
  const todaySport = data.sports.find(s => s.date === today);
  const todaySupps = data.supplements.filter(s => s.date === today);

  const calPct = Math.min(100, Math.round((todayCal / goals.calories) * 100));
  const prtPct = Math.min(100, Math.round((todayProtein / goals.protein) * 100));
  const waterPct = Math.min(100, Math.round((todayWaterMl / goals.waterGoalMl) * 100));

  const nothingToday = !todaySleep && todayDiet.length === 0 && !todayWorkout && !todaySport && todaySupps.length === 0;
  const ringsEmpty = todayCal === 0 && todayProtein === 0 && todayWaterMl === 0;

  // Daily completion — how many of the 3 core rings are at goal
  const ringsHit = [calPct >= 100, prtPct >= 100, waterPct >= 100].filter(Boolean).length;
  const dayPct = Math.round((calPct + prtPct + waterPct) / 3);

  // Logging streak — consecutive days (ending today or yesterday) with any entry
  const streak = useMemo(() => {
    const dayHas = {};
    [...data.diet, ...data.sleep, ...data.exercise, ...data.sports, ...data.water, ...data.supplements]
      .forEach(e => { if (e.date) dayHas[e.date] = true; });
    let count = 0;
    let cursor = new Date();
    // allow streak to count from today or yesterday (grace if today not logged yet)
    if (!dayHas[getTodayStr()]) cursor.setDate(cursor.getDate() - 1);
    for (;;) {
      const ds = cursor.toISOString().split("T")[0];
      if (dayHas[ds]) { count++; cursor.setDate(cursor.getDate() - 1); }
      else break;
    }
    return count;
  }, [data]);

  function addWater() {
    onAddWater({ id: Date.now(), date: today, ml: 250, ts: Date.now() });
    toast("💧 +250ml water logged");
  }

  return (
    <div className="stack">
      {/* GREETING */}
      <div className="greeting">
        <p className="greeting-date">{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 className="greeting-h">{greeting}</h1>
        <div className="greeting-row">
          <span className="greeting-goal">{goals.goal}</span>
          {streak > 0 && <span className="streak-chip" title="Consecutive days logged">🔥 {streak} day{streak === 1 ? "" : "s"}</span>}
        </div>
      </div>

      {/* PRIMARY RINGS */}
      <Card>
        <div className="rings-row">
          <Ring pct={calPct} label="Calories" value={todayCal || "0"} unit="" big />
          <Ring pct={prtPct} label="Protein" value={todayProtein || "0"} unit="g" big />
          <Ring pct={waterPct} label="Water" value={todayWaterMl ? (todayWaterMl >= 1000 ? (todayWaterMl/1000).toFixed(1) : todayWaterMl) : "0"} unit={todayWaterMl >= 1000 ? "L" : "ml"} big />
        </div>
        {ringsEmpty ? (
          <p className="rings-zero">Your day's a clean slate — log a meal or some water to start filling these. 💪</p>
        ) : (
          <>
            <div className="ring-targets">
              <span>{todayCal}/{goals.calories} kcal</span>
              <span>{todayProtein}/{goals.protein}g protein</span>
              <span>{todayWaterMl}/{goals.waterGoalMl}ml</span>
            </div>
            <div className="day-progress">
              <div className="day-progress-bar"><div className="day-progress-fill" style={{ width: `${dayPct}%` }} /></div>
              <span className="day-progress-label">
                {ringsHit === 3 ? "🎉 All goals hit — crushed it!" : ringsHit > 0 ? `${ringsHit}/3 goals hit · ${dayPct}% of the way` : `${dayPct}% of the way there`}
              </span>
            </div>
          </>
        )}
      </Card>

      {/* QUICK ACTIONS */}
      <div className="quick-actions">
        <button className="qa qa-primary" onClick={() => onNav("Log", "diet")}>
          <span className="qa-icon">◉</span><span>Log meal</span>
        </button>
        <button className="qa" onClick={addWater}>
          <span className="qa-icon">◊</span><span>+ 250ml water</span>
        </button>
        <button className="qa" onClick={() => onNav("Log", "exercise")}>
          <span className="qa-icon">◆</span><span>Log workout</span>
        </button>
        <button className="qa" onClick={() => onNav("Coach")}>
          <span className="qa-icon">✦</span><span>Ask coach</span>
        </button>
      </div>

      {/* TODAY LOGGED */}
      <Card title="Today">
        {nothingToday ? (
          <Empty title="Nothing logged yet" hint="Tap a quick action above to get started" />
        ) : (
          <div className="today-items">
            {todaySleep && <div className="today-item"><span className="today-dot" style={{ background: TYPE_DOT.sleep }} /><span className="today-text">{todaySleep.duration}h sleep · {todaySleep.quality.toLowerCase()}</span></div>}
            {todayDiet.map(m => <div key={m.id} className="today-item"><span className="today-dot" style={{ background: TYPE_DOT.diet }} /><span className="today-text">{m.meal} · {m.calories} kcal · {m.food.slice(0, 30)}{m.food.length > 30 ? "…" : ""}</span></div>)}
            {todayWorkout && <div className="today-item"><span className="today-dot" style={{ background: TYPE_DOT.exercise }} /><span className="today-text">Workout · {todayWorkout.label}</span></div>}
            {todaySport && <div className="today-item"><span className="today-dot" style={{ background: TYPE_DOT.sports }} /><span className="today-text">{todaySport.sport} · {todaySport.duration}min</span></div>}
            {todaySupps.length > 0 && <div className="today-item"><span className="today-dot" style={{ background: TYPE_DOT.supplements }} /><span className="today-text">{todaySupps.length} supplement{todaySupps.length === 1 ? "" : "s"} · {todaySupps.map(s => s.name).join(", ")}</span></div>}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── LOG TAB ──────────────────────────────────────────────────────────────────
const LOG_SUBTABS = [
  { key: "diet", label: "Meal", icon: "◉" },
  { key: "sleep", label: "Sleep", icon: "◐" },
  { key: "exercise", label: "Workout", icon: "◆" },
  { key: "sports", label: "Sport", icon: "◇" },
  { key: "water", label: "Water", icon: "◊" },
  { key: "supplement", label: "Supplement", icon: "⊕" },
];

function RecentList({ entries, render }) {
  if (!entries || entries.length === 0) return null;
  return (
    <div className="recent-after">
      <div className="recent-after-label">Recent</div>
      <div className="recent-after-list">
        {entries.slice(0, 3).map(e => (
          <div key={e.id} className="recent-after-item">{render(e)}</div>
        ))}
      </div>
    </div>
  );
}

function LogTab({ data, goals, addEntry, deleteEntry, initialSub }) {
  const [sub, setSub] = useState(initialSub || "diet");
  useEffect(() => { if (initialSub) setSub(initialSub); }, [initialSub]);

  return (
    <div className="stack">
      <div className="subtabs">
        {LOG_SUBTABS.map(t => (
          <button key={t.key} className={`subtab ${sub === t.key ? "active" : ""}`} onClick={() => setSub(t.key)}>
            <span className="subtab-icon">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {sub === "diet" && <DietForm onAdd={addEntry("diet")} recent={data.diet} />}
      {sub === "sleep" && <SleepForm onAdd={addEntry("sleep")} recent={data.sleep} />}
      {sub === "exercise" && <ExerciseForm onAdd={addEntry("exercise")} recent={data.exercise} />}
      {sub === "sports" && <SportsForm onAdd={addEntry("sports")} recent={data.sports} />}
      {sub === "water" && <WaterForm data={data} goals={goals} onAdd={addEntry("water")} onDelete={deleteEntry("water")} />}
      {sub === "supplement" && <SupplementForm data={data} onAdd={addEntry("supplements")} onDelete={deleteEntry("supplements")} />}
    </div>
  );
}

// ─── SLEEP FORM ──
function SleepForm({ onAdd, recent }) {
  const [form, setForm] = useState({ date: getTodayStr(), bedtime: "22:30", wakeTime: "06:30", quality: "Good", notes: "" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const dur = (() => {
    const [bh, bm] = form.bedtime.split(":").map(Number), [wh, wm] = form.wakeTime.split(":").map(Number);
    let m = (wh * 60 + wm) - (bh * 60 + bm); if (m < 0) m += 1440; return (m / 60).toFixed(1);
  })();
  function save() {
    onAdd({ ...form, duration: parseFloat(dur), id: Date.now() });
    toast("◐ Sleep logged");
    setForm(f => ({ ...f, notes: "" }));
  }
  return (
    <>
      <Card title="Log sleep">
        <div className="field-grid">
          <label>Date<input type="date" value={form.date} onChange={e => set("date", e.target.value)} /></label>
          <label>Quality<select value={form.quality} onChange={e => set("quality", e.target.value)}>{sleepQuality.map(q => <option key={q}>{q}</option>)}</select></label>
          <label>Bedtime<input type="time" value={form.bedtime} onChange={e => set("bedtime", e.target.value)} /></label>
          <label>Wake time<input type="time" value={form.wakeTime} onChange={e => set("wakeTime", e.target.value)} /></label>
        </div>
        <div className="duration-pill"><span>{dur}h</span> sleep</div>
        <label>Notes<textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="How did you sleep?" rows={2} /></label>
        <button className="btn full" onClick={save}>Save sleep</button>
      </Card>
      <RecentList entries={recent} render={s => <><span className="ra-main">{s.duration}h · {s.quality}</span><span className="ra-date">{formatShortDate(s.date)}</span></>} />
    </>
  );
}

// ─── DIET FORM ──
function DietForm({ onAdd, recent }) {
  const [date, setDate] = useState(getTodayStr());
  const [meal, setMeal] = useState("Breakfast");
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

  function handleFile(f) {
    if (!f) return;
    setFile(f); setResult(null); setError("");
    const r = new FileReader();
    r.onload = ev => setPreview(ev.target.result);
    r.readAsDataURL(f);
  }

  async function analyze() {
    if (mode === "text" && !text.trim()) return;
    if (mode === "image" && !file) return;
    setAnalyzing(true); setError(""); setResult(null);
    try {
      let b64 = null, mt = null;
      if (mode === "image" && file) {
        b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
        mt = file.type;
      }
      const r = await analyzeFoodAI(mode === "text" ? text : "", b64, mt, useWeb);
      if (r) setResult(r); else setError("Couldn't analyze that. Try again or be more specific.");
    } catch { setError("Network issue. Try again."); }
    setAnalyzing(false);
  }

  function save() {
    if (!result) return;
    onAdd({ date, meal, food: result.food, calories: result.calories, protein: result.protein, carbs: result.carbs, fat: result.fat, notes: result.notes || "", id: Date.now() });
    toast("◉ " + result.food.slice(0, 24) + " added");
    setResult(null); setText(""); setFile(null); setPreview(null); setError("");
  }

  return (
    <>
    <Card title="Log meal" sub="Describe what you ate or upload a photo">
      <div className="field-grid">
        <label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Meal<select value={meal} onChange={e => setMeal(e.target.value)}>{mealTypes.map(m => <option key={m}>{m}</option>)}</select></label>
      </div>

      <div className="seg">
        <button className={`seg-btn ${mode === "text" ? "active" : ""}`} onClick={() => { setMode("text"); setResult(null); setError(""); }}>✎ Describe</button>
        <button className={`seg-btn ${mode === "image" ? "active" : ""}`} onClick={() => { setMode("image"); setResult(null); setError(""); }}>⊞ Photo</button>
      </div>

      {mode === "text" && !result && (
        <label>What did you eat?<textarea value={text} onChange={e => setText(e.target.value)} placeholder='"2 eggs, toast, glass of OJ"' rows={3} /></label>
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

      {!result && (
        <>
          <label className="web-toggle">
            <input type="checkbox" checked={useWeb} onChange={e => setUseWeb(e.target.checked)} />
            <span className="web-toggle-text">
              <span className="web-toggle-title">🌐 Search web for exact data</span>
              <span className="web-toggle-sub">Best for branded / restaurant foods. Slower, costs a bit more.</span>
            </span>
          </label>
          <button className="btn full" onClick={analyze} disabled={analyzing || (mode === "text" ? !text.trim() : !file)}>
            {analyzing ? <><span className="spinner" />{useWeb ? "Researching nutrition…" : "Analyzing…"}</> : "✦ Analyze with AI"}
          </button>
        </>
      )}

      {error && <div className="err">{error}</div>}

      {result && (
        <div className="ai-card">
          <div className="ai-card-label">
            AI analysis
            {result.confidence && <span className={`conf-badge conf-${result.confidence}`}>{result.confidence} confidence</span>}
          </div>
          <div className="ai-card-name">{result.food}</div>
          <div className="macros">
            <div className="macro"><span className="macro-v">{result.calories}</span><span className="macro-l">kcal</span></div>
            <div className="macro"><span className="macro-v">{result.protein}g</span><span className="macro-l">protein</span></div>
            <div className="macro"><span className="macro-v">{result.carbs}g</span><span className="macro-l">carbs</span></div>
            <div className="macro"><span className="macro-v">{result.fat}g</span><span className="macro-l">fat</span></div>
          </div>
          {result.notes && <p className="ai-card-note">{result.notes}</p>}
          <div className="row">
            <button className="btn flex" onClick={save}>+ Add to log</button>
            <button className="btn-ghost" onClick={() => { setResult(null); }}>Redo</button>
          </div>
        </div>
      )}
      </Card>
      <RecentList entries={recent} render={m => <><span className="ra-main">{m.meal} · {m.calories} kcal · {m.food.slice(0, 26)}{m.food.length > 26 ? "…" : ""}</span><span className="ra-date">{formatShortDate(m.date)}</span></>} />
    </>
  );
}

// ─── EXERCISE (paste from Strong) ──
function ExerciseForm({ onAdd, recent }) {
  const [date, setDate] = useState(getTodayStr());
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  function save() {
    if (!text.trim()) return;
    onAdd({ id: Date.now(), date, label: label.trim() || "Workout", text: text.trim() });
    toast("◆ Workout saved");
    setText(""); setLabel("");
  }
  return (
    <>
    <Card title="Log workout" sub="Paste from Strong, or write your own">
      <div className="field-grid">
        <label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Label<input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Push Day A" /></label>
      </div>
      <label>Workout details
        <textarea value={text} onChange={e => setText(e.target.value)} rows={9}
          placeholder={"Push Day A\n1h 12m\n\nBench Press (Barbell)\nSet 1: 60 kg × 10\nSet 2: 80 kg × 8"}
          style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.84rem" }} />
      </label>
      <button className="btn full" onClick={save} disabled={!text.trim()}>Save workout</button>
    </Card>
    <RecentList entries={recent} render={w => <><span className="ra-main">{w.label}</span><span className="ra-date">{formatShortDate(w.date)}</span></>} />
    </>
  );
}

// ─── SPORTS ──
function SportsForm({ onAdd, recent }) {
  const [form, setForm] = useState({ date: getTodayStr(), sport: "Basketball", duration: "60", intensity: "Moderate", result: "", opponent: "", score: "", notes: "" });
  const [weight, setWeight] = useState("75");
  const [est, setEst] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setEst(null); };

  return (
    <>
    <Card title="Log sport">
      <div className="field-grid">
        <label>Date<input type="date" value={form.date} onChange={e => set("date", e.target.value)} /></label>
        <label>Sport<select value={form.sport} onChange={e => set("sport", e.target.value)}>{sportsOptions.map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Duration (min)<input type="number" value={form.duration} onChange={e => set("duration", e.target.value)} /></label>
        <label>Intensity<select value={form.intensity} onChange={e => set("intensity", e.target.value)}>{intensityLevels.map(l => <option key={l}>{l}</option>)}</select></label>
        <label>Your weight (kg)<input type="number" value={weight} onChange={e => { setWeight(e.target.value); setEst(null); }} /></label>
        <label>Result<select value={form.result} onChange={e => set("result", e.target.value)}><option value="">—</option><option>Win</option><option>Loss</option><option>Draw</option><option>Practice</option></select></label>
        <label>Opponent<input type="text" value={form.opponent} onChange={e => set("opponent", e.target.value)} placeholder="Optional" /></label>
        <label>Score<input type="text" value={form.score} onChange={e => set("score", e.target.value)} placeholder="Optional" /></label>
      </div>
      <label>Notes<textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} placeholder="How did it go?" /></label>

      {!est && (
        <button className="btn-ghost full" onClick={async () => {
          if (!form.duration) return;
          setEstimating(true);
          const r = await estimateSportsCalories(form.sport, +form.duration, form.intensity, +weight || 75);
          setEst(r); setEstimating(false);
        }} disabled={estimating || !form.duration}>
          {estimating ? <><span className="spinner" />Calculating (MET-based)…</> : "✦ Estimate calories with AI"}
        </button>
      )}

      {est && (
        <div className="ai-card">
          <div className="ai-card-label">AI estimate</div>
          <div className="ai-card-big">{est.calories}<span> kcal</span></div>
          <p className="ai-card-note">{est.note}</p>
          <div className="row">
            <button className="btn flex" onClick={() => { onAdd({ ...form, id: Date.now(), duration: +form.duration || 0, calories: est.calories }); toast("◇ " + form.sport + " logged"); setForm(f => ({ ...f, opponent: "", score: "", result: "", notes: "" })); setEst(null); }}>+ Save sport</button>
            <button className="btn-ghost" onClick={() => setEst(null)}>Redo</button>
          </div>
        </div>
      )}
    </Card>
    <RecentList entries={recent} render={s => <><span className="ra-main">{s.sport} · {s.duration}min · {s.calories} kcal</span><span className="ra-date">{formatShortDate(s.date)}</span></>} />
    </>
  );
}

// ─── WATER ──
function WaterForm({ data, goals, onAdd, onDelete }) {
  const today = getTodayStr();
  const todayWater = data.water.filter(w => w.date === today);
  const totalMl = todayWater.reduce((a, w) => a + w.ml, 0);
  const pct = Math.min(100, Math.round((totalMl / goals.waterGoalMl) * 100));
  const [custom, setCustom] = useState("");
  const [unit, setUnit] = useState("ml");

  const add = ml => { onAdd({ id: Date.now(), date: today, ml, ts: Date.now() }); toast(`💧 +${ml}ml water`); };
  const past7 = Array.from({ length: 7 }, (_, i) => {
    const d = daysAgo(6 - i);
    const ml = data.water.filter(w => w.date === d).reduce((a, w) => a + w.ml, 0);
    return { date: d, ml };
  });
  const maxPast = Math.max(goals.waterGoalMl, ...past7.map(p => p.ml));

  return (
    <div className="stack">
      <Card>
        <div className="center-stack">
          <Ring pct={pct} label={`of ${goals.waterGoalMl}ml`} value={totalMl} unit="ml" big />
        </div>
        <div className="quick-water">
          <button className="qa" onClick={() => add(250)}>+ Glass<br /><span>250ml</span></button>
          <button className="qa" onClick={() => add(500)}>+ Bottle<br /><span>500ml</span></button>
          <button className="qa" onClick={() => add(1000)}>+ 1L<br /><span>1000ml</span></button>
        </div>
      </Card>

      <Card title="Custom amount">
        <div className="seg">
          <button className={`seg-btn ${unit === "ml" ? "active" : ""}`} onClick={() => { setUnit("ml"); setCustom(""); }}>Milliliters</button>
          <button className={`seg-btn ${unit === "l" ? "active" : ""}`} onClick={() => { setUnit("l"); setCustom(""); }}>Liters</button>
        </div>
        <div className="row">
          <input type="number" step={unit === "l" ? "0.1" : "50"} value={custom} onChange={e => setCustom(e.target.value)} placeholder={unit === "l" ? "0.5" : "350"} />
          <button className="btn" onClick={() => { const v = parseFloat(custom); if (!v) return; add(unit === "l" ? Math.round(v * 1000) : Math.round(v)); setCustom(""); }} disabled={!custom}>Add</button>
        </div>
      </Card>

      {todayWater.length > 0 && (
        <Card title="Today's log" sub={`${todayWater.length} ${todayWater.length === 1 ? "entry" : "entries"}`}>
          <div className="list">
            {todayWater.slice().reverse().map(w => {
              const t = new Date(w.ts || Date.now());
              return (
                <div key={w.id} className="list-row">
                  <span className="muted">{t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="list-main">{w.ml}ml</span>
                  <button className="x" onClick={() => onDelete(w.id)}>×</button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Past 7 days">
        <div className="week">
          {past7.map(d => (
            <div key={d.date} className="week-col">
              <div className="week-bar-wrap">
                <div className="week-bar" style={{ height: `${(d.ml / maxPast) * 100}%`, background: d.ml >= goals.waterGoalMl ? "var(--accent)" : "var(--muted)" }} />
              </div>
              <div className="week-day">{new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" }).slice(0, 1)}</div>
              <div className="week-val">{d.ml >= 1000 ? (d.ml/1000).toFixed(1) + "L" : d.ml + "ml"}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── SUPPLEMENT ──
function SupplementForm({ data, onAdd, onDelete }) {
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const todaySupps = data.supplements.filter(s => s.date === getTodayStr());
  return (
    <div className="stack">
      <Card title="Log supplement">
        <div className="field-grid">
          <label>Name<input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Creatine, Multi, Whey" /></label>
          <label>Dose / notes<input type="text" value={dose} onChange={e => setDose(e.target.value)} placeholder="5g, 1 cap" /></label>
        </div>
        <button className="btn full" onClick={() => { if (!name.trim()) return; onAdd({ id: Date.now(), date: getTodayStr(), name: name.trim(), dose: dose.trim(), ts: Date.now() }); toast("⊕ " + name.trim() + " logged"); setName(""); setDose(""); }} disabled={!name.trim()}>Save</button>
      </Card>

      {todaySupps.length > 0 && (
        <Card title="Today's supplements">
          <div className="list">
            {todaySupps.slice().reverse().map(s => {
              const t = new Date(s.ts || Date.now());
              return (
                <div key={s.id} className="list-row">
                  <div className="list-main">
                    <div>{s.name}</div>
                    {s.dose && <div className="muted small">{s.dose}</div>}
                  </div>
                  <span className="muted">{t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <button className="x" onClick={() => onDelete(s.id)}>×</button>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── HISTORY TAB ──────────────────────────────────────────────────────────────
function HistoryTab({ data, goals, addEntry, deleteEntry }) {
  const [view, setView] = useState("trends"); // trends | lists
  return (
    <div className="stack">
      <div className="subtabs">
        <button className={`subtab ${view === "trends" ? "active" : ""}`} onClick={() => setView("trends")}>📊 Trends</button>
        <button className={`subtab ${view === "lists" ? "active" : ""}`} onClick={() => setView("lists")}>≡ Lists</button>
      </div>
      {view === "trends" && <TrendsView data={data} goals={goals} />}
      {view === "lists" && <ListsView data={data} deleteEntry={deleteEntry} />}
    </div>
  );
}

function TrendsView({ data, goals }) {
  const [range, setRange] = useState(14);
  const series = useMemo(() => Array.from({ length: range }, (_, i) => daysAgo(range - 1 - i)), [range]);

  const sleepPts = series.map(d => { const s = data.sleep.find(x => x.date === d); return { value: s ? s.duration : null }; });
  const calPts = series.map(d => { const day = data.diet.filter(x => x.date === d); return { value: day.length ? day.reduce((a, m) => a + (m.calories || 0), 0) : null }; });
  const proteinPts = series.map(d => { const day = data.diet.filter(x => x.date === d); return { value: day.length ? day.reduce((a, m) => a + (m.protein || 0), 0) : null }; });
  const workoutPts = series.map(d => ({ value: data.exercise.filter(x => x.date === d).length + data.sports.filter(x => x.date === d).length }));
  const waterPts = series.map(d => { const ml = data.water.filter(x => x.date === d).reduce((a, w) => a + w.ml, 0); return { value: ml || null }; });

  const sleepVals = sleepPts.map(p => p.value).filter(v => v != null);
  const avgSleep = sleepVals.length ? +(sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length).toFixed(1) : null;
  const sleepDebt = sleepVals.reduce((debt, v) => debt + (8 - v), 0);

  const calVals = calPts.map(p => p.value).filter(v => v != null);
  const avgCal = calVals.length ? Math.round(calVals.reduce((a, b) => a + b, 0) / calVals.length) : null;

  const proteinHits = proteinPts.filter(p => p.value != null && p.value >= goals.protein).length;
  const proteinLogged = proteinPts.filter(p => p.value != null).length;

  const totalWorkouts = workoutPts.reduce((a, p) => a + p.value, 0);

  // Sleep × workout correlation
  const corr = (() => {
    const days = series.map(d => {
      const s = data.sleep.find(x => x.date === d);
      const w = data.exercise.filter(x => x.date === d).length + data.sports.filter(x => x.date === d).length;
      return s ? { sleep: s.duration, w } : null;
    }).filter(Boolean);
    if (days.length < 4) return null;
    const good = days.filter(d => d.sleep >= 7);
    const poor = days.filter(d => d.sleep < 7);
    if (!good.length || !poor.length) return null;
    return {
      goodAvg: +(good.reduce((a, d) => a + d.w, 0) / good.length).toFixed(2),
      poorAvg: +(poor.reduce((a, d) => a + d.w, 0) / poor.length).toFixed(2),
      goodN: good.length, poorN: poor.length
    };
  })();

  return (
    <>
      <div className="seg">
        {[7, 14, 30].map(r => (
          <button key={r} className={`seg-btn ${range === r ? "active" : ""}`} onClick={() => setRange(r)}>{r} days</button>
        ))}
      </div>

      <Card title="😴 Sleep">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Average</span><span className="ts-v">{avgSleep ?? "—"}h</span></div>
          <div className="ts"><span className="ts-l">Sleep debt</span><span className={`ts-v ${sleepDebt > 5 ? "warn" : sleepDebt > 0 ? "neutral" : "good"}`}>{sleepDebt > 0 ? "+" : ""}{Math.round(sleepDebt*10)/10}h</span></div>
        </div>
        <MiniChart points={sleepPts} showGoal={8} />
      </Card>

      <Card title="🍎 Calories">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Average</span><span className="ts-v">{avgCal ?? "—"}</span></div>
          <div className="ts"><span className="ts-l">Target</span><span className="ts-v muted">{goals.calories}</span></div>
        </div>
        <MiniChart points={calPts} showGoal={goals.calories} />
      </Card>

      <Card title="🥩 Protein">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Target hit</span><span className={`ts-v ${proteinLogged && proteinHits >= proteinLogged * 0.7 ? "good" : "neutral"}`}>{proteinLogged ? `${proteinHits}/${proteinLogged} days` : "—"}</span></div>
        </div>
        <MiniChart points={proteinPts} showGoal={goals.protein} />
      </Card>

      <Card title="💪 Workouts">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Total</span><span className="ts-v">{totalWorkouts}</span></div>
        </div>
        <div className="bars-row">
          {workoutPts.map((p, i) => (
            <div key={i} className="bar-col" title={`${p.value} workout${p.value === 1 ? "" : "s"}`}>
              <div className="bar-fill" style={{ height: `${Math.min(100, p.value * 33)}%`, opacity: p.value === 0 ? 0.15 : 1 }} />
            </div>
          ))}
        </div>
      </Card>

      <Card title="💧 Water">
        <div className="trend-stats">
          <div className="ts"><span className="ts-l">Daily target</span><span className="ts-v">{goals.waterGoalMl}ml</span></div>
        </div>
        <MiniChart points={waterPts} showGoal={goals.waterGoalMl} />
      </Card>

      {corr && (
        <Card title="🔬 Sleep ↔ Training" className="insight-card">
          <p className="md-p">
            On nights with <strong>7+ hours sleep</strong> ({corr.goodN} days), you averaged <strong>{corr.goodAvg}</strong> workout{corr.goodAvg === 1 ? "" : "s"}/day.
            On nights with less ({corr.poorN} days), you averaged <strong>{corr.poorAvg}</strong>.
          </p>
          <p className="muted small" style={{ marginTop: 6 }}>
            {corr.goodAvg > corr.poorAvg ? "→ Better sleep correlates with more training. Prioritize rest." : corr.goodAvg < corr.poorAvg ? "→ You train more on less sleep. Watch for burnout." : "→ No strong difference yet. Keep logging."}
          </p>
        </Card>
      )}
    </>
  );
}

function ListsView({ data, deleteEntry }) {
  const [cat, setCat] = useState("diet");
  const [limit, setLimit] = useState(50);
  const [confirm, confirmModal] = useConfirm();
  const cats = [
    { key: "diet", label: "Meals", icon: "◉" },
    { key: "sleep", label: "Sleep", icon: "◐" },
    { key: "exercise", label: "Workouts", icon: "◆" },
    { key: "sports", label: "Sports", icon: "◇" },
    { key: "water", label: "Water", icon: "◊" },
    { key: "supplements", label: "Supplements", icon: "⊕" },
  ];
  const entries = data[cat] || [];
  const shown = entries.slice(0, limit);
  const label = cats.find(c => c.key === cat).label;

  async function handleDelete(item) {
    const ok = await confirm({ title: "Delete this entry?", body: "This can't be undone.", confirmLabel: "Delete", danger: true });
    if (ok) { deleteEntry(cat)(item.id); toast("Entry deleted"); }
  }

  return (
    <>
      {confirmModal}
      <div className="subtabs">
        {cats.map(c => (
          <button key={c.key} className={`subtab ${cat === c.key ? "active" : ""}`} onClick={() => { setCat(c.key); setLimit(50); }}>
            <span className="subtab-icon">{c.icon}</span>{c.label}
          </button>
        ))}
      </div>
      <Card title={label} sub={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}>
        {entries.length === 0 ? (
          <Empty title={`No ${label.toLowerCase()} logged yet`} hint="Head to the Log tab to add some" />
        ) : (
          <>
            <div className="hist-list">
              {shown.map(item => <HistItem key={item.id} item={item} type={cat} onDelete={() => handleDelete(item)} />)}
            </div>
            {entries.length > limit && (
              <button className="btn-ghost full" style={{ marginTop: 10 }} onClick={() => setLimit(l => l + 50)}>Show more ({entries.length - limit} remaining)</button>
            )}
          </>
        )}
      </Card>
    </>
  );
}

function HistItem({ item, type, onDelete }) {
  const [open, setOpen] = useState(false);
  let main = "", tags = [], detail = null;
  if (type === "sleep") {
    main = `${item.duration}h · ${item.quality}`;
    tags = [`${item.bedtime} → ${item.wakeTime}`];
    detail = item.notes;
  } else if (type === "diet") {
    main = `${item.meal} · ${item.food}`;
    tags = [`${item.calories} kcal`, `P ${item.protein}g`, `C ${item.carbs}g`, `F ${item.fat}g`];
    detail = item.notes;
  } else if (type === "exercise") {
    main = item.label;
    tags = [`${item.text.split("\n").filter(Boolean).length} lines`];
    detail = <pre className="raw-text">{item.text}</pre>;
  } else if (type === "sports") {
    main = `${item.sport} · ${item.duration}min`;
    tags = [item.intensity, item.result || "Practice", `${item.calories} kcal`].filter(Boolean);
    detail = [item.opponent && `vs ${item.opponent}`, item.score && `Score: ${item.score}`, item.notes].filter(Boolean).join(" · ");
  } else if (type === "water") {
    main = `${item.ml}ml`;
    tags = item.ts ? [new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })] : [];
  } else if (type === "supplements") {
    main = item.name;
    tags = [item.dose, item.ts && new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })].filter(Boolean);
  }

  const hasDetail = detail && (typeof detail === "string" ? detail.trim() : true);

  return (
    <div className={`hist ${open ? "open" : ""}`}>
      <div className="hist-head" onClick={() => hasDetail && setOpen(o => !o)}>
        <div className="hist-l">
          <span className="hist-dot" style={{ background: TYPE_DOT[type] }} />
          <div className="hist-text">
            <div className="hist-main">{main}</div>
            <div className="hist-date">{formatShortDate(item.date)}</div>
          </div>
        </div>
        <div className="hist-tags">
          {tags.map((t, i) => <span key={i} className="hist-tag">{t}</span>)}
          {hasDetail && <span className="muted">{open ? "▲" : "▼"}</span>}
          <button className="x" onClick={(e) => { e.stopPropagation(); onDelete(); }}>×</button>
        </div>
      </div>
      {open && hasDetail && (
        <div className="hist-detail">{detail}</div>
      )}
    </div>
  );
}

// ─── COACH TAB ────────────────────────────────────────────────────────────────
const COACH_GREETING = { role: "assistant", text: "Hey! I'm your AI coach. Ask me anything — best exercises for your goal, how to improve your sleep, what to eat before a workout, whether you should rest today. I see your real fitness data and remember our chats. 💪", ts: Date.now() };

function loadMessages() {
  try { const r = localStorage.getItem(STORAGE_KEY + "_chat"); const p = r ? JSON.parse(r) : null; return Array.isArray(p) && p.length ? p : [COACH_GREETING]; } catch { return [COACH_GREETING]; }
}
const saveMessages = m => {
  // Don't persist base64 image previews — they'd bloat storage and the cloud row.
  const stripped = m.map(msg => msg.image ? { ...msg, image: undefined, hadImage: true } : msg);
  localStorage.setItem(STORAGE_KEY + "_chat", JSON.stringify(stripped));
  cloudSync();
};

function CoachTab({ data, goals }) {
  const [messages, setMessages] = useState(loadMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoad, setAnalysisLoad] = useState(false);
  const [analysisErr, setAnalysisErr] = useState("");
  const [confirm, confirmModal] = useConfirm();
  const [attached, setAttached] = useState(null); // { b64, mediaType, preview }
  const endRef = useRef(null);
  const camRef = useRef();
  const galRef = useRef();

  function attachFile(f) {
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const dataUrl = ev.target.result;
      setAttached({ b64: dataUrl.split(",")[1], mediaType: f.type, preview: dataUrl });
    };
    r.readAsDataURL(f);
  }

  useEffect(() => { saveMessages(messages); }, [messages]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const hasData = data.sleep.length || data.diet.length || data.exercise.length || data.sports.length;

  function ctx() {
    const cut = new Date(); cut.setDate(cut.getDate() - 14);
    const l14 = arr => arr.filter(i => new Date(i.date + "T00:00:00") >= cut);
    const today = getTodayStr();
    const todayWater = data.water.filter(w => w.date === today).reduce((a, w) => a + w.ml, 0);
    return `Goal: ${goals.goal} | Cal: ${goals.calories} | P${goals.protein} C${goals.carbs} F${goals.fat} | Water target: ${goals.waterGoalMl}ml
Sleep (14d): ${l14(data.sleep).map(s => `${s.date}:${s.duration}h(${s.quality})`).join(", ") || "none"}
Diet (14d): ${l14(data.diet).map(d => `${d.date} ${d.meal}: ${d.food} ${d.calories}kcal P${d.protein}g`).join(" | ") || "none"}
Workouts (14d): ${l14(data.exercise).map(e => `${e.date}: ${e.label}`).join(", ") || "none"}
Sports (14d): ${l14(data.sports).map(s => `${s.date}: ${s.sport} ${s.duration}min ${s.intensity}`).join(", ") || "none"}
Today water: ${todayWater}/${goals.waterGoalMl}ml
Today supplements: ${data.supplements.filter(s => s.date === today).map(s => s.name).join(", ") || "none"}`;
  }

  async function compactIfNeeded(msgs) {
    if (msgs.length < 22) return msgs;
    if (msgs.some(m => m.summary)) {
      const sIdx = msgs.findIndex(m => m.summary);
      if (msgs.length - sIdx - 1 < 30) return msgs;
    }
    const toSum = msgs.slice(1, msgs.length - 20);
    const transcript = toSum.map(m => `${m.role.toUpperCase()}: ${m.text}`).join("\n\n");
    try {
      const sum = await callClaude({ system: "Summarize this coaching conversation in 4-6 bullet points: what the user works on, advice given, preferences, progress. Specific, no preamble.", userText: transcript, maxTokens: 400 });
      return [msgs[0], { role: "assistant", summary: true, text: `📝 *Earlier conversation summary:*\n\n${sum}`, ts: Date.now() }, ...msgs.slice(-20)];
    } catch { return msgs; }
  }

  async function send() {
    const q = input.trim();
    if ((!q && !attached) || loading) return;
    setInput("");
    const img = attached;
    setAttached(null);
    const userMsg = { role: "user", text: q || (img ? "(sent a photo)" : ""), ts: Date.now() };
    if (img) userMsg.image = img.preview; // store preview for re-display
    let updated = [...messages, userMsg];
    setMessages(updated);
    setLoading(true);
    try {
      updated = await compactIfNeeded(updated);
      setMessages(updated);
      const apiMsgs = updated.slice(1).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
      const lastU = apiMsgs.map(m => m.role).lastIndexOf("user");
      if (lastU >= 0) {
        const textPart = `[Current data]\n${ctx()}\n\n[My message]\n${q || "Please look at this photo and give feedback relevant to my fitness goal."}`;
        if (img) {
          apiMsgs[lastU] = { role: "user", content: [
            { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.b64 } },
            { type: "text", text: textPart }
          ]};
        } else {
          apiMsgs[lastU] = { role: "user", content: textPart };
        }
      }
      const reply = await callClaude({
        model: currentModelId(),
        system: `You are an elite personal trainer and sports nutritionist. The user shares their real fitness tracking data with you AND you have access to your full conversation history (including a summary of older chats). They may send photos — of meals, their physique, gym equipment, supplement labels, workout screens — analyze them helpfully. You CAN search the web, but only do so when you genuinely need a current or specific fact you're unsure about (exact branded nutrition, a specific product, recent research). For general training/nutrition advice, answer directly without searching. Reference past discussions naturally. Give direct, specific advice with their actual numbers. Use markdown: **bold** for key points, bullet lists for steps. Keep it tight — 2-4 short paragraphs. Their goal: ${goals.goal}.`,
        maxTokens: 1000,
        conversationMessages: apiMsgs,
        tools: WEB_SEARCH_TOOL
      });
      setMessages(m => [...m, { role: "assistant", text: reply || "Sorry, try again.", ts: Date.now() }]);
    } catch {
      setMessages(m => [...m, { role: "assistant", text: "Something went wrong. Try again.", ts: Date.now() }]);
    }
    setLoading(false);
  }

  async function clearChat() {
    const ok = await confirm({ title: "Clear chat history?", body: "All messages will be deleted. This can't be undone.", confirmLabel: "Clear", danger: true });
    if (ok) { setMessages([COACH_GREETING]); toast("Chat cleared"); }
  }

  async function runAnalysis() {
    setAnalysisLoad(true); setAnalysisErr("");
    try { setAnalysis(await analyzeAllData(data, goals)); }
    catch { setAnalysisErr("Couldn't analyze. Try again."); }
    setAnalysisLoad(false);
  }

  const suggestions = ["Should I train today or rest?", "Am I eating enough protein?", "What should I eat pre-workout?", "How can I improve my sleep?"];
  const statusColor = { good: "var(--good)", warning: "var(--warn)", critical: "var(--bad)" };

  return (
    <div className="coach-wrap">
      {confirmModal}
      <div className="coach-bar">
        <div className="coach-bar-l">
          <span className="coach-bar-title">AI Coach</span>
          <span className="muted small">{messages.length - 1} messages · {MODELS[_currentModel]?.label}</span>
        </div>
        <div className="coach-bar-r">
          <button className="link-btn" onClick={() => setShowAnalysis(s => !s)}>{showAnalysis ? "← Back to chat" : "📊 Full analysis"}</button>
          {!showAnalysis && messages.length > 1 && <button className="link-btn" onClick={clearChat}>Clear</button>}
        </div>
      </div>

      {!showAnalysis && (
        <>
          <div className="msgs">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.role === "assistant" && <div className="avatar">✦</div>}
                <div className="bubble">
                  {m.image && <img src={m.image} alt="" className="bubble-img" />}
                  {!m.image && m.hadImage && <div className="bubble-img-gone">📷 photo</div>}
                  {m.text && <div className="md">{renderMarkdown(m.text)}</div>}
                </div>
              </div>
            ))}
            {loading && (
              <div className="msg assistant">
                <div className="avatar">✦</div>
                <div className="bubble typing"><span /><span /><span /></div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {messages.length <= 1 && (
            <div className="suggs">
              {suggestions.map((s, i) => <button key={i} className="sugg" onClick={() => setInput(s)}>{s}</button>)}
            </div>
          )}

          <div className="composer-wrap">
            {attached && (
              <div className="attach-preview">
                <img src={attached.preview} alt="" />
                <button className="attach-x" onClick={() => setAttached(null)}>×</button>
                <span className="attach-label">Photo attached</span>
              </div>
            )}
            <div className="composer">
              <button className="attach-btn" onClick={() => camRef.current.click()} disabled={loading} title="Take photo">📷</button>
              <button className="attach-btn" onClick={() => galRef.current.click()} disabled={loading} title="Choose photo">🖼️</button>
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={attached ? "Add a note (optional)…" : "Ask, or attach a photo…"} disabled={loading} />
              <button className="send" onClick={send} disabled={(!input.trim() && !attached) || loading}>{loading ? <span className="spinner" /> : "↑"}</button>
            </div>
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={e => attachFile(e.target.files[0])} />
            <input ref={galRef} type="file" accept="image/*" hidden onChange={e => attachFile(e.target.files[0])} />
          </div>
        </>
      )}

      {showAnalysis && (
        <div className="stack analysis-stack">
          <Card title="Full data analysis" sub={`Reviews your last 14 days vs your ${goals.goal} goal`}>
            {!hasData ? <Empty title="No data yet" hint="Log some sleep, food, or workouts first" /> : (
              <button className="btn full" onClick={runAnalysis} disabled={analysisLoad}>
                {analysisLoad ? <><span className="spinner" />Analyzing…</> : analysis ? "Re-run analysis" : "Run analysis"}
              </button>
            )}
            {analysisErr && <div className="err">{analysisErr}</div>}
          </Card>

          {analysis && (
            <>
              <Card>
                <div className="score-row">
                  <div className="score-ring">
                    <svg viewBox="0 0 80 80">
                      <circle cx="40" cy="40" r="34" fill="none" stroke="var(--track)" strokeWidth="6" />
                      <circle cx="40" cy="40" r="34" fill="none" stroke="var(--accent)" strokeWidth="6" strokeDasharray={`${(analysis.overallScore / 10) * 213.6} 213.6`} strokeLinecap="round" transform="rotate(-90 40 40)" />
                    </svg>
                    <div className="score-n">{analysis.overallScore}<span>/10</span></div>
                  </div>
                  <div>
                    <div className="card-title" style={{ marginBottom: 4 }}>Overall score</div>
                    <p className="md-p">{analysis.summary}</p>
                  </div>
                </div>
              </Card>

              <Card className="priority-card">
                <div className="priority-label">⚡ This week's #1 priority</div>
                <p className="priority-text">{analysis.priorityAction}</p>
              </Card>

              {analysis.sections.map((s, i) => (
                <Card key={i}>
                  <div className="ana-hd">
                    <span className="card-title">{s.category}</span>
                    <div className="ana-score">
                      <span style={{ color: statusColor[s.status] }}>{s.score}/10</span>
                      <span className="ana-dot" style={{ background: statusColor[s.status] }} />
                    </div>
                  </div>
                  <p className="muted" style={{ lineHeight: 1.6, fontSize: ".88rem", marginTop: 8 }}>{s.insight}</p>
                  <ul className="ana-tips">
                    {s.tips.map((t, j) => <li key={j}><span className="ana-arrow">→</span><span>{t}</span></li>)}
                  </ul>
                </Card>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SETTINGS TAB ─────────────────────────────────────────────────────────────
function SettingsTab({ data, goals, onSaveGoals, onClearAll, onImport, session, onSignOut }) {
  const [section, setSection] = useState("goals");

  return (
    <div className="stack">
      <div className="subtabs">
        <button className={`subtab ${section === "goals" ? "active" : ""}`} onClick={() => setSection("goals")}>⊙ Goals</button>
        <button className={`subtab ${section === "export" ? "active" : ""}`} onClick={() => setSection("export")}>⬇ Export</button>
        <button className={`subtab ${section === "data" ? "active" : ""}`} onClick={() => setSection("data")}>⌗ Data</button>
      </div>
      {section === "goals" && <><GoalsSettings goals={goals} onSave={onSaveGoals} /><AIModelSettings /></>}
      {section === "export" && <ExportSettings data={data} goals={goals} />}
      {section === "data" && <DataSettings data={data} onClearAll={onClearAll} onImport={onImport} />}

      {session && (
        <Card title="Account">
          <div className="account-row">
            <div>
              <div className="account-email">{session.user?.email}</div>
              <div className="muted small">☁ Synced across your devices</div>
            </div>
            <button className="btn-ghost" onClick={onSignOut}>Sign out</button>
          </div>
        </Card>
      )}
    </div>
  );
}

function AIModelSettings() {
  const [model, setModel] = useState(loadModelPref);
  function pick(key) { setModel(key); saveModelPref(key); toast(`AI model: ${MODELS[key].label}`); }
  return (
    <Card title="AI model" sub="Used for food, sports & coach. Switch anytime.">
      <div className="model-opts">
        {Object.entries(MODELS).map(([key, m]) => (
          <button key={key} className={`model-opt ${model === key ? "active" : ""}`} onClick={() => pick(key)}>
            <div className="model-opt-top">
              <span className="model-opt-name">{m.label}</span>
              {model === key && <span className="model-opt-check">✓</span>}
            </div>
            <span className="model-opt-desc">{m.desc}</span>
          </button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>
        Haiku is plenty for daily logging. Switch to Sonnet for tricky meals or deeper coaching when accuracy matters most.
      </p>
    </Card>
  );
}

function GoalsSettings({ goals, onSave }) {
  const [form, setForm] = useState(goals);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setForm(goals); }, [goals]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const autoCalc = (cal, goal) => {
    if (goal === "Build Muscle") return { protein: Math.round(cal*.30/4), carbs: Math.round(cal*.45/4), fat: Math.round(cal*.25/9) };
    if (goal === "Lose Fat") return { protein: Math.round(cal*.35/4), carbs: Math.round(cal*.35/4), fat: Math.round(cal*.30/9) };
    if (goal === "Improve Endurance") return { protein: Math.round(cal*.20/4), carbs: Math.round(cal*.55/4), fat: Math.round(cal*.25/9) };
    if (goal === "Athletic Performance") return { protein: Math.round(cal*.25/4), carbs: Math.round(cal*.50/4), fat: Math.round(cal*.25/9) };
    return { protein: Math.round(cal*.25/4), carbs: Math.round(cal*.45/4), fat: Math.round(cal*.30/9) };
  };
  const total = form.protein*4 + form.carbs*4 + form.fat*9;
  const pPct = Math.round((form.protein*4/total)*100);
  const cPct = Math.round((form.carbs*4/total)*100);
  const fPct = Math.round((form.fat*9/total)*100);

  return (
    <Card title="Goals & targets">
      <div className="field-grid">
        <label>Primary goal<select value={form.goal} onChange={e => set("goal", e.target.value)}>{fitnessGoals.map(g => <option key={g}>{g}</option>)}</select></label>
        <label>Daily calories<input type="number" value={form.calories} onChange={e => set("calories", +e.target.value)} /></label>
      </div>

      <div className="row-between">
        <span className="lbl">Macros</span>
        <button className="link-btn" onClick={() => setForm(f => ({ ...f, ...autoCalc(f.calories, f.goal) }))}>Auto-calc for {form.goal}</button>
      </div>
      <div className="field-grid three">
        <label>Protein (g)<input type="number" value={form.protein} onChange={e => set("protein", +e.target.value)} /></label>
        <label>Carbs (g)<input type="number" value={form.carbs} onChange={e => set("carbs", +e.target.value)} /></label>
        <label>Fat (g)<input type="number" value={form.fat} onChange={e => set("fat", +e.target.value)} /></label>
      </div>

      <div className="macro-bar">
        <div className="macro-seg" style={{ width: `${pPct}%`, background: "#b4a8e8" }} />
        <div className="macro-seg" style={{ width: `${cPct}%`, background: "#f9c97e" }} />
        <div className="macro-seg" style={{ width: `${fPct}%`, background: "#f47e6e" }} />
      </div>
      <div className="legend">
        <span><span className="dot" style={{ background: "#b4a8e8" }} />Protein {pPct}%</span>
        <span><span className="dot" style={{ background: "#f9c97e" }} />Carbs {cPct}%</span>
        <span><span className="dot" style={{ background: "#f47e6e" }} />Fat {fPct}%</span>
        <span className="muted" style={{ marginLeft: "auto" }}>{total} / {form.calories} kcal</span>
      </div>

      <div className="divider" />
      <div className="field-grid">
        <label>Daily water (ml)<input type="number" step="100" value={form.waterGoalMl} onChange={e => set("waterGoalMl", +e.target.value)} /></label>
      </div>

      <button className="btn full" onClick={() => { onSave(form); setSaved(true); setTimeout(() => setSaved(false), 2000); }}>{saved ? "✓ Saved" : "Save goals"}</button>
    </Card>
  );
}

function ExportSettings({ data, goals }) {
  const esc = v => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const csv = (rows, h) => [h.join(","), ...rows.map(r => h.map(k => esc(r[k])).join(","))].join("\n");
  const dl = (name, content, mime = "text/csv") => {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  };
  const t = getTodayStr();
  const dlSleep = () => dl(`fitlog-sleep-${t}.csv`, csv(data.sleep, ["date","duration","bedtime","wakeTime","quality","notes"]));
  const dlDiet = () => dl(`fitlog-diet-${t}.csv`, csv(data.diet, ["date","meal","food","calories","protein","carbs","fat","notes"]));
  const dlExer = () => dl(`fitlog-workouts-${t}.csv`, csv(data.exercise, ["date","label","text"]));
  const dlSp = () => dl(`fitlog-sports-${t}.csv`, csv(data.sports, ["date","sport","duration","intensity","calories","result","opponent","score","notes"]));
  const dlWater = () => dl(`fitlog-water-${t}.csv`, csv(data.water.map(w => ({ ...w, time: w.ts ? new Date(w.ts).toISOString() : "" })), ["date","time","ml"]));
  const dlSupp = () => dl(`fitlog-supplements-${t}.csv`, csv(data.supplements.map(s => ({ ...s, time: s.ts ? new Date(s.ts).toISOString() : "" })), ["date","time","name","dose"]));
  const dlChat = () => {
    try { const msgs = JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]");
      const rows = msgs.map(m => ({ timestamp: m.ts ? new Date(m.ts).toISOString() : "", role: m.role, text: m.text }));
      dl(`fitlog-chat-${t}.csv`, csv(rows, ["timestamp","role","text"]));
    } catch { alert("Could not export chat."); }
  };
  const dlAll = () => {
    [dlSleep, dlDiet, dlExer, dlSp, dlWater, dlSupp, dlChat].forEach((fn, i) => setTimeout(fn, i * 200));
  };
  const dlJson = () => dl(`fitlog-backup-${t}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), goals, data, chat: JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]") }, null, 2), "application/json");

  let chatCount = 0;
  try { chatCount = JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]").length; } catch {}

  const cats = [
    { label: "Sleep", icon: "◐", n: data.sleep.length, fn: dlSleep },
    { label: "Meals", icon: "◉", n: data.diet.length, fn: dlDiet },
    { label: "Workouts", icon: "◆", n: data.exercise.length, fn: dlExer },
    { label: "Sports", icon: "◇", n: data.sports.length, fn: dlSp },
    { label: "Water", icon: "◊", n: data.water.length, fn: dlWater },
    { label: "Supps", icon: "⊕", n: data.supplements.length, fn: dlSupp },
    { label: "Chat", icon: "✦", n: Math.max(0, chatCount - 1), fn: dlChat },
  ];

  return (
    <Card title="Export your data" sub="CSVs open in Excel, Google Sheets, Numbers">
      <div className="exp-grid">
        {cats.map(c => (
          <button key={c.label} className="exp-card" onClick={c.fn} disabled={!c.n}>
            <span className="exp-icon">{c.icon}</span>
            <span className="exp-name">{c.label}</span>
            <span className="exp-n">{c.n}</span>
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn flex" onClick={dlAll}>⬇ All as CSV</button>
        <button className="btn-ghost" onClick={dlJson}>JSON backup</button>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>JSON backup includes everything and can be restored from the Data tab.</p>
    </Card>
  );
}

function DataSettings({ data, onClearAll, onImport }) {
  const fileRef = useRef();
  const [confirm, confirmModal] = useConfirm();
  const total = Object.values(data).reduce((a, arr) => a + (Array.isArray(arr) ? arr.length : 0), 0);
  let chatCount = 0;
  try { chatCount = Math.max(0, JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]").length - 1); } catch {}

  function importFile(e) {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async ev => {
      try {
        const p = JSON.parse(ev.target.result);
        if (!p.data || !p.goals) throw new Error();
        const ok = await confirm({ title: "Restore this backup?", body: "This replaces all your current data with the contents of the file.", confirmLabel: "Restore" });
        if (!ok) return;
        onImport(p);
      } catch { toast("Couldn't read that file"); }
    };
    r.readAsText(f);
    e.target.value = "";
  }

  async function clearAll() {
    const ok1 = await confirm({ title: "Delete everything?", body: "All tracked data and chat history will be permanently erased. Goals remain.", confirmLabel: "Continue", danger: true });
    if (!ok1) return;
    const ok2 = await confirm({ title: "Are you absolutely sure?", body: "This cannot be undone. Export a backup first if you're unsure.", confirmLabel: "Delete everything", danger: true });
    if (ok2) onClearAll();
  }

  return (
    <>
      {confirmModal}
      <Card title="Your data">
        <div className="stat-row">
          <div className="stat"><div className="stat-n">{total}</div><div className="stat-l">Total entries</div></div>
          <div className="stat"><div className="stat-n">{chatCount}</div><div className="stat-l">Chat messages</div></div>
        </div>
      </Card>

      <Card title="📥 Restore backup" sub="Load a fitlog JSON file. Replaces current data.">
        <button className="btn-ghost full" onClick={() => fileRef.current.click()}>Choose file…</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importFile} />
      </Card>

      <Card title="⚠ Danger zone" className="danger-card">
        <p className="muted" style={{ marginBottom: 12, fontSize: ".85rem", lineHeight: 1.6 }}>
          Permanently delete all sleep, meals, workouts, sports, water, supplements, and chat history. Goals remain. <strong>Export a backup first.</strong>
        </p>
        <button className="btn-danger full" onClick={clearAll}>Clear everything</button>
      </Card>

      <p className="muted small center" style={{ marginTop: 8 }}>☁ Your data is synced to the cloud and available on any device you sign in to.</p>
    </>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function FitnessTracker() {
  // ─── Auth & sync state ──
  const [authChecked, setAuthChecked] = useState(false);
  const [session, setSession] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [bootKey, setBootKey] = useState(0); // bumped after cloud pull to reload local state

  // Check auth on mount + subscribe to changes
  useEffect(() => {
    if (!hasSupabase) { setAuthChecked(true); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // When a session appears, pull cloud data (or push local up if cloud is empty)
  useEffect(() => {
    if (!session?.user?.id) { setCurrentUser(null); return; }
    const uid = session.user.id;
    setCurrentUser(uid);
    (async () => {
      setSyncing(true);
      try {
        const pulled = await cloudPull(uid);
        if (!pulled) {
          // First time on this account → push whatever's in this browser up
          await cloudPushNow(uid);
        }
        setBootKey(k => k + 1); // reload local-derived state
      } catch (e) {}
      setSyncing(false);
    })();
  }, [session?.user?.id]);

  if (!authChecked) {
    return <><style>{styles}</style><div className="boot"><span className="spinner" /></div></>;
  }

  // If Supabase is configured but no session, show login
  if (hasSupabase && !session) {
    return <><style>{styles}</style><AuthScreen /></>;
  }

  return <AppShell key={bootKey} session={session} syncing={syncing} />;
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
function AuthScreen() {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (e) {
      setError(e.message || "Something went wrong. Try again.");
    }
    setBusy(false);
  }

  return (
    <div className="auth">
      <div className="auth-box">
        <h1 className="auth-brand">FitLog</h1>
        <p className="auth-sub">{mode === "signup" ? "Create your account" : "Welcome back"}</p>
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" autoComplete="email" /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} placeholder="••••••••" autoComplete={mode === "signup" ? "new-password" : "current-password"} /></label>
        {error && <div className="err">{error}</div>}
        <button className="btn full" onClick={submit} disabled={busy} style={{ marginTop: 14 }}>
          {busy ? <span className="spinner" /> : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <p className="auth-switch">
          {mode === "signup" ? "Already have an account?" : "New here?"}
          <button className="link-btn" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); }}>
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}

// ─── APP SHELL (the actual app once authed) ───────────────────────────────────
function AppShell({ session, syncing }) {
  const [activeTab, setActiveTab] = useState("Home");
  const [logSub, setLogSub] = useState(null);
  const [data, setData] = useState(loadData);
  const [goals, setGoals] = useState(loadGoals);
  const firstData = useRef(true);
  const firstGoals = useRef(true);

  useEffect(() => {
    saveData(data);
    if (firstData.current) { firstData.current = false; return; }
    cloudSync();
  }, [data]);
  useEffect(() => {
    saveGoals(goals);
    if (firstGoals.current) { firstGoals.current = false; return; }
    cloudSync();
  }, [goals]);

  const addEntry = type => entry => setData(d => ({ ...d, [type]: [entry, ...(d[type] || [])] }));
  const deleteEntry = type => id => setData(d => ({ ...d, [type]: (d[type] || []).filter(e => e.id !== id) }));
  const clearAll = () => {
    setData(defaultData);
    localStorage.removeItem(STORAGE_KEY + "_chat");
    cloudSync();
    setTimeout(() => window.location.reload(), 200);
  };
  const importData = backup => {
    if (backup.data) setData({ ...defaultData, ...backup.data });
    if (backup.goals) setGoals({ ...defaultGoals, ...backup.goals });
    if (backup.chat) localStorage.setItem(STORAGE_KEY + "_chat", JSON.stringify(backup.chat));
    cloudSync();
    setTimeout(() => window.location.reload(), 300);
  };

  async function signOut() {
    if (hasSupabase) await supabase.auth.signOut();
    window.location.reload();
  }

  function navTo(tab, sub) {
    setActiveTab(tab);
    if (sub) setLogSub(sub);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <style>{styles}</style>
      <ToastHost />
      <div className="app">
        <header className="topbar">
          <h1 className="brand">FitLog</h1>
          {syncing && <span className="sync-badge"><span className="spinner" />syncing</span>}
        </header>

        <main className="main">
          {activeTab === "Home" && <HomeTab data={data} goals={goals} onAddWater={addEntry("water")} onNav={navTo} />}
          {activeTab === "Log" && <LogTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} initialSub={logSub} />}
          {activeTab === "History" && <HistoryTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} />}
          {activeTab === "Coach" && <CoachTab data={data} goals={goals} />}
          {activeTab === "Settings" && <SettingsTab data={data} goals={goals} onSaveGoals={setGoals} onClearAll={clearAll} onImport={importData} session={session} onSignOut={signOut} />}
        </main>

        <nav className="tabbar">
          {TABS.map(tab => (
            <button key={tab} className={`tabbtn ${activeTab === tab ? "active" : ""}`} onClick={() => { setActiveTab(tab); if (tab !== "Log") setLogSub(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
              <TabIcon name={tab} active={activeTab === tab} />
              <span className="tabbtn-label">{tab}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}

// ─── TAB ICONS (inline SVG, consistent across devices) ───────────────────────
function TabIcon({ name, active }) {
  const s = active ? "var(--accent)" : "var(--muted)";
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: s, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "Home") return <svg {...common}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" /></svg>;
  if (name === "Log") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>;
  if (name === "History") return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 4v4h4" /><path d="M12 8v4l3 2" /></svg>;
  if (name === "Coach") return <svg {...common}><path d="M12 3l2.1 5.4L19.5 9l-4 3.6 1.2 5.4L12 15.8 7.3 18l1.2-5.4L4.5 9l5.4-.6L12 3z" /></svg>;
  if (name === "Settings") return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>;
  return null;
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = `
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600;700&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0a0b0f;
  --surface: #14161c;
  --surface-2: #1a1d25;
  --border: rgba(255,255,255,0.06);
  --border-strong: rgba(255,255,255,0.1);
  --text: #ebedf2;
  --text-2: #b5b9c4;
  --muted: #6b7180;
  --accent: #6ee7f7;
  --accent-dim: rgba(110,231,247,0.12);
  --track: rgba(255,255,255,0.06);
  --good: #8fd989;
  --warn: #f9c97e;
  --bad: #f47e6e;
  --radius: 14px;
  --radius-sm: 10px;
  --accent-glow: rgba(110,231,247,0.35);
  --shadow-card: 0 1px 2px rgba(0,0,0,0.3), 0 6px 16px rgba(0,0,0,0.25);
  --shadow-lift: 0 4px 12px rgba(0,0,0,0.35), 0 12px 32px rgba(0,0,0,0.3);
  --spring: cubic-bezier(.34,1.56,.64,1);
  --ease-out: cubic-bezier(.22,1,.36,1);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}

html, body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
body { font-size: 15px; line-height: 1.5; }

/* Atmospheric background — soft accent glow up top + subtle grain, fixed so it doesn't scroll */
body::before {
  content: ""; position: fixed; inset: 0; z-index: -2; pointer-events: none;
  background:
    radial-gradient(900px 500px at 50% -8%, rgba(110,231,247,0.10), transparent 60%),
    radial-gradient(700px 600px at 100% 100%, rgba(180,168,232,0.06), transparent 55%);
}
body::after {
  content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: 0.4;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
  mix-blend-mode: overlay;
}

.app { min-height: 100vh; min-height: 100dvh; max-width: 720px; margin: 0 auto; padding: 0 18px 96px; padding-bottom: calc(96px + env(safe-area-inset-bottom)); }

/* Top */
.topbar { padding: 22px 0 14px; }
.brand {
  font-family: 'DM Serif Display', serif; font-size: 1.7rem; font-weight: 400; letter-spacing: -0.5px;
  background: linear-gradient(100deg, var(--text) 30%, var(--accent) 50%, var(--text) 70%);
  background-size: 200% 100%; -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: brandIn .6s var(--ease-out) both, sheen 6s ease-in-out 1s infinite;
}
@keyframes brandIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@keyframes sheen { 0%, 100% { background-position: 150% 0; } 50% { background-position: -50% 0; } }

/* Tab bar bottom */
.tabbar {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: rgba(10,11,15,0.92); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid var(--border);
  display: flex; padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
  z-index: 100;
}
.tabbtn {
  flex: 1; background: transparent; border: none; color: var(--muted);
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 6px 4px; cursor: pointer; transition: color .2s var(--ease-out), transform .12s ease;
  font-family: inherit; position: relative; -webkit-tap-highlight-color: transparent;
}
.tabbtn::before {
  content: ""; position: absolute; top: 1px; width: 4px; height: 4px; border-radius: 50%;
  background: var(--accent); box-shadow: 0 0 8px var(--accent-glow);
  opacity: 0; transform: scale(0); transition: opacity .25s, transform .35s var(--spring);
}
.tabbtn.active::before { opacity: 1; transform: scale(1); }
.tabbtn:active { transform: scale(.9); }
.tabbtn.active { color: var(--accent); }
.tabbtn.active svg, .tabbtn.active .tabbtn-icon { animation: iconPop .4s var(--spring); }
@keyframes iconPop { 0% { transform: scale(1); } 45% { transform: scale(1.22); } 100% { transform: scale(1); } }
.tabbtn-icon { font-size: 1.1rem; line-height: 1; }
.tabbtn-label { font-size: .67rem; font-weight: 500; }

.main { animation: fade .3s var(--ease-out); }
@keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* Staggered reveal — each direct child of a .stack rises in sequence */
.stack > * { animation: riseIn .5s var(--ease-out) both; }
.stack > *:nth-child(1) { animation-delay: .02s; }
.stack > *:nth-child(2) { animation-delay: .08s; }
.stack > *:nth-child(3) { animation-delay: .14s; }
.stack > *:nth-child(4) { animation-delay: .20s; }
.stack > *:nth-child(5) { animation-delay: .26s; }
.stack > *:nth-child(6) { animation-delay: .32s; }
.stack > *:nth-child(n+7) { animation-delay: .36s; }
@keyframes riseIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

/* Layout */
.stack { display: flex; flex-direction: column; gap: 14px; }
.row { display: flex; gap: 8px; align-items: center; }
.flex { flex: 1; }
.row-between { display: flex; justify-content: space-between; align-items: center; margin: 10px 0 8px; }

/* Greeting */
.greeting { padding: 4px 2px 6px; }
.greeting-date { color: var(--muted); font-size: .8rem; font-weight: 500; letter-spacing: 0.02em; text-transform: uppercase; }
.greeting-h { font-family: 'DM Serif Display', serif; font-size: 1.85rem; font-weight: 400; margin: 6px 0 4px; line-height: 1.05; letter-spacing: -0.01em; }
.greeting-goal { color: var(--text-2); font-size: .9rem; }

/* Card */
.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px;
  box-shadow: var(--shadow-card); position: relative;
  transition: transform .3s var(--ease-out), box-shadow .3s var(--ease-out), border-color .3s var(--ease-out);
}
.card::before {
  content: ""; position: absolute; inset: 0 0 auto; height: 1px; border-radius: var(--radius) var(--radius) 0 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent); pointer-events: none;
}
.card-hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.card-title { font-size: .92rem; font-weight: 600; color: var(--text); letter-spacing: -0.005em; }
.card-sub { color: var(--muted); font-size: .8rem; margin-top: 3px; line-height: 1.5; }

/* Rings */
.rings-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.ring { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; animation: ringDraw .7s var(--ease-out) both; }
.ring:nth-child(2) { animation-delay: .1s; }
.ring:nth-child(3) { animation-delay: .2s; }
@keyframes ringDraw { from { opacity: 0; transform: scale(.85) rotate(-8deg); } to { opacity: 1; transform: none; } }
.ring svg { display: block; }
.ring svg circle:last-child { filter: drop-shadow(0 0 4px var(--accent-glow)); }
.ring-center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding-bottom: 18px; }
.ring-val { font-family: 'DM Serif Display', serif; font-size: 1.05rem; color: var(--text); animation: valIn .6s var(--ease-out) .25s both; }
.ring-val.big { font-size: 1.4rem; }
.ring-unit { font-family: 'Inter', sans-serif; font-size: .65rem; color: var(--muted); margin-left: 2px; font-weight: 500; }
.ring-label { font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
@keyframes valIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.ring-targets { display: flex; justify-content: space-around; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); font-size: .72rem; color: var(--muted); }

/* Quick actions */
.quick-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.qa {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 14px; display: flex; align-items: center; gap: 10px;
  color: var(--text); font-family: inherit; font-size: .9rem; font-weight: 500; cursor: pointer;
  transition: border-color .2s var(--ease-out), background .2s var(--ease-out), transform .15s var(--spring), box-shadow .2s var(--ease-out);
  min-height: 56px; -webkit-tap-highlight-color: transparent;
}
.qa:hover { border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow-card); }
.qa:active { transform: translateY(0) scale(.97); }
.qa.qa-primary { background: var(--accent-dim); border-color: rgba(110,231,247,0.25); color: var(--accent); }
.qa.qa-primary:hover { box-shadow: 0 6px 20px var(--accent-dim); border-color: var(--accent-glow); }
.qa-icon { font-size: 1.1rem; transition: transform .3s var(--spring); }
.qa:hover .qa-icon { transform: scale(1.18) rotate(-6deg); }

.quick-water { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
.quick-water .qa { flex-direction: column; gap: 4px; text-align: center; padding: 14px 8px; min-height: 64px; line-height: 1.2; }
.quick-water .qa span { color: var(--muted); font-size: .7rem; font-weight: 400; }

/* Today items */
.today-items { display: flex; flex-direction: column; gap: 8px; }
.today-item { display: flex; align-items: center; gap: 10px; font-size: .87rem; padding: 4px 0; animation: slideRight .45s var(--ease-out) both; }
.today-item:nth-child(2) { animation-delay: .05s; }
.today-item:nth-child(3) { animation-delay: .1s; }
.today-item:nth-child(4) { animation-delay: .15s; }
.today-item:nth-child(5) { animation-delay: .2s; }
@keyframes slideRight { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
.today-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; animation: dotPulse 2.4s ease-in-out infinite; }
@keyframes dotPulse { 0%, 100% { box-shadow: 0 0 0 0 transparent; } 50% { box-shadow: 0 0 0 3px rgba(255,255,255,0.04); } }
.today-text { color: var(--text-2); }


/* Insight */
.insight { font-size: .9rem; line-height: 1.6; color: var(--text); }

/* Sub-tabs */
.subtabs {
  display: flex; gap: 4px; background: var(--surface); padding: 4px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  overflow-x: auto; scrollbar-width: none;
}
.subtabs::-webkit-scrollbar { display: none; }
.subtab {
  flex: 1; padding: 8px 10px; background: transparent; border: none; color: var(--muted);
  font-family: inherit; font-size: .8rem; font-weight: 500; cursor: pointer; border-radius: 7px;
  white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 5px;
  transition: color .2s var(--ease-out), background .25s var(--ease-out), transform .12s ease; min-width: 60px;
  -webkit-tap-highlight-color: transparent;
}
.subtab.active { background: var(--surface-2); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,0.25); }
.subtab:active { transform: scale(.95); }
.subtab:hover:not(.active) { color: var(--text-2); }
.subtab-icon { font-size: .9rem; }

/* Forms */
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.field-grid.three { grid-template-columns: 1fr 1fr 1fr; }
@media (max-width: 480px) { .field-grid:not(.three) { grid-template-columns: 1fr; } }
label { display: flex; flex-direction: column; gap: 5px; font-size: .73rem; color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }
input, select, textarea {
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); font-family: inherit; font-size: .92rem; padding: 11px 12px;
  outline: none; transition: border-color .2s var(--ease-out), box-shadow .2s var(--ease-out); width: 100%;
}
input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
textarea { resize: vertical; min-height: 64px; line-height: 1.5; }
select option { background: var(--surface-2); }

.duration-pill { display: inline-flex; gap: 4px; background: var(--accent-dim); border: 1px solid rgba(110,231,247,0.2); color: var(--accent); padding: 4px 12px; border-radius: 16px; font-size: .82rem; margin-bottom: 12px; font-weight: 500; }
.duration-pill span { font-weight: 600; }

.lbl { font-size: .82rem; color: var(--text); font-weight: 500; }

/* Buttons */
.btn {
  background: var(--accent); color: #0a1418; border: none; border-radius: 10px; padding: 11px 18px;
  font-family: inherit; font-size: .88rem; font-weight: 600; cursor: pointer;
  transition: transform .14s var(--spring), box-shadow .2s var(--ease-out), opacity .15s;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  position: relative; overflow: hidden; -webkit-tap-highlight-color: transparent;
}
.btn::after {
  content: ""; position: absolute; top: 0; left: -120%; width: 60%; height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.4), transparent);
  transform: skewX(-20deg); transition: left .6s var(--ease-out);
}
.btn:hover:not(:disabled) { box-shadow: 0 4px 16px var(--accent-glow); transform: translateY(-1px); }
.btn:hover:not(:disabled)::after { left: 140%; }
.btn:active:not(:disabled) { transform: translateY(0) scale(.97); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.full { width: 100%; }
.btn-ghost { background: transparent; border: 1px solid var(--border-strong); color: var(--text); border-radius: 10px; padding: 10px 18px; font-family: inherit; font-size: .85rem; font-weight: 500; cursor: pointer; transition: background .2s var(--ease-out), transform .14s var(--spring), border-color .2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; -webkit-tap-highlight-color: transparent; }
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); border-color: var(--accent-glow); }
.btn-ghost:active:not(:disabled) { transform: scale(.97); }
.btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-ghost.full { width: 100%; }
.btn-danger { background: rgba(244,126,110,0.1); border: 1px solid rgba(244,126,110,0.3); color: var(--bad); border-radius: 10px; padding: 11px 18px; font-family: inherit; font-size: .88rem; font-weight: 600; cursor: pointer; transition: background .15s; }
.btn-danger:hover { background: rgba(244,126,110,0.18); }
.btn-danger.full { width: 100%; }
.link-btn { background: transparent; border: none; color: var(--accent); font-family: inherit; font-size: .78rem; font-weight: 500; cursor: pointer; padding: 2px 6px; }
.link-btn:hover:not(:disabled) { text-decoration: underline; }
.link-btn:disabled { opacity: .4; cursor: not-allowed; }

/* Segmented control */
.seg { display: flex; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 3px; margin-bottom: 12px; }
.seg-btn { flex: 1; background: transparent; border: none; color: var(--muted); font-family: inherit; font-size: .8rem; font-weight: 500; padding: 7px 10px; border-radius: 6px; cursor: pointer; transition: all .15s; }
.seg-btn.active { background: var(--bg); color: var(--text); }

/* Upload */
.upload {
  border: 2px dashed var(--border-strong); border-radius: 10px; min-height: 140px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  cursor: pointer; color: var(--muted); margin-bottom: 12px; overflow: hidden;
  transition: border-color .25s var(--ease-out), background .25s, transform .15s var(--spring);
}
.upload:hover { border-color: var(--accent); background: var(--accent-dim); transform: scale(1.01); }
.upload:hover .upload-icon { animation: bob 1.2s ease-in-out infinite; }
@keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
.upload-icon { font-size: 2rem; }
.upload-img { width: 100%; max-height: 220px; object-fit: cover; }

/* AI cards */
.ai-card {
  background: var(--accent-dim); border: 1px solid rgba(110,231,247,0.2); border-radius: 12px; padding: 16px; margin-top: 4px;
  position: relative; animation: aiReveal .5s var(--ease-out) both;
}
.ai-card::before {
  content: ""; position: absolute; inset: -1px; border-radius: 12px; padding: 1px; pointer-events: none;
  background: linear-gradient(120deg, var(--accent), transparent 40%, transparent 60%, var(--accent));
  background-size: 300% 100%; -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude; opacity: .5; animation: sheen 4s linear infinite;
}
@keyframes aiReveal { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
.ai-card-label { font-size: .68rem; font-weight: 600; color: var(--accent); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
.ai-card-name { font-size: .95rem; font-weight: 500; margin-bottom: 12px; }
.conf-badge { font-size: .62rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; padding: 2px 7px; border-radius: 8px; margin-left: 8px; }
.conf-high { background: rgba(143,217,137,0.15); color: var(--good); }
.conf-medium { background: rgba(249,201,126,0.15); color: var(--warn); }
.conf-low { background: rgba(244,126,110,0.15); color: var(--bad); }
.web-toggle { display: flex; align-items: flex-start; gap: 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 10px; cursor: pointer; text-transform: none; letter-spacing: normal; }
.web-toggle input { width: 18px; height: 18px; margin-top: 1px; flex-shrink: 0; accent-color: var(--accent); cursor: pointer; }
.web-toggle-text { display: flex; flex-direction: column; gap: 2px; }
.web-toggle-title { font-size: .85rem; font-weight: 500; color: var(--text); }
.web-toggle-sub { font-size: .72rem; color: var(--muted); line-height: 1.4; }
.model-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.model-opt { text-align: left; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 14px; cursor: pointer; font-family: inherit; transition: border-color .15s, background .15s, transform .12s ease; -webkit-tap-highlight-color: transparent; }
.model-opt:active { transform: scale(.97); }
.model-opt.active { border-color: var(--accent); background: var(--accent-dim); }
.model-opt-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
.model-opt-name { font-size: .95rem; font-weight: 600; color: var(--text); }
.model-opt-check { color: var(--accent); font-weight: 700; }
.model-opt-desc { font-size: .73rem; color: var(--muted); line-height: 1.45; }
@media (max-width: 380px) { .model-opts { grid-template-columns: 1fr; } }
.ai-card-big { font-family: 'DM Serif Display', serif; font-size: 2.4rem; color: var(--accent); line-height: 1; margin-bottom: 6px; }
.ai-card-big span { font-family: 'Inter', sans-serif; font-size: .9rem; color: var(--muted); font-weight: 500; }
.ai-card-note { font-size: .82rem; color: var(--text-2); line-height: 1.55; margin-bottom: 12px; }

.macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px; }
.macro { background: var(--surface); border-radius: 8px; padding: 9px 6px; text-align: center; border: 1px solid var(--border); animation: macroPop .4s var(--spring) both; }
.macro:nth-child(2) { animation-delay: .06s; }
.macro:nth-child(3) { animation-delay: .12s; }
.macro:nth-child(4) { animation-delay: .18s; }
@keyframes macroPop { from { opacity: 0; transform: scale(.8); } to { opacity: 1; transform: none; } }
.macro-v { display: block; font-size: .95rem; font-weight: 600; color: var(--text); }
.macro-l { display: block; font-size: .62rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }

/* Spinner */
.spinner { display: inline-block; width: 13px; height: 13px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
.spinner.inline { width: 12px; height: 12px; }
@keyframes spin { to { transform: rotate(360deg); } }
.loading-row { display: flex; align-items: center; gap: 10px; color: var(--accent); font-size: .85rem; }

/* Errors */
.err { padding: 10px 14px; background: rgba(244,126,110,0.08); border: 1px solid rgba(244,126,110,0.25); color: var(--bad); border-radius: 8px; font-size: .82rem; margin-top: 10px; }

/* Empty */
.empty { text-align: center; padding: 24px 12px; }
.empty-icon { font-size: 1.6rem; color: var(--muted); margin-bottom: 8px; opacity: 0.5; display: inline-block; animation: breathe 3s ease-in-out infinite; }
@keyframes breathe { 0%, 100% { transform: scale(1); opacity: .4; } 50% { transform: scale(1.08); opacity: .6; } }
.empty-title { color: var(--text-2); font-size: .92rem; font-weight: 500; }
.empty-hint { color: var(--muted); font-size: .8rem; margin-top: 4px; line-height: 1.5; }

/* History list */
.hist-list { display: flex; flex-direction: column; gap: 4px; }
.hist { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; transition: border-color .2s, transform .15s var(--ease-out); }
.hist:hover { border-color: var(--border-strong); }
.hist.open { border-color: var(--border-strong); }
.hist-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; gap: 10px; cursor: pointer; }
.hist-l { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.hist-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.hist-text { min-width: 0; flex: 1; }
.hist-main { font-size: .87rem; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hist-date { font-size: .72rem; color: var(--muted); margin-top: 2px; }
.hist-tags { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.hist-tag { font-size: .7rem; color: var(--muted); background: var(--surface); border: 1px solid var(--border); padding: 2px 8px; border-radius: 8px; white-space: nowrap; }
.hist-detail { padding: 0 12px 12px; font-size: .85rem; color: var(--text-2); line-height: 1.5; border-top: 1px solid var(--border); padding-top: 10px; }
.raw-text { font-family: ui-monospace, monospace; font-size: .78rem; white-space: pre-wrap; word-break: break-word; line-height: 1.6; background: var(--bg); padding: 12px; border-radius: 8px; }

/* List rows (water log etc) */
.list { display: flex; flex-direction: column; gap: 4px; }
.list-row { display: flex; align-items: center; gap: 12px; padding: 9px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; }
.list-main { flex: 1; font-size: .87rem; }
.x { background: transparent; border: none; color: var(--muted); cursor: pointer; font-size: 1.3rem; line-height: 1; padding: 4px 6px; border-radius: 4px; transition: color .15s; }
.x:hover { color: var(--bad); background: rgba(244,126,110,0.08); }

/* Inline form */
.inline-form { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
.inline-form input { flex: 1; }

/* Trends */
.trend-stats { display: flex; gap: 18px; margin-bottom: 10px; }
.ts { display: flex; flex-direction: column; gap: 2px; }
.ts-l { font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
.ts-v { font-size: .98rem; font-weight: 600; color: var(--text); }
.ts-v.good { color: var(--good); }
.ts-v.warn { color: var(--warn); }
.ts-v.neutral { color: var(--text-2); }
.ts-v.muted { color: var(--muted); }
.chart { width: 100%; height: 70px; display: block; }
.muted-center { color: var(--muted); font-size: .82rem; text-align: center; padding: 18px; font-style: italic; }

.bars-row { display: grid; grid-auto-columns: 1fr; grid-auto-flow: column; gap: 3px; height: 56px; align-items: end; }
.bar-col { height: 100%; display: flex; align-items: flex-end; }
.bar-fill { width: 100%; min-height: 3px; background: var(--accent); border-radius: 2px; transition: height .6s ease; }

/* Week mini */
.week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; align-items: end; }
.week-col { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.week-bar-wrap { width: 100%; height: 64px; background: var(--surface-2); border-radius: 4px; display: flex; align-items: flex-end; overflow: hidden; }
.week-bar { width: 100%; border-radius: 3px; min-height: 3px; transition: height .6s; transform-origin: bottom; animation: growUp .6s var(--ease-out) both; }
@keyframes growUp { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.week-day { font-size: .68rem; color: var(--muted); font-weight: 500; }
.week-val { font-size: .64rem; color: var(--text-2); }

.center-stack { display: flex; justify-content: center; padding: 8px 0 16px; }

/* Markdown */
.md > *:first-child { margin-top: 0; }
.md > *:last-child { margin-bottom: 0; }
.md-p { line-height: 1.55; margin: 6px 0 0; font-size: .87rem; }
.md-h1 { font-family: 'DM Serif Display', serif; font-size: 1rem; color: var(--text); margin: 12px 0 4px; font-weight: 400; }
.md-h2 { font-family: 'DM Serif Display', serif; font-size: .9rem; color: var(--text); margin: 10px 0 4px; font-weight: 400; }
.md-ul, .md-ol { margin: 6px 0; padding-left: 18px; font-size: .87rem; }
.md-ul li, .md-ol li { margin: 3px 0; line-height: 1.5; }
.md-ul { list-style: none; padding-left: 0; }
.md-ul li { position: relative; padding-left: 14px; }
.md-ul li::before { content: "→"; position: absolute; left: 0; color: var(--accent); }
.md-code { background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-size: .82em; font-family: ui-monospace, monospace; }

/* Coach */
.coach-wrap { display: flex; flex-direction: column; min-height: calc(100dvh - 200px); }
.coach-bar { display: flex; justify-content: space-between; align-items: center; padding: 0 4px 14px; }
.coach-bar-l { display: flex; flex-direction: column; }
.coach-bar-title { font-size: .92rem; font-weight: 600; }
.coach-bar-r { display: flex; gap: 4px; }
.msgs { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 12px; min-height: 200px; }
.msg { display: flex; gap: 8px; align-items: flex-start; animation: msgIn .4s var(--ease-out) both; }
.msg.assistant { animation-name: msgInLeft; }
.msg.user { flex-direction: row-reverse; animation-name: msgInRight; }
@keyframes msgInLeft { from { opacity: 0; transform: translate(-12px, 6px); } to { opacity: 1; transform: none; } }
@keyframes msgInRight { from { opacity: 0; transform: translate(12px, 6px); } to { opacity: 1; transform: none; } }
.avatar { width: 26px; height: 26px; border-radius: 8px; background: var(--accent-dim); border: 1px solid rgba(110,231,247,0.25); display: flex; align-items: center; justify-content: center; font-size: .72rem; color: var(--accent); flex-shrink: 0; margin-top: 2px; }
.bubble { max-width: 82%; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 10px 14px; }
.msg.user .bubble { background: var(--accent-dim); border-color: rgba(110,231,247,0.2); border-radius: 14px 14px 4px 14px; }
.msg.assistant .bubble { border-radius: 4px 14px 14px 14px; }
.bubble.typing { display: flex; gap: 4px; padding: 14px; }
.bubble.typing span { width: 6px; height: 6px; background: var(--muted); border-radius: 50%; animation: bounce .9s infinite; }
.bubble.typing span:nth-child(2) { animation-delay: .15s; }
.bubble.typing span:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }

.suggs { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 2px 12px; }
.sugg { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 6px 12px; color: var(--text-2); font-family: inherit; font-size: .78rem; cursor: pointer; transition: color .2s, border-color .2s, transform .14s var(--spring); -webkit-tap-highlight-color: transparent; }
.sugg:hover { color: var(--accent); border-color: rgba(110,231,247,0.3); transform: translateY(-2px); }
.sugg:active { transform: scale(.95); }

.composer { display: flex; gap: 8px; padding: 12px 2px 8px; position: sticky; bottom: calc(80px + env(safe-area-inset-bottom)); background: var(--bg); margin-top: auto; }
.composer::before { content: ""; position: absolute; left: 0; right: 0; top: -16px; height: 16px; background: linear-gradient(transparent, var(--bg)); pointer-events: none; }
.composer input { flex: 1; }
.send { width: 38px; height: 38px; min-width: 38px; border-radius: 10px; background: var(--accent); color: #0a1418; border: none; font-size: 1.1rem; font-weight: 700; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: transform .14s var(--spring), box-shadow .2s; -webkit-tap-highlight-color: transparent; }
.send:hover:not(:disabled) { box-shadow: 0 4px 14px var(--accent-glow); transform: translateY(-1px); }
.send:active:not(:disabled) { transform: scale(.88); }
.send:disabled { opacity: 0.35; cursor: not-allowed; }

/* Analysis */
.analysis-stack { animation: fade .2s ease; }
.score-row { display: flex; align-items: center; gap: 16px; }
.score-ring { position: relative; width: 80px; height: 80px; flex-shrink: 0; animation: ringDraw .7s var(--ease-out) both; }
.score-ring svg { width: 80px; height: 80px; }
.score-ring svg circle:last-child { filter: drop-shadow(0 0 4px var(--accent-glow)); }
.score-n { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: 'DM Serif Display', serif; font-size: 1.5rem; }
.score-n span { font-family: 'Inter', sans-serif; font-size: .62rem; color: var(--muted); margin-left: 2px; }

.priority-card { background: var(--accent-dim); border-color: rgba(110,231,247,0.2); animation: priorityGlow 3.5s ease-in-out infinite; }
@keyframes priorityGlow { 0%, 100% { box-shadow: var(--shadow-card); } 50% { box-shadow: var(--shadow-card), 0 0 24px var(--accent-dim); } }
.priority-label { font-size: .68rem; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
.priority-text { font-size: .92rem; line-height: 1.55; color: var(--text); font-weight: 500; }

.ana-hd { display: flex; justify-content: space-between; align-items: center; }
.ana-score { display: flex; align-items: center; gap: 7px; font-size: .85rem; font-weight: 600; }
.ana-dot { width: 7px; height: 7px; border-radius: 50%; }
.ana-tips { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 7px; }
.ana-tips li { display: flex; gap: 9px; font-size: .85rem; color: var(--text); line-height: 1.5; animation: slideRight .45s var(--ease-out) both; }
.ana-tips li:nth-child(2) { animation-delay: .08s; }
.ana-tips li:nth-child(3) { animation-delay: .16s; }
.ana-arrow { color: var(--accent); font-weight: 700; flex-shrink: 0; }

/* Settings macros bar */
.macro-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; gap: 2px; background: var(--surface-2); margin: 10px 0 8px; }
.macro-seg { height: 100%; transition: width .4s; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: .73rem; color: var(--text-2); }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; }
.divider { height: 1px; background: var(--border); margin: 16px 0; }

/* Export grid */
.exp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
.exp-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 14px 8px; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; transition: border-color .2s, transform .15s var(--spring), box-shadow .2s; color: var(--text); font-family: inherit; -webkit-tap-highlight-color: transparent; }
.exp-card:hover:not(:disabled) { border-color: var(--accent); transform: translateY(-3px); box-shadow: var(--shadow-card); }
.exp-card:active:not(:disabled) { transform: translateY(0) scale(.96); }
.exp-card:disabled { opacity: 0.4; cursor: not-allowed; }
.exp-icon { font-size: 1.4rem; color: var(--accent); margin-bottom: 2px; transition: transform .3s var(--spring); }
.exp-card:hover:not(:disabled) .exp-icon { transform: scale(1.2); }
.exp-name { font-size: .82rem; font-weight: 500; }
.exp-n { font-size: .65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }

/* Stats */
.stat-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stat { text-align: center; padding: 14px 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; }
.stat-n { font-family: 'DM Serif Display', serif; font-size: 1.6rem; color: var(--accent); line-height: 1; margin-bottom: 4px; }
.stat-l { font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }

.danger-card { border-color: rgba(244,126,110,0.2); }
.muted-tag { font-size: .72rem; color: var(--good); }

/* Helpers */
.muted { color: var(--muted); }
.small { font-size: .76rem; }
.center { text-align: center; }

/* Tab icons */
.tabbtn-icon { line-height: 0; }
.tabbtn svg { display: block; }

/* Rings zero-state */
.rings-zero { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); font-size: .82rem; color: var(--muted); text-align: center; line-height: 1.5; }

/* Recent-after (under log forms) */
.recent-after { margin-top: 4px; }
.recent-after-label { font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; padding: 0 4px 6px; }
.recent-after-list { display: flex; flex-direction: column; gap: 4px; }
.recent-after-item { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; font-size: .82rem; }
.ra-main { color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ra-date { color: var(--muted); font-size: .72rem; white-space: nowrap; flex-shrink: 0; }

/* Toast */
.toast-host { position: fixed; left: 0; right: 0; bottom: calc(96px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 200; pointer-events: none; padding: 0 18px; }
.toast { background: var(--surface-2); border: 1px solid var(--border-strong); color: var(--text); border-radius: 12px; padding: 10px 18px; font-size: .85rem; font-weight: 500; box-shadow: 0 8px 24px rgba(0,0,0,0.4); animation: toastIn .25s cubic-bezier(.2,.8,.2,1); max-width: 100%; }
@keyframes toastIn { from { opacity: 0; transform: translateY(12px) scale(.96); } to { opacity: 1; transform: none; } }

/* Modal */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 24px; z-index: 300; animation: fade .15s ease; }
.modal { background: var(--surface); border: 1px solid var(--border-strong); border-radius: 16px; padding: 22px; max-width: 360px; width: 100%; animation: modalIn .2s cubic-bezier(.2,.8,.2,1); }
@keyframes modalIn { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: none; } }
.modal-title { font-family: 'DM Serif Display', serif; font-size: 1.2rem; font-weight: 400; margin-bottom: 8px; }
.modal-body { color: var(--text-2); font-size: .88rem; line-height: 1.55; margin-bottom: 18px; }
.modal-actions { display: flex; gap: 8px; }

/* Boot spinner */
.boot { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; color: var(--accent); }

/* Auth screen */
.auth { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.auth-box { width: 100%; max-width: 360px; animation: authIn .6s var(--ease-out) both; }
@keyframes authIn { from { opacity: 0; transform: translateY(16px) scale(.98); } to { opacity: 1; transform: none; } }
.auth-brand { font-family: 'DM Serif Display', serif; font-size: 2.4rem; color: var(--text); text-align: center; font-weight: 400; }
.auth-sub { text-align: center; color: var(--muted); margin: 4px 0 24px; font-size: .9rem; }
.auth-box label { margin-bottom: 12px; }
.auth-switch { text-align: center; margin-top: 16px; font-size: .85rem; color: var(--muted); }
.auth-switch .link-btn { font-size: .85rem; margin-left: 4px; }

/* Sync badge */
.sync-badge { display: inline-flex; align-items: center; gap: 6px; font-size: .72rem; color: var(--muted); margin-left: 12px; }
.topbar { display: flex; align-items: center; }

/* Account */
.account-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.account-email { font-size: .9rem; font-weight: 500; color: var(--text); margin-bottom: 3px; }

/* ─── Coach images ─── */
.bubble-img { display: block; max-width: 220px; width: 100%; border-radius: 10px; margin-bottom: 8px; }
.bubble-img-gone { font-size: .8rem; color: var(--muted); background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; margin-bottom: 8px; display: inline-block; }
.composer-wrap { position: sticky; bottom: calc(80px + env(safe-area-inset-bottom)); background: var(--bg); padding-top: 10px; margin-top: auto; }
.composer-wrap::before { content: ""; position: absolute; left: 0; right: 0; top: -16px; height: 16px; background: linear-gradient(transparent, var(--bg)); pointer-events: none; }
.attach-preview { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 8px; margin-bottom: 8px; position: relative; animation: riseIn .3s var(--ease-out) both; }
.attach-preview img { width: 48px; height: 48px; object-fit: cover; border-radius: 8px; }
.attach-label { font-size: .82rem; color: var(--text-2); }
.attach-x { margin-left: auto; background: var(--surface-2); border: none; color: var(--text); width: 26px; height: 26px; border-radius: 50%; cursor: pointer; font-size: 1rem; line-height: 1; flex-shrink: 0; }
.attach-btn { width: 38px; height: 38px; min-width: 38px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); cursor: pointer; font-size: 1.05rem; flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: transform .12s ease, background .15s; -webkit-tap-highlight-color: transparent; }
.attach-btn:active { transform: scale(.9); }
.attach-btn:disabled { opacity: .4; }

/* ─── Diet photo choices ─── */
.photo-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.photo-choice { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 22px 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: pointer; color: var(--text); font-family: inherit; font-size: .85rem; font-weight: 500; transition: transform .12s ease, border-color .15s, background .15s; -webkit-tap-highlight-color: transparent; }
.photo-choice:hover { border-color: var(--accent); background: var(--accent-dim); }
.photo-choice:active { transform: scale(.96); }
.photo-choice-icon { font-size: 1.8rem; }
.upload.has-img { position: relative; padding: 0; min-height: 0; }
.upload-replace { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.6); color: #fff; font-size: .72rem; padding: 4px 10px; border-radius: 12px; backdrop-filter: blur(4px); }

/* ─── Streak chip ─── */
.greeting-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.streak-chip { font-size: .78rem; font-weight: 600; color: var(--warn); background: rgba(249,201,126,0.12); border: 1px solid rgba(249,201,126,0.25); padding: 3px 10px; border-radius: 14px; animation: streakPop .5s var(--spring) both; }
@keyframes streakPop { 0% { opacity: 0; transform: scale(.6); } 60% { transform: scale(1.12); } 100% { opacity: 1; transform: scale(1); } }

/* ─── Day progress bar ─── */
.day-progress { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }
.day-progress-bar { height: 6px; background: var(--track); border-radius: 3px; overflow: hidden; }
.day-progress-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--accent), #8fd989); transition: width 1s var(--ease-out); box-shadow: 0 0 10px var(--accent-glow); }
.day-progress-label { display: block; text-align: center; font-size: .78rem; color: var(--text-2); margin-top: 8px; }

/* ─── Mobile friendliness ─── */
@media (max-width: 520px) {
  .app { padding: 0 14px 96px; padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
  .greeting-h { font-size: 1.6rem; }
  .rings-row { gap: 2px; }
  .ring-val.big { font-size: 1.15rem; }
  .ring svg { width: 104px; height: 104px; }
  .quick-actions { grid-template-columns: 1fr 1fr; }
  .ring-targets { font-size: .66rem; flex-wrap: wrap; gap: 4px; }
  .card { padding: 16px; }
  .field-grid, .field-grid.three { grid-template-columns: 1fr 1fr; }
  .macros { grid-template-columns: repeat(2, 1fr); }
  .bubble { max-width: 88%; }
  .subtab { font-size: .76rem; padding: 8px 8px; min-width: 54px; }
  .tabbtn-label { font-size: .62rem; }
}
@media (max-width: 360px) {
  .field-grid, .field-grid.three { grid-template-columns: 1fr; }
  .quick-actions { grid-template-columns: 1fr; }
}
/* Larger tap targets + no tap highlight on interactive things */
button, .qa, .subtab, .seg-btn, .exp-card, .photo-choice, .tabbtn { -webkit-tap-highlight-color: transparent; }
input, select, textarea { font-size: 16px; } /* prevents iOS zoom-on-focus */
@media (min-width: 521px) { input, select, textarea { font-size: .92rem; } }
`;
