import { useMemo, useState } from "react";
import { Card } from "./primitives";
import { SESSION_TYPES, sleepWindow } from "../engines/fueling";
import { getTodayStr } from "../lib/dates";
import { haptic, SFX } from "../lib/fx";
import { buildTimeline, timeToMin, minToTime, TIGHT_GAP_THRESHOLD_MINUTES } from "../lib/partitioning";

// ─── Nutrition partitioning ─────────────────────────────────────────────────
// Redistributes the EXISTING daily macro target across a per-day meal timeline,
// shaped by wake/sleep + scheduled/ad-hoc activity. Floors (pre/post) are fixed;
// flexible meals reflow around them and around what you've already logged.

const localDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmt = min => { const h = Math.floor(min / 60) % 24, m = min % 60; const ap = h < 12 ? "am" : "pm"; const hh = h % 12 || 12; return `${hh}:${String(m).padStart(2, "0")}${ap}`; };

export function NutritionPartitioningCard({ data, goals, addEntry, deleteEntry }) {
  const today = getTodayStr();
  const tomorrow = localDate(Date.now() + 86400000);
  const [planDate, setPlanDate] = useState(today);
  const [adhoc, setAdhoc] = useState({}); // { [dateKey]: [session,...] } — day-local, never written to Plan
  const [addType, setAddType] = useState(null);
  const [form, setForm] = useState({ time: "17:00", durationMin: "", intensity: "moderate" });

  const totals = { carbsG: goals?.carbs || 0, proteinG: goals?.protein || 0, fatG: goals?.fat || 0 };
  const hasTargets = totals.carbsG + totals.proteinG + totals.fatG > 0;

  const sw = useMemo(() => sleepWindow(data), [data]);
  const planned = (data.plannedSessions || []).filter(s => s.date === planDate).map(s => ({ ...s, _source: "default" }));
  const dayAdhoc = (adhoc[planDate] || []).map(s => ({ ...s, _source: "added" }));
  const activities = [...planned, ...dayAdhoc].sort((a, b) => timeToMin(a.time) - timeToMin(b.time));

  const isToday = planDate === today;
  const now = new Date();
  const nowMin = isToday ? now.getHours() * 60 + now.getMinutes() : null;
  const loggedMeals = (data.diet || []).filter(m => m.date === planDate).map(m => ({ min: timeToMin(m.time), id: m.id, carbsG: m.carbs || 0, proteinG: m.protein || 0, fatG: m.fat || 0 }));

  const tl = useMemo(() => buildTimeline({
    dayKey: planDate, totals, sessions: activities, wakeMin: sw.wakeMin, sleepMin: sw.sleepMin, nowMin, loggedMeals,
  }), [planDate, totals.carbsG, totals.proteinG, totals.fatG, JSON.stringify(activities), sw.wakeMin, sw.sleepMin, nowMin, JSON.stringify(loggedMeals)]);

  const tightIds = useMemo(() => { const s = new Set(); tl.tightPairs.forEach(([a, b]) => { s.add(a); s.add(b); }); return s; }, [tl]);

  // Visual merge: consecutive flexible slots within mergeGap fold into one card.
  const cards = useMemo(() => {
    const out = [];
    for (let i = 0; i < tl.slots.length; i++) {
      const s = tl.slots[i];
      if (s.type === "flexible" && s.status === "planned") {
        const group = [s];
        while (i + 1 < tl.slots.length) {
          const nx = tl.slots[i + 1];
          if (nx.type === "flexible" && nx.status === "planned" && (nx.plannedMin - group[group.length - 1].plannedMin) <= tl.mergeGap) { group.push(nx); i++; } else break;
        }
        if (group.length > 1) {
          out.push({
            id: group.map(g => g.id).join("+"), type: "flexible", merged: true, status: "planned",
            mealName: group.map(g => g.mealName).join(" + "), plannedMin: group[0].plannedMin, plannedMinEnd: group[group.length - 1].plannedMin,
            macros: group.reduce((m, g) => ({ carbsG: m.carbsG + g.macros.carbsG, proteinG: m.proteinG + g.macros.proteinG, fatG: m.fatG + g.macros.fatG }), { carbsG: 0, proteinG: 0, fatG: 0 }),
            note: "Bridged meals — close together, so treat as one feeding.",
          });
        } else out.push(s);
      } else out.push(s);
    }
    return out;
  }, [tl]);

  const addSession = () => {
    if (!addType) return;
    const s = { id: Date.now(), date: planDate, type: addType, time: form.time, durationMin: +form.durationMin || SESSION_TYPES[addType].defMin, intensity: form.intensity };
    setAdhoc(a => ({ ...a, [planDate]: [...(a[planDate] || []), s] }));
    setAddType(null); setForm({ time: "17:00", durationMin: "", intensity: "moderate" }); haptic(8); SFX.tap();
  };
  const removeAdhoc = id => setAdhoc(a => ({ ...a, [planDate]: (a[planDate] || []).filter(s => s.id !== id) }));

  return (
    <Card title="Nutrition partitioning" sub="Your daily targets, spread across the day around training & sleep"
      action={<button className="btn-ghost btn-sm" onClick={() => setAddType(addType ? null : Object.keys(SESSION_TYPES)[0])}>+ Activity</button>}>

      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={`seg-btn ${isToday ? "active" : ""}`} onClick={() => setPlanDate(today)}>Today</button>
        <button className={`seg-btn ${planDate === tomorrow ? "active" : ""}`} onClick={() => setPlanDate(tomorrow)}>Tomorrow</button>
      </div>

      {!hasTargets && <p className="muted small" style={{ marginBottom: 10 }}>Set your daily calorie & macro goals to see a partitioned plan.</p>}

      {/* activity chips */}
      {activities.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {activities.map(a => (
            <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "var(--bg-2)", border: "1px solid var(--line)", color: "var(--text-2)" }}>
              {(SESSION_TYPES[a.type] || {}).label || a.type} · {a.time}
              <span style={{ fontSize: 10, color: a._source === "added" ? "var(--accent)" : "var(--muted)" }}>{a._source}</span>
              {a._source === "added" && <button onClick={() => removeAdhoc(a.id)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>}
            </span>
          ))}
        </div>
      )}

      {/* ad-hoc add flow */}
      {addType && (
        <div className="stack" style={{ marginBottom: 12 }}>
          <div className="fuel-type-chips" style={{ marginBottom: 8 }}>
            {Object.entries(SESSION_TYPES).map(([k, v]) => <button key={k} className={`fuel-type-chip ${addType === k ? "on" : ""}`} onClick={() => setAddType(k)} style={addType === k ? { borderColor: "var(--accent)", color: "var(--text)" } : undefined}>{v.label}</button>)}
          </div>
          <div className="field-grid three">
            <label>Time<input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} /></label>
            <label>Mins<input type="number" inputMode="numeric" value={form.durationMin} onChange={e => setForm(f => ({ ...f, durationMin: e.target.value }))} placeholder={`${SESSION_TYPES[addType].defMin}`} /></label>
            <label>Intensity<select value={form.intensity} onChange={e => setForm(f => ({ ...f, intensity: e.target.value }))}><option value="light">Light</option><option value="moderate">Moderate</option><option value="hard">Hard</option></select></label>
          </div>
          <div className="row"><button className="btn-ghost flex" onClick={() => setAddType(null)}>Cancel</button><button className="btn flex" onClick={addSession}>Add activity</button></div>
        </div>
      )}

      {!tl.neutralOk && activities.length > 0 && (
        <div className="muted small" style={{ marginBottom: 10, color: "#f9c97e" }}>⚠ No 3h+ activity-free window — floors are crowding the day.</div>
      )}

      {/* timeline */}
      {hasTargets && (
        <div style={{ position: "relative", paddingLeft: 22 }}>
          <div style={{ position: "absolute", left: 6, top: 6, bottom: 6, width: 2, background: "var(--line)" }} />
          {cards.map(s => {
            const floor = s.type === "floor";
            const logged = s.status === "logged";
            const tight = tightIds.has(s.id);
            return (
              <div key={s.id} style={{ position: "relative", marginBottom: 10 }}>
                <span style={{ position: "absolute", left: -22, top: 14, width: 12, height: 12, borderRadius: "50%", background: floor ? "var(--accent)" : logged ? "var(--good)" : "var(--surface)", border: `2px solid ${floor ? "var(--accent)" : logged ? "var(--good)" : "var(--border-strong)"}` }} />
                <div style={{
                  background: floor ? "rgba(120,180,200,0.08)" : "var(--bg-2)",
                  border: `1px solid ${floor ? "var(--accent)" : "var(--line)"}`,
                  borderRadius: 12, padding: "10px 12px", opacity: logged ? 0.6 : 1,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--text-2)", fontVariantNumeric: "tabular-nums", minWidth: 58 }}>
                      {fmt(s.plannedMin)}{s.merged ? `–${fmt(s.plannedMinEnd)}` : ""}
                    </span>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                      {logged ? "✓ " : ""}{s.mealName}
                    </span>
                    {floor && <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--accent)" }}>floor</span>}
                    {tight && <span style={{ fontSize: 10, fontWeight: 700, color: "#f9c97e", border: "1px solid rgba(249,201,126,0.4)", borderRadius: 6, padding: "1px 5px" }}>tight</span>}
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 5, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ color: "#f9c97e" }}>{s.macros.carbsG}g C</span>
                    <span style={{ color: "#b4a8e8" }}>{s.macros.proteinG}g P</span>
                    <span style={{ color: "#f47e6e" }}>{s.macros.fatG}g F</span>
                  </div>
                  {s.note && <div className="muted small" style={{ marginTop: 4, lineHeight: 1.4 }}>{s.note}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasTargets && activities.length === 0 && (
        <p className="muted small" style={{ marginTop: 4, lineHeight: 1.5 }}>Add a gym session or sport with <b>+ Activity</b> and FitLog inserts fixed pre/post fuel slots and reflows the rest of your day around them.</p>
      )}
    </Card>
  );
}

export default NutritionPartitioningCard;
