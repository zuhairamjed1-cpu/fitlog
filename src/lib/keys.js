// Shared localStorage namespace. Lives in its own module so leaf utilities
// (sound prefs, etc.) can read it without importing from App.jsx (circular).
export const STORAGE_KEY = "fitlog_v5";
