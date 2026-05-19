import { useState, useEffect, useRef } from "react";

const TABS = ["Dashboard", "Sleep", "Diet", "Exercise", "Sports"];
const STORAGE_KEY = "fitlog_v5";
const defaultData = { sleep: [], diet: [], exercise: [], sports: [] };
const defaultGoals = { calories: 2500, protein: 180, carbs: 250, fat: 80, goal: "Build Muscle" };
const fitnessGoals = ["Build Muscle", "Lose Fat", "Improve Endurance", "Maintain Weight", "Athletic Performance"];
const mealTypes = ["Breakfast", "Lunch", "Dinner", "Snack"];
const sportsOptions = ["Football","Basketball","Tennis","Swimming","Running","Cycling","Yoga","Boxing","Soccer","Volleyball","Badminton","Table Tennis","Golf","Martial Arts","Other"];
const sleepQuality = ["Poor", "Fair", "Good", "Great", "Excellent"];
const intensityLevels = ["Light", "Moderate", "Intense", "All-out"];
const icons = { Dashboard: "◈", Sleep: "◐", Diet: "◉", Exercise: "◆", Sports: "◇" };

function loadData() {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : defaultData; } catch { return defaultData; }
}
function loadGoals() {
  try { const r = localStorage.getItem(STORAGE_KEY + "_goals"); return r ? JSON.parse(r) : defaultGoals; } catch { return defaultGoals; }
}
function saveData(d) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }
function saveGoals(g) { localStorage.setItem(STORAGE_KEY + "_goals", JSON.stringify(g)); }
function getTodayStr() { return new Date().toISOString().split("T")[0]; }
function formatDate(ds) { return new Date(ds + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }

// ─── CLAUDE API ───────────────────────────────────────────────────────────────
async function callClaude({ system, userText, imageBase64, imageMediaType, maxTokens = 1000 }) {
  const userContent = imageBase64
    ? [{ type: "image", source: { type: "base64", media_type: imageMediaType, data: imageBase64 } }, { type: "text", text: userText }]
    : userText;
  const resp = await fetch("/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages: [{ role: "user", content: userContent }] })
  });
  const data = await resp.json();
  return data.content?.map(b => b.text || "").join("") || "";
}

