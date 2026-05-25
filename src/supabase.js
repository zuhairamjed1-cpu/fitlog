import { createClient } from "@supabase/supabase-js";

// These are injected at build time from Vercel environment variables.
// VITE_ prefix is required for Vite to expose them to the browser.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export const hasSupabase = !!supabase;
