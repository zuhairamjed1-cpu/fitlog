// ─── PERSISTENCE + CLOUD SYNC ───────────────────────────────────────────────────
// localStorage-backed data layer plus Supabase cloud sync. Extracted from App.jsx
// so any view module can read/write app data without importing App.jsx.
import { STORAGE_KEY } from "../lib/keys";
import { supabase, hasSupabase } from "../supabase";
import { defaultData, defaultGoals, defaultProfile, defaultStrategy } from "../config";
import type { AppData, Goals } from "../types/models";

export function loadData(): AppData {
  try { const r = localStorage.getItem(STORAGE_KEY); const p = r ? JSON.parse(r) : defaultData; return { ...defaultData, ...p } as AppData; }
  catch { return defaultData as AppData; }
}
export function loadGoals(): Goals {
  try {
    const r = localStorage.getItem(STORAGE_KEY + "_goals");
    const p = r ? JSON.parse(r) : defaultGoals;
    const merged = { ...defaultGoals, ...p };
    // Deep-merge nested objects so existing users get any new fields we add later.
    merged.profile = { ...defaultProfile, ...(p.profile || {}) };
    merged.strategy = { ...defaultStrategy, ...(p.strategy || {}) };
    merged.nutrition = { ...defaultGoals.nutrition, ...(p.nutrition || {}) };
    // Existing users (who already saved goals before onboarding existed) skip the intro.
    if (r && merged.onboarded === undefined) merged.onboarded = true;
    return merged as Goals;
  } catch { return defaultGoals as Goals; }
}
export const saveData = (d: AppData) => localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
export const saveGoals = (g: Goals) => localStorage.setItem(STORAGE_KEY + "_goals", JSON.stringify(g));

// ─── CLOUD SYNC ───────────────────────────────────────────────────────────────
// Tracks the currently signed-in user so any localStorage write can trigger a sync.
let _currentUserId: string | null = null;
export function setCurrentUser(id: string | null) { _currentUserId = id; }

// Pushes the full {data, goals, chat} bundle to Supabase for the logged-in user.
// Debounced so rapid edits don't spam the server.
let _syncTimer: ReturnType<typeof setTimeout> | null = null;
export function cloudSync(userId?: string | null) {
  const uid = userId || _currentUserId;
  if (!hasSupabase || !uid) return;
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(async () => {
    try {
      const payload = {
        user_id: uid,
        data: loadData(),
        goals: loadGoals(),
        chat: JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]"),
        updated_at: new Date().toISOString(),
      };
      await supabase!.from("fitlog_data").upsert(payload, { onConflict: "user_id" });
    } catch (e) { /* offline — will retry on next change */ }
  }, 1200);
}

// Pulls cloud data into localStorage. Returns true if cloud had data.
export async function cloudPull(userId: string): Promise<boolean> {
  if (!hasSupabase || !userId) return false;
  const { data: row, error } = await supabase!.from("fitlog_data").select("*").eq("user_id", userId).maybeSingle();
  if (error || !row) return false;
  const cloudData = row.data || {};
  const hasAny = Object.values(cloudData).some(arr => Array.isArray(arr) && arr.length > 0);
  if (!hasAny && (!row.chat || row.chat.length <= 1)) return false; // cloud effectively empty
  // Data-loss guard: never let an EMPTY cloud array clobber a populated local one.
  // The blob is last-write-wins, so a client that pushed before an array existed
  // (or before it loaded) could otherwise wipe it. Keep local when cloud is empty.
  let localData: any = {};
  try { localData = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {}; } catch { localData = {}; }
  const merged: any = { ...defaultData, ...cloudData };
  for (const k of Object.keys(merged)) {
    const c = merged[k], l = localData[k];
    if (Array.isArray(c) && c.length === 0 && Array.isArray(l) && l.length > 0) merged[k] = l;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  localStorage.setItem(STORAGE_KEY + "_goals", JSON.stringify({ ...defaultGoals, ...(row.goals || {}) }));
  if (row.chat) localStorage.setItem(STORAGE_KEY + "_chat", JSON.stringify(row.chat));
  return true;
}

// Pushes current local data up immediately (used on first sign-in when cloud is empty).
export async function cloudPushNow(userId: string): Promise<void> {
  if (!hasSupabase || !userId) return;
  try {
    await supabase!.from("fitlog_data").upsert({
      user_id: userId,
      data: loadData(),
      goals: loadGoals(),
      chat: JSON.parse(localStorage.getItem(STORAGE_KEY + "_chat") || "[]"),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  } catch (e) {}
}
