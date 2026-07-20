// Vercel serverless function — proxies requests to Anthropic's API.
// Keeps ANTHROPIC_API_KEY server-side and adds abuse controls:
//   - Origin allowlist (drive-by / cross-site blocking)
//   - Optional Supabase JWT verification when a Bearer token is sent
//   - Model allowlist + max_tokens cap + payload size limits
//   - Best-effort in-memory rate limit (per warm instance)
//
// Env vars:
//   ANTHROPIC_API_KEY            (required)
//   ALLOWED_ORIGINS              (optional, comma-separated; e.g. "https://fitlog.app")
//                                falls back to VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL
//   SUPABASE_URL                 (optional; if set, Bearer tokens are verified)
//   SUPABASE_ANON_KEY            (optional; required alongside SUPABASE_URL for verification)

const ALLOWED_MODELS = new Set([
  "claude-haiku-4-5",
  "claude-sonnet-5",
]);

const MAX_TOKENS_CAP = 4000;
const MAX_MESSAGES = 100;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB — fits one inline base64 image
const RATE_LIMIT = 30; // requests
const RATE_WINDOW_MS = 60 * 1000; // per minute, per key

// In-memory sliding-window counter. Resets on cold start / per instance — not a hard
// guarantee, just blunts runaway abuse. For strong limits use Vercel KV / Upstash.
const hits = new Map();
function rateLimited(key) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(key, arr);
  // opportunistic cleanup so the map doesn't grow unbounded
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) hits.delete(k);
  }
  return arr.length > RATE_LIMIT;
}

function allowedOrigins() {
  const explicit = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (explicit.length) return explicit;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return vercel ? [`https://${vercel}`] : [];
}

function originAllowed(req) {
  const list = allowedOrigins();
  if (!list.length) return true; // no allowlist configured (e.g. local dev) — don't hard-block
  const origin = req.headers.origin;
  if (origin && list.includes(origin)) return true;
  // Some same-origin POSTs omit Origin; fall back to Referer host match.
  const ref = req.headers.referer;
  if (ref) {
    try { if (list.some(o => ref.startsWith(o))) return true; } catch { /* noop */ }
  }
  return false;
}

async function verifyToken(token) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: true, userId: null }; // verification not configured
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
    });
    if (!r.ok) return { ok: false };
    const u = await r.json();
    return { ok: true, userId: u?.id || null };
  } catch {
    return { ok: false };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });
  }

  if (!originAllowed(req)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  // Verify Supabase JWT when one is supplied. Anonymous (no token) is still allowed,
  // but a present-but-invalid token is rejected so a stolen/expired token can't pass.
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  let userId = null;
  if (token) {
    const v = await verifyToken(token);
    if (!v.ok) return res.status(401).json({ error: "Invalid or expired token" });
    userId = v.userId;
  }

  // Rate-limit key: user id if known, else client IP.
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(userId || ip)) {
    return res.status(429).json({ error: "Rate limit exceeded. Slow down." });
  }

  // ── Validate + sanitize body ──
  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid body" });
  }

  // Payload size guard (req.body is already parsed; re-stringify to measure)
  let raw;
  try { raw = JSON.stringify(body); } catch { return res.status(400).json({ error: "Unserializable body" }); }
  if (raw.length > MAX_BODY_BYTES) {
    return res.status(413).json({ error: "Payload too large" });
  }

  if (!ALLOWED_MODELS.has(body.model)) {
    return res.status(400).json({ error: "Model not allowed" });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: "Invalid messages" });
  }

  const maxTokens = Number(body.max_tokens);
  const safeMaxTokens = Number.isFinite(maxTokens)
    ? Math.min(Math.max(1, Math.floor(maxTokens)), MAX_TOKENS_CAP)
    : 1000;

  // Forward only whitelisted fields — drop anything the client shouldn't control.
  const forward = {
    model: body.model,
    max_tokens: safeMaxTokens,
    messages: body.messages,
  };
  if (typeof body.system === "string") forward.system = body.system;
  if (Array.isArray(body.tools)) forward.tools = body.tools;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(forward),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
