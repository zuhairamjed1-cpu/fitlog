import { useState } from "react";
import { supabase } from "../supabase";

// ===== extracted body =====
// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
export function AuthScreen() {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (e) {
      setError(e.message || "Something went wrong. Try again.");
    }
    setBusy(false);
  }

  return (
    <div className="auth">
      <div className="auth-box">
        <h1 className="auth-brand">FitLog</h1>
        <p className="auth-sub">{mode === "signup" ? "Create your account" : "Welcome back"}</p>
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" autoComplete="email" /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} placeholder="••••••••" autoComplete={mode === "signup" ? "new-password" : "current-password"} /></label>
        {error && <div className="err">{error}</div>}
        <button className="btn full" onClick={submit} disabled={busy} style={{ marginTop: 14 }}>
          {busy ? <span className="spinner" /> : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <p className="auth-switch">
          {mode === "signup" ? "Already have an account?" : "New here?"}
          <button className="link-btn" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); }}>
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}
