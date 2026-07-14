import { deriveStatus, metricLabel } from "../lib/experiments";
import { getTodayStr } from "../lib/dates";

// ─── ExperimentBands ────────────────────────────────────────────────────────
// Absolutely-positioned overlay that shades experiment windows on a date-scaled
// chart. `dates` = ordered ISO date strings matching the chart's x-domain (the
// series). Only experiments whose metric.source matches `source` are shown. Caps
// at the 2 most recent to avoid noise. Wrap the chart in position:relative.
const COL = { active: "#4fb3bd", planned: "#8b95a3", done: "#5fcf80" };

export function ExperimentBands({ dates, source, experiments, onOpen }) {
  if (!dates || dates.length < 2 || !experiments) return null;
  const first = dates[0], last = dates[dates.length - 1];
  const span = new Date(last + "T00:00:00") - new Date(first + "T00:00:00");
  if (span <= 0) return null;
  const frac = d => Math.max(0, Math.min(1, (new Date(d + "T00:00:00") - new Date(first + "T00:00:00")) / span));
  const today = getTodayStr();

  const bands = experiments
    .filter(e => e.metric?.source === source && e.endDate >= first && e.startDate <= last)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .slice(0, 2)
    .map(e => {
      const l = frac(e.startDate < first ? first : e.startDate);
      const r = frac(e.endDate > last ? last : e.endDate);
      const st = deriveStatus(e, today);
      return { e, left: l * 100, width: Math.max(1.5, (r - l) * 100), color: COL[st] || COL.done };
    });
  if (!bands.length) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 }}>
      {bands.map(b => (
        <div key={b.e.id} onClick={() => onOpen && onOpen(b.e.id)} title={`${b.e.title} · ${metricLabel(b.e.metric)}`}
          style={{ position: "absolute", left: `${b.left}%`, width: `${b.width}%`, top: 0, bottom: 0,
            background: b.color, opacity: 0.09, borderLeft: `1px solid ${b.color}`, pointerEvents: onOpen ? "auto" : "none", cursor: onOpen ? "pointer" : "default" }}>
          <span style={{ position: "absolute", top: 1, left: 3, fontSize: 8.5, color: b.color, opacity: 1.6, whiteSpace: "nowrap", fontWeight: 600 }}>{b.e.title.slice(0, 12)}</span>
        </div>
      ))}
    </div>
  );
}

export default ExperimentBands;
