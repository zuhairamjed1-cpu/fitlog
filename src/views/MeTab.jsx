import { useState, Suspense, lazy } from "react";
import { EjacTab } from "../views/EjacTab";
const SettingsTab = lazy(() => import("./SettingsTab"));

// ===== extracted body =====
// ─── ME (profile + everything secondary, incl. the private tracker) ─────────
export function MeTab({ data, goals, onSaveGoals, onClearAll, onImport, session, onSignOut, addEntry, deleteEntry }) {
  const [view, setView] = useState("menu"); // menu | settings | ejac
  const [section, setSection] = useState("goals");
  const open = (v, s) => { if (s) setSection(s); setView(v); window.scrollTo({ top: 0, behavior: "smooth" }); };

  if (view === "settings") {
    return (
      <div className="stack">
        <button className="log-back" onClick={() => setView("menu")}>‹ Me</button>
        <Suspense fallback={<div className="muted-center" style={{ padding: 40 }}><span className="spinner" /></div>}><SettingsTab data={data} goals={goals} onSaveGoals={onSaveGoals} onClearAll={onClearAll} onImport={onImport} session={session} onSignOut={onSignOut} initialSection={section} /></Suspense>
      </div>
    );
  }
  if (view === "ejac") {
    return (
      <div className="stack">
        <button className="log-back" onClick={() => setView("menu")}>‹ Me</button>
        <EjacTab data={data} addEntry={addEntry} deleteEntry={deleteEntry} />
      </div>
    );
  }

  const initial = (session?.user?.email || goals.goal || "•").trim()[0]?.toUpperCase() || "•";
  const strat = goals.strategy || {};
  const sub = [goals.goal, strat.phase || strat.focus].filter(Boolean).join(" · ");
  const Row = ({ icon, label, onClick }) => (
    <button className="me-row" onClick={onClick}>
      <span className="me-row-icon">{icon}</span>
      <span className="me-row-label">{label}</span>
      <span className="me-row-chev">›</span>
    </button>
  );

  return (
    <div className="stack">
      <div className="me-profile">
        <div className="me-avatar">{initial}</div>
        <div>
          <div className="me-name">{session?.user?.email || "Your profile"}</div>
          {sub && <div className="muted small" style={{ marginTop: 3 }}>{sub}</div>}
        </div>
      </div>

      <div>
        <div className="me-group-title">Setup</div>
        <div className="me-rows">
          <Row icon="⊙" label="Goals & targets" onClick={() => open("settings", "goals")} />
          <Row icon="◔" label="About me & strategy" onClick={() => open("settings", "goals")} />
        </div>
      </div>

      <div>
        <div className="me-group-title">Preferences</div>
        <div className="me-rows">
          <Row icon="✦" label="AI model & sound" onClick={() => open("settings", "goals")} />
        </div>
      </div>

      <div>
        <div className="me-group-title">Data &amp; private</div>
        <div className="me-rows">
          <Row icon="⬇" label="Export & backup" onClick={() => open("settings", "export")} />
          <Row icon="⌗" label="Manage data" onClick={() => open("settings", "data")} />
          <Row icon="◯" label="Private tracker" onClick={() => open("ejac")} />
        </div>
      </div>
    </div>
  );
}
