// ─── Activity time-range helpers ────────────────────────────────────────────
// Pure logic behind the "from/to time" prompt shown when logging a meal,
// workout, or sport. Kept here (not inline in App/primitives) so it's unit-
// testable and shared by the modal + the addEntry interception.

// Log types that trigger the time-range prompt.
export const TIMED_TYPES = new Set(["diet", "exercise", "sports"]);
export const isTimed = type => TIMED_TYPES.has(type);

const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); if (!m) return null; const h = +m[1], mm = +m[2]; return (h >= 0 && h < 24 && mm >= 0 && mm < 60) ? h * 60 + mm : null; };
const pad = n => String(n).padStart(2, "0");
const fromMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// Current local wall-clock "HH:MM".
export const nowHHMM = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Add minutes to an "HH:MM" (wraps around midnight). "" for invalid input.
export const addMinutesHHMM = (t, add) => { const s = toMin(t); return s == null ? "" : fromMin(((s + add) % 1440 + 1440) % 1440); };

// Minutes from start→end, wrapping past midnight. null if either is invalid.
export const rangeDurationMin = (start, end) => {
  const s = toMin(start), e = toMin(end);
  if (s == null || e == null) return null;
  let d = e - s;
  if (d < 0) d += 1440;
  return d;
};

// A valid range needs two parseable times.
export const isValidRange = (start, end) => toMin(start) != null && toMin(end) != null;

// Attach a time range to an entry (used on modal Save). Sets `time` to the
// start so downstream time-based engines place it correctly.
export const decorateWithTime = (entry, { timeStart, timeEnd }) => ({
  ...entry,
  time: timeStart,
  timeStart,
  timeEnd,
  durationMin: rangeDurationMin(timeStart, timeEnd),
});