async function estimateSportsCalories(sport, duration, intensity, weight) {
  try {
    const raw = await callClaude({ system: "Sports science expert. Valid JSON only, no markdown.", userText: `Estimate calories: sport="${sport}", ${duration} min, intensity="${intensity}", ${weight}kg. JSON: {"calories":<number>,"note":"<1 sentence>"}` });
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch { return { calories: 0, note: "Could not estimate." }; }
}

async function analyzeFoodAI(description, imageBase64, imageMediaType) {
  try {
    const raw = await callClaude({ system: `Nutritionist. Return ONLY JSON: {"food":"<name>","calories":<n>,"protein":<n>,"carbs":<n>,"fat":<n>,"notes":"<brief>"}. No markdown.`, userText: description ? `Analyze nutrition: "${description}"` : "Analyze the food in this image.", imageBase64, imageMediaType });
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch { return null; }
}

async function analyzeAllData(data, goals) {
  const cut = new Date(); cut.setDate(cut.getDate() - 14);
  const last14 = arr => arr.filter(i => new Date(i.date + "T00:00:00") >= cut);
  const sleepLines = last14(data.sleep).map(s => `${s.date}: ${s.duration}h (${s.quality})`).join("\n") || "No data";
  const dietLines = last14(data.diet).map(d => `${d.date} ${d.meal}: ${d.food} — ${d.calories}kcal P:${d.protein}g C:${d.carbs}g F:${d.fat}g`).join("\n") || "No data";
  const exLines = last14(data.exercise).map(e => `${e.date}: ${e.label}\n${(e.text||"").slice(0,200)}`).join("\n\n") || "No data";
  const spLines = last14(data.sports).map(s => `${s.date}: ${s.sport} ${s.duration}min ${s.intensity} — ${s.calories}kcal`).join("\n") || "No data";

  const system = `You are an elite personal trainer and sports nutritionist. Analyze real fitness data and give highly specific, actionable advice to maximize ${goals.goal}. Reference actual numbers from the data. Return ONLY valid JSON, no markdown:
{
  "overallScore": <1-10>,
  "summary": "<2-3 sentence assessment>",
  "sections": [
    {"category":"Sleep & Recovery","score":<1-10>,"status":"good|warning|critical","insight":"<specific observation with their numbers>","tips":["<actionable tip>","<tip>","<tip>"]},
    {"category":"Nutrition","score":<1-10>,"status":"good|warning|critical","insight":"<specific>","tips":["<tip>","<tip>","<tip>"]},
    {"category":"Training","score":<1-10>,"status":"good|warning|critical","insight":"<specific>","tips":["<tip>","<tip>","<tip>"]},
    {"category":"Calorie Balance","score":<1-10>,"status":"good|warning|critical","insight":"<specific>","tips":["<tip>","<tip>","<tip>"]}
  ],
  "priorityAction": "<The single most impactful thing to do this week>"
}`;

  const raw = await callClaude({ system, maxTokens: 2000, userText: `Goal: ${goals.goal}\nCalorie target: ${goals.calories}kcal\nMacros: P${goals.protein}g C${goals.carbs}g F${goals.fat}g\n\nSLEEP:\n${sleepLines}\n\nDIET:\n${dietLines}\n\nEXERCISE:\n${exLines}\n\nSPORTS:\n${spLines}` });
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

// ─── SLEEP FORM ───────────────────────────────────────────────────────────────
function SleepForm({ onAdd }) {
  const [form, setForm] = useState({ date: getTodayStr(), bedtime: "22:30", wakeTime: "06:30", quality: "Good", notes: "" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  function calcDur(bed, wake) {
    const [bh, bm] = bed.split(":").map(Number), [wh, wm] = wake.split(":").map(Number);
    let m = (wh * 60 + wm) - (bh * 60 + bm); if (m < 0) m += 1440; return (m / 60).toFixed(1);
  }
  const dur = calcDur(form.bedtime, form.wakeTime);
  return (
    <div className="form-card">
      <h3 className="form-title">Log Sleep</h3>
      <div className="form-grid">
        <label>Date<input type="date" value={form.date} onChange={e => set("date", e.target.value)} /></label>
        <label>Bedtime<input type="time" value={form.bedtime} onChange={e => set("bedtime", e.target.value)} /></label>
        <label>Wake Time<input type="time" value={form.wakeTime} onChange={e => set("wakeTime", e.target.value)} /></label>
        <label>Quality<select value={form.quality} onChange={e => set("quality", e.target.value)}>{sleepQuality.map(q => <option key={q}>{q}</option>)}</select></label>
      </div>
      <div className="duration-badge">Duration: <strong>{dur}h</strong></div>
      <label>Notes<textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="How did you sleep?" /></label>
      <button className="btn-primary" style={{ marginTop: 14 }} onClick={() => onAdd({ ...form, duration: parseFloat(dur), id: Date.now() })}>Add Sleep Log</button>
    </div>
  );
}

// ─── DIET FORM ────────────────────────────────────────────────────────────────
function DietForm({ onAdd }) {
  const [date, setDate] = useState(getTodayStr());
  const [meal, setMeal] = useState("Breakfast");
  const [inputText, setInputText] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("text");
  const fileRef = useRef();

  async function handleAnalyze() {
    if (mode === "text" && !inputText.trim()) return;
    if (mode === "image" && !imageFile) return;
    setAnalyzing(true); setError(""); setResult(null);
    try {
      let b64 = null, mt = null;
      if (mode === "image" && imageFile) {
        b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(imageFile); });
        mt = imageFile.type;
      }
      const r = await analyzeFoodAI(mode === "text" ? inputText : "", b64, mt);
      if (r) setResult(r); else setError("Could not analyze. Try rephrasing or a clearer photo.");
    } catch { setError("Analysis failed."); } finally { setAnalyzing(false); }
  }

  return (
    <div className="form-card">
      <h3 className="form-title">Log Meal <span className="ai-badge">✦ AI</span></h3>
      <div className="form-grid" style={{ marginBottom: 16 }}>
        <label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Meal Type<select value={meal} onChange={e => setMeal(e.target.value)}>{mealTypes.map(m => <option key={m}>{m}</option>)}</select></label>
      </div>
      <div className="mode-toggle">
        <button className={`mode-btn ${mode === "text" ? "active" : ""}`} onClick={() => { setMode("text"); setResult(null); setError(""); }}>✎ Describe</button>
        <button className={`mode-btn ${mode === "image" ? "active" : ""}`} onClick={() => { setMode("image"); setResult(null); setError(""); }}>⊞ Photo</button>
      </div>
      {mode === "text" && !result && <label style={{ marginBottom: 14 }}>What did you eat?<textarea value={inputText} onChange={e => setInputText(e.target.value)} placeholder='"Two eggs, toast, orange juice"' style={{ minHeight: 80 }} /></label>}
      {mode === "image" && !result && (
        <div className="image-upload-area" onClick={() => fileRef.current.click()}>
          {imagePreview ? <img src={imagePreview} alt="Food" className="food-preview" /> : <div className="upload-prompt"><span className="upload-icon">⊞</span><span>Tap to upload a photo</span></div>}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (!f) return; setImageFile(f); setResult(null); setError(""); const r = new FileReader(); r.onload = ev => setImagePreview(ev.target.result); r.readAsDataURL(f); }} />
        </div>
      )}
      {!result && <button className="btn-ai" onClick={handleAnalyze} disabled={analyzing || (mode === "text" ? !inputText.trim() : !imageFile)}>{analyzing ? <span className="loading-text"><span className="spinner-dot" />Analyzing…</span> : "✦ Analyze Nutrition with AI"}</button>}
      {error && <div className="error-msg">{error}</div>}
      {result && (
        <div className="ai-result">
          <div className="ai-result-title">✦ AI Analysis</div>
          <div className="ai-food-name">{result.food}</div>
          <div className="macro-grid">
            <div className="macro-chip cal"><span className="macro-val">{result.calories}</span><span className="macro-lbl">kcal</span></div>
            <div className="macro-chip"><span className="macro-val">{result.protein}g</span><span className="macro-lbl">protein</span></div>
            <div className="macro-chip"><span className="macro-val">{result.carbs}g</span><span className="macro-lbl">carbs</span></div>
            <div className="macro-chip"><span className="macro-val">{result.fat}g</span><span className="macro-lbl">fat</span></div>
          </div>
          {result.notes && <div className="ai-note">"{result.notes}"</div>}
          <div className="result-actions">
            <button className="btn-primary" onClick={() => { onAdd({ date, meal, food: result.food, calories: result.calories, protein: result.protein, carbs: result.carbs, fat: result.fat, notes: result.notes || "", id: Date.now() }); setResult(null); setInputText(""); setImageFile(null); setImagePreview(null); }}>+ Add to Log</button>
            <button className="btn-secondary" onClick={() => { setResult(null); setError(""); }}>Re-analyze</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── EXERCISE TAB ─────────────────────────────────────────────────────────────
function ExerciseTab({ entries, onAdd, onDelete }) {
  const [text, setText] = useState(""); const [date, setDate] = useState(getTodayStr()); const [label, setLabel] = useState(""); const [expanded, setExpanded] = useState(null);
  return (
    <div>
      <div className="form-card">
        <h3 className="form-title">Paste from Strong</h3>
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>Label (optional)<input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Push Day A" /></label>
        </div>
        <label style={{ marginBottom: 14 }}>Workout<textarea value={text} onChange={e => setText(e.target.value)} placeholder={"Push Day A\nOctober 14, 2024 · 1h 12m\n\nBench Press (Barbell)\nSet 1: 60 kg × 10\nSet 2: 80 kg × 8"} style={{ minHeight: 220, fontFamily: "monospace", fontSize: "0.8rem", lineHeight: 1.7 }} /></label>
        <button className="btn-primary" onClick={() => { if (!text.trim()) return; onAdd({ id: Date.now(), date, label: label.trim() || "Workout", text: text.trim() }); setText(""); setLabel(""); }} disabled={!text.trim()}>Save Workout</button>
      </div>
      <div className="list-header"><h3 className="section-title" style={{ margin: 0 }}>Workout Log</h3><span className="entry-count">{entries.length} entries</span></div>
      {entries.length === 0 && <div className="empty-msg">No workouts saved yet.</div>}
      <div className="log-list">
        {entries.map(w => (
          <div key={w.id} className={`log-item ${expanded === w.id ? "open" : ""}`}>
            <div className="log-header" onClick={() => setExpanded(expanded === w.id ? null : w.id)}>
              <div className="log-title">{w.label}</div>
              <div className="log-meta"><span className="log-tag">{formatDate(w.date)}</span><span className="log-tag">{w.text.split("\n").filter(Boolean).length} lines</span><span className="log-toggle">{expanded === w.id ? "▲" : "▼"}</span></div>
            </div>
            {expanded === w.id && <div className="log-detail"><pre className="workout-raw">{w.text}</pre><button className="btn-delete" onClick={() => onDelete(w.id)}>Delete</button></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SPORTS FORM ─────────────────────────────────────────────────────────────
function SportsForm({ onAdd }) {
  const [form, setForm] = useState({ date: getTodayStr(), sport: "Basketball", duration: "60", intensity: "Moderate", result: "", opponent: "", score: "", notes: "" });
  const [estimating, setEstimating] = useState(false); const [estimate, setEstimate] = useState(null); const [weight, setWeight] = useState("75");
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setEstimate(null); };
  return (
    <div className="form-card">
      <h3 className="form-title">Log Sport <span className="ai-badge">✦ AI</span></h3>
      <div className="form-grid">
        <label>Date<input type="date" value={form.date} onChange={e => set("date", e.target.value)} /></label>
        <label>Sport<select value={form.sport} onChange={e => set("sport", e.target.value)}>{sportsOptions.map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Duration (min)<input type="number" value={form.duration} onChange={e => set("duration", e.target.value)} placeholder="60" /></label>
        <label>Intensity<select value={form.intensity} onChange={e => set("intensity", e.target.value)}>{intensityLevels.map(l => <option key={l}>{l}</option>)}</select></label>
        <label>Your Weight (kg)<input type="number" value={weight} onChange={e => { setWeight(e.target.value); setEstimate(null); }} placeholder="75" /></label>
        <label>Result<select value={form.result} onChange={e => set("result", e.target.value)}><option value="">—</option><option>Win</option><option>Loss</option><option>Draw</option><option>Practice</option></select></label>
        <label>Opponent<input type="text" value={form.opponent} onChange={e => set("opponent", e.target.value)} placeholder="Team / Player" /></label>
        <label>Score<input type="text" value={form.score} onChange={e => set("score", e.target.value)} placeholder="21 – 18" /></label>
      </div>
      <label>Notes<textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="How did it go?" /></label>
      {!estimate && <button className="btn-ai" style={{ marginTop: 14 }} onClick={async () => { if (!form.duration) return; setEstimating(true); const r = await estimateSportsCalories(form.sport, Number(form.duration), form.intensity, Number(weight) || 75); setEstimate(r); setEstimating(false); }} disabled={estimating || !form.duration}>{estimating ? <span className="loading-text"><span className="spinner-dot" />Calculating…</span> : "✦ Estimate Calories with AI"}</button>}
      {estimate && (
        <div className="calorie-estimate">
          <div className="calorie-est-header">✦ AI Estimate</div>
          <div className="calorie-est-value">{estimate.calories} <span>kcal burned</span></div>
          <div className="calorie-est-note">{estimate.note}</div>
          <div className="result-actions">
            <button className="btn-primary" onClick={() => { onAdd({ ...form, id: Date.now(), duration: Number(form.duration) || 0, calories: estimate.calories }); setForm(f => ({ ...f, opponent: "", score: "", result: "", notes: "" })); setEstimate(null); }}>+ Add to Log</button>
            <button className="btn-secondary" onClick={() => setEstimate(null)}>Re-estimate</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LOG ITEM ─────────────────────────────────────────────────────────────────
function LogItem({ item, type, onDelete }) {
  const [open, setOpen] = useState(false);
  let title = "", meta = [], detail = [];
  if (type === "sleep") { title = `Sleep — ${formatDate(item.date)}`; meta = [`${item.duration}h`, item.quality]; detail = [`Bedtime: ${item.bedtime}`, `Wake: ${item.wakeTime}`, item.notes && `Notes: ${item.notes}`].filter(Boolean); }
  else if (type === "diet") { title = `${item.meal} — ${formatDate(item.date)}`; meta = [item.food.slice(0, 28) + (item.food.length > 28 ? "…" : ""), `${item.calories} kcal`]; detail = [`Protein: ${item.protein}g`, `Carbs: ${item.carbs}g`, `Fat: ${item.fat}g`, item.notes && `Notes: ${item.notes}`].filter(Boolean); }
  else if (type === "sports") { title = `${item.sport} — ${formatDate(item.date)}`; meta = [item.result || "Practice", `${item.duration}min`, `${item.calories} kcal`]; detail = [item.intensity && `Intensity: ${item.intensity}`, item.opponent && `vs ${item.opponent}`, item.score && `Score: ${item.score}`, item.notes && `Notes: ${item.notes}`].filter(Boolean); }
  return (
    <div className={`log-item ${open ? "open" : ""}`}>
      <div className="log-header" onClick={() => setOpen(o => !o)}>
        <div className="log-title">{title}</div>
        <div className="log-meta">{meta.map((m, i) => <span key={i} className="log-tag">{m}</span>)}<span className="log-toggle">{open ? "▲" : "▼"}</span></div>
      </div>
      {open && <div className="log-detail">{detail.map((d, i) => <div key={i} className="log-detail-row">{d}</div>)}<button className="btn-delete" onClick={() => onDelete(item.id)}>Delete</button></div>}
    </div>
  );
}

// ─── STAT CARD ────────────────────────────────────────────────────────────────
function StatCard({ label, value, unit, color, sub }) {
  return (
    <div className="stat-card" style={{ "--accent": color }}>
      <div className="stat-value">{value}<span className="stat-unit">{unit}</span></div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ─── SETTINGS SECTION ─────────────────────────────────────────────────────────
function SettingsSection({ data, goals, onSaveGoals, onClearAll, onImport }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("goals"); // goals | export | data

  // ─── Goals state ──
  const [form, setForm] = useState(goals);
  const [saved, setSaved] = useState(false);
  const setG = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => { setForm(goals); }, [goals]);

  function autoCalc(calories, goal) {
    if (goal === "Build Muscle") return { protein: Math.round(calories * .30 / 4), carbs: Math.round(calories * .45 / 4), fat: Math.round(calories * .25 / 9) };
    if (goal === "Lose Fat") return { protein: Math.round(calories * .35 / 4), carbs: Math.round(calories * .35 / 4), fat: Math.round(calories * .30 / 9) };
    if (goal === "Improve Endurance") return { protein: Math.round(calories * .20 / 4), carbs: Math.round(calories * .55 / 4), fat: Math.round(calories * .25 / 9) };
    if (goal === "Athletic Performance") return { protein: Math.round(calories * .25 / 4), carbs: Math.round(calories * .50 / 4), fat: Math.round(calories * .25 / 9) };
    return { protein: Math.round(calories * .25 / 4), carbs: Math.round(calories * .45 / 4), fat: Math.round(calories * .30 / 9) };
  }
  const total = form.protein * 4 + form.carbs * 4 + form.fat * 9;
  const pPct = Math.round((form.protein * 4 / total) * 100);
  const cPct = Math.round((form.carbs * 4 / total) * 100);
  const fPct = Math.round((form.fat * 9 / total) * 100);

  // ─── Export helpers ──
  function escapeCSV(v) {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function arrayToCSV(rows, headers) {
    return [headers.join(","), ...rows.map(r => headers.map(h => escapeCSV(r[h])).join(","))].join("\n");
  }
  function download(filename, content, mime = "text/csv") {
    const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  const exportSleep = () => download(`fitlog-sleep-${getTodayStr()}.csv`, arrayToCSV(data.sleep, ["date","duration_hours","bedtime","wakeTime","quality","notes"]));
  const exportDiet = () => download(`fitlog-diet-${getTodayStr()}.csv`, arrayToCSV(data.diet, ["date","meal","food","calories","protein","carbs","fat","notes"]));
  const exportExercise = () => download(`fitlog-workouts-${getTodayStr()}.csv`, arrayToCSV(data.exercise, ["date","label","text"]));
  const exportSports = () => download(`fitlog-sports-${getTodayStr()}.csv`, arrayToCSV(data.sports, ["date","sport","duration","intensity","calories","result","opponent","score","notes"]));
  const exportChat = () => {
    try {
      const msgs = JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]");
      const rows = msgs.map(m => ({ timestamp: m.ts ? new Date(m.ts).toISOString() : "", role: m.role, text: m.text }));
      download(`fitlog-chat-${getTodayStr()}.csv`, arrayToCSV(rows, ["timestamp","role","text"]));
    } catch { alert("Could not export chat."); }
  };
  const exportAll = () => {
    if (data.sleep.length) exportSleep();
    setTimeout(() => data.diet.length && exportDiet(), 200);
    setTimeout(() => data.exercise.length && exportExercise(), 400);
    setTimeout(() => data.sports.length && exportSports(), 600);
    setTimeout(() => exportChat(), 800);
  };
  const exportJSON = () => {
    const all = { exportedAt: new Date().toISOString(), goals, data, chat: JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]") };
    download(`fitlog-backup-${getTodayStr()}.json`, JSON.stringify(all, null, 2), "application/json");
  };

  // ─── Import / Clear ──
  const fileRef = useRef();
  function handleImportFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.data || !parsed.goals) throw new Error("Invalid backup");
        if (!confirm("This will REPLACE all your current data with the backup. Continue?")) return;
        onImport(parsed);
        alert("Backup restored successfully!");
      } catch { alert("Couldn't read that file. Make sure it's a fitlog JSON backup."); }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset so same file can be re-uploaded
  }

  const counts = { sleep: data.sleep.length, diet: data.diet.length, exercise: data.exercise.length, sports: data.sports.length };
  let chatCount = 0;
  try { chatCount = JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]").length; } catch {}
  const totalEntries = counts.sleep + counts.diet + counts.exercise + counts.sports;

  return (
    <div className="dash-section">
      <button className="dash-section-toggle" onClick={() => setOpen(o => !o)}>
        <span className="dash-section-label">⚙ Settings</span>
        <span className="dash-section-meta">{goals.goal} · {goals.calories} kcal</span>
        <span className="dash-chevron">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <div className="settings-tabs">
            <button className={`settings-tab ${tab === "goals" ? "active" : ""}`} onClick={() => setTab("goals")}>⊙ Goals</button>
            <button className={`settings-tab ${tab === "export" ? "active" : ""}`} onClick={() => setTab("export")}>⬇ Export</button>
            <button className={`settings-tab ${tab === "data" ? "active" : ""}`} onClick={() => setTab("data")}>⌗ Data</button>
          </div>

          {/* ── GOALS TAB ── */}
          {tab === "goals" && (
            <div className="settings-body">
              <div className="form-grid" style={{ marginBottom: 12 }}>
                <label>Primary Goal
                  <select value={form.goal} onChange={e => setG("goal", e.target.value)}>
                    {fitnessGoals.map(g => <option key={g}>{g}</option>)}
                  </select>
                </label>
                <label>Daily Calories
                  <input type="number" value={form.calories} onChange={e => setG("calories", Number(e.target.value))} />
                </label>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: ".82rem", color: "var(--text)", fontWeight: 500 }}>Macros</span>
                <button className="btn-secondary" style={{ padding: "5px 11px", fontSize: ".73rem" }} onClick={() => setForm(f => ({ ...f, ...autoCalc(f.calories, f.goal) }))}>✦ Auto for {form.goal}</button>
              </div>
              <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginBottom: 12 }}>
                <label>Protein (g)<input type="number" value={form.protein} onChange={e => setG("protein", Number(e.target.value))} /></label>
                <label>Carbs (g)<input type="number" value={form.carbs} onChange={e => setG("carbs", Number(e.target.value))} /></label>
                <label>Fat (g)<input type="number" value={form.fat} onChange={e => setG("fat", Number(e.target.value))} /></label>
              </div>
              <div className="macro-bar">
                <div className="macro-bar-seg mprot" style={{ width: `${pPct}%` }} />
                <div className="macro-bar-seg mcarb" style={{ width: `${cPct}%` }} />
                <div className="macro-bar-seg mfat" style={{ width: `${fPct}%` }} />
              </div>
              <div className="macro-legend">
                <span><span className="ldot mprot-d" />P {pPct}%</span>
                <span><span className="ldot mcarb-d" />C {cPct}%</span>
                <span><span className="ldot mfat-d" />F {fPct}%</span>
                <span style={{ marginLeft: "auto", color: Math.abs(total - form.calories) > 50 ? "#f9e27e" : "var(--muted)" }}>{total} / {form.calories} kcal</span>
              </div>
              <button className="btn-primary" style={{ marginTop: 14 }} onClick={() => { onSaveGoals(form); setSaved(true); setTimeout(() => setSaved(false), 2000); }}>
                {saved ? "✓ Saved!" : "Save Goals"}
              </button>
            </div>
          )}

          {/* ── EXPORT TAB ── */}
          {tab === "export" && (
            <div className="settings-body">
              <p style={{ fontSize: ".85rem", color: "var(--muted)", marginBottom: 14, lineHeight: 1.6 }}>
                Download your tracked data and chat history. Open CSV files in Excel, Google Sheets, or Numbers.
              </p>
              <div className="export-grid">
                <button className="export-btn" onClick={exportSleep} disabled={!counts.sleep}>
                  <span className="export-icon" style={{ color: "var(--sleep)" }}>◐</span>
                  <span className="export-name">Sleep</span>
                  <span className="export-count">{counts.sleep} entries</span>
                </button>
                <button className="export-btn" onClick={exportDiet} disabled={!counts.diet}>
                  <span className="export-icon" style={{ color: "var(--diet)" }}>◉</span>
                  <span className="export-name">Diet</span>
                  <span className="export-count">{counts.diet} entries</span>
                </button>
                <button className="export-btn" onClick={exportExercise} disabled={!counts.exercise}>
                  <span className="export-icon" style={{ color: "var(--exercise)" }}>◆</span>
                  <span className="export-name">Workouts</span>
                  <span className="export-count">{counts.exercise} entries</span>
                </button>
                <button className="export-btn" onClick={exportSports} disabled={!counts.sports}>
                  <span className="export-icon" style={{ color: "var(--sports)" }}>◇</span>
                  <span className="export-name">Sports</span>
                  <span className="export-count">{counts.sports} entries</span>
                </button>
                <button className="export-btn" onClick={exportChat} disabled={chatCount <= 1}>
                  <span className="export-icon" style={{ color: "var(--accent)" }}>✦</span>
                  <span className="export-name">AI Chat</span>
                  <span className="export-count">{Math.max(0, chatCount - 1)} messages</span>
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button className="btn-primary" onClick={exportAll}>⬇ All as CSV</button>
                <button className="btn-secondary" onClick={exportJSON}>JSON Backup</button>
              </div>
              <p style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 12, lineHeight: 1.5 }}>
                <strong style={{ color: "var(--text)" }}>JSON Backup</strong> includes everything (goals, data, chat) and can be used to restore in the Data tab.
              </p>
            </div>
          )}

          {/* ── DATA TAB ── */}
          {tab === "data" && (
            <div className="settings-body">
              <div className="data-stats">
                <div className="data-stat"><span className="data-stat-num">{totalEntries}</span><span className="data-stat-lbl">Total Entries</span></div>
                <div className="data-stat"><span className="data-stat-num">{Math.max(0, chatCount - 1)}</span><span className="data-stat-lbl">Chat Messages</span></div>
              </div>

              <div className="data-action">
                <div>
                  <div className="data-action-title">📥 Restore from Backup</div>
                  <div className="data-action-desc">Load a previously exported fitlog JSON file. This replaces all current data.</div>
                </div>
                <button className="btn-secondary" onClick={() => fileRef.current.click()}>Choose File</button>
                <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={handleImportFile} />
              </div>

              <div className="data-action danger">
                <div>
                  <div className="data-action-title" style={{ color: "var(--exercise)" }}>⚠ Clear All Data</div>
                  <div className="data-action-desc">Permanently delete all sleep, diet, workouts, sports, and chat history. Goals remain.</div>
                </div>
                <button className="btn-delete" onClick={() => {
                  if (confirm("Delete ALL tracked data and chat history? This can't be undone.")) {
                    if (confirm("Are you absolutely sure? Consider exporting a backup first.")) {
                      onClearAll();
                    }
                  }
                }} style={{ margin: 0 }}>Clear Everything</button>
              </div>

              <p style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: 14, lineHeight: 1.6 }}>
                Your data lives in your browser's storage on this device only. No cloud sync. Export a JSON backup regularly if you care about keeping it.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AI COACH SECTION ────────────────────────────────────────────────────────
const COACH_INITIAL_MSG = {
  role: "assistant",
  text: "Hey! I'm your AI coach. Ask me anything — best exercises for your goal, how to improve your sleep, what to eat before a workout, whether you should rest today. I'll use your actual logged data AND remember our past conversations to give you the best answer. 💪"
};

function loadMessages() {
  try {
    const r = localStorage.getItem(STORAGE_KEY + "_chat");
    const parsed = r ? JSON.parse(r) : null;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [COACH_INITIAL_MSG];
  } catch { return [COACH_INITIAL_MSG]; }
}
function saveMessages(m) { localStorage.setItem(STORAGE_KEY + "_chat", JSON.stringify(m)); }

function AICoachSection({ data, goals }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("chat");
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState("");
  const [messages, setMessages] = useState(loadMessages);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Persist messages whenever they change
  useEffect(() => { saveMessages(messages); }, [messages]);

  const hasData = data.sleep.length > 0 || data.diet.length > 0 || data.exercise.length > 0 || data.sports.length > 0;
  const statusColor = { good: "#a5f3b4", warning: "#f9e27e", critical: "#f97b6e" };
  const statusBg = { good: "rgba(165,243,180,0.07)", warning: "rgba(249,226,126,0.07)", critical: "rgba(249,123,110,0.07)" };
  const statusBorder = { good: "rgba(165,243,180,0.22)", warning: "rgba(249,226,126,0.22)", critical: "rgba(249,123,110,0.22)" };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, chatLoading]);

  function buildContext() {
    const cut = new Date(); cut.setDate(cut.getDate() - 14);
    const last14 = arr => arr.filter(i => new Date(i.date + "T00:00:00") >= cut);
    return `User goal: ${goals.goal}
Calorie target: ${goals.calories}kcal | Protein: ${goals.protein}g | Carbs: ${goals.carbs}g | Fat: ${goals.fat}g

Sleep (last 14d): ${last14(data.sleep).map(s => `${s.date}: ${s.duration}h (${s.quality})`).join(", ") || "none"}
Diet (last 14d): ${last14(data.diet).map(d => `${d.date} ${d.meal}: ${d.food} ${d.calories}kcal P${d.protein}g`).join(" | ") || "none"}
Workouts (last 14d): ${last14(data.exercise).map(e => `${e.date}: ${e.label}`).join(", ") || "none"}
Sports (last 14d): ${last14(data.sports).map(s => `${s.date}: ${s.sport} ${s.duration}min ${s.intensity}`).join(", ") || "none"}`;
  }

  async function sendMessage() {
    const q = input.trim();
    if (!q || chatLoading) return;
    setInput("");
    const updated = [...messages, { role: "user", text: q, ts: Date.now() }];
    setMessages(updated);
    setChatLoading(true);
    try {
      // Send full conversation history (skip the initial greeting). The coach now has memory.
      // Cap at last 40 messages to control token costs as history grows.
      const recentHistory = updated.slice(1).slice(-40);
      const apiMsgs = recentHistory.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
      // Inject latest fitness data into the most recent user message so context stays fresh
      const lastUserIdx = apiMsgs.map(m => m.role).lastIndexOf("user");
      if (lastUserIdx >= 0) {
        apiMsgs[lastUserIdx] = { role: "user", content: `[Current fitness data]\n${buildContext()}\n\n[My question]\n${apiMsgs[lastUserIdx].content}` };
      }
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 800,
          system: `You are an elite personal trainer and sports nutritionist. The user shares their real fitness tracking data with you AND you have access to your full conversation history with them, so reference past discussions naturally when relevant ("like we talked about last week...", "you mentioned earlier that..."). Give direct, specific, practical advice. Be concise — 2-4 short paragraphs or bullet points. Be encouraging but honest. Their goal: ${goals.goal}.`,
          messages: apiMsgs
        })
      });
      const res = await resp.json();
      const reply = res.content?.map(b => b.text || "").join("") || "Sorry, try again.";
      setMessages(prev => [...prev, { role: "assistant", text: reply, ts: Date.now() }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: "Something went wrong. Please try again.", ts: Date.now() }]);
    }
    setChatLoading(false);
  }

  function clearChat() {
    if (confirm("Clear all chat history? This can't be undone.")) {
      setMessages([COACH_INITIAL_MSG]);
    }
  }

  async function runAnalysis() {
    setLoading(true); setAnalysisError(""); setAnalysis(null);
    try { setAnalysis(await analyzeAllData(data, goals)); }
    catch { setAnalysisError("Analysis failed. Log some data and try again."); }
    finally { setLoading(false); }
  }

  const suggestions = [
    "Should I train today or rest?",
    "What should I eat before my workout?",
    "How can I improve my sleep?",
    "Am I eating enough protein?",
    "What's the best split for my goal?",
  ];

  return (
    <div className="dash-section">
      <button className="dash-section-toggle" onClick={() => setOpen(o => !o)}>
        <span className="dash-section-label">✦ AI Coach</span>
        <span className="dash-section-meta">{analysis ? `Score: ${analysis.overallScore}/10` : "Chat · Analysis"}</span>
        <span className="dash-chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <div className="coach-tabs">
            <button className={`coach-tab ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}>💬 Ask Coach</button>
            <button className={`coach-tab ${tab === "analysis" ? "active" : ""}`} onClick={() => setTab("analysis")}>📊 Full Analysis</button>
          </div>

          {tab === "chat" && (
            <div className="coach-chat-wrap">
              <div className="chat-info-bar">
                <span className="chat-info-label">{messages.length - 1} messages · saved on this device</span>
                {messages.length > 1 && (
                  <button className="chat-clear-btn" onClick={clearChat}>Clear chat</button>
                )}
              </div>
              <div className="coach-messages">
                {messages.map((m, i) => (
                  <div key={i} className={`coach-msg ${m.role}`}>
                    {m.role === "assistant" && <div className="coach-avatar">✦</div>}
                    <div className="coach-bubble">
                      {m.text.split("\n").filter((l, li, arr) => l || (li > 0 && arr[li-1])).map((line, j) => (
                        line.startsWith("• ") || line.startsWith("- ") || line.match(/^\d+\./)
                          ? <p key={j} style={{ margin: "3px 0", paddingLeft: 4 }}>{line}</p>
                          : <p key={j} style={{ margin: j > 0 && line ? "7px 0 0" : 0 }}>{line}</p>
                      ))}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="coach-msg assistant">
                    <div className="coach-avatar">✦</div>
                    <div className="coach-bubble coach-typing"><span /><span /><span /></div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {messages.length <= 1 && (
                <div className="coach-suggestions">
                  {suggestions.map((s, i) => (
                    <button key={i} className="coach-suggestion" onClick={() => setInput(s)}>{s}</button>
                  ))}
                </div>
              )}

              <div className="coach-input-row">
                <input
                  className="coach-input"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }}}
                  placeholder="Ask about training, diet, recovery…"
                  disabled={chatLoading}
                />
                <button className="coach-send" onClick={sendMessage} disabled={!input.trim() || chatLoading}>
                  {chatLoading ? <span className="spinner-dot" style={{ width: 12, height: 12 }} /> : "↑"}
                </button>
              </div>
            </div>
          )}

          {tab === "analysis" && (
            <div style={{ padding: "18px" }}>
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: 14, lineHeight: 1.6 }}>
                Deep analysis of your last 14 days vs your <strong style={{ color: "var(--text)" }}>{goals.goal}</strong> goal.
              </p>
              {!hasData && <div className="empty-msg" style={{ marginBottom: 14 }}>Log some data first.</div>}
              <button className="btn-ai" onClick={runAnalysis} disabled={loading || !hasData}>
                {loading ? <span className="loading-text"><span className="spinner-dot" />Analyzing…</span> : "✦ Run Full Analysis"}
              </button>
              {analysisError && <div className="error-msg" style={{ marginTop: 12 }}>{analysisError}</div>}
              {analysis && (
                <div className="coach-results">
                  <div className="overall-score-card">
                    <div className="score-ring">
                      <svg viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" strokeWidth="6" />
                        <circle cx="40" cy="40" r="34" fill="none" stroke="#6ee7f7" strokeWidth="6"
                          strokeDasharray={`${(analysis.overallScore / 10) * 213.6} 213.6`} strokeLinecap="round" transform="rotate(-90 40 40)" />
                      </svg>
                      <div className="score-number">{analysis.overallScore}<span>/10</span></div>
                    </div>
                    <div><div className="score-label">Overall Score</div><p className="score-summary">{analysis.summary}</p></div>
                  </div>
                  <div className="priority-card">
                    <div className="priority-label">⚡ This Week's #1 Priority</div>
                    <div className="priority-text">{analysis.priorityAction}</div>
                  </div>
                  {analysis.sections.map((s, i) => (
                    <div key={i} className="coach-section" style={{ background: statusBg[s.status], border: `1px solid ${statusBorder[s.status]}` }}>
                      <div className="coach-section-header">
                        <div className="coach-section-title">{s.category}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: statusColor[s.status] }}>{s.score}/10</span>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor[s.status], display: "inline-block" }} />
                        </div>
                      </div>
                      <p className="coach-insight">{s.insight}</p>
                      <div className="coach-tips">{s.tips.map((tip, j) => (
                        <div key={j} className="coach-tip">
                          <span style={{ color: statusColor[s.status], fontWeight: 700, flexShrink: 0 }}>→</span>
                          <span>{tip}</span>
                        </div>
                      ))}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── RING CHART ───────────────────────────────────────────────────────────────
function RingChart({ pct, color, size = 88, stroke = 8, label, value, unit }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(1, pct / 100) * circ;
  return (
    <div className="ring-wrap">
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--surface2)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s cubic-bezier(.4,0,.2,1)", filter: `drop-shadow(0 0 6px ${color}88)` }} />
      </svg>
      <div className="ring-center">
        <div className="ring-val" style={{ color }}>{value}<span className="ring-unit">{unit}</span></div>
        <div className="ring-pct">{pct > 0 ? pct + "%" : ""}</div>
      </div>
      <div className="ring-label">{label}</div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ data, goals, onSaveGoals, onClearAll, onImport }) {
  const today = getTodayStr();
  const now = new Date();
  const last7 = arr => arr.filter(i => (now - new Date(i.date + "T00:00:00")) / 86400000 <= 7);
  const todaySleep = data.sleep.filter(s => s.date === today);
  const todayDiet = data.diet.filter(s => s.date === today);
  const todayExercise = data.exercise.filter(s => s.date === today);
  const todaySports = data.sports.filter(s => s.date === today);
  const avgSleep = last7(data.sleep).length
    ? +(last7(data.sleep).reduce((a, s) => a + s.duration, 0) / last7(data.sleep).length).toFixed(1) : 0;
  const todayCalIn = todayDiet.reduce((a, m) => a + m.calories, 0);
  const todayProtein = todayDiet.reduce((a, m) => a + (m.protein || 0), 0);
  const todayCarbs = todayDiet.reduce((a, m) => a + (m.carbs || 0), 0);
  const todayFat = todayDiet.reduce((a, m) => a + (m.fat || 0), 0);
  const todayCalOut = todaySports.reduce((a, e) => a + (e.calories || 0), 0);
  const totalWorkouts = last7(data.exercise).length + last7(data.sports).length;
  const calPct = goals.calories > 0 ? Math.min(100, Math.round((todayCalIn / goals.calories) * 100)) : 0;
  const prtPct = goals.protein > 0 ? Math.min(100, Math.round((todayProtein / goals.protein) * 100)) : 0;
  const carbPct = goals.carbs > 0 ? Math.min(100, Math.round((todayCarbs / goals.carbs) * 100)) : 0;
  const fatPct = goals.fat > 0 ? Math.min(100, Math.round((todayFat / goals.fat) * 100)) : 0;
  const sleepPct = Math.min(100, Math.round((avgSleep / 8) * 100));
  const hr = now.getHours();
  const greeting = hr < 5 ? "Still up?" : hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : hr < 21 ? "Good evening" : "Good night";
  const recentAll = [
    ...data.sleep.map(i => ({ ...i, _type: "sleep" })),
    ...data.diet.map(i => ({ ...i, _type: "diet" })),
    ...data.exercise.map(i => ({ ...i, _type: "exercise" })),
    ...data.sports.map(i => ({ ...i, _type: "sports" })),
  ].sort((a, b) => b.id - a.id).slice(0, 6);
  const typeColor = { sleep: "var(--sleep)", diet: "var(--diet)", exercise: "var(--exercise)", sports: "var(--sports)" };
  const typeBg = { sleep: "rgba(110,231,247,.1)", diet: "rgba(249,226,126,.1)", exercise: "rgba(249,123,110,.1)", sports: "rgba(165,243,180,.1)" };
  const typeIcon = { sleep: "◐", diet: "◉", exercise: "◆", sports: "◇" };

  return (
    <div className="dashboard">

      {/* HERO */}
      <div className="db-hero">
        <div className="db-hero-glow" />
        <div className="db-hero-inner">
          <div className="db-hero-top">
            <div>
              <p className="db-hero-date">{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
              <h2 className="db-hero-greeting">{greeting} 👋</h2>
            </div>
            <div className="db-goal-pill">{goals.goal}</div>
          </div>
          <div className="db-rings">
            <RingChart pct={calPct} color="#f9e27e" value={todayCalIn || "—"} unit="" label="Calories" />
            <RingChart pct={prtPct} color="#c4b5fd" value={todayProtein || "—"} unit={todayProtein ? "g" : ""} label="Protein" />
            <RingChart pct={sleepPct} color="#6ee7f7" value={avgSleep || "—"} unit={avgSleep ? "h" : ""} label="Avg Sleep" />
            <RingChart pct={Math.min(100, Math.round((totalWorkouts / 7) * 100))} color="#a5f3b4" value={totalWorkouts || "—"} unit="" label="Workouts" />
          </div>
        </div>
      </div>

      {/* AI COACH */}
      <AICoachSection data={data} goals={goals} />

      {/* NUTRITION CARD */}
      {todayCalIn > 0 && (
        <div className="db-card">
          <div className="db-card-hd">
            <span className="db-card-title">Today's Nutrition</span>
            <span className="db-card-badge" style={{ color: "#f9e27e" }}>{todayCalIn} kcal</span>
          </div>
          <div className="db-macros">
            {[
              { label: "Calories", val: todayCalIn, target: goals.calories, unit: "kcal", color: "#f9e27e", pct: calPct },
              { label: "Protein", val: todayProtein, target: goals.protein, unit: "g", color: "#c4b5fd", pct: prtPct },
              { label: "Carbs", val: todayCarbs, target: goals.carbs, unit: "g", color: "#f97b6e", pct: carbPct },
              { label: "Fat", val: todayFat, target: goals.fat, unit: "g", color: "#a5f3b4", pct: fatPct },
            ].map(m => (
              <div key={m.label} className="db-macro-row">
                <div className="db-macro-info">
                  <span className="db-macro-label">{m.label}</span>
                  <span className="db-macro-nums" style={{ color: m.color }}>{m.val}{m.unit} <span className="db-macro-target">/ {m.target}{m.unit}</span></span>
                </div>
                <div className="db-macro-track">
                  <div className="db-macro-fill" style={{ width: `${m.pct}%`, background: m.color, boxShadow: `0 0 8px ${m.color}55` }} />
                </div>
              </div>
            ))}
          </div>
          {todayCalOut > 0 && (
            <div className="db-net-cal">
              <span>Net calories</span>
              <span style={{ color: "#a5f3b4", fontWeight: 600 }}>{todayCalIn - todayCalOut} kcal <span style={{ color: "var(--muted)", fontWeight: 400 }}>({todayCalOut} burned)</span></span>
            </div>
          )}
        </div>
      )}

      {/* TODAY'S ACTIVITY */}
      <div className="db-card">
        <div className="db-card-hd"><span className="db-card-title">Today's Activity</span></div>
        {todaySleep.length + todayDiet.length + todayExercise.length + todaySports.length === 0
          ? <div className="db-empty">Nothing logged yet — go crush it! 💪</div>
          : <div className="db-tiles">
              {todaySleep.map(s => (
                <div key={s.id} className="db-tile" style={{ "--tc": "#6ee7f7", "--tb": "rgba(110,231,247,.07)" }}>
                  <span className="db-tile-icon">◐</span>
                  <span className="db-tile-val">{s.duration}h</span>
                  <span className="db-tile-lbl">{s.quality} sleep</span>
                </div>
              ))}
              {todayExercise.map(e => (
                <div key={e.id} className="db-tile" style={{ "--tc": "#f97b6e", "--tb": "rgba(249,123,110,.07)" }}>
                  <span className="db-tile-icon">◆</span>
                  <span className="db-tile-val" style={{ fontSize: "0.8rem" }}>{e.label}</span>
                  <span className="db-tile-lbl">Workout</span>
                </div>
              ))}
              {todaySports.map(s => (
                <div key={s.id} className="db-tile" style={{ "--tc": "#a5f3b4", "--tb": "rgba(165,243,180,.07)" }}>
                  <span className="db-tile-icon">◇</span>
                  <span className="db-tile-val" style={{ fontSize: "0.8rem" }}>{s.sport}</span>
                  <span className="db-tile-lbl">{s.duration}min · {s.calories}kcal</span>
                </div>
              ))}
              {todayDiet.map(m => (
                <div key={m.id} className="db-tile" style={{ "--tc": "#f9e27e", "--tb": "rgba(249,226,126,.07)" }}>
                  <span className="db-tile-icon">◉</span>
                  <span className="db-tile-val" style={{ fontSize: "0.8rem" }}>{m.meal}</span>
                  <span className="db-tile-lbl">{m.calories} kcal</span>
                </div>
              ))}
            </div>
        }
      </div>

      {/* SETTINGS (Goals · Export · Data) */}
      <SettingsSection data={data} goals={goals} onSaveGoals={onSaveGoals} onClearAll={onClearAll} onImport={onImport} />

      {/* RECENT FEED */}
      <div className="db-card">
        <div className="db-card-hd"><span className="db-card-title">Recent Entries</span></div>
        {recentAll.length === 0
          ? <div className="db-empty">No entries yet — start logging!</div>
          : <div className="db-feed">
              {recentAll.map((item, i) => (
                <div key={item.id} className="db-feed-item">
                  <div className="db-feed-left">
                    <div className="db-feed-icon" style={{ color: typeColor[item._type], background: typeBg[item._type] }}>{typeIcon[item._type]}</div>
                    {i < recentAll.length - 1 && <div className="db-feed-line" />}
                  </div>
                  <div className="db-feed-body">
                    <div className="db-feed-text">
                      {item._type === "sleep" && `${item.duration}h sleep · ${item.quality}`}
                      {item._type === "diet" && `${item.meal}: ${item.food.slice(0, 38)}${item.food.length > 38 ? "…" : ""}`}
                      {item._type === "exercise" && item.label}
                      {item._type === "sports" && `${item.sport}${item.result ? " · " + item.result : ""} · ${item.calories} kcal`}
                    </div>
                    <div className="db-feed-date">{formatDate(item.date)}</div>
                  </div>
                </div>
              ))}
            </div>
        }
      </div>

    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function FitnessTracker() {
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [data, setData] = useState(loadData);
  const [goals, setGoals] = useState(loadGoals);
  useEffect(() => { saveData(data); }, [data]);
  useEffect(() => { saveGoals(goals); }, [goals]);
  const addEntry = type => entry => setData(d => ({ ...d, [type]: [entry, ...d[type]] }));
  const deleteEntry = type => id => setData(d => ({ ...d, [type]: d[type].filter(e => e.id !== id) }));
  const clearAllData = () => {
    setData(defaultData);
    localStorage.removeItem(STORAGE_KEY + "_chat");
    // Trigger a reload so the AI Coach's loaded messages reset
    setTimeout(() => window.location.reload(), 100);
  };
  const importData = (backup) => {
    if (backup.data) setData(backup.data);
    if (backup.goals) setGoals(backup.goals);
    if (backup.chat) localStorage.setItem(STORAGE_KEY + "_chat", JSON.stringify(backup.chat));
    setTimeout(() => window.location.reload(), 100);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --bg:#0e0f14; --surface:#16181f; --surface2:#1e2029; --border:#2a2d38; --text:#e8eaf0; --muted:#7a7e94; --accent:#6ee7f7; --sleep:#6ee7f7; --diet:#f9e27e; --exercise:#f97b6e; --sports:#a5f3b4; --radius:14px; }
        body { background:var(--bg); color:var(--text); font-family:'DM Sans',sans-serif; }
        .app { min-height:100vh; display:flex; flex-direction:column; max-width:860px; margin:0 auto; padding:0 16px 100px; }
        .app-header { padding:28px 0 20px; display:flex; align-items:baseline; gap:12px; }
        .app-header h1 { font-family:'DM Serif Display',serif; font-size:2rem; letter-spacing:-0.5px; background:linear-gradient(135deg,#e8eaf0 30%,#6ee7f7); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
        .app-header p { color:var(--muted); font-size:0.85rem; font-weight:300; }
        .tabs { display:flex; gap:4px; background:var(--surface); border-radius:12px; padding:5px; margin-bottom:24px; border:1px solid var(--border); overflow-x:auto; scrollbar-width:none; }
        .tabs::-webkit-scrollbar { display:none; }
        .tab-btn { flex:1; min-width:76px; padding:9px 10px; border:none; background:transparent; color:var(--muted); font-family:'DM Sans',sans-serif; font-size:0.78rem; font-weight:500; border-radius:8px; cursor:pointer; transition:all .2s; white-space:nowrap; display:flex; align-items:center; justify-content:center; gap:5px; }
        .tab-btn.active { background:var(--surface2); color:var(--text); box-shadow:0 1px 3px rgba(0,0,0,.4); }
        .tab-btn:hover:not(.active) { color:var(--text); }
        .form-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:24px; margin-bottom:24px; }
        .form-title { font-family:'DM Serif Display',serif; font-size:1.3rem; margin-bottom:18px; color:var(--text); display:flex; align-items:center; gap:10px; }
        .ai-badge { font-family:'DM Sans',sans-serif; font-size:0.68rem; font-weight:600; background:linear-gradient(135deg,#6ee7f7,#a5f3b4); color:#0a1214; padding:3px 9px; border-radius:20px; letter-spacing:.05em; }
        .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px; }
        @media (max-width:560px) { .form-grid { grid-template-columns:1fr; } }
        label { display:flex; flex-direction:column; gap:6px; font-size:.78rem; font-weight:500; color:var(--muted); letter-spacing:.03em; text-transform:uppercase; }
        input,select,textarea { background:var(--surface2); border:1px solid var(--border); border-radius:8px; color:var(--text); font-family:'DM Sans',sans-serif; font-size:.92rem; padding:10px 12px; outline:none; transition:border-color .2s; width:100%; }
        input:focus,select:focus,textarea:focus { border-color:var(--accent); }
        textarea { resize:vertical; min-height:72px; }
        select option { background:var(--surface2); }
        .duration-badge { display:inline-block; background:rgba(110,231,247,.12); color:var(--sleep); border:1px solid rgba(110,231,247,.25); border-radius:20px; padding:5px 14px; font-size:.85rem; margin-bottom:14px; }
        .mode-toggle { display:flex; gap:6px; margin-bottom:16px; }
        .mode-btn { flex:1; padding:10px; background:var(--surface2); border:1px solid var(--border); border-radius:8px; color:var(--muted); font-family:'DM Sans',sans-serif; font-size:.82rem; font-weight:500; cursor:pointer; transition:all .2s; }
        .mode-btn.active { background:rgba(110,231,247,.08); border-color:rgba(110,231,247,.4); color:var(--sleep); }
        .image-upload-area { border:2px dashed var(--border); border-radius:10px; min-height:140px; display:flex; align-items:center; justify-content:center; cursor:pointer; margin-bottom:14px; overflow:hidden; transition:border-color .2s; }
        .image-upload-area:hover { border-color:var(--accent); }
        .upload-prompt { display:flex; flex-direction:column; align-items:center; gap:8px; color:var(--muted); font-size:.88rem; }
        .upload-icon { font-size:2.2rem; }
        .food-preview { width:100%; max-height:220px; object-fit:cover; }
        .ai-result { background:rgba(110,231,247,.05); border:1px solid rgba(110,231,247,.2); border-radius:12px; padding:18px; margin-top:4px; }
        .ai-result-title { font-size:.72rem; font-weight:600; color:var(--sleep); letter-spacing:.09em; text-transform:uppercase; margin-bottom:8px; }
        .ai-food-name { font-size:1rem; font-weight:500; color:var(--text); margin-bottom:14px; line-height:1.4; }
        .macro-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:12px; }
        .macro-chip { background:var(--surface2); border-radius:10px; padding:10px 8px; text-align:center; border:1px solid var(--border); }
        .macro-chip.cal { border-color:rgba(249,226,126,.3); background:rgba(249,226,126,.06); }
        .macro-chip.cal .macro-val { color:var(--diet); }
        .macro-val { display:block; font-size:1.05rem; font-weight:600; color:var(--text); }
        .macro-lbl { display:block; font-size:.66rem; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin-top:3px; }
        .ai-note { font-size:.82rem; color:var(--muted); margin-bottom:14px; font-style:italic; line-height:1.5; }
        .calorie-estimate { background:rgba(165,243,180,.05); border:1px solid rgba(165,243,180,.2); border-radius:12px; padding:18px; margin-top:14px; }
        .calorie-est-header { font-size:.72rem; font-weight:600; color:var(--sports); letter-spacing:.09em; text-transform:uppercase; margin-bottom:8px; }
        .calorie-est-value { font-family:'DM Serif Display',serif; font-size:2.4rem; color:var(--sports); margin-bottom:6px; line-height:1; }
        .calorie-est-value span { font-family:'DM Sans',sans-serif; font-size:.88rem; color:var(--muted); }
        .calorie-est-note { font-size:.82rem; color:var(--muted); margin-bottom:16px; font-style:italic; line-height:1.5; }
        .result-actions { display:flex; gap:8px; }
        .btn-primary { flex:1; padding:12px; background:linear-gradient(135deg,#6ee7f7,#4db8cc); color:#0a1214; font-family:'DM Sans',sans-serif; font-size:.9rem; font-weight:600; border:none; border-radius:10px; cursor:pointer; transition:opacity .2s,transform .1s; letter-spacing:.02em; }
        .btn-primary:hover { opacity:.9; } .btn-primary:active { transform:scale(.98); } .btn-primary:disabled { opacity:.4; cursor:not-allowed; }
        .btn-secondary { padding:10px 16px; background:var(--surface2); border:1px solid var(--border); color:var(--muted); font-family:'DM Sans',sans-serif; font-size:.85rem; border-radius:10px; cursor:pointer; white-space:nowrap; }
        .btn-secondary:hover { color:var(--text); }
        .btn-ai { width:100%; padding:13px; background:transparent; border:1px solid rgba(110,231,247,.3); color:var(--accent); font-family:'DM Sans',sans-serif; font-size:.9rem; font-weight:600; border-radius:10px; cursor:pointer; transition:all .2s; }
        .btn-ai:hover:not(:disabled) { background:rgba(110,231,247,.08); } .btn-ai:disabled { opacity:.4; cursor:not-allowed; }
        .loading-text { display:inline-flex; align-items:center; gap:10px; }
        .spinner-dot { display:inline-block; width:14px; height:14px; border:2px solid currentColor; border-top-color:transparent; border-radius:50%; animation:spin .7s linear infinite; flex-shrink:0; }
        @keyframes spin { to { transform:rotate(360deg); } }
        .error-msg { margin-top:12px; padding:11px 14px; background:rgba(249,123,110,.08); border:1px solid rgba(249,123,110,.25); color:var(--exercise); border-radius:8px; font-size:.85rem; }
        .section-title { font-family:'DM Serif Display',serif; font-size:1.15rem; color:var(--text); margin:24px 0 10px; }

        /* ── DASHBOARD ── */
        .dashboard { display:flex; flex-direction:column; gap:14px; }

        /* Hero */
        .db-hero { position:relative; border-radius:20px; overflow:hidden; background:linear-gradient(135deg,#161a24 0%,#0e1420 60%,#0d1a1f 100%); border:1px solid var(--border); padding:24px 20px 20px; }
        .db-hero-glow { position:absolute; top:-60px; right:-60px; width:220px; height:220px; background:radial-gradient(circle,rgba(110,231,247,.12) 0%,transparent 70%); pointer-events:none; }
        .db-hero-inner { position:relative; }
        .db-hero-top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:22px; }
        .db-hero-date { font-size:.75rem; color:var(--muted); margin-bottom:4px; letter-spacing:.03em; }
        .db-hero-greeting { font-family:'DM Serif Display',serif; font-size:1.7rem; color:var(--text); line-height:1.1; }
        .db-goal-pill { background:rgba(110,231,247,.12); color:var(--sleep); border:1px solid rgba(110,231,247,.2); border-radius:20px; padding:5px 13px; font-size:.72rem; font-weight:600; white-space:nowrap; letter-spacing:.03em; }
        .db-rings { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
        @media (max-width:420px) { .db-rings { grid-template-columns:repeat(2,1fr); } }

        /* Ring chart */
        .ring-wrap { display:flex; flex-direction:column; align-items:center; gap:6px; }
        .ring-center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
        .ring-wrap > svg { display:block; }
        .ring-wrap { position:relative; }
        .ring-val { font-family:'DM Serif Display',serif; font-size:1.1rem; line-height:1; }
        .ring-unit { font-family:'DM Sans',sans-serif; font-size:.6rem; opacity:.8; }
        .ring-pct { font-size:.6rem; color:var(--muted); }
        .ring-label { font-size:.68rem; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; text-align:center; }

        /* Card */
        .db-card { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:18px; }
        .db-card-hd { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
        .db-card-title { font-family:'DM Serif Display',serif; font-size:1rem; color:var(--text); }
        .db-card-badge { font-size:.78rem; font-weight:600; }

        /* Macros */
        .db-macros { display:flex; flex-direction:column; gap:10px; }
        .db-macro-row { display:flex; flex-direction:column; gap:5px; }
        .db-macro-info { display:flex; justify-content:space-between; align-items:baseline; }
        .db-macro-label { font-size:.75rem; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
        .db-macro-nums { font-size:.85rem; font-weight:600; }
        .db-macro-target { font-size:.72rem; color:var(--muted); font-weight:400; }
        .db-macro-track { height:5px; background:var(--surface2); border-radius:3px; overflow:hidden; }
        .db-macro-fill { height:100%; border-radius:3px; transition:width .7s cubic-bezier(.4,0,.2,1); }
        .db-net-cal { margin-top:12px; padding-top:12px; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; font-size:.82rem; color:var(--muted); }

        /* Activity tiles */
        .db-tiles { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:8px; }
        .db-tile { background:var(--tb,var(--surface2)); border:1px solid rgba(255,255,255,.06); border-radius:12px; padding:12px 10px; display:flex; flex-direction:column; align-items:center; gap:4px; text-align:center; border-top:2px solid var(--tc); }
        .db-tile-icon { font-size:1.1rem; color:var(--tc); }
        .db-tile-val { font-family:'DM Serif Display',serif; font-size:1rem; color:var(--text); line-height:1.1; }
        .db-tile-lbl { font-size:.65rem; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }

        /* Feed */
        .db-feed { display:flex; flex-direction:column; }
        .db-feed-item { display:flex; gap:12px; align-items:flex-start; padding:6px 0; }
        .db-feed-left { display:flex; flex-direction:column; align-items:center; flex-shrink:0; }
        .db-feed-icon { width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:.9rem; flex-shrink:0; }
        .db-feed-line { width:1px; flex:1; background:var(--border); min-height:10px; margin:3px 0; }
        .db-feed-body { flex:1; padding-top:5px; padding-bottom:4px; }
        .db-feed-text { font-size:.84rem; color:var(--text); line-height:1.4; }
        .db-feed-date { font-size:.72rem; color:var(--muted); margin-top:2px; }

        /* Empty */
        .db-empty { text-align:center; color:var(--muted); padding:20px; font-size:.88rem; }

        .log-list { display:flex; flex-direction:column; gap:8px; }
        .log-item { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; transition:border-color .2s; }
        .log-item.open { border-color:rgba(110,231,247,.4); }
        .log-header { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; cursor:pointer; gap:12px; }
        .log-title { font-weight:500; font-size:.9rem; }
        .log-meta { display:flex; align-items:center; gap:6px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end; }
        .log-tag { background:var(--surface2); border:1px solid var(--border); border-radius:20px; padding:2px 10px; font-size:.72rem; color:var(--muted); }
        .log-toggle { color:var(--muted); font-size:.7rem; margin-left:4px; }
        .log-detail { padding:14px 18px 16px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:6px; }
        .log-detail-row { font-size:.85rem; color:var(--muted); }
        .btn-delete { margin-top:8px; padding:6px 14px; background:rgba(249,123,110,.1); color:var(--exercise); border:1px solid rgba(249,123,110,.2); border-radius:8px; font-family:'DM Sans',sans-serif; font-size:.8rem; cursor:pointer; align-self:flex-start; }
        .btn-delete:hover { background:rgba(249,123,110,.2); }
        .workout-raw { font-family:monospace; font-size:.78rem; color:var(--muted); white-space:pre-wrap; word-break:break-word; line-height:1.7; background:var(--surface2); border-radius:8px; padding:14px; border:1px solid var(--border); max-height:400px; overflow-y:auto; }
        .dash-greeting h2 { font-family:'DM Serif Display',serif; font-size:1.6rem; margin-bottom:4px; }
        .dash-date { color:var(--muted); font-size:.85rem; margin-bottom:8px; }
        .goal-chip { display:inline-block; background:rgba(110,231,247,.1); color:var(--sleep); border:1px solid rgba(110,231,247,.2); border-radius:20px; padding:3px 12px; font-size:.75rem; font-weight:500; margin-bottom:16px; }
        .today-pills { display:flex; flex-wrap:wrap; gap:8px; }
        .pill { padding:6px 14px; border-radius:20px; font-size:.8rem; font-weight:500; }
        .pill-sleep { background:rgba(110,231,247,.1); color:var(--sleep); border:1px solid rgba(110,231,247,.2); }
        .pill-diet { background:rgba(249,226,126,.1); color:var(--diet); border:1px solid rgba(249,226,126,.2); }
        .pill-exercise { background:rgba(249,123,110,.1); color:var(--exercise); border:1px solid rgba(249,123,110,.2); }
        .pill-sports { background:rgba(165,243,180,.1); color:var(--sports); border:1px solid rgba(165,243,180,.2); }
        .pill-empty { background:var(--surface2); color:var(--muted); border:1px solid var(--border); }
        .recent-list { display:flex; flex-direction:column; gap:6px; }
        .recent-row { display:flex; align-items:center; gap:12px; padding:12px 16px; background:var(--surface); border:1px solid var(--border); border-radius:10px; font-size:.85rem; }
        .recent-icon { font-size:1rem; } .recent-label { flex:1; } .recent-date { color:var(--muted); font-size:.75rem; white-space:nowrap; }
        .recent-sleep .recent-icon { color:var(--sleep); } .recent-diet .recent-icon { color:var(--diet); } .recent-exercise .recent-icon { color:var(--exercise); } .recent-sports .recent-icon { color:var(--sports); }
        .empty-msg { text-align:center; color:var(--muted); padding:28px; font-size:.9rem; background:var(--surface); border-radius:var(--radius); border:1px dashed var(--border); }
        .tab-content { animation:fadeIn .2s ease; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
        .list-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
        .entry-count { background:var(--surface2); color:var(--muted); border-radius:20px; padding:3px 10px; font-size:.75rem; }

        /* COLLAPSIBLE DASH SECTIONS */
        .dash-section { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; margin-bottom:8px; }
        .dash-section-toggle { width:100%; display:flex; align-items:center; gap:10px; padding:14px 18px; background:transparent; border:none; cursor:pointer; text-align:left; }
        .dash-section-toggle:hover { background:rgba(255,255,255,.02); }
        .dash-section-label { font-size:.9rem; font-weight:600; color:var(--text); flex-shrink:0; }
        .dash-section-meta { font-size:.78rem; color:var(--muted); flex:1; }
        .dash-chevron { color:var(--muted); font-size:.7rem; flex-shrink:0; }
        .dash-section-body { padding:0 18px 20px; border-top:1px solid var(--border); padding-top:18px; }

        /* AI COACH TABS */
        .coach-tabs { display:flex; border-bottom:1px solid var(--border); }
        .chat-info-bar { display:flex; justify-content:space-between; align-items:center; padding:8px 16px; border-bottom:1px solid var(--border); background:rgba(110,231,247,.03); }
        .chat-info-label { font-size:.72rem; color:var(--muted); }
        .chat-clear-btn { background:transparent; border:1px solid var(--border); color:var(--muted); font-family:'DM Sans',sans-serif; font-size:.7rem; padding:4px 10px; border-radius:14px; cursor:pointer; transition:all .2s; }
        .chat-clear-btn:hover { color:var(--exercise); border-color:rgba(249,123,110,.4); }

        /* EXPORT */
        .export-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:8px; }
        .export-btn { background:var(--surface2); border:1px solid var(--border); border-radius:10px; padding:14px 10px; display:flex; flex-direction:column; align-items:center; gap:4px; cursor:pointer; transition:all .2s; color:var(--text); font-family:'DM Sans',sans-serif; }
        .export-btn:hover:not(:disabled) { border-color:var(--accent); transform:translateY(-1px); }
        .export-btn:disabled { opacity:.4; cursor:not-allowed; }

        /* SETTINGS */
        .settings-tabs { display:flex; border-bottom:1px solid var(--border); }
        .settings-tab { flex:1; padding:11px 6px; background:transparent; border:none; color:var(--muted); font-family:'DM Sans',sans-serif; font-size:.78rem; font-weight:500; cursor:pointer; transition:all .2s; border-bottom:2px solid transparent; margin-bottom:-1px; }
        .settings-tab.active { color:var(--accent); border-bottom-color:var(--accent); }
        .settings-tab:hover:not(.active) { color:var(--text); }
        .settings-body { padding:18px; }

        /* DATA TAB */
        .data-stats { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:18px; }
        .data-stat { background:var(--surface2); border:1px solid var(--border); border-radius:10px; padding:14px; text-align:center; }
        .data-stat-num { display:block; font-family:'DM Serif Display',serif; font-size:1.6rem; color:var(--accent); line-height:1; margin-bottom:4px; }
        .data-stat-lbl { display:block; font-size:.7rem; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
        .data-action { display:flex; align-items:center; gap:12px; padding:14px; background:var(--surface2); border:1px solid var(--border); border-radius:10px; margin-bottom:10px; }
        .data-action.danger { border-color:rgba(249,123,110,.2); background:rgba(249,123,110,.04); }
        .data-action > div:first-child { flex:1; }
        .data-action-title { font-size:.88rem; font-weight:500; color:var(--text); margin-bottom:3px; }
        .data-action-desc { font-size:.75rem; color:var(--muted); line-height:1.5; }
        .export-icon { font-size:1.3rem; }
        .export-name { font-size:.84rem; font-weight:500; }
        .export-count { font-size:.68rem; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
        .coach-tab { flex:1; padding:11px; background:transparent; border:none; color:var(--muted); font-family:'DM Sans',sans-serif; font-size:.82rem; font-weight:500; cursor:pointer; transition:all .2s; border-bottom:2px solid transparent; margin-bottom:-1px; }
        .coach-tab.active { color:var(--accent); border-bottom-color:var(--accent); }
        .coach-tab:hover:not(.active) { color:var(--text); }

        /* CHAT */
        .coach-chat-wrap { display:flex; flex-direction:column; }
        .coach-messages { padding:16px 16px 8px; display:flex; flex-direction:column; gap:12px; max-height:380px; overflow-y:auto; scroll-behavior:smooth; }
        .coach-messages::-webkit-scrollbar { width:3px; }
        .coach-messages::-webkit-scrollbar-thumb { background:var(--border); border-radius:2px; }
        .coach-msg { display:flex; gap:10px; align-items:flex-start; }
        .coach-msg.user { flex-direction:row-reverse; }
        .coach-avatar { width:28px; height:28px; border-radius:8px; background:linear-gradient(135deg,rgba(110,231,247,.15),rgba(165,243,180,.15)); border:1px solid rgba(110,231,247,.25); display:flex; align-items:center; justify-content:center; font-size:.75rem; color:var(--accent); flex-shrink:0; margin-top:2px; }
        .coach-bubble { max-width:82%; background:var(--surface2); border:1px solid var(--border); border-radius:12px; padding:10px 13px; font-size:.84rem; line-height:1.55; color:var(--text); }
        .coach-msg.user .coach-bubble { background:rgba(110,231,247,.1); border-color:rgba(110,231,247,.2); color:var(--text); border-radius:12px 12px 4px 12px; }
        .coach-msg.assistant .coach-bubble { border-radius:4px 12px 12px 12px; }
        .coach-typing { display:flex; gap:5px; align-items:center; padding:12px 14px; }
        .coach-typing span { width:6px; height:6px; background:var(--muted); border-radius:50%; animation:typingBounce .9s infinite; }
        .coach-typing span:nth-child(2) { animation-delay:.15s; }
        .coach-typing span:nth-child(3) { animation-delay:.3s; }
        @keyframes typingBounce { 0%,60%,100% { transform:translateY(0); } 30% { transform:translateY(-5px); } }
        .coach-suggestions { padding:4px 16px 12px; display:flex; flex-wrap:wrap; gap:6px; }
        .coach-suggestion { background:var(--surface2); border:1px solid var(--border); border-radius:20px; padding:6px 12px; font-family:'DM Sans',sans-serif; font-size:.75rem; color:var(--muted); cursor:pointer; transition:all .2s; white-space:nowrap; }
        .coach-suggestion:hover { color:var(--accent); border-color:rgba(110,231,247,.3); background:rgba(110,231,247,.06); }
        .coach-input-row { display:flex; gap:8px; padding:10px 14px 16px; border-top:1px solid var(--border); }
        .coach-input { flex:1; background:var(--surface2); border:1px solid var(--border); border-radius:10px; color:var(--text); font-family:'DM Sans',sans-serif; font-size:.88rem; padding:10px 14px; outline:none; transition:border-color .2s; }
        .coach-input:focus { border-color:var(--accent); }
        .coach-input::placeholder { color:var(--muted); }
        .coach-send { width:38px; height:38px; border-radius:10px; background:linear-gradient(135deg,#6ee7f7,#4db8cc); border:none; color:#0a1214; font-size:1rem; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:opacity .2s; align-self:flex-end; }
        .coach-send:disabled { opacity:.4; cursor:not-allowed; }
        .coach-send:hover:not(:disabled) { opacity:.85; }

        /* AI COACH */
        .coach-results { display:flex; flex-direction:column; gap:12px; margin-top:16px; }
        .overall-score-card { background:var(--surface2); border:1px solid var(--border); border-radius:12px; padding:18px; display:flex; align-items:center; gap:18px; }
        .score-ring { position:relative; width:72px; height:72px; flex-shrink:0; }
        .score-ring svg { width:72px; height:72px; }
        .score-number { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-family:'DM Serif Display',serif; font-size:1.4rem; color:var(--text); }
        .score-number span { font-family:'DM Sans',sans-serif; font-size:.6rem; color:var(--muted); margin-left:1px; }
        .score-label { font-size:.7rem; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-bottom:5px; }
        .score-summary { font-size:.85rem; color:var(--text); line-height:1.6; }
        .priority-card { background:rgba(110,231,247,.06); border:1px solid rgba(110,231,247,.2); border-radius:10px; padding:14px 16px; }
        .priority-label { font-size:.7rem; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:.08em; margin-bottom:7px; }
        .priority-text { font-size:.88rem; color:var(--text); line-height:1.6; font-weight:500; }
        .coach-section { border-radius:10px; padding:16px; }
        .coach-section-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
        .coach-section-title { font-family:'DM Serif Display',serif; font-size:1rem; color:var(--text); }
        .coach-insight { font-size:.83rem; color:var(--muted); line-height:1.6; margin-bottom:10px; font-style:italic; }
        .coach-tips { display:flex; flex-direction:column; gap:7px; }
        .coach-tip { display:flex; gap:9px; font-size:.83rem; color:var(--text); line-height:1.5; }

        /* GOALS MACROS */
        .macro-bar { height:8px; border-radius:4px; overflow:hidden; display:flex; gap:2px; background:var(--surface2); margin-bottom:8px; }
        .macro-bar-seg { height:100%; transition:width .4s; }
        .mprot { background:#c4b5fd; border-radius:4px 0 0 4px; }
        .mcarb { background:#f9e27e; }
        .mfat { background:#f97b6e; border-radius:0 4px 4px 0; }
        .macro-legend { display:flex; gap:12px; font-size:.73rem; color:var(--muted); align-items:center; }
        .ldot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:3px; }
        .mprot-d { background:#c4b5fd; } .mcarb-d { background:#f9e27e; } .mfat-d { background:#f97b6e; }
      `}</style>

      <div className="app">
        <header className="app-header"><h1>FitLog</h1><p>Your personal fitness journal</p></header>
        <nav className="tabs">
          {TABS.map(tab => (
            <button key={tab} className={`tab-btn ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
              <span>{icons[tab]}</span>{tab}
            </button>
          ))}
        </nav>

        <div className="tab-content">
          {activeTab === "Dashboard" && <Dashboard data={data} goals={goals} onSaveGoals={setGoals} onClearAll={clearAllData} onImport={importData} />}

          {activeTab === "Sleep" && (
            <>
              <SleepForm onAdd={addEntry("sleep")} />
              <div className="list-header"><h3 className="section-title" style={{ margin: 0 }}>Sleep Log</h3><span className="entry-count">{data.sleep.length} entries</span></div>
              <div className="log-list">
                {data.sleep.length === 0 && <div className="empty-msg">No sleep logs yet.</div>}
                {data.sleep.map(item => <LogItem key={item.id} item={item} type="sleep" onDelete={deleteEntry("sleep")} />)}
              </div>
            </>
          )}

          {activeTab === "Diet" && (
            <>
              <DietForm onAdd={addEntry("diet")} />
              <div className="list-header"><h3 className="section-title" style={{ margin: 0 }}>Meal Log</h3><span className="entry-count">{data.diet.length} entries</span></div>
              <div className="log-list">
                {data.diet.length === 0 && <div className="empty-msg">No meals logged yet.</div>}
                {data.diet.map(item => <LogItem key={item.id} item={item} type="diet" onDelete={deleteEntry("diet")} />)}
              </div>
            </>
          )}

          {activeTab === "Exercise" && <ExerciseTab entries={data.exercise} onAdd={addEntry("exercise")} onDelete={deleteEntry("exercise")} />}

          {activeTab === "Sports" && (
            <>
              <SportsForm onAdd={addEntry("sports")} />
              <div className="list-header"><h3 className="section-title" style={{ margin: 0 }}>Sports Log</h3><span className="entry-count">{data.sports.length} entries</span></div>
              <div className="log-list">
                {data.sports.length === 0 && <div className="empty-msg">No sports logged yet.</div>}
                {data.sports.map(item => <LogItem key={item.id} item={item} type="sports" onDelete={deleteEntry("sports")} />)}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
