// ─── Nutrition dashboard SVG builders ───────────────────────────────────────
// Pure functions → SVG strings, rendered via dangerouslySetInnerHTML in
// NutritionTrends. Colours are CSS vars scoped under `.nutx` (see styles.js).
// Ported from the approved redesign mockup.

const V = {
  protein: "var(--nut-protein)", carb: "var(--nut-carb)", fat: "var(--nut-fat)",
  accent: "var(--nut-accent)", teal: "var(--nut-teal)", good: "var(--nut-good)",
  amber: "var(--nut-amber)", red: "var(--nut-red)", text: "var(--nut-text)", muted: "var(--nut-muted)", hair: "var(--nut-hair)",
};
const FF = 'font-family="var(--nut-mono)"';
const fmt = n => Math.round(n).toLocaleString("en-US");
export const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export function smooth(a, w = 5) {
  return a.map((_, i) => { const s = Math.max(0, i - (w >> 1)), e = Math.min(a.length, i + Math.ceil(w / 2)); return mean(a.slice(s, e)); });
}

// Energy ledger: intake bars (capped at maintenance) + amber overflow + the
// maintenance waterline + the weight trend line on a right axis.
export function ledgerSVG(intake, weightSmooth, maint) {
  const W = 372, H = 152, padL = 8, padR = 8, padT = 16, padB = 22, plotW = W - padL - padR, plotH = H - padT - padB;
  const kMin = 1000, kMax = Math.max(2800, maint + 300, ...intake) ;
  const wMin = Math.min(...weightSmooth) - 0.12, wMax = Math.max(...weightSmooth) + 0.12;
  const n = intake.length, gap = n > 20 ? 3 : n > 10 ? 5 : 8, bw = (plotW - gap * (n - 1)) / n;
  const yK = v => padT + plotH * (1 - (v - kMin) / (kMax - kMin));
  const yW = v => (wMax === wMin ? padT + plotH / 2 : padT + plotH * (1 - (v - wMin) / (wMax - wMin)));
  const maintY = yK(maint), base = padT + plotH;
  let svg = "";
  intake.forEach((v, i) => {
    const x = padL + i * (bw + gap), capY = yK(Math.min(v, maint));
    svg += `<rect x="${x}" y="${capY}" width="${bw}" height="${base - capY}" rx="2.5" fill="rgba(79,179,189,.5)"/>`;
    if (v > maint) { const oy = yK(v); svg += `<rect x="${x}" y="${oy}" width="${bw}" height="${maintY - oy}" rx="2.5" fill="${V.amber}" opacity=".9"/>`; }
  });
  svg += `<line x1="${padL}" x2="${W - padR}" y1="${maintY}" y2="${maintY}" stroke="${V.teal}" stroke-width="1.75" opacity=".9"/>`;
  svg += `<text x="${padL + 2}" y="${maintY - 5}" fill="${V.teal}" font-size="8.5" ${FF}>maintenance ${fmt(maint)}</text>`;
  const cx = i => padL + i * (bw + gap) + bw / 2;
  let d = ""; weightSmooth.forEach((v, i) => { d += (i ? "L" : "M") + cx(i).toFixed(1) + " " + yW(v).toFixed(1) + " "; });
  svg += `<path d="${d}" fill="none" stroke="${V.text}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>`;
  weightSmooth.forEach((v, i) => { if (i % Math.ceil(n / 8) === 0 || i === n - 1) svg += `<circle cx="${cx(i)}" cy="${yW(v)}" r="2.2" fill="${V.text}"/>`; });
  [wMax, (wMax + wMin) / 2, wMin].forEach(v => { svg += `<text x="${W - padR + 1}" y="${yW(v) + 3}" fill="${V.muted}" font-size="7.5" text-anchor="end" ${FF}>${v.toFixed(1)}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${svg}</svg>`;
}

// Today macro-segmented calorie ring. segs = [{kcal,color}], goalCal.
export function ringSVG(segs, goalCal) {
  const cx = 63, cy = 63, r = 51, circ = 2 * Math.PI * r;
  let inner = "", acc = 0;
  segs.forEach(s => {
    const frac = Math.min(s.kcal / goalCal, 1), len = frac * circ, vis = Math.max(len - 3, 0);
    inner += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${vis} ${circ - vis}" stroke-dashoffset="${-acc * circ}"/>`;
    acc += frac;
  });
  return `<svg viewBox="0 0 126 126"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.055)" stroke-width="10"/><g transform="rotate(-90 ${cx} ${cy})">${inner}</g></svg>`;
}

// Weight trend: raw scatter + smoothed actual + predicted-from-deficit dashed.
export function weightSVG(raw, pred) {
  const W = 372, H = 118, padL = 6, padR = 26, padT = 10, padB = 14, plotW = W - padL - padR, plotH = H - padT - padB;
  const sm = smooth(raw), n = raw.length;
  const all = raw.concat(pred);
  const wMin = Math.min(...all) - 0.1, wMax = Math.max(...all) + 0.1;
  const x = i => padL + plotW * i / (n - 1 || 1), y = v => (wMax === wMin ? padT + plotH / 2 : padT + plotH * (1 - (v - wMin) / (wMax - wMin)));
  let svg = "";
  let dp = ""; pred.forEach((v, i) => { dp += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1) + " "; });
  svg += `<path d="${dp}" fill="none" stroke="${V.muted}" stroke-width="1.5" stroke-dasharray="4 3" opacity=".7"/>`;
  raw.forEach((v, i) => { svg += `<circle cx="${x(i)}" cy="${y(v)}" r="1.8" fill="${V.muted}" opacity=".55"/>`; });
  let d = ""; sm.forEach((v, i) => { d += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1) + " "; });
  svg += `<path d="${d}" fill="none" stroke="${V.text}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>`;
  [wMax, wMin].forEach(v => { svg += `<text x="${W - padR + 2}" y="${y(v) + 3}" fill="${V.muted}" font-size="7.5" ${FF}>${v.toFixed(1)}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${svg}</svg>`;
}

// Protein adherence strip vs goal.
export function proteinSVG(protein, goal) {
  const W = 372, H = 60, padL = 6, padR = 6, padT = 6, padB = 14, n = protein.length, gap = 4, bw = (W - padL - padR - gap * (n - 1)) / n, plot = H - padT - padB;
  const max = Math.max(...protein, goal) * 1.05 || 1, goalY = padT + plot * (1 - goal / max);
  let svg = "";
  protein.forEach((g, i) => {
    const x = padL + i * (bw + gap), h = plot * g / max, y = padT + plot - h;
    svg += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="2" fill="${g >= goal ? V.protein : "rgba(249,201,126,.35)"}"/>`;
  });
  svg += `<line x1="${padL}" x2="${W - padR}" y1="${goalY}" y2="${goalY}" stroke="${V.protein}" stroke-width="1" stroke-dasharray="3 3" opacity=".6"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${svg}</svg>`;
}

// Water fill column toward a daily goal.
export function waterColSVG(ml, goal) {
  const W = 44, H = 96, pad = 3, r = 10, pct = Math.min(ml / goal, 1) || 0;
  const innerH = H - pad * 2 - 4, fillH = innerH * pct, fy = pad + 2 + (innerH - fillH);
  return `<svg viewBox="0 0 ${W} ${H}">
    <rect x="${pad}" y="${pad}" width="${W - pad * 2}" height="${H - pad * 2}" rx="${r}" fill="none" stroke="${V.hair}" stroke-width="2"/>
    <clipPath id="nwclip"><rect x="${pad + 2}" y="${pad + 2}" width="${W - pad * 2 - 4}" height="${innerH}" rx="${r - 2}"/></clipPath>
    <rect x="${pad + 2}" y="${fy}" width="${W - pad * 2 - 4}" height="${fillH}" fill="${V.carb}" opacity=".85" clip-path="url(#nwclip)"/>
    <text x="${W / 2}" y="${H / 2 + 3}" fill="#04252a" font-size="11" font-weight="700" text-anchor="middle" ${FF}>${Math.round(pct * 100)}%</text>
  </svg>`;
}
