import { useMemo, useState } from "react";
import { Card } from "./primitives";
import { computeVolume } from "../engines/volume";
import { MUSCLE_GROUPS, SUBGROUP_BY_ID } from "../engines/muscleGroups";
import { getTodayStr } from "../lib/dates";

// ─── Weekly set targets per muscle subgroup ──────────────────────────────────
// Writes goals.subgroupTargets[subId] (the source of truth for this card) and
// derives goals.goalPlan.volumeTargets[muscleKey] = Σ subgroup targets that map
// to that key — the dormant hook computeVolume already reads. Engine untouched.

// Rebuild the per-muscle-key target map from all subgroup targets.
function deriveVolumeTargets(subTargets) {
  const out = {};
  Object.entries(subTargets || {}).forEach(([subId, val]) => {
    const s = SUBGROUP_BY_ID[subId];
    if (!s || !(val > 0)) return;
    out[s.muscle] = (out[s.muscle] || 0) + val;
  });
  return out;
}

export function SetTargetsCard({ data, goals, onSaveGoals }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const subTargets = goals.subgroupTargets || {};

  // this-week hard sets per muscle key
  const setsByKey = useMemo(() => {
    const vol = computeVolume(data, goals, getTodayStr(), 0);
    const o = {};
    (vol.muscles || []).forEach(m => { o[m.key] = m.thisWeek; });
    return o;
  }, [data, goals]);

  const setTarget = (subId, raw) => {
    const val = Math.max(0, Math.min(40, Math.round(Number(raw) || 0)));
    const st = { ...subTargets };
    if (val > 0) st[subId] = val; else delete st[subId];
    onSaveGoals({ ...goals, subgroupTargets: st, goalPlan: { ...(goals.goalPlan || {}), volumeTargets: deriveVolumeTargets(st) } });
  };

  const totalSet = Object.values(subTargets).filter(v => v > 0).length;

  return (
    <Card title="Weekly set targets" sub="Your goal hard sets per muscle subgroup"
      action={<button className="btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>{open ? "Hide ▾" : `Set ▸`}</button>}>
      {open && (
        <>
          <div style={{ margin: "4px 0 10px" }}>
            {MUSCLE_GROUPS.map(g => {
              const isC = !!collapsed[g.id];
              const groupTot = g.subs.reduce((a, s) => a + (subTargets[s.id] || 0), 0);
              return (
                <div key={g.id} style={{ marginBottom: 4 }}>
                  <button onClick={() => setCollapsed(c => ({ ...c, [g.id]: !c[g.id] }))}
                    style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 8px", background: "var(--bg-2)", border: "none", borderRadius: 8, cursor: "pointer", color: "var(--text)" }}>
                    <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".02em" }}>{g.label}</span>
                    <span className="muted small">{groupTot > 0 ? `${groupTot} sets/wk · ` : ""}{g.subs.length} <span style={{ opacity: .7 }}>{isC ? "▸" : "▾"}</span></span>
                  </button>
                  {!isC && g.subs.map(s => {
                    const target = subTargets[s.id] || 0;
                    const cur = setsByKey[s.muscle] || 0;
                    const pct = target > 0 ? Math.min(100, Math.round((cur / target) * 100)) : 0;
                    const hit = target > 0 && cur >= target;
                    return (
                      <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: "1px solid var(--line)" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="small" style={{ color: "var(--text)" }}>{s.label}</div>
                          {target > 0 && (
                            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5 }}>
                              <div style={{ flex: 1, height: 5, borderRadius: 999, background: "var(--bg-2)", overflow: "hidden", maxWidth: 140 }}>
                                <div style={{ width: `${pct}%`, height: "100%", background: hit ? "var(--good)" : "var(--accent)" }} />
                              </div>
                              <span className="small" style={{ color: hit ? "var(--good)" : "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>{cur}/{target}</span>
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flex: "none" }}>
                          <button className="btn-ghost btn-sm" style={{ padding: "4px 10px" }} onClick={() => setTarget(s.id, target - 1)} disabled={target <= 0}>−</button>
                          <input type="number" value={target || ""} placeholder="0" min={0} max={40}
                            onChange={e => setTarget(s.id, e.target.value)}
                            style={{ width: 46, textAlign: "center", background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 4px", fontSize: 14 }} />
                          <button className="btn-ghost btn-sm" style={{ padding: "4px 10px" }} onClick={() => setTarget(s.id, target + 1)}>+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <p className="muted small" style={{ lineHeight: 1.45 }}>
            {totalSet > 0 ? `${totalSet} subgroup${totalSet === 1 ? "" : "s"} targeted. ` : ""}Progress bars show this week's hard sets vs your target. Targets feed the muscle-volume model — leave a subgroup at 0 to fall back to the default range.
          </p>
        </>
      )}
    </Card>
  );
}

export default SetTargetsCard;
