// ===========================================================================
// src/useGoogleHealth.js
// ---------------------------------------------------------------------------
// React hook that talks to /api/google-health. The browser never sees any
// Google token — it only sends your existing Supabase JWT.
//
// Usage:
//   const { connected, needsReconnect, connect, disconnect, fetchMetric } = useGoogleHealth();
//   if (!connected) return <button onClick={connect}>Connect Fitbit Air</button>;
//   const sleep = await fetchMetric('sleep', '2026-07-01');
// ===========================================================================

import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';

const API = '/api/google-health';

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useGoogleHealth() {
  const [connected, setConnected] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}?action=status`, { headers: await authHeader() });
      const j = await res.json();
      setConnected(!!j.connected);
      if (j.connected) setNeedsReconnect(false);
    } catch {
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  // Kick off the OAuth flow. Google will redirect back to APP_URL with
  // ?gh=connected (or ?gh_error=...), after which refreshStatus() picks it up.
  const connect = useCallback(async () => {
    const res = await fetch(`${API}?action=login`, { headers: await authHeader() });
    const { authUrl } = await res.json();
    window.location.href = authUrl;
  }, []);

  const disconnect = useCallback(async () => {
    await fetch(`${API}?action=disconnect`, { method: 'POST', headers: await authHeader() });
    setConnected(false);
  }, []);

  // metric: 'sleep' | 'heart-rate' | 'hrv' | 'daily-hrv' | 'resting-hr'
  // sinceISO / untilISO: ISO strings (sleep accepts a date; samples want a full timestamp).
  // Returns { metric, count, dataPoints } — dataPoints is the raw Google Health payload.
  const fetchMetric = useCallback(async (metric, sinceISO, untilISO) => {
    const qs = new URLSearchParams({ action: 'data', metric, since: sinceISO });
    if (untilISO) qs.set('until', untilISO);
    const res = await fetch(`${API}?${qs.toString()}`, { headers: await authHeader() });
    if (res.status === 401) {
      const j = await res.json().catch(() => ({}));
      if (j.needsReconnect) { setNeedsReconnect(true); setConnected(false); }
      throw new Error(j.error || 'unauthorized');
    }
    if (!res.ok) throw new Error(`fetch_${metric}_failed`);
    return res.json();
  }, []);

  return { connected, needsReconnect, loading, connect, disconnect, fetchMetric, refreshStatus };
}
