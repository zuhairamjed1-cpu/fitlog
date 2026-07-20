// ===========================================================================
// api/google-health.js   (Vercel serverless function, Node.js)
// ---------------------------------------------------------------------------
// Single-user Google Health API OAuth broker for the fitlog app.
// All Google tokens (refresh + access) live server-side in Supabase and never
// reach the React bundle. The browser only ever talks to this function, using
// its existing Supabase JWT for identity.
//
// Actions (via ?action=):
//   login      -> (needs Supabase JWT) returns { authUrl }, sets state cookie
//   callback   -> Google redirects here; exchanges code, stores tokens, -> APP_URL
//   status     -> (needs Supabase JWT) returns { connected: boolean }
//   data       -> (needs Supabase JWT) &metric=... &since=ISO [&until=ISO]
//   disconnect -> (needs Supabase JWT) deletes stored tokens
//
// NOTE ON MODULE STYLE: this uses ESM (import/export). If your existing
// api/chat.js uses CommonJS (require / module.exports), match that style
// instead, or add "type": "module" is already implied by Vite — check what
// api/chat.js does and stay consistent.
// ===========================================================================

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,   // e.g. https://your-app.vercel.app/api/google-health?action=callback
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  APP_URL,               // where to send the user back after connecting, e.g. https://your-app.vercel.app/
} = process.env;

const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
];

const GH_BASE   = 'https://health.googleapis.com/v4';
const AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Metric key -> Google Health data type + the field to filter on.
// The sleep / heart-rate / hrv filter fields are confirmed from the docs.
// The two daily-* fields are best-guesses — if you get empty results, verify
// the exact filter field at https://developers.google.com/health/endpoints.
const METRICS = {
  sleep:        { dataType: 'sleep',                        filterField: 'sleep.interval.civil_end_time',                        dateOnly: true },
  'heart-rate': { dataType: 'heart-rate',                   filterField: 'heart_rate.sample_time.physical_time',                 maxWindowDays: 14 },
  hrv:          { dataType: 'heart-rate-variability',       filterField: 'heart_rate_variability.sample_time.physical_time' },
  'daily-hrv':  { dataType: 'daily-heart-rate-variability', filterField: 'daily_heart_rate_variability.sample_time.physical_time', verify: true },
  'resting-hr': { dataType: 'daily-resting-heart-rate',     filterField: 'daily_resting_heart_rate.sample_time.physical_time',     verify: true },
};

// service_role client — bypasses RLS. NEVER expose this key to the browser.
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---- helpers --------------------------------------------------------------

function getBearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

async function requireUser(req, res) {
  const jwt = getBearer(req);
  if (!jwt) { res.status(401).json({ error: 'missing_supabase_jwt' }); return null; }
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) { res.status(401).json({ error: 'invalid_supabase_jwt' }); return null; }
  return data.user;
}

function cookie(name, value, maxAgeSec) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (maxAgeSec != null) parts.push(`Max-Age=${maxAgeSec}`);
  return parts.join('; ');
}

const toDateOnly = (iso) => iso.slice(0, 10);
const addDaysISO = (iso, d) => new Date(new Date(iso).getTime() + d * 86400000).toISOString();

function redirectApp(res, query) {
  const base = APP_URL || '/';
  const sep = base.includes('?') ? '&' : '?';
  res.setHeader('Location', `${base}${sep}${query}`);
  res.status(302).end();
}

// ---- token storage + refresh ----------------------------------------------

class NeedsReconnect extends Error {}

async function loadTokens(userId) {
  const { data } = await admin
    .from('google_health_tokens')
    .select('refresh_token, access_token, access_token_expiry')
    .eq('user_id', userId)
    .maybeSingle();
  return data || null;
}

async function saveTokens(userId, fields) {
  await admin
    .from('google_health_tokens')
    .upsert({ user_id: userId, ...fields, updated_at: new Date().toISOString() });
}

async function getAccessToken(userId) {
  const row = await loadTokens(userId);
  if (!row?.refresh_token) throw new NeedsReconnect('not_connected');

  // Reuse a still-valid access token (60s safety margin).
  if (row.access_token && row.access_token_expiry &&
      new Date(row.access_token_expiry).getTime() - Date.now() > 60_000) {
    return row.access_token;
  }

  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: row.refresh_token,
    grant_type: 'refresh_token',
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json();
  if (!r.ok) {
    // The weekly Testing-mode refresh-token expiry surfaces here.
    if (j.error === 'invalid_grant') throw new NeedsReconnect('token_expired');
    throw new Error(`token_refresh_failed: ${JSON.stringify(j)}`);
  }
  const expiry = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
  await saveTokens(userId, { access_token: j.access_token, access_token_expiry: expiry });
  return j.access_token;
}

