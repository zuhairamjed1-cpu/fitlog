// ─── FITBIT WEB API (OAuth2 PKCE, client-side) ──────────────────────────────
// Public-client PKCE flow — no server secret. Token + refresh + sleep import all
// run in the browser (Fitbit's endpoints allow CORS with a Bearer token).
// Tokens live in goals.fitbit so they sync across devices like everything else.

const AUTH_URL = "https://www.fitbit.com/oauth2/authorize";
const TOKEN_URL = "https://api.fitbit.com/oauth2/token";
const API = "https://api.fitbit.com";
const SCOPE = "sleep profile"; // add "activity heartrate weight" later for steps/HR
const REDIRECT_URI = () => window.location.origin + window.location.pathname;

// base64url of raw bytes / string
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function randomVerifier() {
  const a = new Uint8Array(48); crypto.getRandomValues(a); return b64url(a);
}
async function challengeFor(verifier) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(d));
}

// Step 1 — kick off the redirect. Stashes the PKCE verifier + state for the callback.
export async function beginFitbitAuth(clientId) {
  if (!clientId) throw new Error("no-client-id");
  const verifier = randomVerifier();
  const state = randomVerifier().slice(0, 24);
  sessionStorage.setItem("fitbit_pkce", verifier);
  sessionStorage.setItem("fitbit_state", state);
  sessionStorage.setItem("fitbit_client", clientId);
  const challenge = await challengeFor(verifier);
  const p = new URLSearchParams({
    client_id: clientId, response_type: "code", code_challenge: challenge,
    code_challenge_method: "S256", scope: SCOPE, redirect_uri: REDIRECT_URI(), state,
  });
  window.location.href = `${AUTH_URL}?${p}`;
}

// Detect a Fitbit callback in the URL (?code=…&state=…). Returns {code} or null.
export function readFitbitCallback() {
  const u = new URLSearchParams(window.location.search);
  const code = u.get("code"), state = u.get("state");
  if (!code) return null;
  const expect = sessionStorage.getItem("fitbit_state");
  if (state && expect && state !== expect) return { error: "state-mismatch" };
  return { code };
}

// Clear the ?code from the URL after handling (avoid re-exchange on reload).
export function clearFitbitCallback() {
  const url = new URL(window.location.href);
  ["code", "state"].forEach(k => url.searchParams.delete(k));
  window.history.replaceState({}, "", url.pathname + (url.search || "") + url.hash);
}

// Step 2 — exchange the code for tokens. Returns the token record to store.
export async function exchangeFitbitCode(code) {
  const verifier = sessionStorage.getItem("fitbit_pkce");
  const clientId = sessionStorage.getItem("fitbit_client");
  if (!verifier || !clientId) throw new Error("no-pkce-state");
  const body = new URLSearchParams({
    client_id: clientId, grant_type: "authorization_code", code,
    code_verifier: verifier, redirect_uri: REDIRECT_URI(),
  });
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(j.errors?.[0]?.message || "token-exchange-failed");
  sessionStorage.removeItem("fitbit_pkce"); sessionStorage.removeItem("fitbit_state");
  return { clientId, accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000, userId: j.user_id, connectedAt: Date.now() };
}

// Refresh an expired access token. Returns the updated token record.
export async function refreshFitbit(tok) {
  const body = new URLSearchParams({ client_id: tok.clientId, grant_type: "refresh_token", refresh_token: tok.refreshToken });
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(j.errors?.[0]?.message || "refresh-failed");
  return { ...tok, accessToken: j.access_token, refreshToken: j.refresh_token || tok.refreshToken, expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
}

// Fetch with auto-refresh. onToken(newTok) is called when the token rotates.
async function authedGet(path, tok, onToken) {
  let t = tok;
  if (Date.now() >= (t.expiresAt || 0)) { t = await refreshFitbit(t); onToken?.(t); }
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${t.accessToken}` } });
  if (r.status === 401) { t = await refreshFitbit(t); onToken?.(t); return (await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${t.accessToken}` } })).json(); }
  if (!r.ok) throw new Error(`fitbit ${r.status}`);
  return r.json();
}

const hhmm = iso => { const m = /T(\d{2}):(\d{2})/.exec(iso || ""); return m ? `${m[1]}:${m[2]}` : ""; };
const qualityFor = eff => eff >= 90 ? "Great" : eff >= 80 ? "Good" : eff >= 70 ? "Fair" : "Poor";

// Map a Fitbit sleep log → a FitLog sleep entry.
export function fitbitSleepToEntry(s) {
  return {
    id: `fb${s.logId}`,
    date: s.dateOfSleep,
    bedtime: hhmm(s.startTime),
    wakeTime: hhmm(s.endTime),
    duration: +((s.duration || 0) / 3600000).toFixed(1), // total time in bed, hrs
    quality: qualityFor(s.efficiency || 0),
    wakeMin: s.minutesAwake ?? undefined,
    efficiency: s.efficiency,
    source: "fitbit",
    fitbitLogId: s.logId,
  };
}

// Pull sleep logs for the last `days`, main sleeps only, as FitLog entries.
export async function fetchFitbitSleep(tok, onToken, days = 30) {
  const end = new Date();
  const start = new Date(Date.now() - (days - 1) * 86400000);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const j = await authedGet(`/1.2/user/-/sleep/date/${fmt(start)}/${fmt(end)}.json`, tok, onToken);
  return (j.sleep || []).filter(s => s.isMainSleep !== false).map(fitbitSleepToEntry);
}

// Verify who we're connected as (also a cheap token-liveness check).
export async function fitbitProfile(tok, onToken) {
  const j = await authedGet("/1/user/-/profile.json", tok, onToken);
  return j.user ? { name: j.user.fullName || j.user.displayName, avatar: j.user.avatar } : null;
}
