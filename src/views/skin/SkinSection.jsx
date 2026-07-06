import { useState, useEffect, useRef, useMemo } from "react";
import { fileToResizedBase64, callClaude } from "../../api/client";
import { Card, Empty, toast } from "../../components/primitives";
import { RecentList } from "../../components/RecentList";
import { dayGlycemicLoad } from "../../engines/glycemic";
import { computeSkin, detectRoutineConflicts } from "../../engines/skin";
import { sleepTST, estimateSleepNeed } from "../../engines/sleep";
import { localDateStr, getTodayStr, formatShortDate, daysAgo } from "../../lib/dates";
import { haptic } from "../../lib/fx";

// ===== extracted body =====
// ─── SKIN INTELLIGENCE SECTION ──────────────────────────────────────────────
const SKIN_CONDITION = [{ v: 1, l: "Poor" }, { v: 2, l: "Fair" }, { v: 3, l: "OK" }, { v: 4, l: "Good" }, { v: 5, l: "Great" }];
const SKIN_PHOTO_KEY = "fitlog_skin_photos"; // local-only, never synced to the cloud blob (face photos are sensitive)

function SkinLogForm({ onAdd, recent }) {
  const [form, setForm] = useState({ date: getTodayStr(), condition: 4, breakouts: "", concern: "", notes: "" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  function save() {
    onAdd({ date: form.date, condition: form.condition, breakouts: form.breakouts === "" ? 0 : Math.max(0, parseInt(form.breakouts) || 0), concern: form.concern.trim(), notes: form.notes.trim(), id: Date.now() });
    toast("✦ Skin logged");
    setForm(f => ({ ...f, breakouts: "", notes: "" }));
  }
  return (
    <>
      <Card title="Log skin" action={<input type="date" className="sleep-date" value={form.date} onChange={e => set("date", e.target.value)} />}>
        <div className="sleep-field-label">How's your skin today?</div>
        <div className="sleep-q-chips">
          {SKIN_CONDITION.map(c => (
            <button key={c.v} className={`sleep-q-chip ${form.condition === c.v ? "on" : ""}`} onClick={() => { set("condition", c.v); haptic(8); }}>{c.l}</button>
          ))}
        </div>
        <div className="field-grid" style={{ marginTop: 14 }}>
          <label>Active breakouts<input type="number" inputMode="numeric" value={form.breakouts} onChange={e => set("breakouts", e.target.value)} placeholder="e.g. 2" /></label>
          <label>Main concern<input type="text" value={form.concern} onChange={e => set("concern", e.target.value)} placeholder="jawline, redness…" /></label>
        </div>
        <label>Notes<textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Anything notable — new product, flare, period…" rows={2} /></label>
        <button className="btn full" onClick={save}>Save skin log</button>
      </Card>
      <RecentList entries={recent} render={s => <><span className="ra-main">{(SKIN_CONDITION.find(c => c.v === s.condition) || {}).l || s.condition}{s.breakouts ? ` · ${s.breakouts} breakout${s.breakouts > 1 ? "s" : ""}` : ""}</span><span className="ra-date">{formatShortDate(s.date)}</span></>} />
    </>
  );
}

function SkinRoutineCard({ goals, onSaveGoals, conflicts, addEntry }) {
  const routine = goals.skinRoutine || { am: [], pm: [] };
  const [adding, setAdding] = useState(null); // "am" | "pm" | null
  const [val, setVal] = useState("");
  const logChange = (slot, action, product) => { if (addEntry) addEntry("skinRoutineChanges")({ id: Date.now(), date: getTodayStr(), slot, action, product }); };
  function addStep(slot) {
    if (!val.trim()) return;
    const next = { ...routine, [slot]: [...(routine[slot] || []), { product: val.trim() }] };
    onSaveGoals({ ...goals, skinRoutine: next });
    logChange(slot, "added", val.trim());
    setVal(""); setAdding(null); haptic(8);
  }
  function removeStep(slot, i) {
    const removed = routine[slot][i];
    const next = { ...routine, [slot]: routine[slot].filter((_, idx) => idx !== i) };
    onSaveGoals({ ...goals, skinRoutine: next });
    if (removed) logChange(slot, "removed", removed.product);
  }
  const Col = ({ slot, label }) => (
    <div className="skin-routine-col">
      <div className="skin-routine-head">{label}</div>
      {(routine[slot] || []).map((s, i) => (
        <div key={i} className="skin-routine-step"><span>{s.product}</span><button className="skin-x" onClick={() => removeStep(slot, i)}>×</button></div>
      ))}
      {adding === slot ? (
        <div className="row" style={{ marginTop: 6 }}>
          <input autoFocus value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === "Enter" && addStep(slot)} placeholder="Product name" />
          <button className="btn" onClick={() => addStep(slot)}>Add</button>
        </div>
      ) : (
        <button className="skin-add-step" onClick={() => { setAdding(slot); setVal(""); }}>+ Add product</button>
      )}
    </div>
  );
  return (
    <Card title="Routine" sub="Tag products so SkinLog can flag conflicts">
      <div className="skin-routine-grid"><Col slot="am" label="☀ AM" /><Col slot="pm" label="☾ PM" /></div>
      {conflicts.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {conflicts.map((c, i) => <div key={i} className="sleep-flag">⚠ {c}</div>)}
        </div>
      )}
      {conflicts.length === 0 && (routine.am.length + routine.pm.length > 0) && <p className="muted small" style={{ marginTop: 10 }}>No conflicts detected in your current actives.</p>}
    </Card>
  );
}

