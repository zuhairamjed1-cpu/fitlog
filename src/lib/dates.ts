// ─── DATE UTILITIES ─────────────────────────────────────────────────────────
// Pure, framework-free date helpers shared across engines and UI.
import type { ISODate } from "../types/models";

// Format a Date as YYYY-MM-DD using the user's LOCAL timezone (not UTC).
// `toISOString()` returns UTC, which is off-by-one for any user not in UTC.
export const localDateStr = (d: Date): ISODate => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const getTodayStr = (): ISODate => localDateStr(new Date());

export const formatDate = (ds: ISODate): string => new Date(ds + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export const formatShortDate = (ds: ISODate): string => new Date(ds + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

export const daysAgo = (n: number): ISODate => { const d = new Date(); d.setDate(d.getDate() - n); return localDateStr(d); };

// Add/subtract days from a YYYY-MM-DD string (delta in days; negative = future).
export function daysAgoFrom(dateStr: ISODate, delta: number): ISODate {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - delta);
  return localDateStr(d);
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
