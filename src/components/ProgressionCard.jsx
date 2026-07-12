import { useMemo, useState } from "react";
import { Card, Empty } from "./primitives";
import { computeProgression, groupProgression } from "../engines/progression";

// Read-only overload verdict card. One row per exercise, grouped by primary
// muscle. Colour is a bonus channel — arrows carry the meaning in greyscale.

const ARROW = { up: "▲", down: "▼", flat: "▬" };
const VERDICT_COLOR = { up: "var(--good)", down: "var(--bad)", flat: "var(--text-2)", stale: "var(--muted)" };
const COLLAPSE_KEY = "fitlog_prog_collapsed";

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}"); } catch { return {}; }
}

// One axis cell. Only the deciding cell is lit; unlit cells still show their arrow.
function AxisCell({ axis, lit, verdict, showDelta }) {
  const mag = showDelta && axis.delta != null && axis.delta !== 0 ? Math.abs(axis.delta) : null;
  return (
    <span className={`prog-cell ${lit ? "lit" : ""}`} style={lit ? { color: VERDICT_COLOR[verdict], background: "var(--surface-2)" } : undefined}>
      {ARROW[axis.dir] || "–"}{mag != null ? <span className="prog-cell-d">{mag}</span> : null}
    </span>
  );
}

function Row({ r }) {
  const badge = r.verdict === "up" && r.streak > 1 ? `▲${r.streak}`
    : r.verdict === "flat" && r.flatStreak > 1 ? `▬${r.flatStreak}` : null;
  const stale = r.verdict === "stale";
  return (
    <div className="prog-row">
      <div className="prog-row-head">
        <span className="prog-name" style={{ color: VERDICT_COLOR[r.verdict] }}>{r.exercise}</span>
        {badge && <span className="prog-streak">{badge}</span>}
        <span className="prog-cells">
          {stale ? (
            <><span className="prog-cell">–</span><span className="prog-cell">–</span><span className="prog-cell">–</span></>
          ) : (
            <>
              <AxisCell axis={r.axes.wt} lit={r.axes.wt.lit} verdict={r.verdict} />
              <AxisCell axis={r.axes.reps} lit={r.axes.reps.lit} verdict={r.verdict} showDelta />
              <AxisCell axis={r.axes.rir} lit={r.axes.rir.lit} verdict={r.verdict} />
            </>
          )}
        </span>
      </div>
      <div className="prog-evidence muted">
        {r.evidence}
        {r.note && <span className="prog-note"> · {r.note}</span>}
        {!r.note && <span className="prog-note"> · {r.daysSince}d</span>}
      </div>
    </div>
  );
}

function Group({ g, collapsed, onToggle }) {
  return (
    <div className="prog-group">
      <button className="prog-group-head" onClick={onToggle}>
        <span className="prog-group-name">{g.muscle}</span>
        <span className="prog-group-sum muted">
          {g.upCount}/{g.total}
          {g.regressed && <span className="prog-dot" title="a lift regressed" />}
        </span>
        <span className="prog-chev muted">{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && (
        <>
          <div className="prog-colhead muted">
            <span className="prog-name" />
            <span className="prog-cells"><span className="prog-cell">wt</span><span className="prog-cell">rep</span><span className="prog-cell">rir</span></span>
          </div>
          {g.items.map(r => <Row key={r.key} r={r} />)}
        </>
      )}
    </div>
  );
}

export function ProgressionCard({ data, goals }) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const groups = useMemo(
    () => groupProgression(computeProgression(data.exercise || [], (goals && goals.exerciseMap) || {})),
    [data.exercise, goals && goals.exerciseMap]
  );

  function toggle(muscle) {
    setCollapsed(prev => {
      const next = { ...prev, [muscle]: !prev[muscle] };
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  return (
    <Card title="Progression" sub="Did you overload vs last time?">
      {groups.length === 0 ? (
        <Empty title="No lifts to compare yet" hint="Log a lift twice and its overload verdict shows up here" />
      ) : (
        <div className="prog-list">
          {groups.map(g => <Group key={g.muscle} g={g} collapsed={!!collapsed[g.muscle]} onToggle={() => toggle(g.muscle)} />)}
        </div>
      )}
    </Card>
  );
}

export default ProgressionCard;