// ---- Google Health queries ------------------------------------------------

function buildFilter(field, sinceISO, untilISO, dateOnly) {
  const s = dateOnly ? toDateOnly(sinceISO) : sinceISO;
  let f = `${field} >= "${s}"`;
  if (untilISO) {
    const u = dateOnly ? toDateOnly(untilISO) : untilISO;
    f += ` AND ${field} < "${u}"`;
  }
  return f;
}

async function listDataPoints(accessToken, dataType, filter) {
  const points = [];
  let pageToken;
  do {
    const url = new URL(`${GH_BASE}/users/me/dataTypes/${dataType}/dataPoints`);
    if (filter) url.searchParams.set('filter', filter);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`gh_query_failed ${r.status}: ${JSON.stringify(j)}`);
    if (Array.isArray(j.dataPoints)) points.push(...j.dataPoints);
    pageToken = j.nextPageToken;
  } while (pageToken);
  return points;
}

async function queryMetric(accessToken, metricKey, sinceISO, untilISO) {
  const cfg = METRICS[metricKey];
  const end = untilISO || new Date().toISOString();

  // heart-rate is capped at 14-day query ranges -> page through in windows.
  if (cfg.maxWindowDays) {
    const all = [];
    let winStart = sinceISO;
    while (new Date(winStart) < new Date(end)) {
      const winEnd = new Date(Math.min(
        new Date(addDaysISO(winStart, cfg.maxWindowDays)).getTime(),
        new Date(end).getTime(),
      )).toISOString();
      all.push(...await listDataPoints(accessToken, cfg.dataType,
        buildFilter(cfg.filterField, winStart, winEnd, cfg.dateOnly)));
      winStart = winEnd;
    }
    return all;
  }

  return listDataPoints(accessToken, cfg.dataType,
    buildFilter(cfg.filterField, sinceISO, untilISO, cfg.dateOnly));
}

// ---- action handlers ------------------------------------------------------

async function handleLogin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const state = crypto.randomBytes(16).toString('hex');
  // httpOnly cookie carries the CSRF state + Supabase user id through the
  // Google redirect (the callback request has no Authorization header).
  res.setHeader('Set-Cookie', cookie('gh_oauth', `${state}.${user.id}`, 600));
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent'); // ensure a refresh token every time
  url.searchParams.set('state', state);
  res.status(200).json({ authUrl: url.toString() });
}

async function handleCallback(req, res) {
  const { code, state, error } = req.query;
  const [cookieState, userId] = (req.cookies?.gh_oauth || '').split('.');
  res.setHeader('Set-Cookie', cookie('gh_oauth', '', 0)); // clear it

  if (error) return redirectApp(res, `gh_error=${encodeURIComponent(error)}`);
  if (!code || !state || !cookieState || state !== cookieState || !userId) {
    return redirectApp(res, 'gh_error=state_mismatch');
  }

  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    code,
    redirect_uri: GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) {
    return redirectApp(res, `gh_error=${encodeURIComponent(j.error || 'no_refresh_token')}`);
  }
  const expiry = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
  await saveTokens(userId, {
    refresh_token: j.refresh_token,
    access_token: j.access_token,
    access_token_expiry: expiry,
  });
  return redirectApp(res, 'gh=connected');
}

async function handleStatus(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const row = await loadTokens(user.id);
  res.status(200).json({ connected: !!row?.refresh_token });
}

async function handleDisconnect(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  await admin.from('google_health_tokens').delete().eq('user_id', user.id);
  res.status(200).json({ connected: false });
}

async function handleData(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const { metric, since, until } = req.query;
  if (!metric || !METRICS[metric]) return res.status(400).json({ error: 'bad_metric' });
  if (!since) return res.status(400).json({ error: 'missing_since' });
  try {
    const accessToken = await getAccessToken(user.id);
    const dataPoints = await queryMetric(accessToken, metric, since, until);
    res.status(200).json({ metric, count: dataPoints.length, dataPoints });
  } catch (e) {
    if (e instanceof NeedsReconnect) {
      return res.status(401).json({ error: e.message, needsReconnect: true });
    }
    console.error(e);
    res.status(502).json({ error: 'gh_query_failed', detail: String(e.message || e) });
  }
}

// ---- entrypoint -----------------------------------------------------------

export default async function handler(req, res) {
  try {
    switch (req.query.action) {
      case 'login':      return await handleLogin(req, res);
      case 'callback':   return await handleCallback(req, res);
      case 'status':     return await handleStatus(req, res);
      case 'data':       return await handleData(req, res);
      case 'disconnect': return await handleDisconnect(req, res);
      default:           return res.status(400).json({ error: 'unknown_action' });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error', detail: String(e.message || e) });
  }
}
