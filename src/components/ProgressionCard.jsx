import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Empty } from "./primitives";
import { computeProgression } from "../engines/progression";

// ─── Progression card ────────────────────────────────────────────────────────
// Read-only overload verdict per lift. Flags-first: lagging lifts up top, the
// rest ("holding or climbing") tucked behind a slide-up sheet grouped by muscle.
// Self-contained dark styling (matches the Claude-design spec exactly).

const C = { good: "#5fcf80", bad: "#f4776a", flat: "#8b95a3", muted: "#59626d", text2: "#9aa4b2", surface2: "#1c232c" };
const ARROW = { up: "▲", down: "▼", flat: "▬" };
const mono = "ui-monospace, 'SF Mono', Menlo, monospace";

const vColor = v => v === "up" ? C.good : v === "down" ? C.bad : v === "flat" ? C.flat : C.muted;
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

function cell(axis, verdict, stale) {
  if (stale || !axis) return { glyph: "–", mag: "", color: C.muted, bg: "transparent", weight: 400 };
  const col = axis.lit ? vColor(verdict) : C.muted;
  return {
    glyph: ARROW[axis.dir] || "–",
    mag: axis.lit && axis.delta ? String(Math.abs(axis.delta)) : "",
    color: col, bg: axis.lit ? C.surface2 : "transparent", weight: axis.lit ? 700 : 400,
  };
}

function mkRow(it) {
  const stale = it.verdict === "stale";
  const carryNote = (it.verdict === "up" || it.verdict === "flat") && it.note ? `  ·  ${it.note}` : "";
  return {
    key: it.key || it.exercise,
    exercise: it.exercise, muscle: it.muscle, verdict: it.verdict, accent: vColor(it.verdict),
    badge: it.verdict === "up" && it.streak > 1 ? "▲" + it.streak : "",
    reason: (it.verdict === "down" || stale) ? (it.note || (stale ? "no recent read" : "")) : "",
    rowBg: it.verdict === "down" ? hexA(C.bad, 0.07) : stale ? hexA(C.muted, 0.08) : "transparent",
    evidence: (it.evidence || "") + carryNote,
    cells: [cell(it.axes?.wt, it.verdict, stale), cell(it.axes?.reps, it.verdict, stale), cell(it.axes?.rir, it.verdict, stale)],
  };
}

function Cells({ cells }) {
  return (
    <span style={{ display: "flex", gap: 4 }}>
      {cells.map((c, i) => (
        <span key={i} style={{ width: 40, textAlign: "center", padding: "3px 0", borderRadius: 6, fontFamily: mono, fontSize: 13, color: c.color, background: c.bg, fontWeight: c.weight }}>
          {c.glyph}{c.mag && <span style={{ fontSize: 10, marginLeft: 1, opacity: 0.85 }}>{c.mag}</span>}
        </span>
      ))}
    </span>
  );
}

const STALE_IN_FLAGS = true;
const SHOW_EVIDENCE = true;

