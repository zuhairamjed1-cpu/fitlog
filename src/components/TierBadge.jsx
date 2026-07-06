// Shared confidence-tier badge — used by the Training analysis and Goal-plan views.
export function TierBadge({ tier }) {
  const M = { measured: ["Measured", "#5cc8df"], calc: ["Calculated", "#8fd989"], estimate: ["Estimated", "#f9c97e"], forecast: ["Forecast", "#aab2c0"] };
  const [label, color] = M[tier] || M.estimate;
  return <span className="tier-badge" style={{ color, borderColor: `${color}55` }}>{label}</span>;
}
