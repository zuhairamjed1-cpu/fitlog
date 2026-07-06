// ─── TIME UTILITIES ───────────────────────────────────────────────────────

export function avgTimeMins(times: (string | null | undefined)[]): number | null {
  const valid = times
    .map(t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? (+m[1] * 60 + +m[2]) : null; })
    .filter((v): v is number => v != null && v >= 0 && v < 1440);
  if (!valid.length) return null;
  let sx = 0, sy = 0;
  for (const v of valid) {
    const ang = (v / 1440) * 2 * Math.PI;
    sx += Math.cos(ang);
    sy += Math.sin(ang);
  }
  // All vectors cancelled out (rare) → fall back to plain mean
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  }
  let ang = Math.atan2(sy, sx);
  if (ang < 0) ang += 2 * Math.PI;
  return Math.round((ang / (2 * Math.PI)) * 1440) % 1440;
}

export function minsOfTime(t: string | null | undefined): number | null { if (!t) return null; const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? +m[1] * 60 + +m[2] : null; }

export function avgTimeHHMM(times: (string | null | undefined)[], wrapPM = false): string | null {
  // wrapPM kept for call-site compatibility but no longer needed — circular mean
  // handles midnight-straddling times correctly.
  if (!times || !times.length) return null;
  const avg = avgTimeMins(times);
  if (avg == null) return null;
  return `${String(Math.floor(avg / 60)).padStart(2, "0")}:${String(avg % 60).padStart(2, "0")}`;
}
