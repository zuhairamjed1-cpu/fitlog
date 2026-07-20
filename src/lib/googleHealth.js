// ─── GOOGLE HEALTH API (client side) ────────────────────────────────────────
// The Fitbit Air syncs to Google Health, not the classic Fitbit app, and the
// legacy Fitbit Web API is deprecated (Sep 2026). We read via the Google Health
// API. The OAuth client SECRET stays server-side in /api/google-health — this
// module only ever holds an access/refresh token (stored in goals.googleHealth,
// cloud-synced like everything else) and talks to our own broker function.
//
// Docs: https://developers.google.com/health   Base: https://health.googleapis.com/v4

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const BROKER = "/api/google-health";
const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
];
export const REDIRECT_URI = () => window.location.origin + window.location.pathname;

// Client ID is not secret. Prefer a build-time env, fall back to one pasted into
// the connect card (stored in goals.googleHealth.clientId).
export function googleClientId(goals) {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || goals?.googleHealth?.clientId || "";
}

// ── OAuth (authorization-code flow) ─────────────────────────────────────────
const rand = () => {
  const a = new Uint8Array(24); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
};

export function beginGoogleHealthAuth(clientId) {
  if (!clientId) throw new Error("no-client-id");
  const state = rand();
  sessionStorage.setItem("gh_state", state);
  sessionStorage.setItem("gh_client", clientId);
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",     // ask for a refresh token
    prompt: "consent",          // force refresh-token issuance on re-connect
    include_granted_scopes: "true",
    state,
  });
  window.location.href = `${AUTHORIZE_URL}?${p}`;
}

// Detect the OAuth redirect back (?code / ?error). Returns {code} | {error} | null.
export function readGoogleHealthCallback() {
  const u = new URLSearchParams(window.location.search);
  const err = u.get("error");
  if (err) return { error: err };
  const code = u.get("code"), state = u.get("state");
  if (!code) return null;
  const expect = sessionStorage.getItem("gh_state");
  // Only claim callbacks we started (avoids stealing Fitbit's ?code, and CSRF).
  if (!expect) return null;
  if (state !== expect) return { error: "state-mismatch" };
  return { code };
}

export function clearGoogleHealthCallback() {
  const url = new URL(window.location.href);
  ["code", "state", "scope", "error", "authuser", "prompt"].forEach(k => url.searchParams.delete(k));
  window.history.replaceState({}, "", url.pathname + (url.search || "") + url.hash);
}

