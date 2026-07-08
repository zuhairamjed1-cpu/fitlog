import { useMemo, useState, useId } from "react";
import { Card, Empty } from "./primitives";
import { getTodayStr, formatShortDate } from "../lib/dates";
import { creatineDailyIntake, saturationSeries, washoutProjection, targetForDay } from "../engines/creatine";

// ─── CREATINE INTAKE + SATURATION ───────────────────────────────────────────
// Daily intake as bars + modeled muscle saturation (0–100%) as a line, with an
// optional loading phase and a "what if I stop" washout projection. Calibrated
// approximation — see caption.
export function CreatineSaturationCard({ data }) {
  const uid = useId().replace(/:/g, "");
  const today = getTodayStr();
  const history = useMemo(() => creatineDailyIntake(data.supplements, today), [data.supplements, today]);

  const [loadingOn, setLoadingOn] = useState(true);
  const [targetGrams, setTargetGrams] = useState(20);
  const [durationDays, setDurationDays] = useState(6);
  const [maintenanceGrams, setMaintenanceGrams] = useState(5);
  const [projectStop, setProjectStop] = useState(true);
  const projectionDays = 45;

  const model = useMemo(() => {
    if (!history.length) return null;
    const config = { loading: { enabled: loadingOn, targetGrams, durationDays }, maintenanceGrams, projectionDays };
    const histG = history.map(d => d.grams);
    const projG = projectStop ? Array(projectionDays).fill(0) : [];
    const allG = [...histG, ...projG];
    const sat = saturationSeries(allG);
    const targets = history.map((_, i) => targetForDay(i, config));
    const nHist = history.length;
    const curSat = sat[nHist - 1] ?? 0;
    const curTarget = targetForDay(nHist - 1, config);
    const inLoading = loadingOn && (nHist - 1) < durationDays;
    const wash = washoutProjection(curSat);
    return { config, allG, sat, targets, nHist, curSat, curTarget, inLoading, wash };
  }, [history, loadingOn, targetGrams, durationDays, maintenanceGrams, projectStop]);

  const [hover, setHover] = useState(null);

  if (!history.length) {
    return (
      <Card title="Creatine saturation" sub="intake vs modeled muscle saturation">
        <Empty icon="⬦" title="No creatine logged yet" hint="Log creatine as a supplement (with a dose like “5 g”) and this chart models how full your muscle stores are — and how fast they’d wash out if you stopped." />
      </Card>
    );
  }

  // ── layout ──
  const W = 700, H = 230, padL = 30, padR = 34, padT = 14, padB = 26;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const { allG, sat, targets, nHist, curSat, curTarget, inLoading, wash, config } = model;
  const N = allG.length;
  const gMax = Math.max(6, targetGrams, ...history.map(d => d.grams)) * 1.12;
  const x = i => padL + (N <= 1 ? chartW / 2 : (i / (N - 1)) * chartW);
  const bw = Math.max(1.5, Math.min(16, (chartW / N) * 0.62));
  const yG = g => padT + chartH - (g / gMax) * chartH;
  const yS = s => padT + chartH - s * chartH;

  const barColor = (g, i) => {
    if (i >= nHist) return "var(--muted)";       // projected (ghost)
    if (g <= 0) return "var(--muted)";           // missed
    return g >= targets[i] ? "var(--accent)" : "#f9c97e"; // met vs below
  };

  // stepped target line across the logged region
  const targetPts = [];
  for (let i = 0; i < nHist; i++) { const xi = x(i); targetPts.push([xi, yG(targets[i])]); if (i < nHist - 1 && targets[i] !== targets[i + 1]) targetPts.push([x(i + 1), yG(targets[i])]); }
  const targetPath = targetPts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

  // saturation polylines (history solid, projection dashed)
  const satPt = i => `${x(i).toFixed(1)},${yS(sat[i]).toFixed(1)}`;
  const histLine = sat.slice(0, nHist).map((_, i) => satPt(i)).join(" ");
  const projLine = nHist > 0 && N > nHist ? [satPt(nHist - 1), ...sat.slice(nHist).map((_, i) => satPt(nHist + i))].join(" ") : "";

  const loadEndX = loadingOn ? x(Math.min(durationDays, nHist) - 0.5 + 0.5) : null;
  const todayX = x(nHist - 1);
  const reduce = { transition: "none" };

  const markers = [];
  if (projectStop) {
    const add = (day, label, cls) => { if (day != null && day <= (N - nHist)) markers.push({ i: nHist - 1 + day, label, cls }); };
    add(wash.below90, "−90%", "warn");
    add(wash.below50, "−50%", "warn");
    add(wash.below5, "unsaturated", "bad");
  }

  const pct = s => `${Math.round(s * 100)}%`;

  return (
    <Card title="Creatine saturation" sub="daily intake vs modeled muscle saturation">
      {/* readout strip */}
      <div className="creat-readout">
        <div className="creat-chip"><span className="creat-chip-v" style={{ color: "var(--accent)" }}>{pct(curSat)}</span><span className="creat-chip-l">saturated now</span></div>
        <div className="creat-chip"><span className="creat-chip-v">{curTarget}g</span><span className="creat-chip-l">{inLoading ? "loading target" : "maintenance"}</span></div>
        {projectStop && <div className="creat-chip"><span className="creat-chip-v">{wash.below5 ?? "—"}<small>d</small></span><span className="creat-chip-l">to unsaturated</span></div>}
      </div>

      {/* controls */}
      <div className="creat-controls">
        <label className="creat-switch">
          <input type="checkbox" checked={loadingOn} onChange={e => setLoadingOn(e.target.checked)} />
          <span>Loading phase</span>
        </label>
        {loadingOn && <>
          <label className="creat-num">Dose<input type="number" min="3" max="30" value={targetGrams} onChange={e => setTargetGrams(Math.max(0, +e.target.value || 0))} /><span>g</span></label>
          <label className="creat-num">for<input type="number" min="1" max="14" value={durationDays} onChange={e => setDurationDays(Math.max(1, +e.target.value || 1))} /><span>days</span></label>
        </>}
        <label className="creat-num">Maintain<input type="number" min="1" max="15" value={maintenanceGrams} onChange={e => setMaintenanceGrams(Math.max(1, +e.target.value || 1))} /><span>g</span></label>
        <label className="creat-switch">
          <input type="checkbox" checked={projectStop} onChange={e => setProjectStop(e.target.checked)} />
          <span>Project a stop</span>
        </label>
      </div>

      {/* chart */}
      <div className="creat-chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="creat-svg" preserveAspectRatio="none" role="img" aria-label={`Creatine intake and modeled saturation, currently ${pct(curSat)} saturated`}>
          <defs>
            <linearGradient id={`cg-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.35" />
            </linearGradient>
            <linearGradient id={`cs-${uid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#7cc4a0" />
              <stop offset="100%" stopColor="#6ee7f7" />
            </linearGradient>
          </defs>

          {/* projection region + loading band */}
          {projectStop && N > nHist && <rect x={todayX} y={padT} width={x(N - 1) - todayX} height={chartH} fill="var(--muted)" opacity="0.06" />}
          {loadingOn && durationDays > 0 && <rect x={padL - bw / 2} y={padT} width={x(Math.min(durationDays, nHist) - 1) - (padL - bw / 2) + bw} height={chartH} fill="var(--accent)" opacity="0.07" />}

          {/* % gridlines */}
          {[0, 0.5, 1].map(g => (
            <g key={g}>
              <line x1={padL} y1={yS(g)} x2={W - padR} y2={yS(g)} stroke="var(--line)" strokeWidth="1" opacity="0.5" />
              <text x={W - padR + 4} y={yS(g) + 3} className="creat-axis">{g * 100}%</text>
            </g>
          ))}

          {/* bars */}
          {allG.map((g, i) => {
            const h = g > 0 ? Math.max(2, (padT + chartH) - yG(g)) : 2;
            const proj = i >= nHist;
            return <rect key={i} x={x(i) - bw / 2} y={g > 0 ? yG(g) : padT + chartH - 2} width={bw} height={h} rx={Math.min(2, bw / 2)}
              fill={i < nHist && g > 0 && g >= targets[i] ? `url(#cg-${uid})` : barColor(g, i)}
              opacity={proj ? 0.18 : g > 0 ? 1 : 0.28} style={reduce} />;
          })}

          {/* stepped target line */}
          <path d={targetPath} fill="none" stroke="var(--text-2)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.7" />

          {/* today divider */}
          {projectStop && N > nHist && <line x1={todayX} y1={padT} x2={todayX} y2={padT + chartH} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />}

          {/* saturation line */}
          <polyline points={histLine} fill="none" stroke={`url(#cs-${uid})`} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" style={reduce} />
          {projLine && <polyline points={projLine} fill="none" stroke="#6ee7f7" strokeWidth="2" strokeDasharray="5 4" opacity="0.7" strokeLinecap="round" />}

          {/* washout markers */}
          {markers.map((m, k) => (
            <g key={k}>
              <circle cx={x(m.i)} cy={yS(sat[m.i])} r="3" fill={m.cls === "bad" ? "var(--bad)" : "#f9c97e"} stroke="var(--bg)" strokeWidth="1.5" />
            </g>
          ))}

          {/* hover hit-areas + marker */}
          {allG.map((_, i) => (
            <rect key={`h${i}`} x={x(i) - (chartW / N) / 2} y={padT} width={chartW / N} height={chartH} fill="transparent"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(h => h === i ? null : h)} />
          ))}
          {hover != null && <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + chartH} stroke="var(--accent)" strokeWidth="1" opacity="0.4" />}
          {hover != null && <circle cx={x(hover)} cy={yS(sat[hover])} r="3.5" fill="#6ee7f7" stroke="var(--bg)" strokeWidth="1.5" />}
        </svg>

        {hover != null && (() => {
          const proj = hover >= nHist;
          const dateStr = proj ? `+${hover - nHist + 1}d (projected)` : formatShortDate(history[hover].date);
          const g = allG[hover];
          const leftPct = ((x(hover)) / W) * 100;
          return (
            <div className="creat-tip" style={{ left: `${leftPct}%` }}>
              <div className="creat-tip-d">{dateStr}</div>
              <div className="creat-tip-r"><span>Intake</span><b>{proj ? "0g (stopped)" : `${g}g`}</b></div>
              {!proj && <div className="creat-tip-r"><span>Target</span><b>{targets[hover]}g</b></div>}
              <div className="creat-tip-r"><span>Saturation</span><b style={{ color: "#6ee7f7" }}>{pct(sat[hover])}</b></div>
            </div>
          );
        })()}
      </div>

      {/* legend + washout callout */}
      <div className="creat-legend">
        <span><i style={{ background: "var(--accent)" }} />met target</span>
        <span><i style={{ background: "#f9c97e" }} />below</span>
        <span><i style={{ background: "var(--muted)", opacity: 0.4 }} />missed</span>
        <span><i className="creat-legend-line" />saturation</span>
      </div>
      {projectStop && wash.below5 != null && (
        <p className="creat-callout">◇ Stop today → <strong>fully unsaturated in ~{wash.below5} days</strong>{wash.below90 != null ? ` · below 90% in ${wash.below90}d` : ""}{wash.below50 != null ? ` · half gone by ${wash.below50}d` : ""}.</p>
      )}
      <p className="creat-caption">A calibrated approximation of monohydrate kinetics — directional, not a medical predictor.</p>
    </Card>
  );
}
