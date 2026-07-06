import { useState, useEffect } from "react";

// ===== extracted body =====
// Brief welcome shown on every app entry. Auto-dismisses; tap to skip.
export function WelcomeSplash({ session, goals, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const close = () => { if (leaving) return; setLeaving(true); setTimeout(onDone, 480); };
  useEffect(() => {
    const t = setTimeout(close, 2000);
    return () => clearTimeout(t);
  }, []);
  const h = new Date().getHours();
  const part = h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Late night grind";
  const raw = (session?.user?.email || "").split("@")[0] || "";
  const name = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "";
  const sub = goals?.goal || "Let's make today count";
  return (
    <div className={`welcome-splash${leaving ? " leaving" : ""}`} onClick={close}>
      <div className="welcome-inner">
        <div className="welcome-logo">FitLog</div>
        <div className="welcome-greet">{part}{name ? `, ${name}` : ""} 👋</div>
        <div className="welcome-sub">{sub}</div>
      </div>
    </div>
  );
}