async function broker(payload) {
  const r = await fetch(BROKER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

// Exchange the auth code → token record (stored into goals.googleHealth).
export async function exchangeGoogleHealthCode(code, clientId) {
  const r = await broker({ action: "token", code, redirectUri: REDIRECT_URI() });
  if (!r.ok || !r.json.accessToken) throw new Error(r.json.error || "token-exchange-failed");
  const cid = clientId || sessionStorage.getItem("gh_client") || undefined;
  sessionStorage.removeItem("gh_state");
  return { ...r.json, clientId: cid, connectedAt: Date.now() };
}

async function refreshToken(tok) {
  const r = await broker({ action: "refresh", refreshToken: tok.refreshToken });
  if (!r.ok || !r.json.accessToken) throw new Error(r.json.error || "refresh-failed");
  return { ...tok, ...r.json };
}

// ── Authed data read with transparent refresh ───────────────────────────────
async function ghFetch(tok, dataType, filter, onToken, op) {
  let t = tok;
  if (Date.now() >= (t.expiresAt || 0) && t.refreshToken) { t = await refreshToken(t); onToken?.(t); }
  let r = await broker({ action: "fetch", accessToken: t.accessToken, dataType, filter, op });
  if (r.status === 401 && t.refreshToken) {
    t = await refreshToken(t); onToken?.(t);
    r = await broker({ action: "fetch", accessToken: t.accessToken, dataType, filter, op });
  }
  if (!r.ok) throw new Error(r.json.error || `google-health ${r.status}`);
  return r.json;
}

// ── Filters (kebab-case in path, snake_case in filter; field varies by type) ─
const iso = d => d.toISOString();
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgoDate = n => new Date(Date.now() - n * 86400000);

// Sleep session filters on interval.civil_end_time (whole nights up to today).
export async function fetchGoogleHealthSleep(tok, onToken, days = 30) {
  const start = ymd(daysAgoDate(days - 1));
  const filter = `sleep.interval.civil_end_time >= "${start}"`;
  const j = await ghFetch(tok, "sleep", filter, onToken);
  const points = j.dataPoint || j.dataPoints || [];
  return points.map(normalizeSleep).filter(Boolean);
}

// heart-rate has a hard 14-day-per-request cap → page in ≤14-day windows.
export async function fetchGoogleHealthHeartRate(tok, onToken, days = 14) {
  const out = [];
  let cursor = new Date();
  let remaining = days;
  while (remaining > 0) {
    const win = Math.min(14, remaining);
    const from = new Date(cursor.getTime() - (win - 1) * 86400000);
    const filter = `heart_rate.sample_time.physical_time >= "${iso(from)}" AND heart_rate.sample_time.physical_time < "${iso(cursor)}"`;
    const j = await ghFetch(tok, "heart-rate", filter, onToken);
    out.push(...(j.dataPoint || j.dataPoints || []));
    cursor = from;
    remaining -= win;
  }
  return out;
}

export async function fetchRestingHeartRate(tok, onToken, days = 30) {
  const start = ymd(daysAgoDate(days - 1));
  const filter = `daily_resting_heart_rate.interval.civil_start_time >= "${start}"`;
  const j = await ghFetch(tok, "daily-resting-heart-rate", filter, onToken);
  return j.dataPoint || j.dataPoints || [];
}

export async function fetchDailyHrv(tok, onToken, days = 30) {
  const start = ymd(daysAgoDate(days - 1));
  const filter = `daily_heart_rate_variability.interval.civil_start_time >= "${start}"`;
  const j = await ghFetch(tok, "daily-heart-rate-variability", filter, onToken);
  return j.dataPoint || j.dataPoints || [];
}

// ── Sleep normalizer ────────────────────────────────────────────────────────
// TODO(reconcile): field paths below are per the integration brief. Confirm exact
// nesting against one real `sleep` dataPoint from the OAuth 2.0 Playground and
// adjust the `pick`s — a wrong path yields empty stages, not an error.
const STAGE_LABEL = { AWAKE: "Awake", DEEP: "Deep", REM: "REM", LIGHT: "Light", OUT_OF_BED: "Out of bed" };
const hhmm = t => { const m = /T(\d{2}):(\d{2})/.exec(t || ""); return m ? `${m[1]}:${m[2]}` : ""; };
const toMs = t => { const d = t ? Date.parse(t) : NaN; return Number.isNaN(d) ? null : d; };
const minutes = ms => Math.round((ms || 0) / 60000);

function normalizeSleep(dp) {
  const s = dp.sleep || dp; // point may be wrapped under `sleep`
  const interval = s.interval || {};
  const startT = interval.civilStartTime || interval.civil_start_time || s.startTime;
  const endT = interval.civilEndTime || interval.civil_end_time || s.endTime;
  const date = (endT || "").slice(0, 10);
  if (!date) return null;

  const rawSegs = s.stages || s.segments || s.stageSegments || [];
  const stages = rawSegs.map(seg => {
    const type = (seg.type || seg.stage || seg.stageType || "").toUpperCase();
    const a = seg.interval?.civilStartTime || seg.startTime || seg.start;
    const b = seg.interval?.civilEndTime || seg.endTime || seg.end;
    const dur = toMs(b) != null && toMs(a) != null ? toMs(b) - toMs(a) : (seg.durationMillis || 0);
    return { type, label: STAGE_LABEL[type] || type, start: a, end: b, min: minutes(dur) };
  }).filter(x => x.type);

  // Per-stage totals — prefer an API-provided summary, else sum segments.
  const summary = s.summary || {};
  const totals = { DEEP: 0, REM: 0, LIGHT: 0, AWAKE: 0, OUT_OF_BED: 0 };
  for (const seg of stages) if (seg.type in totals) totals[seg.type] += seg.min;
  if (summary.stageDurations) {
    for (const k of Object.keys(totals)) {
      const v = summary.stageDurations[k] ?? summary.stageDurations[k?.toLowerCase()];
      if (v != null) totals[k] = minutes(toMs(`1970-01-01T00:00:00Z`) === 0 ? v * 1000 : v); // best-effort
    }
  }

  const asleepMin = totals.DEEP + totals.REM + totals.LIGHT;
  const inBedMin = toMs(endT) != null && toMs(startT) != null ? minutes(toMs(endT) - toMs(startT)) : asleepMin + totals.AWAKE;
  const efficiency = inBedMin > 0 ? Math.round((asleepMin / inBedMin) * 100) : null;

  return {
    id: `gh${s.id || s.logId || `${date}-${startT}`}`,
    date,
    bedtime: hhmm(startT),
    wakeTime: hhmm(endT),
    duration: +(asleepMin / 60).toFixed(1),   // hours asleep
    inBedHours: +(inBedMin / 60).toFixed(1),
    stages,
    stageTotals: totals,
    efficiency,
    sleepType: s.sleepType || s.type || (stages.length ? "stages" : "classic"),
    derivedScore: derivedSleepScore({ totals, asleepMin, inBedMin, efficiency, awakeMin: totals.AWAKE }),
    quality: qualityFor(efficiency),
    source: "googlehealth",
    ghId: s.id || s.logId,
  };
}

const qualityFor = eff => eff == null ? "—" : eff >= 90 ? "Great" : eff >= 80 ? "Good" : eff >= 70 ? "Fair" : "Poor";

// Google Health exposes NO sleep score — compute one from stages + efficiency.
// 0–100: efficiency (50%) + deep/REM adequacy (35%) + low restlessness (15%).
export function derivedSleepScore({ totals, asleepMin, inBedMin, efficiency, awakeMin }) {
  if (!asleepMin) return null;
  const eff = efficiency ?? (inBedMin ? (asleepMin / inBedMin) * 100 : 0);
  const effPts = Math.max(0, Math.min(1, eff / 100)) * 50;
  // Target ~13% deep + ~23% REM of time asleep (typical adult reference bands).
  const deepFrac = totals.DEEP / asleepMin, remFrac = totals.REM / asleepMin;
  const deepPts = Math.min(1, deepFrac / 0.13) * 17.5;
  const remPts = Math.min(1, remFrac / 0.23) * 17.5;
  const restPts = Math.max(0, 1 - (awakeMin / Math.max(asleepMin, 1)) / 0.15) * 15;
  return Math.round(effPts + deepPts + remPts + restPts);
}
