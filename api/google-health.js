// Vercel serverless function — Google Health API broker.
// Keeps GOOGLE_CLIENT_SECRET server-side. The browser never sees the secret and
// can only reach Google through this function (no open proxy — host allowlisted).
//
// Actions (POST body { action, ... }):
//   "token"   { code, redirectUri }            → exchange auth code for tokens
//   "refresh" { refreshToken }                 → mint a fresh access token
//   "fetch"   { accessToken, dataType, filter } → GET a dataPoints list from Google
//
// Env vars:
//   GOOGLE_CLIENT_ID       (required)
//   GOOGLE_CLIENT_SECRET   (required)
//   ALLOWED_ORIGINS        (optional, comma-separated; falls back to VERCEL_*_URL)
//
// Notes:
//   - health.googleapis.com CORS support is unknown, so all data reads are proxied.
//   - We only ever call Google's token endpoint and health.googleapis.com — the
//     client cannot steer this function at an arbitrary URL.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const HEALTH_BASE = "https://health.googleapis.com/v4";
const DATA_TYPES = new Set([
  "heart-rate",
  "daily-resting-heart-rate",
  "heart-rate-variability",
  "daily-heart-rate-variability",
  "sleep",
]);
const MAX_BODY_BYTES = 1 * 1024 * 1024;

function allowedOrigins() {
  const explicit = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (explicit.length) return explicit;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return vercel ? [`https://${vercel}`] : [];
}
function originAllowed(req) {
  const list = allowedOrigins();
  if (!list.length) return true; // local dev — don't hard-block
  const origin = req.headers.origin;
  if (origin && list.includes(origin)) return true;
  const ref = req.headers.referer;
  if (ref && list.some(o => ref.startsWith(o))) return true;
  return false;
}

async function exchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  return postForm(TOKEN_URL, body);
}
async function refresh(refreshToken) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  return postForm(TOKEN_URL, body);
}
async function postForm(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

// Normalize a Google token payload into our stored shape.
function tokenRecord(j, prev) {
  return {
    accessToken: j.access_token,
    // Google only returns refresh_token on the first consent — keep the old one.
    refreshToken: j.refresh_token || prev?.refreshToken,
    expiresAt: Date.now() + ((j.expires_in || 3600) - 60) * 1000,
    scope: j.scope,
    tokenType: j.token_type,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set" });
  }
  if (!originAllowed(req)) return res.status(403).json({ error: "Origin not allowed" });

  const body = req.body;
  if (!body || typeof body !== "object") return res.status(400).json({ error: "Invalid body" });
  let raw;
  try { raw = JSON.stringify(body); } catch { return res.status(400).json({ error: "Unserializable body" }); }
  if (raw.length > MAX_BODY_BYTES) return res.status(413).json({ error: "Payload too large" });

  try {
    if (body.action === "token") {
      if (!body.code || !body.redirectUri) return res.status(400).json({ error: "Missing code/redirectUri" });
      const r = await exchangeCode(body.code, body.redirectUri);
      if (!r.ok || !r.json.access_token) return res.status(r.status || 400).json({ error: r.json.error_description || r.json.error || "token-exchange-failed" });
      return res.status(200).json(tokenRecord(r.json));
    }

    if (body.action === "refresh") {
      if (!body.refreshToken) return res.status(400).json({ error: "Missing refreshToken" });
      const r = await refresh(body.refreshToken);
      if (!r.ok || !r.json.access_token) return res.status(r.status || 400).json({ error: r.json.error_description || r.json.error || "refresh-failed" });
      return res.status(200).json(tokenRecord(r.json, { refreshToken: body.refreshToken }));
    }

    if (body.action === "fetch") {
      if (!body.accessToken) return res.status(401).json({ error: "Missing accessToken" });
      if (!DATA_TYPES.has(body.dataType)) return res.status(400).json({ error: "Unknown dataType" });
      const op = body.op === "reconcile" ? ":reconcile" : "/dataPoints";
      const qs = body.filter ? `?filter=${encodeURIComponent(body.filter)}` : "";
      const url = `${HEALTH_BASE}/users/me/dataTypes/${body.dataType}${op}${qs}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${body.accessToken}`, Accept: "application/json" } });
      const j = await r.json().catch(() => ({}));
      // Bubble Google's status up so the client can trigger a refresh on 401.
      return res.status(r.status).json(j);
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
