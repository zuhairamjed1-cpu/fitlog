import { useMemo, useState } from "react";
import { Card, Empty } from "./primitives";
import { SESSION_TYPES } from "../engines/fueling";
import { estimateSleepNeed } from "../engines/sleep";
import { getTodayStr, WEEKDAYS } from "../lib/dates";
import { haptic, SFX } from "../lib/fx";
import { buildTimeline, timeToMin, minToTime, TIGHT_GAP_THRESHOLD_MINUTES, suggestGymWindow, gymSleepProximity } from "../lib/partitioning";
import { POST_WORKOUT_PRESET, inRange } from "../lib/postWorkoutPreset";
import { PRE_WORKOUT_PRESET, inCarbRange } from "../lib/preWorkoutPreset";
import { predictBedtime, planRemainingIntake } from "../lib/prebedTaper";

const FORM_LABEL = { "full-meal": "a full meal", "lighter-solid-or-shake": "something lighter or a shake", "liquid-preferred": "liquid (shake/smoothie)", "casein-or-milk-shake": "a casein or milk shake" };
// Atwater kcal from macros (4/4/9).
const kcalOf = m => Math.round((m.carbsG || 0) * 4 + (m.proteinG || 0) * 4 + (m.fatG || 0) * 9);

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
  const [addType, setAddType] = useState(null);
  const [form, setForm] = useState({ time: "17:00", durationMin: "", intensity: "moderate" });

  const totals = { carbsG: goals?.carbs || 0, proteinG: goals?.protein || 0, fatG: goals?.fat || 0 };
  const hasTargets = totals.carbsG + totals.proteinG + totals.fatG > 0;

  // ── wake time drives the whole plan ──
  // Meals aren't laid out until the day's sleep is logged; the wake time from
  // that log anchors everything (biological-day aware).
  const isToday = planDate === today;
  // Today's sleep = the entry whose date is today (logged on waking).
  const todaySleep = useMemo(() => (data.sleep || []).filter(s => s.date === planDate && s.wakeTime).sort((a, b) => (b.id || 0) - (a.id || 0))[0]
    || (!isToday ? (data.sleep || []).filter(s => s.wakeTime).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0] : null), [data.sleep, planDate, isToday]);
  const wakeEstimated = !!(todaySleep && todaySleep.date !== planDate);
  const wakeMin = todaySleep ? timeToMin(todaySleep.wakeTime) : null;
  const needH = useMemo(() => estimateSleepNeed(data, goals).hours, [data, goals]);
  // Predicted bedtime (§13.1) from sleep history, anomaly-filtered. Source-agnostic.
  const bedPred = useMemo(() => predictBedtime((data.sleep || []).filter(s => s.bedtime).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.id || 0) - (a.id || 0)).map(s => s.bedtime)), [data.sleep]);
  // Bedtime on the same forward scale as wake (after-midnight → +24h).
  const bedMin = wakeMin != null ? (bedPred.bedtime <= wakeMin ? bedPred.bedtime + 1440 : bedPred.bedtime) : null;
  const sleepMin = bedMin != null ? bedMin : (wakeMin != null ? wakeMin + Math.round((24 - needH) * 60) : null);

  // ── rest vs training from the weekly plan ("Your week") ──
  const plan = goals?.plan || {};
  const dow = WEEKDAYS[(new Date(planDate + "T00:00:00").getDay() + 6) % 7];
  const isTraining = (plan.trainingDays || []).includes(dow);
  const splitLabel = isTraining ? (plan.assignments?.[dow] || "Training") : "Rest";

  // Timed workout sessions for the day (persisted, so the meal-log quick-log can
  // see them too). This is the timed-session layer — NOT the weekly split plan.
  // On a rest day the plan carries no workout floors.
  const activities = isTraining ? (data.plannedSessions || []).filter(s => s.date === planDate).sort((a, b) => timeToMin(a.time) - timeToMin(b.time)) : [];

  const now = new Date();
  const nowMin = isToday ? now.getHours() * 60 + now.getMinutes() : null;
  // Planned cheat meals are free — kept out of the partitioning budget.
  const cheatSet = new Set((goals?.cheatMeals || []).map(c => `${c.date}|${c.meal}`));
  const loggedMeals = (data.diet || []).filter(m => m.date === planDate && !m.cheat && !cheatSet.has(`${m.date}|${m.meal}`)).map(m => ({ min: timeToMin(m.time), id: m.id, label: m.meal, carbsG: m.carbs || 0, proteinG: m.protein || 0, fatG: m.fat || 0 }));

  // Post-workout micro breakdown from a quick-logged meal near a floor (§5 chips).
  const postMicrosFor = floor => {
    let best = null, bestD = 90;
    (data.diet || []).filter(m => m.date === planDate && m.postWorkout).forEach(m => { const d = Math.abs(timeToMin(m.time) - floor.plannedMin); if (d <= bestD) { best = m; bestD = d; } });
    return best ? best.postWorkout : null;
  };
  // Pre-workout carbs from a quick-logged meal near the pre floor (§10.5 chip).
  const preCarbsFor = floor => {
    let best = null, bestD = 90;
    (data.diet || []).filter(m => m.date === planDate && m.preWorkout).forEach(m => { const d = Math.abs(timeToMin(m.time) - floor.plannedMin); if (d <= bestD) { best = m; bestD = d; } });
    return best ? (best.preWorkout.carbsG || 0) : 0;
  };

  const tl = useMemo(() => (wakeMin == null || !hasTargets) ? { slots: [], tightPairs: [], neutralOk: true, mergeGap: 75 } : buildTimeline({
    dayKey: planDate, totals, sessions: activities, wakeMin, sleepMin, nowMin, loggedMeals,
  }), [planDate, hasTargets, totals.carbsG, totals.proteinG, totals.fatG, JSON.stringify(activities), wakeMin, sleepMin, nowMin, JSON.stringify(loggedMeals)]);

  const tightIds = useMemo(() => { const s = new Set(); tl.tightPairs.forEach(([a, b]) => { s.add(a); s.add(b); }); return s; }, [tl]);
  const proxIds = useMemo(() => new Set(tl.sleepProximityIds || []), [tl]);
  const insufIds = useMemo(() => new Set(tl.insufficientIds || []), [tl]);

  // Pre-bed calorie taper (§13): re-evaluate as the clock advances toward bed.
  const taper = useMemo(() => {
    if (!(hasTargets && wakeMin != null) || !isToday || bedMin == null) return null;
    const nowM = new Date().getHours() * 60 + new Date().getMinutes();
    const eaten = (data.diet || []).filter(m => m.date === planDate).reduce((a, m) => a + (m.calories || 0), 0);
    const remaining = Math.max(0, (goals?.calories || 0) - eaten);
    return planRemainingIntake(nowM, bedMin, remaining);
  }, [hasTargets, wakeMin, isToday, bedMin, goals?.calories, data.diet, planDate]);
  // Suggested gym window when it's a training day with no time set yet.
  const suggest = useMemo(() => (planReadyLike() && isTraining && activities.length === 0) ? suggestGymWindow({ wakeMin, sleepMin }) : null, [isTraining, activities.length, wakeMin, sleepMin]);
  function planReadyLike() { return hasTargets && wakeMin != null; }
  const confirmSuggested = () => { if (!suggest) return; addEntry("plannedSessions")({ id: Date.now(), date: planDate, type: "gym", time: minToTime(suggest.suggestMin), durationMin: 60, intensity: "moderate" }); haptic(10); SFX.tap(); };

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
    // Insert the activity itself as a timeline block (between its floors).
    activities.forEach(a => out.push({ id: `act-${a.id}`, kind: "activity", plannedMin: timeToMin(a.time), label: (SESSION_TYPES[a.type] || {}).label || a.type, durationMin: a.durationMin || (SESSION_TYPES[a.type] || {}).defMin, intensity: a.intensity }));
    return out.sort((x, y) => x.plannedMin - y.plannedMin);
  }, [tl, activities]);

  const addSession = () => {
    if (!addType) return;
    addEntry("plannedSessions")({ id: Date.now(), date: planDate, type: addType, time: form.time, durationMin: +form.durationMin || SESSION_TYPES[addType].defMin, intensity: form.intensity });
    setAddType(null); setForm({ time: "17:00", durationMin: "", intensity: "moderate" }); haptic(8); SFX.tap();
  };
  const removeSession = id => { deleteEntry("plannedSessions")(id); haptic(6); };

  const planReady = hasTargets && wakeMin != null;
  const sub = wakeMin != null
    ? `${splitLabel} day · up ${fmt(wakeMin)}${wakeEstimated ? " (est.)" : ""} → bed ~${fmt(sleepMin)}`
    : "Plans around your wake time — log sleep to build it";

  return (
    <Card title="Nutrition partitioning" sub={sub}
      action={isTraining ? <button className="btn-ghost btn-sm" onClick={() => setAddType(addType ? null : Object.keys(SESSION_TYPES)[0])}>+ Activity</button> : null}>

      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={`seg-btn ${isToday ? "active" : ""}`} onClick={() => setPlanDate(today)}>Today</button>
        <button className={`seg-btn ${planDate === tomorrow ? "active" : ""}`} onClick={() => setPlanDate(tomorrow)}>Tomorrow</button>
      </div>

      {!hasTargets && <p className="muted small" style={{ marginBottom: 10 }}>Set your daily calorie & macro goals to see a partitioned plan.</p>}

      {hasTargets && wakeMin == null && (
        <Empty icon="◐" title={isToday ? "Log today's sleep to lay out your meals" : "No wake time yet"}
          hint={isToday ? "The whole plan runs off when you woke up. Log last night's sleep and your meals appear, spaced around your day." : "Log a night's sleep first — tomorrow's plan estimates from your usual wake time."} />
      )}

      {planReady && wakeEstimated && (
        <div className="muted small" style={{ marginBottom: 10 }}>Estimated from your usual wake time — log tonight's sleep to firm it up.</div>
      )}

      {/* activity chips */}
      {activities.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {activities.map(a => (
            <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "var(--bg-2)", border: "1px solid var(--line)", color: "var(--text-2)" }}>
              {(SESSION_TYPES[a.type] || {}).label || a.type} · {a.time}
              <button onClick={() => removeSession(a.id)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
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

      {tl.carbsCrowded && (
        <div className="muted small" style={{ marginBottom: 10, color: "#f9c97e" }}>⚠ Your pre-workout carb load is crowding out the rest of the day — the other meals are running lean on carbs.</div>
      )}
      {!tl.neutralOk && activities.length > 0 && (
        <div className="muted small" style={{ marginBottom: 10, color: "#f9c97e" }}>⚠ No 3h+ activity-free window — floors are crowding the day.</div>
      )}
      {planReady && tl.isCompressed && (
        <div className="muted small" style={{ marginBottom: 10, color: "#f9c97e" }}>⚠ Short awake window — meals are compressed. Later meals sit close to bedtime.</div>
      )}
      {planReady && insufIds.size > 0 && (
        <div className="muted small" style={{ marginBottom: 10, color: "#f47e6e" }}>⚠ Your remaining budget is very low after logged meals + floors — the flagged meals are held at a minimum.</div>
      )}
      {planReady && taper && (taper.tapered || !taper.onTrack) && (
        <div className="muted small" style={{ marginBottom: 10, color: "#9fb0c8" }}>
          🌙 ~{taper.hoursToBed.toFixed(1)}h to predicted bed{bedPred.anomaly ? " (adj.)" : ""} — {taper.tapered
            ? `keep it ${FORM_LABEL[taper.form] || taper.form}, ≤${taper.ceilingKcal} kcal${taper.skipIfPossible ? " (or skip)" : ""}.`
            : `you're behind, so the last meal absorbs the remaining ~${Math.round(taper.suggestKcal)} kcal before the 3h pre-bed line.`}
        </div>
      )}
      {planReady && suggest && (
        <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 12, background: "rgba(120,180,200,0.1)", border: "1px solid var(--accent)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Training day — when's the gym?</div>
          <div className="muted small" style={{ margin: "4px 0 10px" }}>Suggested window <b style={{ color: "var(--text)" }}>{fmt(suggest.loMin)}–{fmt(suggest.hiMin)}</b>{gymSleepProximity({ startMin: suggest.suggestMin, sleepMin }) ? " · close to bed — earlier is better" : ""}</div>
          <button className="btn" onClick={confirmSuggested} style={{ padding: "0 16px" }}>Confirm {fmt(suggest.suggestMin)}</button>
        </div>
      )}

      {/* timeline */}
      {planReady && (
        <div style={{ position: "relative", paddingLeft: 22 }}>
          <div style={{ position: "absolute", left: 6, top: 6, bottom: 6, width: 2, background: "var(--line)" }} />
          {cards.map(s => {
            if (s.kind === "activity") {
              return (
                <div key={s.id} style={{ position: "relative", marginBottom: 10 }}>
                  <span style={{ position: "absolute", left: -23, top: 12, width: 14, height: 14, borderRadius: "50%", background: "var(--accent)", border: "2px solid var(--bg)" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 12, background: "rgba(120,180,200,0.12)", border: "1px solid var(--accent)" }}>
                    <span style={{ fontSize: 12, color: "var(--text-2)", fontVariantNumeric: "tabular-nums", minWidth: 58 }}>{fmt(s.plannedMin)}</span>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🏋 {s.label}</span>
                    <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>{s.durationMin}min · {s.intensity}</span>
                  </div>
                </div>
              );
            }
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
                    {proxIds.has(s.id) && <span style={{ fontSize: 10, fontWeight: 700, color: "#b4a8e8", border: "1px solid rgba(180,168,232,0.4)", borderRadius: 6, padding: "1px 5px" }}>near bed</span>}
                    {insufIds.has(s.id) && <span style={{ fontSize: 10, fontWeight: 700, color: "#f47e6e", border: "1px solid rgba(244,126,110,0.4)", borderRadius: 6, padding: "1px 5px" }}>low budget</span>}
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 5, fontSize: 12.5, fontVariantNumeric: "tabular-nums", alignItems: "baseline" }}>
                    <span style={{ color: "var(--text)", fontWeight: 700 }}>{kcalOf(s.macros)}<span style={{ color: "var(--text-2)", fontWeight: 400, fontSize: 11 }}> kcal</span></span>
                    <span style={{ color: "#f9c97e" }}>{s.macros.carbsG}g C</span>
                    <span style={{ color: "#b4a8e8" }}>{s.macros.proteinG}g P</span>
                    <span style={{ color: "#f47e6e" }}>{s.macros.fatG}g F</span>
                  </div>
                  {floor && s.mealName === "Post-workout" && (() => {
                    const micros = postMicrosFor(s) || {};
                    const T = POST_WORKOUT_PRESET.targets;
                    const defs = [["proteinG", "P", "g"], ["glucoseG", "glu", "g"], ["fructoseG", "fru", "g"], ["saltTsp", "salt", ""], ["omega3Mg", "ω3", ""]];
                    return (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                        {defs.map(([k, lab]) => {
                          const cur = micros[k] || 0; const t = T[k]; const ok = inRange(cur, t);
                          return (
                            <span key={k} style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 7, fontVariantNumeric: "tabular-nums",
                              border: `1px solid ${ok ? "rgba(95,207,128,0.4)" : "var(--line)"}`, background: ok ? "rgba(95,207,128,0.1)" : "transparent", color: ok ? "var(--good)" : "var(--text-2)" }}>
                              {lab} {cur}/{t.max != null ? `${t.min}–${t.max}` : `${t.min}+`}
                            </span>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {floor && s.mealName === "Pre-workout" && (() => {
                    const cur = preCarbsFor(s); const T = PRE_WORKOUT_PRESET.target.carbsG; const ok = inCarbRange(cur, T);
                    return (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                        <span style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 7, fontVariantNumeric: "tabular-nums",
                          border: `1px solid ${ok ? "rgba(95,207,128,0.4)" : "var(--line)"}`, background: ok ? "rgba(95,207,128,0.1)" : "transparent", color: ok ? "var(--good)" : "var(--text-2)" }}>
                          carbs {cur}/{T.min}–{T.max}
                        </span>
                      </div>
                    );
                  })()}
                  {s.note && <div className="muted small" style={{ marginTop: 4, lineHeight: 1.4 }}>{s.note}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {planReady && isTraining && activities.length === 0 && !suggest && (
        <p className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>Today is a <b>{splitLabel}</b> day, but the awake window's too tight for a clean gym slot. Add a time with <b>+ Activity</b> if you're training.</p>
      )}
      {planReady && !isTraining && (
        <p className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>Rest day per your weekly plan — no training floors, just your meals spread across the day.</p>
      )}
    </Card>
  );
}

export default NutritionPartitioningCard;