export function ProgressionCard({ data, goals }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const rows = useMemo(() => computeProgression(data, goals), [data, goals]);

  const view = useMemo(() => {
    const scored = rows.filter(r => r.verdict !== "stale");
    const ups = scored.filter(r => r.verdict === "up").length;
    const downs = scored.filter(r => r.verdict === "down").length;
    const holds = scored.length - ups - downs;
    const staleCount = rows.filter(r => r.verdict === "stale").length;

    const momentum = [{ flex: ups, color: C.good }, { flex: holds, color: C.flat }, { flex: downs, color: C.bad }].filter(s => s.flex > 0);
    const legend = [{ color: C.good, n: ups, text: `${ups} up` }, { color: C.flat, n: holds, text: `${holds} holding` }, { color: C.bad, n: downs, text: `${downs} down` }].filter(l => l.n > 0);

    const rank = { down: 0, stale: 1 };
    const flagged = rows.filter(r => r.verdict === "down" || (STALE_IN_FLAGS && r.verdict === "stale"))
      .sort((a, b) => rank[a.verdict] - rank[b.verdict]).map(mkRow);

    const headline = downs > 0 ? `${downs} slipping` : `${ups} up`;
    const headlineColor = downs > 0 ? C.bad : ups > 0 ? C.good : C.flat;

    const restChips = [
      ups ? { color: C.good, text: `▲ ${ups} progressing` } : null,
      holds ? { color: C.flat, text: `▬ ${holds} holding` } : null,
      (!STALE_IN_FLAGS && staleCount) ? { color: C.muted, text: `– ${staleCount} stale` } : null,
    ].filter(Boolean);

    // on-track sheet: up + flat, grouped by muscle in first-seen order
    const order = []; const map = {};
    rows.filter(r => r.verdict === "up" || r.verdict === "flat").forEach(r => { if (!map[r.muscle]) { map[r.muscle] = []; order.push(r.muscle); } map[r.muscle].push(r); });
    const sheetSections = order.map(muscle => {
      const items = map[muscle];
      const up = items.filter(i => i.verdict === "up").length;
      return { title: muscle, count: `${up}/${items.length}`, countColor: up > 0 ? C.good : C.text2, segments: items.map(i => ({ color: vColor(i.verdict) })), rows: items.map(mkRow) };
    });

    return { ups, downs, holds, momentum, legend, flagged, hasFlags: flagged.length > 0, flaggedCount: flagged.length, headline, headlineColor, restChips, sheetSections, onTrackCount: ups + holds };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div style={{ maxWidth: 440, margin: "0 auto", padding: 20, background: "#161b22", border: "1px solid #262d38", borderRadius: 20 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#e9edf2", marginBottom: 4 }}>Progression</div>
        <Empty title="No lifts to compare yet" hint="Log a lift twice and you'll see whether you beat it" />
      </div>
    );
  }

  const { momentum, legend, flagged, hasFlags, flaggedCount, headline, headlineColor, restChips, sheetSections, onTrackCount } = view;

  return (
    <>
      <div style={{ maxWidth: 440, margin: "0 auto", padding: "20px 20px 8px", background: "#161b22", border: "1px solid #262d38", borderRadius: 20 }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 15 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#e9edf2", letterSpacing: "-0.01em" }}>Progression</div>
            <div style={{ fontSize: 13, color: "#6b7480", marginTop: 3 }}>vs. last time you trained each lift</div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: headlineColor, letterSpacing: "-0.02em" }}>{headline}</div>
        </div>

        {/* momentum bar */}
        <div style={{ display: "flex", gap: 3, height: 7, borderRadius: 999, overflow: "hidden", marginBottom: 8 }}>
          {momentum.map((s, i) => <span key={i} style={{ flex: s.flex, background: s.color }} />)}
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#6b7480", marginBottom: 18, fontVariantNumeric: "tabular-nums" }}>
          {legend.map((l, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: l.color }} />{l.text}
            </span>
          ))}
        </div>

        {/* flags */}
        {hasFlags && (
          <>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#f4776a", fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 7 }}>
              <span>Needs a look</span><span style={{ color: "#59626d", fontWeight: 700 }}>{flaggedCount}</span>
            </div>
            {flagged.map(it => (
              <div key={it.key} style={{ padding: "10px 11px", borderRadius: 11, background: it.rowBg, borderLeft: `3px solid ${it.accent}`, marginBottom: 5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e7ee", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.exercise}</div>
                    <div style={{ fontSize: 11, color: "#5a636e", marginTop: 2 }}>{it.muscle}{it.reason ? ` · ${it.reason}` : ""}</div>
                  </div>
                  <Cells cells={it.cells} />
                </div>
                {SHOW_EVIDENCE && <div style={{ fontSize: 12, color: "#5a636e", fontFamily: mono, marginTop: 6 }}>{it.evidence}</div>}
              </div>
            ))}
          </>
        )}

        {/* all clear */}
        {!hasFlags && (
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "14px 12px", borderRadius: 12, background: "rgba(95,207,128,0.07)", border: "1px solid rgba(95,207,128,0.2)" }}>
            <span style={{ fontSize: 20 }}>✓</span>
            <div style={{ fontSize: 13.5, color: "#bfe6cc", lineHeight: 1.35 }}>Nothing slipping — every lift is holding or climbing.</div>
          </div>
        )}

        {/* view all */}
        {sheetSections.length > 0 && (
          <button onClick={() => setSheetOpen(true)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", margin: "10px 0 12px", padding: "12px 6px", background: "transparent", border: "none", borderTop: "1px solid #1f2630", cursor: "pointer", textAlign: "left" }}>
            <span style={{ display: "flex", gap: 16, flex: 1, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              {restChips.map((ch, i) => <span key={i} style={{ color: ch.color, fontWeight: 600 }}>{ch.text}</span>)}
            </span>
            <span style={{ fontSize: 12.5, color: "#6b7480", fontWeight: 600 }}>View all →</span>
          </button>
        )}
      </div>

      {/* sheet */}
      {sheetOpen && createPortal(
        <div onClick={() => setSheetOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(6,9,13,0.7)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50, animation: "pc-fade 0.18s ease" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, maxHeight: "82vh", overflowY: "auto", background: "#161b22", border: "1px solid #262d38", borderBottom: "none", borderRadius: "22px 22px 0 0", padding: "8px 20px 26px", animation: "pc-rise 0.24s cubic-bezier(0.22,1,0.36,1)" }}>
            <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 12px" }}><span style={{ width: 38, height: 4, borderRadius: 999, background: "#333c47" }} /></div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 18 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#e9edf2", letterSpacing: "-0.01em" }}>Everything on track</div>
                <div style={{ fontSize: 12.5, color: "#6b7480", marginTop: 2 }}>{onTrackCount} lifts holding or climbing</div>
              </div>
              <button onClick={() => setSheetOpen(false)} style={{ width: 30, height: 30, borderRadius: 999, background: "#1c232c", border: "none", color: "#aab3bf", fontSize: 15, cursor: "pointer" }}>✕</button>
            </div>

            {sheetSections.map((sec, si) => (
              <div key={si} style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8b95a3" }}>{sec.title}</span>
                  <span style={{ display: "flex", gap: 3, width: 56 }}>
                    {sec.segments.map((s, i) => <span key={i} style={{ flex: 1, height: 6, borderRadius: 2, minWidth: 4, background: s.color }} />)}
                  </span>
                  <span style={{ flex: 1, height: 1, background: "#1f2630" }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: sec.countColor, fontVariantNumeric: "tabular-nums" }}>{sec.count}</span>
                </div>
                {sec.rows.map(it => (
                  <div key={it.key} style={{ padding: "9px 4px 9px 11px", borderBottom: "1px solid #1a2029", borderLeft: `3px solid ${it.accent}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: "#e2e7ee", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.exercise}</span>
                          {it.badge && <span style={{ fontSize: 11, fontWeight: 700, color: "#7c8592" }}>{it.badge}</span>}
                        </div>
                      </div>
                      <Cells cells={it.cells} />
                    </div>
                    {SHOW_EVIDENCE && <div style={{ fontSize: 12, color: "#545d68", fontFamily: mono, marginTop: 5 }}>{it.evidence}</div>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default ProgressionCard;
