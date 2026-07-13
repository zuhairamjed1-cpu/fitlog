import { useMemo, useState } from "react";
import { localDateStr } from "../lib/dates";

// ─── ACT urge tracker ("Ride the wave") ──────────────────────────────────────
// Ported from the standalone design, recoloured to the FitLog dark palette,
// wired to data.ejac via addEntry/deleteEntry. Same layout & interactions.

const ACC = "#4fb3bd";   // wave + primary (teal)
const GOOD = "#5fcf80";  // surfed
const CLAY = "#f9c97e";  // peak marker + acted
const PANEL = "#12161d", INNER = "#161b22", LINE = "#262d38";
const TX = "#eef2f6", T2 = "#9aa4b2", MUT = "#6b7480";

const PLACES = ["In bed", "Bathroom", "Desk / room", "Out"];
const CUES = ["Scrolling", "Bored", "Can't sleep", "Stress", "Out of nowhere"];
const BEHAVIORS = ["Surfed it", "Acted — no screen", "Acted — feed", "Acted — porn"];

const chipStyle = active => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 40, padding: "0 15px",
  borderRadius: 999, fontSize: 14, cursor: "pointer", transition: "all .12s",
  border: `1.5px solid ${active ? ACC : LINE}`, background: active ? "rgba(79,179,189,0.14)" : "rgba(255,255,255,0.03)",
  color: active ? "#bfe7ec" : T2, fontWeight: active ? 600 : 500,
});

