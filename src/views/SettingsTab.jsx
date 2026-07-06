import { useState, useEffect, useRef } from "react";
import { Card, toast, useConfirm } from "../components/primitives";
import { defaultProfile, defaultStrategy, fitnessGoals, MODELS, loadModelPref, saveModelPref } from "../config";
import { getTodayStr } from "../lib/dates";
import { haptic, SFX, soundEnabled, setSoundPref } from "../lib/fx";
import { STORAGE_KEY } from "../lib/keys";

// ===== extracted body =====
// ─── SETTINGS TAB ─────────────────────────────────────────────────────────────
export function SettingsTab({ data, goals, onSaveGoals, onClearAll, onImport, session, onSignOut, initialSection = "goals" }) {
  const [section, setSection] = useState(initialSection);

  return (
    <div className="stack">
      <div className="subtabs">
        <button className={`subtab ${section === "goals" ? "active" : ""}`} onClick={() => setSection("goals")}>⊙ Goals</button>
        <button className={`subtab ${section === "export" ? "active" : ""}`} onClick={() => setSection("export")}>⬇ Export</button>
        <button className={`subtab ${section === "data" ? "active" : ""}`} onClick={() => setSection("data")}>⌗ Data</button>
      </div>
      {section === "goals" && <><GoalsSettings goals={goals} onSave={onSaveGoals} /><ProfileSettings goals={goals} onSave={onSaveGoals} /><StrategySettings goals={goals} onSave={onSaveGoals} /><AIModelSettings /><SoundSettings /></>}
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

function SoundSettings() {
  const [on, setOn] = useState(soundEnabled());
  function toggle() {
    const next = !on;
    setOn(next);
    setSoundPref(next);
    if (next) { SFX.success(); } // play a sample when turning on
    haptic(12);
  }
  return (
    <Card title="Sound effects" sub="Audio feedback when you log, hit a PR, and more">
      <div className="sound-row">
        <div className="sound-info">
          <span className="sound-state">{on ? "🔊 On" : "🔇 Off"}</span>
          <span className="muted small">Synthesized in-app · works offline</span>
        </div>
        <button className={`toggle-switch ${on ? "on" : ""}`} onClick={toggle} role="switch" aria-checked={on}>
          <span className="toggle-knob" />
        </button>
      </div>
      {on && (
        <div className="sound-samples">
          <button className="sample-btn" onClick={() => SFX.log()}>Log</button>
          <button className="sample-btn" onClick={() => SFX.water()}>Water</button>
          <button className="sample-btn" onClick={() => SFX.pr()}>PR 🏆</button>
          <button className="sample-btn" onClick={() => SFX.success()}>Done</button>
        </div>
      )}
    </Card>
  );
}

function ProfileSettings({ goals, onSave }) {
  const initial = goals.profile || {};
  const [p, setP] = useState({ ...defaultProfile, ...initial });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => setP(prev => ({ ...prev, [k]: v }));
  function save() {
    onSave({ ...goals, profile: p });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
    haptic(12);
  }
  // Detect changes from saved version
  const changed = JSON.stringify({ ...defaultProfile, ...initial }) !== JSON.stringify(p);
  return (
    <Card title="About me" sub="Tell your coach who you are — informs every AI response">
      <div className="field-grid three">
        <label>Sex
          <select value={p.sex} onChange={e => set("sex", e.target.value)}>
            <option value="">—</option><option>Male</option><option>Female</option><option>Other</option>
          </select>
        </label>
        <label>Age<input type="number" value={p.age} onChange={e => set("age", e.target.value)} placeholder="e.g. 25" /></label>
        <label>Height (cm)<input type="number" value={p.heightCm} onChange={e => set("heightCm", e.target.value)} placeholder="e.g. 178" /></label>
      </div>
      <div className="field-grid">
        <label>Weight (kg)<input type="number" value={p.weightKg} onChange={e => set("weightKg", e.target.value)} placeholder="e.g. 75" /></label>
        <label>Training experience
          <select value={p.trainingExp} onChange={e => set("trainingExp", e.target.value)}>
            <option value="">—</option>
            <option value="beginner">Beginner (&lt; 1 year)</option>
            <option value="intermediate">Intermediate (1-3 years)</option>
            <option value="advanced">Advanced (3+ years)</option>
          </select>
        </label>
      </div>
      <label>Lifting background <span className="muted small" style={{ fontWeight: 400 }}>(historical PRs, years training, lifetime context — not your current strategy)</span>
        <textarea value={p.liftingBackground} onChange={e => set("liftingBackground", e.target.value)} rows={5}
          placeholder={"e.g. 4 years lifting, big-3 PRs: Bench 100kg, Squat 130kg, Deadlift 135kg. Strong on lower body. OHP deprioritized due to shoulder."} />
      </label>
      <label>Equipment access
        <select value={p.equipment} onChange={e => set("equipment", e.target.value)}>
          <option value="">—</option>
          <option value="full gym">Full gym</option>
          <option value="home gym (full)">Home gym (barbell, rack, plates)</option>
          <option value="home basic (dumbbells)">Home basic (dumbbells, bands)</option>
          <option value="bodyweight only">Bodyweight only</option>
        </select>
      </label>
      <label>Injuries or limitations (the AI will avoid suggesting things that conflict)
        <textarea value={p.injuries} onChange={e => set("injuries", e.target.value)} rows={2}
          placeholder="e.g. left shoulder impingement, knee gives out on heavy squats" />
      </label>
      <label>Food allergies / dietary restrictions
        <textarea value={p.allergies} onChange={e => set("allergies", e.target.value)} rows={2}
          placeholder="e.g. lactose intolerant, no shellfish, vegetarian" />
      </label>
      <label>Preferences (the AI will respect these)
        <textarea value={p.preferences} onChange={e => set("preferences", e.target.value)} rows={2}
          placeholder="e.g. I don't like running, I train at 6am, I prefer compound lifts" />
      </label>
      <label>Current life context (what's going on right now)
        <textarea value={p.lifeContext} onChange={e => set("lifeContext", e.target.value)} rows={2}
          placeholder="e.g. stressful work month, sister's wedding in 8 weeks, just moved" />
      </label>
      <button className="btn full" onClick={save} disabled={!changed && !saved}>
        {saved ? "✓ Profile saved" : "Save profile"}
      </button>
    </Card>
  );
}

function StrategySettings({ goals, onSave }) {
  const initial = goals.strategy || {};
  const [s, setS] = useState({ ...defaultStrategy, ...initial });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => setS(prev => ({ ...prev, [k]: v }));
  function save() {
    onSave({ ...goals, strategy: s });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
    haptic(12);
  }
  const changed = JSON.stringify({ ...defaultStrategy, ...initial }) !== JSON.stringify(s);

  // Compute current block week if applicable
  let blockWeek = null;
  if (s.blockStarted && s.blockWeeks) {
    const startMs = new Date(s.blockStarted + "T00:00:00").getTime();
    blockWeek = Math.max(1, Math.floor((Date.now() - startMs) / (7 * 86400000)) + 1);
  }
  return (
    <Card title="Current strategy" sub="What you're building toward right now">
      <div className="field-grid">
        <label>Phase
          <select value={s.phase} onChange={e => set("phase", e.target.value)}>
            <option value="">—</option>
            <option value="bulk">Bulk (gain muscle)</option>
            <option value="cut">Cut (lose fat)</option>
            <option value="maintenance">Maintenance</option>
            <option value="recomp">Recomp</option>
            <option value="performance">Performance (sport-focused)</option>
          </select>
        </label>
        <label>Focus
          <select value={s.focus} onChange={e => set("focus", e.target.value)}>
            <option value="">—</option>
            <option value="strength">Strength</option>
            <option value="hypertrophy">Hypertrophy</option>
            <option value="conditioning">Conditioning</option>
            <option value="fat loss">Fat loss</option>
            <option value="general">General</option>
          </select>
        </label>
      </div>
      <div className="field-grid">
        <label>Block started<input type="date" value={s.blockStarted} onChange={e => set("blockStarted", e.target.value)} /></label>
        <label>Block length (weeks)<input type="number" value={s.blockWeeks} onChange={e => set("blockWeeks", e.target.value)} placeholder="e.g. 6" /></label>
      </div>
      {blockWeek && s.blockWeeks && (
        <p className="muted small" style={{ marginTop: -6, marginBottom: 12 }}>
          You're in <strong style={{ color: "var(--accent)" }}>week {blockWeek} of {s.blockWeeks}</strong>
        </p>
      )}
      <label>Strategy notes
        <textarea value={s.notes} onChange={e => set("notes", e.target.value)} rows={3}
          placeholder="e.g. focusing on overhead press progression, eating in slight surplus, recovering from last month's volume spike" />
      </label>
      <button className="btn full" onClick={save} disabled={!changed && !saved}>
        {saved ? "✓ Strategy saved" : "Save strategy"}
      </button>
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

      <div className="divider" />
      <label className="toggle-row">
        <div className="toggle-text">
          <div className="toggle-title">Biological day</div>
          <div className="toggle-sub">When enabled, calories and meals are grouped by your average sleep schedule instead of midnight.</div>
        </div>
        <input type="checkbox" checked={form.nutrition?.biologicalDay !== false} onChange={e => { const next = { ...form, nutrition: { ...form.nutrition, biologicalDay: e.target.checked } }; setForm(next); onSave(next); }} />
      </label>

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
  const dlDiet = () => dl(`fitlog-diet-${t}.csv`, csv(data.diet, ["date","time","meal","food","calories","protein","carbs","fat","notes"]));
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

export default SettingsTab;