function SkinExperimentCard({ data, goals, onSaveGoals }) {
  const exp = goals.skinExperiment;
  const skin = useMemo(() => computeSkin(data, goals), [data, goals]);
  function start(name) {
    onSaveGoals({ ...goals, skinExperiment: { name: name || "New product", startDate: getTodayStr(), weeks: 8, baseline: skin?.avgCond14 ?? null } });
    toast("🧪 Skin experiment started");
  }
  function end() { onSaveGoals({ ...goals, skinExperiment: null }); toast("Experiment ended"); }
  const [name, setName] = useState("");
  if (!exp) {
    return (
      <Card title="🧪 Run a skin experiment" sub="One variable, 8–12 weeks — skin is slow, so isolate the change">
        <div className="row">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="What are you testing? (e.g. azelaic acid)" />
          <button className="btn" onClick={() => start(name)}>Start</button>
        </div>
        <p className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>SkinLog snapshots your current skin rating as a baseline, tracks physiology alongside (so a win isn't just a good-sleep month), and tells you to hold everything else steady. Give it the full window — cell turnover is ~6–8 weeks.</p>
      </Card>
    );
  }
  const daysIn = Math.max(0, Math.round((Date.now() - new Date(exp.startDate + "T00:00:00").getTime()) / 86400000));
  const now = skin?.avgCond14 ?? null;
  const delta = (now != null && exp.baseline != null) ? +(now - exp.baseline).toFixed(1) : null;
  return (
    <Card title={`🧪 Testing: ${exp.name}`} sub={`Day ${daysIn} of ~${exp.weeks * 7} · hold everything else steady`}>
      <div className="rt-bar" style={{ margin: "4px 0 12px" }}><div className="rt-bar-fill" style={{ width: `${Math.min(100, (daysIn / (exp.weeks * 7)) * 100)}%` }} /></div>
      <div className="eb-grid">
        <div className="eb-cell"><span className="eb-l">Baseline</span><span className="eb-v">{exp.baseline ?? "—"}</span></div>
        <div className="eb-cell"><span className="eb-l">Now</span><span className="eb-v">{now ?? "—"}{delta != null ? <span className={delta >= 0 ? "good" : "bad"} style={{ fontSize: 12 }}> {delta >= 0 ? "+" : ""}{delta}</span> : ""}</span></div>
        <div className="eb-cell"><span className="eb-l">Weeks left</span><span className="eb-v">{Math.max(0, exp.weeks - Math.floor(daysIn / 7))}</span></div>
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>{daysIn < exp.weeks * 7 - 14 ? "Too early to judge — keep going and don't change anything else." : "Enough time has passed to read the result."}</p>
      <button className="btn-ghost full" style={{ marginTop: 8 }} onClick={end}>End experiment</button>
    </Card>
  );
}

function SkinResearchStore({ data, addEntry, deleteEntry }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", text: "", tags: "" });
  const research = (data.skinResearch || []).slice().reverse();
  function save() {
    if (!form.title.trim() && !form.text.trim()) return;
    addEntry("skinResearch")({ id: Date.now(), date: getTodayStr(), title: form.title.trim(), text: form.text.trim(), tags: form.tags.split(",").map(t => t.trim()).filter(Boolean) });
    setForm({ title: "", text: "", tags: "" }); setOpen(false); toast("✦ Research saved");
  }
  return (
    <Card title="Research notes" sub="Paste studies & findings — the coach reads these">
      {open ? (
        <div className="stack">
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Title (e.g. Azelaic acid for PIH)" />
          <textarea value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} placeholder="Key finding / notes…" rows={3} />
          <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="tags, comma separated (acne, retinoid…)" />
          <div className="row"><button className="btn-ghost flex" onClick={() => setOpen(false)}>Cancel</button><button className="btn flex" onClick={save}>Save</button></div>
        </div>
      ) : (
        <button className="btn full" onClick={() => setOpen(true)}>+ Add research note</button>
      )}
      {research.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {research.map(r => (
            <div key={r.id} className="skin-research-item">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: ".9rem" }}>{r.title || "Untitled"}</div>
                {r.text && <div className="muted small" style={{ marginTop: 2, lineHeight: 1.4 }}>{r.text.length > 140 ? r.text.slice(0, 140) + "…" : r.text}</div>}
                {r.tags?.length > 0 && <div className="skin-tags">{r.tags.map((t, i) => <span key={i} className="skin-tag">{t}</span>)}</div>}
              </div>
              <button className="skin-x" onClick={() => deleteEntry("skinResearch")(r.id)}>×</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SkinPhotos() {
  const [photos, setPhotos] = useState([]);
  const [compare, setCompare] = useState(false);
  useEffect(() => {
    try { const raw = localStorage.getItem(SKIN_PHOTO_KEY); if (raw) setPhotos(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  function persist(next) { setPhotos(next); try { localStorage.setItem(SKIN_PHOTO_KEY, JSON.stringify(next)); } catch { toast("Couldn't save photo (storage full)"); } }
  async function onFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const { base64, mediaType } = await fileToResizedBase64(file, 900, 0.8);
      const next = [...photos, { id: Date.now(), date: getTodayStr(), url: `data:${mediaType};base64,${base64}` }];
      persist(next); toast("✦ Photo saved (stays on this device)");
    } catch { toast("Couldn't process that image"); }
    e.target.value = "";
  }
  function remove(id) { persist(photos.filter(p => p.id !== id)); }
  const sorted = [...photos].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Card title="Progress photos" sub="Side-by-side over time — stays on this device only" action={sorted.length >= 2 ? <button className="link-btn" onClick={() => setCompare(c => !c)}>{compare ? "Grid" : "Compare"}</button> : null}>
      {compare && sorted.length >= 2 ? (
        <div className="skin-compare">
          <div className="skin-compare-cell"><img src={sorted[0].url} alt="earliest" /><span className="muted small">{formatShortDate(sorted[0].date)}</span></div>
          <div className="skin-compare-cell"><img src={sorted[sorted.length - 1].url} alt="latest" /><span className="muted small">{formatShortDate(sorted[sorted.length - 1].date)}</span></div>
        </div>
      ) : (
        <div className="skin-photo-grid">
          {sorted.map(p => (
            <div key={p.id} className="skin-photo">
              <img src={p.url} alt={p.date} />
              <span className="skin-photo-date">{formatShortDate(p.date)}</span>
              <button className="skin-photo-x" onClick={() => remove(p.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      <label className="btn full" style={{ marginTop: 12, textAlign: "center", cursor: "pointer" }}>
        + Add photo
        <input type="file" accept="image/*" capture="user" onChange={onFile} style={{ display: "none" }} />
      </label>
      <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>For useful comparisons: same spot, same light, no makeup, same time of day. SkinLog shows the photos honestly — it won't invent "pore counts" or a skin score.</p>
    </Card>
  );
}

const SKIN_PROCEDURES = ["Microneedling", "Subcision", "PRP", "Chemical peel", "Laser", "Botox", "Filler", "Facial", "Extraction", "LED therapy", "Other"];

// Educational recovery/prep guidance per procedure. Defers specifics to the provider.
const PROC_PLAN = {
  Microneedling: { down: "3–5 days", steps: [
    { d: -14, t: "Pause retinoids & strong actives (if your provider agrees)", why: "lowers irritation on the day" },
    { d: -3, t: "Stop exfoliating acids and scrubs; avoid sunburn and tanning", why: "compromised skin reacts worse" },
    { d: -1, t: "Hydrate well; plan to arrive with clean, bare skin", why: "better tolerance, lower infection risk" },
    { d: 0, t: "Gentle cleanse, hyaluronic + bland moisturizer; no makeup 24h", why: "the barrier is briefly open" },
    { d: 1, t: "Expect redness/flushing; SPF even indoors; no actives", why: "skin is raw and photosensitive" },
    { d: 3, t: "Light flaking is normal — keep it simple, don't pick", why: "picking causes marks/scarring" },
    { d: 7, t: "Reintroduce actives slowly if calm (confirm with provider)", why: "barrier has recovered" },
  ] },
  Subcision: { down: "1–2 weeks", medical: true, steps: [
    { d: -7, t: "Ask your provider about pausing blood thinners / alcohol", why: "reduces bruising — medical, provider decides" },
    { d: -1, t: "Arrive with clean skin and clear your calendar", why: "visible bruising and swelling are expected" },
    { d: 0, t: "Cold compress as directed; gentle care only", why: "controls swelling early" },
    { d: 2, t: "Bruising/swelling peaks; don't massage unless told to", why: "can disrupt healing tissue" },
    { d: 7, t: "Most bruising fading; keep actives off the area", why: "tissue is still remodeling" },
    { d: 14, t: "Firmness/lumps can persist — attend your provider review", why: "remodeling takes weeks" },
  ] },
  PRP: { down: "3–5 days", steps: [
    { d: -3, t: "Stay hydrated; pause strong actives if advised", why: "calmer baseline skin" },
    { d: 0, t: "Gentle care only; no makeup that day", why: "injection sites are fresh" },
    { d: 1, t: "Expect redness and mild swelling; SPF; skip workouts 24–48h", why: "limits flushing/swelling" },
    { d: 3, t: "Resume gentle routine; still no harsh actives", why: "skin settling" },
    { d: 5, t: "Reintroduce actives slowly if calm", why: "recovered enough" },
  ] },
  "Chemical peel": { down: "3–7 days", steps: [
    { d: -7, t: "Stop retinoids/acids per your provider; no waxing", why: "avoids over-exfoliation" },
    { d: -1, t: "No sunburn; arrive bare-skinned", why: "peels need intact skin" },
    { d: 0, t: "Follow neutralise/aftercare exactly; bland moisturizer", why: "depth-specific steps matter" },
    { d: 2, t: "Peeling/flaking begins — do NOT pick or pull", why: "picking scars and pigments" },
    { d: 5, t: "Keep moisturising; strict SPF", why: "new skin burns easily" },
    { d: 7, t: "Reintroduce actives once peeling fully stops", why: "barrier restored" },
  ] },
  Laser: { down: "5–7 days", steps: [
    { d: -14, t: "Strict sun avoidance; no self-tan; pause actives as advised", why: "tanned skin raises burn/pigment risk" },
    { d: -1, t: "Arrive clean, no makeup/products", why: "clear field for treatment" },
    { d: 0, t: "Cool compresses, bland moisturizer; follow aftercare", why: "skin is heat-stressed" },
    { d: 2, t: "Redness/swelling, possible darkening; SPF is non-negotiable", why: "photosensitive and fragile" },
    { d: 5, t: "Light peeling/sloughing may happen — let it shed", why: "picking marks the skin" },
    { d: 14, t: "Reintroduce actives slowly; keep sun protection up for weeks", why: "pigment risk lingers" },
  ] },
  Botox: { down: "~1 day", steps: [
    { d: 0, t: "Stay upright 4h; no exercise or rubbing the area 24h", why: "keeps product where intended" },
    { d: 1, t: "Normal routine; avoid facials/massage on the area a few days", why: "avoids migration" },
    { d: 4, t: "Effect appears over 3–7 days; review if uneven at 2 weeks", why: "it takes time to settle" },
  ] },
  Filler: { down: "2–5 days", steps: [
    { d: -3, t: "Ask about pausing alcohol/blood thinners", why: "less bruising — provider decides" },
    { d: 0, t: "Ice gently; no exercise/heat 24–48h; don't massage", why: "limits swelling and migration" },
    { d: 2, t: "Swelling/bruising peak then fade; avoid facials a couple weeks", why: "let it integrate" },
    { d: 14, t: "Final result; review with provider if needed", why: "swelling fully gone" },
  ] },
  Facial: { down: "~1 day", steps: [
    { d: 0, t: "Skip actives that night if extractions were done", why: "skin is briefly sensitised" },
    { d: 1, t: "Back to normal; SPF as always", why: "no real downtime" },
  ] },
  Extraction: { down: "1–2 days", steps: [
    { d: 0, t: "Spot-treat gently; don't squeeze more at home", why: "DIY squeezing scars" },
    { d: 1, t: "Marks fade; keep actives light 24h", why: "pores are open" },
  ] },
  "LED therapy": { down: "none", steps: [
    { d: 0, t: "No downtime — resume everything", why: "non-ablative" },
    { d: 1, t: "Consistency beats intensity — schedule regular sessions", why: "effects are cumulative" },
  ] },
  Other: { down: "varies", steps: [
    { d: -3, t: "Ask your provider what to pause beforehand", why: "every treatment differs" },
    { d: 0, t: "Follow the aftercare you were given exactly", why: "provider knows the specifics" },
    { d: 3, t: "Reintroduce actives once your provider clears you", why: "avoid irritating healing skin" },
  ] },
};

function ProcTimeline({ type, procDate }) {
  const plan = PROC_PLAN[type] || PROC_PLAN.Other;
  const today = getTodayStr();
  const base = new Date(procDate + "T00:00:00");
  const dayN = Math.round((new Date(today + "T00:00:00") - base) / 86400000);
  const fmt = off => { const dt = new Date(base.getTime() + off * 86400000); return `${dt.getMonth() + 1}/${dt.getDate()}`; };
  const nowIdx = plan.steps.findIndex(s => s.d >= dayN);
  return (
    <div className="proc-timeline" data-medical={plan.medical ? "1" : "0"}>
      <div className="proc-tl-head">Science-based plan · downtime {plan.down}</div>
      {plan.steps.map((s, i) => {
        const state = nowIdx === -1 ? "past" : i < nowIdx ? "past" : i === nowIdx ? "now" : "future";
        return (
          <div key={i} className={`proc-tl-row ${state}`}>
            <span className="proc-tl-when">{s.d === 0 ? "Day 0" : s.d < 0 ? `${s.d}d` : `+${s.d}d`}<small>{fmt(s.d)}</small></span>
            <div className="proc-tl-body"><div className="proc-tl-act">{s.t}</div><div className="muted small">{s.why}</div></div>
          </div>
        );
      })}
      <p className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>{plan.medical ? "This is a medical procedure — your provider's instructions override everything here." : "General, science-based aftercare — your provider's specific instructions always come first."} Nicotine slows healing; SPF protects every result.</p>
    </div>
  );
}

function SkinProceduresCard({ data, addEntry, deleteEntry }) {
  const [type, setType] = useState(null);
  const [form, setForm] = useState({ date: getTodayStr(), provider: "", notes: "" });
  const today = getTodayStr();
  const all = (data.skinProcedures || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const upcoming = all.filter(p => (p.date || "") > today).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const past = all.filter(p => (p.date || "") <= today);
  const recentDate = daysAgo(10);
  function save() {
    if (!type) return;
    addEntry("skinProcedures")({ id: Date.now(), date: form.date, type, provider: form.provider.trim(), notes: form.notes.trim() });
    setType(null); setForm({ date: getTodayStr(), provider: "", notes: "" }); toast("✦ Procedure saved");
  }
  return (
    <Card title="Procedures" sub="Log past treatments or plan ahead — pick a future date to plan">
      <div className="skin-proc-chips">
        {SKIN_PROCEDURES.map(p => <button key={p} className={`skin-proc-chip ${type === p ? "on" : ""}`} onClick={() => { setType(t => t === p ? null : p); haptic(8); }}>{p}</button>)}
      </div>
      {type && (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="field-grid">
            <label>Date (future = planned)<input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></label>
            <label>Provider / clinic<input value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} placeholder="optional" /></label>
          </div>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="What was done, settings if you know, how your skin reacted…" rows={2} />
          <button className="btn full" onClick={save}>Save {type}</button>
        </div>
      )}

      {upcoming.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="skin-section-h">Planned</div>
          {upcoming.map(p => (
            <div key={p.id} className="skin-proc-block">
              <div className="skin-proc-item">
                <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: ".9rem" }}>{p.type}{p.provider ? ` · ${p.provider}` : ""}</div><div className="muted small">{formatShortDate(p.date)} · in {Math.max(0, Math.round((new Date(p.date + "T00:00:00") - Date.now()) / 86400000))} days</div></div>
                <button className="skin-x" onClick={() => deleteEntry("skinProcedures")(p.id)}>×</button>
              </div>
              <ProcTimeline type={p.type} procDate={p.date} />
            </div>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="skin-section-h">Done</div>
          {past.map(p => (
            <div key={p.id} className="skin-proc-block">
              <div className="skin-proc-item">
                <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: ".9rem" }}>{p.type}{p.provider ? ` · ${p.provider}` : ""}</div><div className="muted small">{formatShortDate(p.date)}{p.notes ? ` — ${p.notes}` : ""}</div></div>
                <button className="skin-x" onClick={() => deleteEntry("skinProcedures")(p.id)}>×</button>
              </div>
              {p.date >= recentDate && <ProcTimeline type={p.type} procDate={p.date} />}
            </div>
          ))}
        </div>
      )}

      <p className="muted small" style={{ marginTop: 12, lineHeight: 1.45 }}>Recovery guidance is general and educational — it won't replace your provider's aftercare. Anything that looks off (signs of infection, lasting reactions) goes to your provider.</p>
    </Card>
  );
}

const SKIN_COACH_SYSTEM = `You are SkinLog's skin coach. You ONLY help with SKIN. The data below is skin-relevant only.

SCOPE — THIS IS A HARD BOUNDARY:
- You help with skin: condition, breakouts, skincare routine (AM/PM products), procedures, and the lifestyle factors that affect skin — sleep, nicotine, diet (dairy/sugar/glycemic load), hydration, and stress.
- You have NO data about and must NOT discuss: training, workouts, lifting, gym splits, sports, bodyweight, strength, fuelling, or macros for muscle. None of that is your job.
- If the user asks about any of that, do NOT answer it. Say one line like "That's outside what I track here — I'm just your skin coach" and steer back to skin.
- "Routine" ALWAYS means their SKINCARE routine (AM/PM products) — NEVER a workout or training split. If they ask you to "build a routine," build a SKINCARE routine from their products and skin needs.

YOUR EDGE: you can see how this person's sleep, nicotine, diet, hydration and stress move their skin — use those links. Lead with the highest-evidence lever for THIS person.

RULES:
- Be specific and personal — cite their actual numbers and logged patterns. No generic listicles.
- Frame correlations as personal patterns, not proven cause.
- Evidence order: not smoking + daily SPF (strong) > dairy/glycemic load, sleep, stress (moderate) > hydration/"detox" (weak — don't oversell water).
- Prefer one-variable experiments over changing everything at once. Skin is slow (~6–8 weeks) — set that expectation.
- PROCEDURES (microneedling, PRP, peels, lasers): you may EDUCATE — what it does, rough evidence, recovery/aftercare, how it interacts with their actives, and what to ask a provider. Do NOT prescribe protocols, depths or settings, or replace an in-person assessment. Send them to a dermatologist for the decision and anything medical (cystic/persistent acne, suspicious lesions, prescription actives).
- Keep replies tight: a short answer plus the one next action. No walls of text.`;

const SKIN_PROMPTS = ["Why am I breaking out?", "What's my biggest skin lever?", "Is microneedling worth it for me?", "Build me a simple skincare routine"];

// Skin-ONLY context. Deliberately excludes training, sports, fuel, weight, strength,
// macros and strategy — the coach can't leak what it never receives.
function buildSkinContext(data, goals) {
  const today = getTodayStr();
  const skin = computeSkin(data, goals);
  const L = [];
  if (skin) L.push(`SKIN CONDITION: 14-day avg ${skin.avgCond14 ?? "—"}/5, trend ${skin.condTrend == null ? "n/a" : skin.condTrend > 0.2 ? "improving" : skin.condTrend < -0.2 ? "worsening" : "steady"}, ${skinLogStreak(data.skin)}-day log streak, confidence ${skin.confidence}.${skin.breakouts14 != null ? ` ~${skin.breakouts14} breakouts/log.` : ""}`);
  else L.push("SKIN CONDITION: not enough logs yet for trends.");
  const recent = (data.skin || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 10);
  if (recent.length) L.push("Recent skin logs: " + recent.map(s => `${s.date} ${s.condition}/5${s.breakouts ? ` ${s.breakouts}br` : ""}${s.concern ? ` (${s.concern})` : ""}${s.notes ? ` "${s.notes}"` : ""}`).join(" | "));

  const lastSleep = (data.sleep || []).filter(s => s.date === today || s.date === daysAgo(1)).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  const slept = lastSleep ? sleepTST(lastSleep) : null;
  const need = estimateSleepNeed(data, goals).hours;
  const waterMl = (data.water || []).filter(w => w.date === today).reduce((a, w) => a + (w.ml || 0), 0);
  const nic = (data.nicotine || []).filter(n => n.date === today).length;
  const td = (data.diet || []).filter(d => d.date === today);
  const gl = dayGlycemicLoad(td);
  const dairy = td.some(d => DAIRY_LEVER_RE.test(`${d.name || ""} ${d.food || ""} ${d.notes || ""}`));
  const rl = (data.skinRoutineLogs || []).filter(l => l.date === today);
  const adh = skinRoutineAdherence(data);
  L.push(`TODAY'S SKIN LEVERS: sleep ${slept != null ? slept.toFixed(1) + "h" : "—"} (need ~${need}h); water ${(waterMl / 1000).toFixed(1)}L/${(((goals && goals.waterGoalMl) || 2500) / 1000)}L; nicotine ${nic === 0 ? "none" : nic + "x"}; diet ${gl.hasData ? gl.band + " glycemic load" : "unlogged"}${dairy ? " + dairy today" : ""}; routine done today: AM ${rl.some(l => l.slot === "am") ? "yes" : "no"}, PM ${rl.some(l => l.slot === "pm") ? "yes" : "no"}. Routine adherence 14d: AM ${adh.amPct}%, PM ${adh.pmPct}%.`);

  if (skin && skin.correlations && skin.correlations.length) L.push("SKIN CORRELATIONS (this person's patterns — correlation, not proof): " + skin.correlations.map(c => c.text).join(" | "));
  if (skin && skin.topLever) L.push("Biggest lever: " + skin.topLever.text);

  const r = (goals && goals.skinRoutine) || { am: [], pm: [] };
  L.push(`SKINCARE ROUTINE — AM: ${(r.am || []).map(s => s.product).join(", ") || "(empty)"} | PM: ${(r.pm || []).map(s => s.product).join(", ") || "(empty)"}.`);

  const intros = data.skinProductIntros || [], changes = data.skinRoutineChanges || [];
  if (intros.length || changes.length) L.push("PRODUCT HISTORY: " + [...intros.map(p => `introduced ${p.name} ${p.startDate}`), ...changes.map(c => `${c.action} ${c.product} (${c.slot}) ${c.date}`)].join("; "));

  const procs = data.skinProcedures || [];
  if (procs.length) {
    const up = procs.filter(p => (p.date || "") > today), past = procs.filter(p => (p.date || "") <= today);
    L.push("PROCEDURES: " + [...up.map(p => `PLANNED ${p.type} ${p.date}${p.notes ? ` (${p.notes})` : ""}`), ...past.map(p => `past ${p.type} ${p.date}`)].join("; "));
  }
  if (goals && goals.skinExperiment) { const e = goals.skinExperiment; L.push(`SKIN EXPERIMENT running: ${e.variable || e.name || "active"}${e.startDate || e.start ? ` since ${e.startDate || e.start}` : ""}.`); }
  if ((data.skinResearch || []).length) L.push("Saved skin research: " + (data.skinResearch || []).map(x => x.title).filter(Boolean).join("; "));

  const days = Array.from({ length: 14 }, (_, i) => daysAgo(i));
  const sleeps = (data.sleep || []).filter(s => days.includes(s.date)).map(s => sleepTST(s)).filter(x => x != null);
  const avgSleep = sleeps.length ? (sleeps.reduce((a, b) => a + b, 0) / sleeps.length).toFixed(1) : null;
  const nicDays = days.filter(d => (data.nicotine || []).some(n => n.date === d)).length;
  const dairyDays = days.filter(d => (data.diet || []).some(x => x.date === d && DAIRY_LEVER_RE.test(`${x.name || ""} ${x.food || ""} ${x.notes || ""}`))).length;
  L.push(`LIFESTYLE INPUTS THAT AFFECT SKIN (14d): avg sleep ${avgSleep ?? "?"}h; nicotine on ${nicDays}/14 days; dairy on ${dairyDays}/14 days.`);
  const moods = (data.journal || []).filter(j => days.includes(j.date) && (j.mood != null || j.stress != null));
  if (moods.length) L.push(`Mood/stress noted on ${moods.length}/14 days (stress can flare skin).`);

  return L.join("\n");
}

function SkinCoach({ data, goals, addEntry }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [concluding, setConcluding] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, loading]);
  async function ask(text) {
    const q = (text || input).trim(); if (!q || loading) return;
    const next = [...messages, { role: "user", content: q }];
    setMessages(next); setInput(""); setLoading(true);
    try {
      const system = SKIN_COACH_SYSTEM + "\n\n=== YOUR SKIN DATA (skin-relevant only) ===\n" + buildSkinContext(data, goals);
      const reply = await callClaude({ system, conversationMessages: next, maxTokens: 1100 });
      setMessages(m => [...m, { role: "assistant", content: reply || "I didn't catch that — try rephrasing?" }]);
    } catch {
      setMessages(m => [...m, { role: "assistant", content: "Couldn't reach the coach right now — check your connection and try again." }]);
    }
    setLoading(false);
  }
  async function conclude() {
    if (!messages.length || concluding || loading) return;
    setConcluding(true);
    try {
      const sys = "You turn a skin coaching chat into a short action plan. Output ONLY 2–5 concrete skin actions, one per line, each starting with '- ', each under ~16 words. Skin only — no training/diet-for-muscle. No preamble, headers, or bold.";
      const convo = messages.map(m => `${m.role === "user" ? "User" : "Coach"}: ${m.content}`).join("\n");
      const raw = await callClaude({ system: sys, conversationMessages: [{ role: "user", content: `Conversation:\n${convo}\n\nWrite the action plan.` }], maxTokens: 400 });
      let items = (raw || "").split("\n").map(l => l.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 5).map(text => ({ text, done: false }));
      if (!items.length) items = [{ text: (raw || "Reviewed skin plan with coach.").trim().slice(0, 160), done: false }];
      const summary = (messages.find(m => m.role === "user")?.content || "Skin coach session").slice(0, 80);
      addEntry("skinCoachPlans")({ id: Date.now(), date: getTodayStr(), summary, items, messages });
      setMessages([]); setInput("");
      toast("✦ Saved to your Plan");
    } catch {
      toast("Couldn't save — try again");
    }
    setConcluding(false);
  }
  return (
    <Card title="Ask your skin coach" sub="Skin only — reads your skin + sleep, nicotine, diet, hydration & stress">
      {messages.length === 0 ? (
        <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 10 }}>Ask anything about your skin. The coach reads only your skin-relevant patterns — your routine, condition, and the lifestyle factors that move skin. It won't touch your training.</p>
      ) : (
        <div className="skin-chat">
          {messages.map((m, i) => <div key={i} className={`skin-msg ${m.role === "user" ? "user" : "ai"}`}>{m.content}</div>)}
          {loading && <div className="skin-msg ai typing"><span /><span /><span /></div>}
          <div ref={endRef} />
        </div>
      )}
      {messages.length > 0 && (
        <button className="btn-ghost coach-conclude" onClick={conclude} disabled={concluding || loading}>{concluding ? "Saving…" : "✓ Conclude — save & add to Plan"}</button>
      )}
      <div className="skin-coach-chips">
        {SKIN_PROMPTS.map(p => <button key={p} className="skin-coach-chip" onClick={() => ask(p)} disabled={loading}>{p}</button>)}
      </div>
      <div className="skin-coach-row">
        <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }} placeholder="Ask about your skin…" rows={1} />
        <button className="btn" onClick={() => ask()} disabled={loading || !input.trim()}>{loading ? "…" : "Send"}</button>
      </div>
    </Card>
  );
}

// ─── SKIN TAB COMPONENTS ────────────────────────────────────────────────────
const PRODUCT_KINDS = [
  { k: "retinoid", label: "Retinoid" },
  { k: "acid", label: "Exfoliating acid" },
  { k: "vitc", label: "Vitamin C" },
  { k: "other", label: "Other active" },
];
const PRODUCT_RAMP = {
  retinoid: ["Patch test 48h behind the ear", "Weeks 1–2: 2 nights/week, pea-size, buffer with moisturizer", "Weeks 3–4: every other night if no irritation", "Week 5+: nightly as tolerated", "Never the same night as exfoliating acids; always AM SPF"],
  acid: ["Patch test 48h", "Weeks 1–2: 1–2×/week", "Weeks 3–4: alternate days if tolerated", "Don't stack with a retinoid the same night", "AM SPF is non-negotiable"],
  vitc: ["Patch test 48h", "Start every other morning", "Build to daily AM use", "Keep separate from benzoyl peroxide", "Store away from light and air"],
  other: ["Patch test 48h behind the ear", "Introduce just this one product at a time", "Start every other day, watch for irritation", "Give it 4–6 weeks before judging it"],
};

function skinRoutineAdherence(data) {
  const days = 14; let am = 0, pm = 0;
  for (let i = 0; i < days; i++) { const d = daysAgo(i); const l = (data.skinRoutineLogs || []).filter(x => x.date === d); if (l.some(x => x.slot === "am")) am++; if (l.some(x => x.slot === "pm")) pm++; }
  return { amPct: Math.round((am / days) * 100), pmPct: Math.round((pm / days) * 100) };
}
function skinLogStreak(entries) {
  const has = d => (entries || []).some(e => e.date === d);
  let s = 0; let i = has(getTodayStr()) ? 0 : 1;
  for (; i < 90; i++) { if (has(daysAgo(i))) s++; else break; }
  return s;
}

const DAIRY_LEVER_RE = /\b(milk|cheese|yogurt|yoghurt|dairy|whey|ice ?cream|latte|cappuccino)\b/i;
function SkinLevers({ data, goals }) {
  const today = getTodayStr();
  const lastSleep = (data.sleep || []).filter(s => s.date === today || s.date === daysAgo(1)).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  const need = estimateSleepNeed(data, goals).hours;
  const slept = lastSleep ? sleepTST(lastSleep) : null;
  const waterMl = (data.water || []).filter(w => w.date === today).reduce((a, w) => a + (w.ml || 0), 0);
  const waterGoal = (goals && goals.waterGoalMl) || 2500;
  const nic = (data.nicotine || []).filter(n => n.date === today).length;
  const todayDiet = (data.diet || []).filter(d => d.date === today);
  const gl = dayGlycemicLoad(todayDiet);
  const dairy = todayDiet.some(d => DAIRY_LEVER_RE.test(`${d.name || ""} ${d.food || ""} ${d.notes || ""}`));
  const rlogs = (data.skinRoutineLogs || []).filter(l => l.date === today);
  const amDone = rlogs.some(l => l.slot === "am"), pmDone = rlogs.some(l => l.slot === "pm");
  const routineN = (amDone ? 1 : 0) + (pmDone ? 1 : 0);
  const items = [
    { l: "Sleep", v: slept != null ? `${slept.toFixed(1)}h` : "—", warn: slept != null && slept < need - 1, ok: slept == null || slept >= need - 0.5 },
    { l: "Water", v: waterMl ? `${(waterMl / 1000).toFixed(1)}L` : "—", warn: false, ok: waterMl >= waterGoal * 0.7 },
    { l: "Nicotine", v: nic === 0 ? "none" : `${nic}×`, warn: nic > 0, ok: nic === 0 },
    { l: "Diet", v: gl.hasData ? (gl.band + (dairy ? " · dairy" : "")) : (dairy ? "dairy" : "—"), warn: gl.band === "high" || dairy, ok: gl.hasData && gl.band !== "high" && !dairy },
    { l: "Routine", v: routineN === 2 ? "AM·PM ✓" : routineN === 1 ? (amDone ? "AM ✓" : "PM ✓") : "—", warn: false, ok: routineN === 2 },
  ];
  return (
    <Card title="Today's skin levers" sub="the controllables — surfaced before they show up in your skin">
      <div className="lever-grid">
        {items.map((it, i) => (
          <div key={i} className="lever" data-tone={it.warn ? "warn" : it.ok ? "ok" : "neutral"}>
            <span className="lever-v">{it.v}</span><span className="lever-l">{it.l}</span>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>Sleep and nicotine are your strongest levers; water and a calm diet help a little. Hydration is real but oversold — don't expect miracles from water alone.</p>
    </Card>
  );
}

function RoutineCheck({ data, addEntry, deleteEntry, compact }) {
  const today = getTodayStr();
  const logs = (data.skinRoutineLogs || []).filter(l => l.date === today);
  const done = slot => logs.some(l => l.slot === slot);
  const toggle = slot => {
    const ex = logs.find(l => l.slot === slot);
    if (ex) deleteEntry("skinRoutineLogs")(ex.id);
    else addEntry("skinRoutineLogs")({ id: Date.now(), date: today, slot });
    haptic(8);
  };
  const adh = skinRoutineAdherence(data);
  return (
    <div>
      <div className="routine-check">
        <button className={`routine-toggle ${done("am") ? "on" : ""}`} onClick={() => toggle("am")}>{done("am") ? "✓" : "○"} AM routine</button>
        <button className={`routine-toggle ${done("pm") ? "on" : ""}`} onClick={() => toggle("pm")}>{done("pm") ? "✓" : "○"} PM routine</button>
      </div>
      {!compact && <div className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>Last 14 days: AM {adh.amPct}% · PM {adh.pmPct}%. Consistency is what makes any routine actually work.</div>}
    </div>
  );
}

function SkinDashboard({ data, goals, skin }) {
  const streak = skinLogStreak(data.skin);
  const today = getTodayStr();
  const procs = data.skinProcedures || [];
  const upcoming = procs.filter(p => (p.date || "") > today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const recent = procs.filter(p => (p.date || "") <= today && p.date >= daysAgo(14)).sort((a, b) => b.date.localeCompare(a.date))[0];
  const proc = upcoming || recent;
  let procLine = null;
  if (proc) {
    const dayN = Math.round((new Date(today + "T00:00:00") - new Date(proc.date + "T00:00:00")) / 86400000);
    const plan = PROC_PLAN[proc.type] || PROC_PLAN.Other;
    const next = (plan.steps || []).filter(s => s.d >= dayN).sort((a, b) => a.d - b.d)[0];
    procLine = { proc, dayN, next, upcoming: !!upcoming };
  }
  return (
    <>
      <SkinLevers data={data} goals={goals} />
      {procLine && (
        <Card className="proc-countdown">
          <div className="muted small" style={{ textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>{procLine.upcoming ? "Coming up" : "Recovering"}</div>
          <div className="sleep-need-v" style={{ fontSize: "1.4rem" }}>{procLine.proc.type}{procLine.upcoming ? ` · in ${-procLine.dayN}d` : ` · day ${procLine.dayN}`}</div>
          {procLine.next && <p className="muted small" style={{ lineHeight: 1.5, marginTop: 4 }}>{procLine.upcoming ? `Next: ${procLine.next.t}` : procLine.next.t} — {procLine.next.why}. See the full timeline in Plan.</p>}
        </Card>
      )}
      {skin ? (
        <>
          <Card>
            <div className="sleep-need-row">
              <div>
                <div className="muted small">Skin condition (14-day avg)</div>
                <div className="sleep-need-v">{skin.avgCond14 ?? "—"}<span>/5</span></div>
                <div className="muted small" style={{ marginTop: 2 }}>{skin.condTrend == null ? "building a trend" : skin.condTrend > 0.2 ? "↑ improving" : skin.condTrend < -0.2 ? "↓ slipping" : "→ steady"} · {streak}-day log streak</div>
              </div>
              <div style={{ textAlign: "right" }}><div className="muted small">Confidence</div><div style={{ fontWeight: 600 }}>{skin.confidence}</div></div>
            </div>
          </Card>
          {skin.topLever && <Card title="Your biggest skin lever" className="sleep-lever-card"><p className="sleep-lever-text">{skin.topLever.text}</p></Card>}
        </>
      ) : (
        <Card title="Skin intelligence"><Empty icon="✦" title="Log your skin for a couple of weeks" hint="Once there's a week or two of entries, SkinLog learns how your sleep, nicotine, diet and stress move your skin." /></Card>
      )}
    </>
  );
}

function SkinAdviceCard({ skin, conflicts }) {
  let action, why, tone = "ok";
  const leverName = { sleep: "protecting your sleep", nicotine: "cutting nicotine", dairy: "a 4-week dairy test", glycemic: "lowering your glycemic load", stress: "managing stress load" };
  if (conflicts && conflicts.length) { action = "Fix your routine conflict first"; why = conflicts[0]; tone = "warn"; }
  else if (skin && skin.topLever) { action = `Focus on ${leverName[skin.topLever.key] || "your top lever"}`; why = skin.topLever.text; }
  else if (skin && skin.condTrend != null && skin.condTrend <= -0.6) { action = "Find what changed"; why = "Your skin trended down recently — review new products, sleep, stress and diet over the last two weeks."; tone = "warn"; }
  else if (!skin || skin.confidence === "Low") { action = "Keep logging daily"; why = "A week or two of consistent logs unlocks your personal correlations — then the advice gets specific to you."; }
  else { action = "Hold steady"; why = "Things look stable — don't change several variables at once. Let your current routine keep working."; }
  return (
    <Card title="Best next step" sub="the single highest-value thing right now">
      <p className="advice-action" data-tone={tone}>{action}</p>
      <p className="muted small" style={{ lineHeight: 1.5, marginTop: 4 }}>{why}</p>
    </Card>
  );
}

function ProductIntroCard({ data, addEntry, deleteEntry }) {
  const [kind, setKind] = useState(null);
  const [name, setName] = useState("");
  const intros = (data.skinProductIntros || []).slice().sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
  function start() { if (!kind || !name.trim()) return; addEntry("skinProductIntros")({ id: Date.now(), name: name.trim(), kind, startDate: getTodayStr() }); setKind(null); setName(""); toast("✦ Introduction plan added"); }
  return (
    <Card title="Introduce a new product" sub="add one active at a time, the safe way">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Product name (e.g. Tretinoin 0.025%)" />
      <div className="skin-proc-chips" style={{ marginTop: 8 }}>
        {PRODUCT_KINDS.map(p => <button key={p.k} className={`skin-proc-chip ${kind === p.k ? "on" : ""}`} onClick={() => setKind(p.k)}>{p.label}</button>)}
      </div>
      <button className="btn full" style={{ marginTop: 10 }} onClick={start} disabled={!kind || !name.trim()}>Build ramp plan</button>
      {intros.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {intros.map(it => (
            <div key={it.id} className="intro-block">
              <div className="skin-proc-item"><div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: ".9rem" }}>{it.name}</div><div className="muted small">started {formatShortDate(it.startDate)}</div></div><button className="skin-x" onClick={() => deleteEntry("skinProductIntros")(it.id)}>×</button></div>
              <ol className="intro-steps">{(PRODUCT_RAMP[it.kind] || PRODUCT_RAMP.other).map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function avgCondBetween(skin, startStr, endStr) {
  const xs = (skin || []).filter(s => s.date >= startStr && s.date <= endStr && s.condition != null).map(s => s.condition);
  return xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null;
}

function ProductEffectCard({ data }) {
  const today = getTodayStr();
  const dayMs = 86400000;
  const changes = [
    ...(data.skinProductIntros || []).map(p => ({ name: p.name, date: p.startDate, slot: p.kind })),
    ...(data.skinRoutineChanges || []).filter(c => c.action === "added").map(c => ({ name: c.product, date: c.date, slot: c.slot })),
  ].filter(c => c.date).sort((a, b) => b.date.localeCompare(a.date));
  if (!changes.length) return (
    <Card title="Product effects" sub="add a product in Plan → SkinLog tracks its long-term effect here">
      <Empty icon="🧴" title="No product changes logged yet" hint="When you introduce or add a product, SkinLog watches your skin for the weeks before and after to estimate its real effect." />
    </Card>
  );
  return (
    <Card title="Product effects" sub="before vs after — correlation over weeks, not proof">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {changes.map((c, i) => {
          const start = new Date(c.date + "T00:00:00");
          const daysSince = Math.round((new Date(today + "T00:00:00") - start) / dayMs);
          const before = avgCondBetween(data.skin, localDateStr(new Date(start.getTime() - 21 * dayMs)), localDateStr(new Date(start.getTime() - dayMs)));
          const after = avgCondBetween(data.skin, c.date, localDateStr(new Date(start.getTime() + 21 * dayMs)));
          const muddied = changes.some(o => o !== c && Math.abs((new Date(o.date + "T00:00:00") - start) / dayMs) <= 10);
          let body;
          if (daysSince < 14) body = <span className="muted small">Too soon — about {14 - daysSince} more days for a first read (skin is slow; give it 6–8 weeks for the full picture).</span>;
          else if (before == null || after == null) body = <span className="muted small">Not enough skin logs around this change to compare yet.</span>;
          else { const d = +(after - before).toFixed(1); body = <span className="small">{before} → {after}/5 <b style={{ color: d > 0.2 ? "var(--good)" : d < -0.2 ? "#d98a3c" : "inherit" }}>{d > 0 ? `↑ +${d}` : d < 0 ? `↓ ${d}` : "→ flat"}</b> over {daysSince} days</span>; }
          return (
            <div key={i} className="prod-effect">
              <div className="prod-effect-h"><b>{c.name}</b><span className="muted small">{formatShortDate(c.date)}{c.slot ? ` · ${c.slot}` : ""}</span></div>
              {body}
              {muddied && <div className="muted small" style={{ marginTop: 4 }}>⚠ Other changes happened around the same time — hard to isolate this one.</div>}
            </div>
          );
        })}
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>This is correlation, not proof. For a clean read, change one product at a time and give it 6–8 weeks.</p>
    </Card>
  );
}

function RoutineSuggestCard({ goals, conflicts }) {
  const routine = goals.skinRoutine || { am: [], pm: [] };
  const amText = (routine.am || []).map(s => s.product.toLowerCase()).join(" ");
  const pmText = (routine.pm || []).map(s => s.product.toLowerCase()).join(" ");
  const all = `${amText} ${pmText}`;
  const count = (routine.am || []).length + (routine.pm || []).length;
  const suggestions = [];
  (conflicts || []).forEach(c => suggestions.push({ tone: "warn", evidence: "high", text: c }));
  if ((routine.am || []).length && !/spf|sunscreen|sun ?screen|sun ?block/.test(amText)) suggestions.push({ tone: "warn", evidence: "high", text: "No morning SPF detected — add a daily SPF. It's the single highest-evidence step for ageing, pigmentation, and protecting any procedure results." });
  if (/retin|tretinoin|adapalene|retinal|retinol/.test(all) && !/spf|sunscreen/.test(amText)) suggestions.push({ tone: "warn", evidence: "high", text: "You list a retinoid but no SPF — daily sun protection is essential while using one." });
  if (count > 0 && !/moisturiz|moisturis|cream|lotion|hydrat|ceramide/.test(all)) suggestions.push({ tone: "neutral", evidence: "moderate", text: "No moisturizer listed — a basic one supports your barrier, especially alongside actives." });
  if (count > 0 && !/cleans|wash|face ?wash|gel|foam/.test(all)) suggestions.push({ tone: "neutral", evidence: "low", text: "No cleanser listed — a gentle cleanser morning and night is a sensible base." });
  if (!suggestions.length) suggestions.push({ tone: "ok", evidence: "", text: count ? "No gaps or conflicts detected. Hold steady and let your routine work — avoid changing several things at once." : "Add your AM/PM products above and SkinLog will check for gaps, conflicts, and missing SPF." });
  return (
    <Card title="Routine suggestions" sub="science-ranked tweaks from your actual routine">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {suggestions.map((s, i) => (
          <div key={i} className="rs-row" data-tone={s.tone}>
            <span className="small" style={{ lineHeight: 1.5 }}>{s.text}</span>
            {s.evidence && <span className="rs-ev">{s.evidence}</span>}
          </div>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 10, lineHeight: 1.45 }}>Suggestions, not prescriptions. Patch-test new actives; prescription products and persistent acne are a dermatologist's call.</p>
    </Card>
  );
}

function CoachPlanCard({ data, updateEntry, deleteEntry }) {
  const plans = (data.skinCoachPlans || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);
  if (!plans.length) return null;
  const toggle = (plan, i) => {
    const items = (plan.items || []).map((it, idx) => idx === i ? { ...it, done: !it.done } : it);
    updateEntry("skinCoachPlans")(plan.id, { items });
    haptic(6);
  };
  return (
    <Card title="From your coach" sub="action items you saved by concluding a coach chat">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {plans.map(p => (
          <div key={p.id} className="coach-plan">
            <div className="coach-plan-h"><span className="muted small">{formatShortDate(p.date)}{p.summary ? ` · ${p.summary}` : ""}</span><button className="skin-x" onClick={() => deleteEntry("skinCoachPlans")(p.id)}>×</button></div>
            {(p.items || []).map((it, i) => (
              <button key={i} className={`coach-plan-item ${it.done ? "done" : ""}`} onClick={() => toggle(p, i)}>
                <span className="cpi-box">{it.done ? "✓" : "○"}</span><span className="cpi-text">{it.text}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

const SKIN_TABS = [
  { k: "dash", label: "Dashboard" },
  { k: "log", label: "Log" },
  { k: "insights", label: "Insights" },
  { k: "plan", label: "Plan" },
  { k: "coach", label: "Coach" },
  { k: "research", label: "Research" },
];

export function SkinSection({ data, goals, addEntry, deleteEntry, updateEntry, onSaveGoals }) {
  const [tab, setTab] = useState("dash");
  const skin = useMemo(() => computeSkin(data, goals), [data, goals]);
  const conflicts = useMemo(() => detectRoutineConflicts(goals.skinRoutine), [goals.skinRoutine]);
  return (
    <div className="skin-scope stack">
      <div className="skinlog-bg" aria-hidden="true">
        <span className="sl-bloom b1" /><span className="sl-bloom b2" /><span className="sl-bloom b3" />
        <span className="sl-leaf l1" /><span className="sl-leaf l2" /><span className="sl-leaf l3" /><span className="sl-leaf l4" /><span className="sl-leaf l5" /><span className="sl-leaf l6" />
      </div>
      <div className="skinlog-brand"><span className="skinlog-mark" />SkinLog</div>
      <div className="skin-tabs">
        {SKIN_TABS.map(t => <button key={t.k} className={`skin-tab ${tab === t.k ? "on" : ""}`} onClick={() => { setTab(t.k); haptic(6); }}>{t.label}</button>)}
      </div>

      {tab === "dash" && <SkinDashboard data={data} goals={goals} skin={skin} />}

      {tab === "log" && (
        <>
          <SkinLogForm onAdd={addEntry("skin")} recent={data.skin} />
          <Card title="Routine check-off" sub="mark today's routine to build a consistency record"><RoutineCheck data={data} addEntry={addEntry} deleteEntry={deleteEntry} /></Card>
          <SkinRoutineCard goals={goals} onSaveGoals={onSaveGoals} conflicts={conflicts} addEntry={addEntry} />
          <SkinPhotos />
        </>
      )}

      {tab === "insights" && (
        <>
          {skin ? (
            <>
              <Card>
                <div className="sleep-need-row">
                  <div><div className="muted small">Skin condition (14-day avg)</div><div className="sleep-need-v">{skin.avgCond14 ?? "—"}<span>/5</span></div><div className="muted small" style={{ marginTop: 2 }}>{skin.condTrend == null ? "building a trend" : skin.condTrend > 0.2 ? "↑ improving" : skin.condTrend < -0.2 ? "↓ slipping" : "→ steady"}{skin.breakouts14 != null ? ` · ~${skin.breakouts14} breakouts/log` : ""}</div></div>
                  <div style={{ textAlign: "right" }}><div className="muted small">Confidence</div><div style={{ fontWeight: 600 }}>{skin.confidence}</div></div>
                </div>
                {skin.series && <div className="cond-spark">{skin.series.map((s, i) => <span key={i} className="cond-bar" style={{ height: `${s.value ? s.value * 7 + 6 : 3}px`, opacity: s.value ? 1 : 0.25 }} title={s.label} />)}</div>}
              </Card>
              <SkinAdviceCard skin={skin} conflicts={conflicts} />
              {skin.correlations.length > 0 && (
                <Card title="How your body affects your skin" sub="patterns from your own data — correlation, not proof">
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{skin.correlations.map((c, i) => <div key={i} className="sleep-couple-row"><span className="sleep-couple-dot" style={{ background: c.evidence === "strong" ? "var(--good)" : "#f9c97e" }} /><span className="small" style={{ lineHeight: 1.5 }}>{c.text}</span></div>)}</div>
                </Card>
              )}
              <SkinExperimentCard data={data} goals={goals} onSaveGoals={onSaveGoals} />
              <ProductEffectCard data={data} />
            </>
          ) : (
            <>
              <Card title="Insights"><Empty icon="✦" title="Not enough data yet" hint="Log your skin daily for a week or two and your trends, correlations and progress show up here." /></Card>
              <SkinAdviceCard skin={skin} conflicts={conflicts} />
              <ProductEffectCard data={data} />
            </>
          )}
        </>
      )}

      {tab === "plan" && (
        <>
          <CoachPlanCard data={data} updateEntry={updateEntry} deleteEntry={deleteEntry} />
          <SkinProceduresCard data={data} addEntry={addEntry} deleteEntry={deleteEntry} />
          <RoutineSuggestCard goals={goals} conflicts={conflicts} />
          <ProductIntroCard data={data} addEntry={addEntry} deleteEntry={deleteEntry} />
        </>
      )}

      {tab === "coach" && <SkinCoach data={data} goals={goals} addEntry={addEntry} />}

      {tab === "research" && <SkinResearchStore data={data} addEntry={addEntry} deleteEntry={deleteEntry} />}

      <p className="muted small" style={{ textAlign: "center", lineHeight: 1.5, padding: "4px 12px" }}>SkinLog's skin tools track, correlate, experiment and explain — they don't diagnose or prescribe. For persistent acne, suspicious spots, prescription actives, or the decision to get a procedure, see a dermatologist.</p>
    </div>
  );
}