export function UrgeTracker({ data, addEntry, deleteEntry }) {
  const [draft, setDraft] = useState({ place: "In bed", cue: null, behavior: "Surfed it", peak: 6, after: null, hook: "" });
  const [showDetail, setShowDetail] = useState(false);
  const [saved, setSaved] = useState(null);

  const entries = useMemo(() => (data.ejac || []).filter(e => e && (e.behavior || e.peak != null)), [data.ejac]);

  const setField = (f, v) => { setDraft(d => ({ ...d, [f]: v })); setSaved(null); };
  const setChip = (f, v) => { setDraft(d => ({ ...d, [f]: f === "behavior" ? v : (d[f] === v ? null : v) })); setSaved(null); };

  function log() {
    const now = new Date();
    const entry = {
      id: Date.now(), ts: now.getTime(), date: localDateStr(now),
      place: draft.place || "—", cue: draft.cue || "no clear trigger", behavior: draft.behavior,
      peak: draft.peak, after: draft.after, hook: (draft.hook || "").trim(),
    };
    addEntry("ejac")(entry);
    const surfed = draft.behavior === "Surfed it";
    const drop = draft.after != null ? draft.peak - draft.after : null;
    const msg = surfed ? "Logged — you let the wave pass. That's the rep."
      : (drop != null && drop > 0) ? `Logged. The wave fell ${drop} point${drop > 1 ? "s" : ""} — proof it passes.`
      : "Logged. One row of data, nothing more.";
    setSaved(msg);
    setDraft(d => ({ place: d.place, cue: null, behavior: "Surfed it", peak: 6, after: null, hook: "" }));
  }
  function clearAll() {
    if (typeof window !== "undefined" && !window.confirm("Delete every logged wave?")) return;
    entries.forEach(e => deleteEntry("ejac")(e.id));
    setSaved(null);
  }

  // wave geometry (viewBox 0 0 320 90)
  const hasAfter = draft.after != null;
  const afterVal = hasAfter ? draft.after : Math.max(0, draft.peak - 4);
  const base = 82, top = 12;
  const yFor = v => base - (Math.max(0, Math.min(10, v)) / 10) * (base - top);
  const py = +yFor(draft.peak).toFixed(1), ay = +yFor(afterVal).toFixed(1);
  const line = `M0,${base} C55,${base} 82,${py} 130,${py} S240,${ay} 320,${ay}`;
  const dropText = hasAfter
    ? ((draft.peak - draft.after) > 0 ? `falls ${draft.peak - draft.after} by 10 min` : "holds — that's ok too")
    : "crests here — log where it settles";

  // insights
  const n = entries.length;
  const surfedN = entries.filter(e => e.behavior === "Surfed it").length;
  const withAfter = entries.filter(e => e.after != null);
  const avgDrop = withAfter.length ? (withAfter.reduce((s, e) => s + (e.peak - e.after), 0) / withAfter.length) : null;
  const topTrigger = (() => { if (!n) return "not enough data"; const c = {}; entries.forEach(e => { c[e.cue] = (c[e.cue] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a])[0]; })();
  const cap = { fontSize: 12, letterSpacing: "0.05em", textTransform: "uppercase", color: MUT, fontWeight: 600 };

  const dateShort = e => { try { return new Date(e.ts || (e.date + "T00:00:00")).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return e.date; } };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* header */}
      <div style={cap}>ACT · Urge Log</div>
      <h2 style={{ fontWeight: 600, fontSize: 26, margin: "8px 0 0", color: TX, letterSpacing: "-0.01em" }}>Ride the wave</h2>
      <p style={{ margin: "8px 0 0", color: T2, fontSize: 14.5, lineHeight: 1.55 }}>Every urge is one wave — it crests, then falls, whether or not you act. Log it in a few taps and watch the pattern, not a streak.</p>

      {/* compassion frame */}
      <div style={{ marginTop: 18, background: "rgba(79,179,189,0.08)", border: "1px solid rgba(79,179,189,0.2)", borderRadius: 16, padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: ACC, color: "#04191b", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✦</span>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "#bfe7ec" }}><strong style={{ fontWeight: 700 }}>One log is data, never a verdict.</strong> A lapse is a single row, not a broken streak — the spiral comes from the judgment, not the wave. Log it and carry on the same day.</p>
      </div>

      {/* quick log */}
      <div style={{ marginTop: 22, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 22, overflow: "hidden" }}>
        <div style={{ padding: "20px 22px 6px", background: "linear-gradient(180deg,#161b22 0%,#12161d 100%)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ ...cap, fontSize: 12 }}>This urge</span>
            <span style={{ fontSize: 13, color: T2 }}>The wave {dropText}</span>
          </div>
          <div style={{ position: "relative", marginTop: 6 }}>
            <svg viewBox="0 0 320 90" preserveAspectRatio="none" style={{ width: "100%", height: 96, display: "block" }}>
              <path d={`${line} L320,90 L0,90 Z`} fill="rgba(79,179,189,0.16)" />
              <path d={line} fill="none" stroke={ACC} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={hasAfter ? "none" : "5 5"} />
              <circle cx="130" cy={py} r="4.5" fill={CLAY} />
              <circle cx="320" cy={ay} r="4" fill={ACC} />
            </svg>
            <div style={{ position: "absolute", left: 6, bottom: 4, fontSize: 11, color: MUT }}>calm</div>
            <div style={{ position: "absolute", left: "34%", top: -2, fontSize: 11, color: CLAY, fontWeight: 600 }}>peak {draft.peak}</div>
          </div>
        </div>

        <div style={{ padding: "18px 22px 22px", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* peak slider */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <label style={{ fontSize: 13.5, fontWeight: 600, color: "#c8d0da" }}>How strong is the pull right now?</label>
              <span style={{ fontSize: 30, fontWeight: 600, lineHeight: 1, color: TX, minWidth: 34, textAlign: "right" }}>{draft.peak}</span>
            </div>
            <input type="range" min="0" max="10" step="1" value={draft.peak} onChange={e => setField("peak", Math.round(+e.target.value))} style={{ width: "100%", marginTop: 12, accentColor: CLAY, height: 24 }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: MUT, marginTop: -2 }}><span>barely there</span><span>gripping</span></div>
          </div>

          {/* where */}
          <ChipRow title="Where are you?" opts={PLACES} val={draft.place} onPick={v => setChip("place", v)} />
          {/* what happened */}
          <ChipRow title="What happened?" opts={BEHAVIORS} val={draft.behavior} onPick={v => setChip("behavior", v)} />

          {/* detail toggle */}
          <button onClick={() => setShowDetail(s => !s)} style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, cursor: "pointer", color: ACC, fontSize: 13.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 15 }}>{showDetail ? "–" : "+"}</span>{showDetail ? "Fewer details" : "Add trigger, after-10-min & thought"}
          </button>

          {showDetail && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingTop: 2, animation: "pc-fade .3s ease" }}>
              <ChipRow title="What came just before?" opts={CUES} val={draft.cue} onPick={v => setChip("cue", v)} />
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <label style={{ fontSize: 13.5, fontWeight: 600, color: "#c8d0da" }}>If you waited ~10 min, how strong then?</label>
                  <span style={{ fontSize: 22, fontWeight: 600, color: GOOD, minWidth: 30, textAlign: "right" }}>{hasAfter ? draft.after : "—"}</span>
                </div>
                <input type="range" min="0" max="10" step="1" value={afterVal} onChange={e => setField("after", Math.round(+e.target.value))} style={{ width: "100%", marginTop: 12, accentColor: GOOD, height: 24 }} />
                <button onClick={() => setField("after", null)} style={{ background: "none", border: "none", padding: "4px 0 0", cursor: "pointer", color: MUT, fontSize: 12 }}>didn't wait — skip</button>
              </div>
              <div>
                <label style={cap}>The thought that hooked you</label>
                <input value={draft.hook} onChange={e => setField("hook", e.target.value)} placeholder="Just one, then I'll lock in…"
                  style={{ width: "100%", marginTop: 8, padding: "11px 13px", border: `1px solid ${LINE}`, borderRadius: 12, background: INNER, color: TX, fontSize: 15 }} />
              </div>
            </div>
          )}

          <button onClick={log} style={{ width: "100%", padding: 15, border: "none", borderRadius: 14, background: ACC, color: "#04191b", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>Log this wave</button>
          {saved && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#bfe7ec", marginTop: -4 }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: ACC, color: "#04191b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>✓</span>{saved}
            </div>
          )}
        </div>
      </div>

      {/* insights */}
      <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
        {[["Waves logged", n, PANEL], ["Surfed, not acted", n ? Math.round(surfedN / n * 100) + "%" : "—", "rgba(95,207,128,0.08)"],
          ["Avg wave drop", avgDrop != null ? "↓" + avgDrop.toFixed(1) : "—", PANEL], ["Top trigger", topTrigger, "rgba(249,201,126,0.08)"]].map((s, i) => (
          <div key={i} style={{ background: s[2], border: `1px solid ${LINE}`, borderRadius: 16, padding: "14px 16px" }}>
            <div style={{ ...cap, fontSize: 11 }}>{s[0]}</div>
            <div style={{ fontSize: typeof s[1] === "string" && s[1].length > 6 ? 16 : 26, fontWeight: 700, marginTop: 6, color: TX, lineHeight: 1.15 }}>{s[1]}</div>
          </div>
        ))}
      </div>

      {/* log list */}
      <div style={{ marginTop: 24, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h3 style={{ fontWeight: 600, fontSize: 19, margin: 0, color: TX }}>Your log</h3>
        {n > 0 && <button onClick={clearAll} style={{ padding: "7px 14px", border: `1px solid ${LINE}`, borderRadius: 999, background: INNER, color: MUT, fontSize: 13, cursor: "pointer" }}>Clear</button>}
      </div>

      {n === 0 ? (
        <div style={{ marginTop: 14, background: PANEL, border: `1px dashed ${LINE}`, borderRadius: 18, padding: "32px 20px", textAlign: "center", color: MUT, fontSize: 14.5 }}>
          No waves logged yet. The next urge — acted on or not — is just a few taps above.
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.map(e => {
            const drop = e.after != null ? e.peak - e.after : null;
            const dl = drop == null ? ["crest only", MUT] : drop > 0 ? [`↓ fell ${drop}`, GOOD] : drop === 0 ? ["held", CLAY] : [`rose ${-drop}`, CLAY];
            const surfed = e.behavior === "Surfed it";
            return (
              <div key={e.id} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 16, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 66, flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: TX }}>{dateShort(e)}</div>
                  <div style={{ fontSize: 12, color: MUT, marginTop: 1 }}>{e.place}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", padding: "3px 11px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: surfed ? "rgba(95,207,128,0.14)" : "rgba(249,201,126,0.14)", color: surfed ? GOOD : CLAY }}>{e.behavior}</span>
                    <span style={{ fontSize: 12, color: T2 }}>peak {e.peak} · {e.cue}</span>
                  </div>
                  {e.hook && <div style={{ fontSize: 12.5, color: T2, marginTop: 5, fontStyle: "italic" }}>“{e.hook}”</div>}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: dl[1] }}>{dl[0]}</div>
                  <button onClick={() => deleteEntry("ejac")(e.id)} style={{ marginTop: 4, background: "none", border: "none", color: MUT, cursor: "pointer", fontSize: 16 }}>×</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChipRow({ title, opts, val, onPick }) {
  return (
    <div>
      <div style={{ fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase", color: MUT, fontWeight: 600, marginBottom: 10 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
        {opts.map(o => <button key={o} onClick={() => onPick(o)} style={chipStyle(val === o)}>{o}</button>)}
      </div>
    </div>
  );
}

export default UrgeTracker;
