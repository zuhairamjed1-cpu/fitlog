import { useMemo, useState } from "react";
import { Card, toast } from "../components/primitives";
import { getTodayStr, formatShortDate, daysAgoFrom } from "../lib/dates";
import { haptic, SFX } from "../lib/fx";
import { assess, prescribe, absorptionRead, BRISTOL, STOOL_COLORS, STOOL_FLAGS } from "../lib/stool";

// ─── Stool tracker ──────────────────────────────────────────────────────────
// Port of the GutCheck design in the FitLog dark palette. The pipeline
// (assess → prescribe) lives in src/lib/stool.js; this is UI + the store wire.

const GOOD = "#5fcf80", WATCH = "#f9c97e", BAD = "#f47e6e";
const TONE = { healthy: GOOD, watch: WATCH, alert: BAD };

export function StoolTracker({ data, addEntry, deleteEntry }) {
  const today = getTodayStr();
  const [bristol, setBristol] = useState(null);
  const [color, setColor] = useState("brown");
  const [ease, setEase] = useState("normal");
  const [flags, setFlags] = useState([]);
  const [reading, setReading] = useState(null);

  const entries = data.stool || [];
  const toggleFlag = v => setFlags(f => f.includes(v) ? f.filter(x => x !== v) : [...f, v]);

  const log = () => {
    if (bristol == null) return;
    const e = { bristol, color, ease, flags };
    const status = assess(e);          // ← pipeline
    const rx = prescribe(status);      // ← pipeline
    const absorb = absorptionRead(e);
    addEntry("stool")({ id: Date.now(), date: today, ts: Date.now(), ...e, status, tone: rx.tone, absorb });
    setReading({ status, rx, absorb });
    haptic(10); SFX.tap();
    toast(`⊙ ${rx.title}`, { silent: true });
    setBristol(null); setFlags([]); setEase("normal"); setColor("brown");
  };

  // last 14 days — one bar per logged entry, height = closeness to Bristol 3.5
  const strip = useMemo(() => {
    const from = daysAgoFrom(today, 13);
    return entries.filter(e => e.date >= from).sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(-14);
  }, [entries, today]);

  return (
    <div className="stack">
      <Card title="⊙ Today's entry" sub="Form, colour, ease — the read is instant">
        {/* ── Bristol dial ── */}
        <div className="field" style={{ marginBottom: 18 }}>
          <span className="lbl">Form — firm to loose</span>
          <div style={{ border: "1px solid var(--border-strong)", borderRadius: 11, overflow: "hidden", background: "var(--bg-2)", marginTop: 8 }}>
            <div style={{ display: "flex" }}>
              {BRISTOL.map((b, i) => {
                const on = bristol === b.v;
                return (
                  <button key={b.v} title={b.label} onClick={() => { setBristol(b.v); haptic(6); }}
                    style={{
                      flex: 1, border: "none", borderLeft: i ? "1px solid var(--line)" : "none",
                      background: on ? "rgba(95,207,128,0.12)" : "transparent",
                      color: on ? GOOD : "var(--text-2)", fontWeight: on ? 700 : 500,
                      padding: "14px 0 10px", cursor: "pointer", fontSize: 13,
                      boxShadow: on ? `inset 0 -3px 0 ${GOOD}` : "none", transition: "background .18s, color .18s",
                    }}>
                    <div style={{ fontSize: 15, letterSpacing: "-.05em", marginBottom: 6, opacity: on ? 1 : 0.6 }}>{b.glyph}</div>
                    {b.v}
                  </button>
                );
              })}
            </div>
            {/* ideal zone under 3–4 */}
            <div style={{ display: "flex", borderTop: "1px solid var(--line)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)" }}>
              {BRISTOL.map(b => {
                const zone = b.v === 3 || b.v === 4;
                return (
                  <span key={b.v} style={{ flex: 1, textAlign: "center", padding: "5px 0", position: "relative", color: zone ? GOOD : "var(--muted)" }}>
                    {zone && <i style={{ position: "absolute", top: 0, left: "8%", right: "8%", height: 2, background: GOOD, borderRadius: 2 }} />}
                    {zone ? "ideal" : ""}
                  </span>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)", marginTop: 7 }}>
            <span>hard · pellets</span><span>watery</span>
          </div>
        </div>

        {/* ── Colour ── */}
        <div className="field" style={{ marginBottom: 18 }}>
          <span className="lbl">Colour</span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            {STOOL_COLORS.map(c => (
              <button key={c.v} title={c.label} onClick={() => { setColor(c.v); haptic(5); }}
                style={{
                  width: 38, height: 38, borderRadius: "50%", background: c.hex, cursor: "pointer",
                  border: `2px solid ${color === c.v ? "var(--text)" : "transparent"}`,
                  boxShadow: "inset 0 0 0 1px rgba(0,0,0,.25)", transition: "transform .15s, border-color .15s",
                  transform: color === c.v ? "translateY(-2px)" : "none",
                }} />
            ))}
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>{STOOL_COLORS.find(c => c.v === color)?.label}</div>
        </div>

        {/* ── Ease ── */}
        <div className="field" style={{ marginBottom: 18 }}>
          <span className="lbl">Ease</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {["strained", "normal", "urgent"].map(v => (
              <button key={v} onClick={() => { setEase(v); haptic(5); }}
                style={{
                  fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em", borderRadius: 999, padding: "9px 15px", cursor: "pointer",
                  border: `1px solid ${ease === v ? "var(--text)" : "var(--border-strong)"}`,
                  background: ease === v ? "var(--text)" : "var(--bg-2)",
                  color: ease === v ? "var(--bg)" : "var(--text)",
                }}>{v}</button>
            ))}
          </div>
        </div>

        {/* ── Flags ── */}
        <div className="field" style={{ marginBottom: 16 }}>
          <span className="lbl">Flags — tap any that apply</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {STOOL_FLAGS.map(f => {
              const on = flags.includes(f.v);
              return (
                <button key={f.v} onClick={() => { toggleFlag(f.v); haptic(5); }}
                  style={{
                    fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em", borderRadius: 999, padding: "9px 15px", cursor: "pointer",
                    border: `1px solid ${on ? BAD : "var(--border-strong)"}`,
                    background: on ? BAD : "var(--bg-2)", color: on ? "#1a0f0d" : "var(--text)", fontWeight: on ? 700 : 400,
                  }}>{f.label}</button>
              );
            })}
          </div>
        </div>

        <button className="btn full" onClick={log} disabled={bristol == null}>
          {bristol == null ? "Select a form to log" : "Log entry"}
        </button>
      </Card>

      {/* ── Reading ── */}
      {reading && (
        <Card title="⊹ Reading">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", flex: "none", background: TONE[reading.rx.tone], boxShadow: `0 0 0 4px ${TONE[reading.rx.tone]}22` }} />
            <h3 style={{ margin: 0, fontSize: 21, fontWeight: 700, color: TONE[reading.rx.tone] }}>{reading.rx.title}</h3>
          </div>
          <div className="muted small" style={{ textTransform: "uppercase", letterSpacing: ".08em", margin: "4px 0 16px 24px" }}>{reading.rx.sub}</div>

          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 10 }}>
              {reading.rx.tone === "alert" ? "What to do" : "Prescription"}
            </div>
            {reading.rx.actions.map((a, i) => (
              <div key={i} style={{ position: "relative", padding: "7px 0 7px 20px", fontSize: 14.5, lineHeight: 1.5, borderBottom: i < reading.rx.actions.length - 1 ? "1px dashed var(--line)" : "none" }}>
                <i style={{ position: "absolute", left: 0, top: 14, width: 7, height: 7, borderRadius: 2, background: TONE[reading.rx.tone] }} />
                {a}
              </div>
            ))}

            {/* absorption tag — hidden on red (doctor overrides everything) */}
            {reading.status !== "red" && (() => {
              const good = reading.absorb === "good";
              return (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 7, marginTop: 14, fontSize: 11, letterSpacing: ".06em",
                  textTransform: "uppercase", padding: "7px 12px", borderRadius: 8,
                  background: good ? "rgba(95,207,128,0.12)" : "rgba(249,201,126,0.12)", color: good ? GOOD : WATCH,
                }}>
                  Absorption: {reading.absorb} · {good ? "protein is landing" : "may be out-eating your gut"}
                </span>
              );
            })()}
          </div>
        </Card>
      )}

      {/* ── 14-day strip ── */}
      <Card title="Last 14 days" sub={strip.length ? `${strip.length} logged` : "nothing logged yet"}>
        {strip.length ? (
          <>
            <div style={{ display: "flex", gap: 5, alignItems: "flex-end", height: 56 }}>
              {strip.map((d, i) => (
                <div key={d.id} title={`${formatShortDate(d.date)} · Bristol ${d.bristol}`}
                  style={{
                    flex: 1, minWidth: 0, borderRadius: "4px 4px 2px 2px",
                    background: TONE[d.tone] || "var(--border-strong)",
                    height: `${28 + Math.round((1 - Math.abs((d.bristol ?? 4) - 3.5) / 3.5) * 28)}px`,
                    opacity: i === strip.length - 1 ? 1 : 0.75,
                  }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
              {[["healthy", GOOD], ["watch", WATCH], ["flag", BAD]].map(([l, c]) => (
                <span key={l} className="muted small" style={{ display: "flex", alignItems: "center", gap: 6, textTransform: "uppercase", letterSpacing: ".06em" }}>
                  <i style={{ width: 9, height: 9, borderRadius: 2, background: c, display: "inline-block" }} />{l}
                </span>
              ))}
            </div>
            <div className="list" style={{ marginTop: 14 }}>
              {[...strip].reverse().slice(0, 5).map(e => (
                <div key={e.id} className="list-row">
                  <div className="list-main">
                    <div>Bristol {e.bristol} · <span style={{ color: TONE[e.tone] }}>{prescribe(e.status)?.title || e.status}</span></div>
                    <div className="muted small">{formatShortDate(e.date)} · {e.color} · {e.ease}{(e.flags || []).length ? ` · ${e.flags.join(", ")}` : ""}</div>
                  </div>
                  <button className="x" aria-label="Delete" onClick={() => deleteEntry("stool")(e.id)}>×</button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="muted small">Log an entry and the 14-day trend appears here.</p>
        )}
      </Card>

      <p className="muted small" style={{ textAlign: "center", lineHeight: 1.7, marginTop: 4 }}>
        Personal log · lifestyle guidance only, not medical advice<br />
        Blood, black stool, or changes lasting weeks → see a doctor
      </p>
    </div>
  );
}

export default StoolTracker;
