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
