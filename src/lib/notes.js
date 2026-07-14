// ─── NOTES store helpers (pure) ─────────────────────────────────────────────
// Operate on the notes[] array and return a NEW array. The UI wires these through
// the existing setData/addEntry path — no separate persistence.
import { normExercise } from "../engines/volume";
import { parseWorkout } from "../engines/workout";
import { localDateStr } from "./dates";

export const MAX_PINNED = 5;

export const slug = s => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// #hashtags → deduped, lowercased, hash stripped (hashes stay in text).
export function parseTags(text) {
  const m = (text || "").match(/#[\w-]+/g) || [];
  return [...new Set(m.map(t => t.slice(1).toLowerCase()))];
}

// Distinct known exercise display-names across logged workouts + the exercise map.
export function knownExercises(data, goals) {
  const names = new Map(); // norm -> display
  (data.exercise || []).forEach(e => {
    const p = e._parsed || parseWorkout(e.text || "");
    (p.exercises || []).forEach(ex => { const n = normExercise(ex.name); if (n && !names.has(n)) names.set(n, ex.name); });
  });
  Object.keys((goals && goals.exerciseMap) || {}).forEach(n => { if (n && !names.has(n)) names.set(n, n); });
  return [...names.values()];
}

// Longest known exercise name that appears (case-insensitive) in the text. No
// fuzzy guessing — must be an exact substring after normalisation.
export function inferLinkedExercise(text, data, goals) {
  const norm = normExercise(text);
  if (!norm) return undefined;
  let best = null;
  knownExercises(data, goals).forEach(name => {
    const n = normExercise(name);
    if (n && norm.includes(n) && (!best || n.length > normExercise(best).length)) best = name;
  });
  return best || undefined;
}

// Build a Note from raw text (used for manual capture).
export function makeNote(text, data, goals, extra = {}) {
  const body = (text || "").trim();
  return {
    id: `n${Date.now()}${Math.floor((data.notes || []).length)}`,
    date: localDateStr(new Date()),
    ts: Date.now(),
    text: body,
    tags: parseTags(body),
    pinned: false,
    pinnedAt: null,
    linkedExercise: inferLinkedExercise(body, data, goals),
    source: extra.source || "manual",
    ...extra,
  };
}

export const addNote = (notes, note) => [note, ...(notes || [])];
export const deleteNote = (notes, id) => (notes || []).filter(n => n.id !== id);

// updateNote NEVER changes `pinned` — the only path to pinned:true is togglePin,
// so the max-5 cap can't be bypassed. Strip it from any patch.
export function updateNote(notes, id, patch) {
  const { pinned, pinnedAt, ...safe } = patch || {};
  return (notes || []).map(n => n.id === id ? { ...n, ...safe, tags: safe.text != null ? parseTags(safe.text) : n.tags } : n);
}

// Toggle pin; enforce MAX_PINNED — pinning past the cap unpins the oldest pin.
export function togglePin(notes, id) {
  let list = (notes || []).map(n => n.id === id
    ? { ...n, pinned: !n.pinned, pinnedAt: !n.pinned ? Date.now() : null }
    : n);
  const pinned = list.filter(n => n.pinned).sort((a, b) => (a.pinnedAt || 0) - (b.pinnedAt || 0));
  if (pinned.length > MAX_PINNED) {
    const evict = new Set(pinned.slice(0, pinned.length - MAX_PINNED).map(n => n.id));
    list = list.map(n => evict.has(n.id) ? { ...n, pinned: false, pinnedAt: null } : n);
  }
  return list;
}

// Case-insensitive substring on text + tags, optional tag/exercise filters.
export function searchNotes(notes, query, { tag, exercise } = {}) {
  const q = (query || "").trim().toLowerCase();
  return (notes || []).filter(n => {
    if (tag && !(n.tags || []).includes(tag)) return false;
    if (exercise && n.linkedExercise !== exercise) return false;
    if (!q) return true;
    return (n.text || "").toLowerCase().includes(q) || (n.tags || []).some(t => t.includes(q));
  });
}

// Notes relevant to an exercise being logged: linked by canonical name, tagged
// with its full slug, or tagged with any whole word of its name (so #bench
// surfaces on "Bench Press (Barbell)"). Whole-word only — avoids over-matching.
export function notesForExercise(notes, name) {
  const s = slug(name);
  const tokens = new Set(normExercise(name).split(" ").filter(Boolean));
  return (notes || []).filter(n =>
    n.linkedExercise === name
    || (n.tags || []).includes(s)
    || (n.tags || []).some(t => tokens.has(t)));
}
