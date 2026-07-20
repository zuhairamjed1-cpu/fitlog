// ─── Sleep dashboard SVG builders ───────────────────────────────────────────
// Pure functions → SVG markup strings, rendered via dangerouslySetInnerHTML in
// SleepSection. Colours are CSS vars scoped under `.sleepx` (see styles.js), so
// they theme automatically. Ported from the approved redesign mockup.

const V = {
  deep: "var(--gh-deep)", rem: "var(--gh-rem)", light: "var(--gh-light)", awake: "var(--gh-awake)",
  accent: "var(--gh-accent)", teal: "var(--gh-teal)", good: "var(--gh-good)",
  amber: "var(--gh-amber)", red: "var(--gh-red)", hair: "var(--gh-hair)", muted: "var(--gh-muted)", text: "var(--gh-text)",
};

export const fmtClock = m => { m = ((m % 1440) + 1440) % 1440; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
export const hm = mins => { const h = Math.floor(mins / 60), m = Math.round(mins % 60); return h ? `${h}h${m ? String(m).padStart(2, "0") : ""}` : `${m}m`; };
export const scoreColor = s => s >= 80 ? V.good : s >= 70 ? V.accent : s >= 60 ? V.amber : V.red;
const polar = (cx, cy, r, deg) => { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
const arcPath = (cx, cy, r, s, e) => { const [x1, y1] = polar(cx, cy, r, s), [x2, y2] = polar(cx, cy, r, e); const large = (e - s) % 360 > 180 ? 1 : 0; return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`; };
const FF = 'font-family="var(--gh-font)"';

// Segmented score donut with per-segment gradients, soft glow, rounded caps.
export function ringSVG(parts) {
  const cx = 86, cy = 86, r = 62, sw = 12, Circ = 2 * Math.PI * r, ppt = Circ / 100, gapPt = 2.2;
  const solid = { Efficiency: V.teal, Deep: V.deep, REM: V.rem, Calm: V.good };
  let defs = `<filter id="ghGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="4.5"/></filter>`;
  let glow = "", ring = "";
  let cum = 0;
  parts.forEach((seg) => {
    const c = seg.color || solid[seg.key] || V.teal;
    const len = Math.max(0, seg.pts * ppt - gapPt);
    const dash = `${len} ${Circ - len}`;
    const off = -cum * ppt;
    glow += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="10" stroke-dasharray="${dash}" stroke-dashoffset="${off}" stroke-linecap="round" opacity=".35" filter="url(#ghGlow)"/>`;
    ring += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-dasharray="${dash}" stroke-dashoffset="${off}" stroke-linecap="round"/>`;
    cum += seg.pts;
  });
  const track = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.045)" stroke-width="${sw}"/>`;
  return `<svg viewBox="0 0 172 172"><defs>${defs}</defs><g transform="rotate(-90 86 86)">${track}${glow}${ring}</g></svg>`;
}

// Hypnogram — connected ribbon with soft lane tracks + gradient bands.
// h = { bedMin, total, segs:[{type,start,min}] }.
export function hypnoSVG(h) {
  const W = 700, H = 190, padL = 8, padR = 8, padT = 12, plotH = H - padT - 30, plotW = W - padL - padR;
  const lanes = ["AWAKE", "REM", "LIGHT", "DEEP"];
  const order = { AWAKE: 0, REM: 1, LIGHT: 2, DEEP: 3 };
  const colorOf = { AWAKE: V.awake, REM: V.rem, LIGHT: V.light, DEEP: V.deep };
  const laneH = plotH / 4, band = laneH * 0.46, radius = band / 2;
  const laneY = i => padT + (i + 0.5) * laneH;
  const x = off => padL + (off / h.total) * plotW;

  let defs = "";
  lanes.forEach(t => {
    defs += `<linearGradient id="ghg-${t}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colorOf[t]}" stop-opacity="1"/><stop offset="1" stop-color="${colorOf[t]}" stop-opacity=".72"/></linearGradient>`;
  });

  let tracks = "";
  lanes.forEach((t, i) => {
    tracks += `<rect x="${padL}" y="${laneY(i) - band / 2}" width="${plotW}" height="${band}" rx="${radius}" fill="${colorOf[t]}" opacity=".07"/>`;
  });

  // hour gridlines + labels
  let grid = "";
  const firstHour = (60 - (h.bedMin % 60)) % 60;
  for (let off = firstHour; off <= h.total; off += 60) {
    const gx = x(off);
    grid += `<line x1="${gx}" y1="${padT - 4}" x2="${gx}" y2="${padT + plotH + 2}" stroke="${V.hair}" stroke-width="1" opacity=".7"/>`;
    grid += `<text x="${gx}" y="${H - 9}" fill="${V.muted}" font-size="11" text-anchor="middle" ${FF}>${fmtClock(h.bedMin + off)}</text>`;
  }

  // connectors (risers) between consecutive stages — subtle, behind bands
  let risers = "";
  for (let i = 0; i < h.segs.length - 1; i++) {
    const bx = x(h.segs[i + 1].start);
    const y1 = laneY(order[h.segs[i].type] ?? 2), y2 = laneY(order[h.segs[i + 1].type] ?? 2);
    risers += `<line x1="${bx}" y1="${y1}" x2="${bx}" y2="${y2}" stroke="rgba(255,255,255,.16)" stroke-width="2" stroke-linecap="round"/>`;
  }

  // stage bands (gradient, rounded)
  let bands = "";
  h.segs.forEach(s => {
    const bx = x(s.start), bw = Math.max(band, x(s.start + s.min) - x(s.start)), cy = laneY(order[s.type] ?? 2);
    bands += `<rect x="${bx}" y="${cy - band / 2}" width="${bw}" height="${band}" rx="${radius}" fill="url(#ghg-${s.type})"/>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><defs>${defs}</defs>${tracks}${grid}${risers}${bands}</svg>`;
}

// TST bars vs need. series = [{value|null}], need = hours.
export function tstStripSVG(series, need) {
  const W = 680, H = 176, padL = 8, padR = 44, padT = 14, plotW = W - padL - padR, plotH = H - padT - 22;
  const vals = series.map(p => (p && p.value != null ? p.value : 0));
  const maxV = Math.max(need + 1, ...vals) || 9;
  const y = v => padT + plotH - (v / maxV) * plotH;
  const n = series.length, slot = plotW / n, bw = slot * 0.56, needY = y(need);
  let svg = "";
  vals.forEach((v, i) => { if (v > 0 && v < need) { const bx = padL + i * slot + (slot - bw) / 2; svg += `<rect x="${bx}" y="${needY}" width="${bw}" height="${y(v) - needY}" fill="rgba(244,126,110,.16)" rx="2"/>`; } });
  vals.forEach((v, i) => {
    if (v <= 0) return;
    const bx = padL + i * slot + (slot - bw) / 2, top = y(v), last = i === n - 1;
    const fill = last ? V.teal : v >= need ? "rgba(110,231,247,.55)" : "rgba(146,159,172,.5)";
    svg += `<rect x="${bx}" y="${top}" width="${bw}" height="${padT + plotH - top}" rx="3" fill="${fill}"/>`;
    if (v >= need) svg += `<rect x="${bx}" y="${top}" width="${bw}" height="3" rx="1.5" fill="${V.good}"/>`;
    if (last) svg += `<rect x="${bx - 1.5}" y="${top - 1.5}" width="${bw + 3}" height="${padT + plotH - top + 1.5}" rx="4" fill="none" stroke="${V.teal}" stroke-width="1.5" opacity=".9"/>`;
  });
  svg += `<line x1="${padL}" y1="${needY}" x2="${padL + plotW}" y2="${needY}" stroke="${V.amber}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  svg += `<text x="${W - padR + 6}" y="${needY - 4}" fill="${V.amber}" font-size="11" ${FF}>need</text>`;
  svg += `<text x="${W - padR + 6}" y="${needY + 9}" fill="${V.amber}" font-size="11" ${FF}>${need}h</text>`;
  svg += `<text x="${padL}" y="${H - 6}" fill="${V.muted}" font-size="10.5" ${FF}>${n} nights ago</text>`;
  svg += `<text x="${padL + plotW}" y="${H - 6}" fill="${V.muted}" font-size="10.5" text-anchor="end" ${FF}>last night</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${svg}</svg>`;
}

// 24h circadian dial. c = { bedMin, wakeMin, jetlagMin, bedSD }.
export function clockSVG(c) {
  const S = 176, cx = 88, cy = 88, R = 70, a = m => (m / 1440) * 360;
  let bedDeg = a(c.bedMin), wakeDeg = a(c.wakeMin); if (wakeDeg <= bedDeg) wakeDeg += 360;
  let svg = "";
  for (let h = 0; h < 24; h++) {
    const major = h % 6 === 0;
    const [x1, y1] = polar(cx, cy, R, a(h * 60)), [x2, y2] = polar(cx, cy, R - (major ? 9 : 5), a(h * 60));
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${major ? V.muted : V.hair}" stroke-width="${major ? 1.5 : 1}"/>`;
    if (major) { const [lx, ly] = polar(cx, cy, R - 20, a(h * 60)); svg += `<text x="${lx}" y="${ly + 4}" fill="${V.muted}" font-size="10.5" text-anchor="middle" ${FF}>${h}</text>`; }
  }
  const sd = c.bedSD || 30;
  svg += `<path d="${arcPath(cx, cy, R - 14, a(c.bedMin - sd), a(c.bedMin + sd))}" fill="none" stroke="rgba(249,201,126,.28)" stroke-width="9" stroke-linecap="round"/>`;
  svg += `<defs><linearGradient id="ghsleepg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${V.accent}"/><stop offset="1" stop-color="${V.rem}"/></linearGradient></defs>`;
  svg += `<path d="${arcPath(cx, cy, R - 14, bedDeg, wakeDeg)}" fill="none" stroke="url(#ghsleepg)" stroke-width="9" stroke-linecap="round"/>`;
  const [bx, by] = polar(cx, cy, R - 14, bedDeg), [wx, wy] = polar(cx, cy, R - 14, wakeDeg);
  svg += `<circle cx="${bx}" cy="${by}" r="4.5" stroke="${V.accent}" stroke-width="2" style="fill:#0f151d"/>`;
  svg += `<circle cx="${wx}" cy="${wy}" r="5" fill="${V.good}" stroke="#0f151d" stroke-width="2"/>`;
  svg += `<text x="${cx}" y="${cy - 6}" fill="${V.muted}" font-size="9.5" text-anchor="middle" letter-spacing="1.4" ${FF}>SOCIAL JETLAG</text>`;
  svg += `<text x="${cx}" y="${cy + 16}" fill="${V.text}" font-size="24" font-weight="700" text-anchor="middle" ${FF}>${c.jetlagMin}m</text>`;
  svg += `<text x="${cx}" y="${cy + 32}" fill="${V.muted}" font-size="10" text-anchor="middle" ${FF}>bed ${fmtClock(c.bedMin)} · wake ${fmtClock(c.wakeMin)}</text>`;
  return `<svg viewBox="0 0 ${S} ${S}" preserveAspectRatio="xMidYMid meet">${svg}</svg>`;
}

// Stacked stage composition. nights = [{D,R,L,A}] oldest→newest.
export function compositionSVG(nights) {
  const W = 680, H = 150, padL = 6, padR = 6, padT = 6, plotW = W - padL - padR, plotH = H - padT - 6;
  const n = nights.length, slot = plotW / n, bw = slot * 0.66;
  const order = [["D", V.deep], ["L", V.light], ["R", V.rem], ["A", V.awake]];
  let svg = "";
  nights.forEach((s, i) => {
    const tot = (s.D + s.R + s.L + s.A) || 1, bx = padL + i * slot + (slot - bw) / 2; let yy = padT;
    order.forEach(([k, c]) => { const hgt = (s[k] / tot) * plotH; svg += `<rect x="${bx}" y="${yy}" width="${bw}" height="${hgt}" fill="${c}" opacity="${i === n - 1 ? 1 : 0.9}"/>`; yy += hgt; });
  });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="border-radius:6px">${svg}</svg>`;
}

// Recent-row mini stage bar. s = {D,R,L,A}.
export function miniBarSVG(s) {
  const tot = (s.D + s.R + s.L + s.A) || 1, W = 200, H = 10;
  const order = [["D", V.deep], ["L", V.light], ["R", V.rem], ["A", V.awake]];
  let x = 0, svg = "";
  order.forEach(([k, c]) => { const w = (s[k] / tot) * W; svg += `<rect x="${x}" y="0" width="${Math.max(1, w - 1)}" height="${H}" rx="2" fill="${c}"/>`; x += w; });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${svg}</svg>`;
}
