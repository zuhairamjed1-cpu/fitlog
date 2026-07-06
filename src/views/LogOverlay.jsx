import { useState } from "react";
import { getTodayStr } from "../lib/dates";
import { haptic, SFX } from "../lib/fx";
import { DietForm } from "../views/DietForm";
import { EjacTab } from "../views/EjacTab";
import { GoalPlanV3 } from "../views/goal/GoalPlan";
import { WaterForm, SupplementForm, WeightForm } from "../views/IntakeTab";
import { JournalTab } from "../views/JournalTab";
import { NicotineTab } from "../views/NicotineTab";
import { PlanTab } from "../views/PlanTab";
import { SkinSection } from "../views/skin/SkinSection";
import { SleepSection } from "../views/SleepSection";
import { WorkoutScreen, SportsForm } from "../views/WorkoutScreen";

// ===== extracted body =====
// Full-screen sheet launched by the raised ＋. Shows logging options grouped by
// intent; tapping one opens that existing form. Reuses every form component.
export function LogOverlay({ data, goals, addEntry, deleteEntry, onSaveGoals, setData, initial, onClose }) {
  const updateEntry = type => (id, patch) => setData(d => ({ ...d, [type]: (d[type] || []).map(e => e.id === id ? { ...e, ...patch } : e) }));
  const [view, setView] = useState(initial || null);
  const today = getTodayStr();
  const groups = [
    { title: "Goal", items: [
      { key: "goalplan", label: "Goal Plan", icon: "◎", color: "#7cc4a0" },
      { key: "plan", label: "Plan", icon: "▦", color: "#6ee7f7" },
    ] },
    { title: "Nutrition", items: [
      { key: "diet", label: "Meal", icon: "◉", color: "#f9c97e" },
      { key: "water", label: "Water", icon: "◊", color: "#5cc8df" },
      { key: "supps", label: "Supps", icon: "⊕", color: "#b4a8e8" },
    ] },
    { title: "Training", items: [
      { key: "exercise", label: "Workout", icon: "◆", color: "#f47e6e" },
      { key: "sports", label: "Sport", icon: "◇", color: "#8fd989" },
      { key: "weight", label: "Weight", icon: "◈", color: "#e8c97e" },
    ] },
    { title: "Wellness", items: [
      { key: "sleep", label: "Sleep", icon: "◐", color: "#6ee7f7" },
      { key: "nicotine", label: "Nicotine", icon: "●", color: "#d98fa8" },
      { key: "skin", label: "Skin", icon: "✦", color: "#e89ab0" },
      { key: "journal", label: "Journal", icon: "✎", color: "#9aa8e8" },
      { key: "ejac", label: "Private", icon: "◯", color: "#c9a2e8" },
    ] },
  ];
  const labelFor = k => { for (const g of groups) for (const it of g.items) if (it.key === k) return it.label; return "Log"; };

  const renderForm = () => {
    switch (view) {
      case "diet": return <DietForm onAdd={addEntry("diet")} recent={data.diet} goals={goals} data={data} todayDiet={data.diet.filter(d => d.date === today)} addEntry={addEntry} deleteEntry={deleteEntry} />;
      case "water": return <WaterForm data={data} goals={goals} onAdd={addEntry("water")} onDelete={deleteEntry("water")} />;
      case "supps": return <SupplementForm data={data} onAdd={addEntry("supplements")} onDelete={deleteEntry("supplements")} />;
      case "weight": return <WeightForm data={data} goals={goals} onAdd={addEntry("weight")} onDelete={deleteEntry("weight")} />;
      case "exercise": return <WorkoutScreen data={data} goals={goals} addEntry={addEntry} onSaveGoals={onSaveGoals} />;
      case "sports": return <SportsForm onAdd={addEntry("sports")} recent={data.sports} />;
      case "plan": return <PlanTab data={data} goals={goals} onSaveGoals={onSaveGoals} />;
      case "sleep": return <SleepSection data={data} goals={goals} addEntry={addEntry} onSaveGoals={onSaveGoals} />;
      case "nicotine": return <NicotineTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} />;
      case "journal": return <JournalTab data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} setData={setData} />;
      case "skin": return <SkinSection data={data} goals={goals} addEntry={addEntry} deleteEntry={deleteEntry} updateEntry={updateEntry} onSaveGoals={onSaveGoals} />;
      case "goalplan": return <GoalPlanV3 data={data} goals={goals} onSaveGoals={onSaveGoals} addEntry={addEntry} deleteEntry={deleteEntry} />;
      case "ejac": return <EjacTab data={data} addEntry={addEntry} deleteEntry={deleteEntry} />;
      default: return null;
    }
  };

  return (
    <div className={`log-overlay${view === "skin" ? " skinlog-active" : ""}`}>
      <div className="log-overlay-head">
        <div className="log-overlay-head-inner">
          {view
            ? <button className="log-back" onClick={() => setView(null)}>‹ All</button>
            : <span className="log-overlay-title">Log anything</span>}
          <span className="log-overlay-mid">{view ? labelFor(view) : ""}</span>
          <button className="log-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>
      <div className="log-overlay-body">
        <div className="log-overlay-inner">
        {view ? renderForm() : (
          <div className="stack">
            <div className="muted small" style={{ marginBottom: 2 }}>Pick what you want to record</div>
            {groups.map(g => (
              <div key={g.title}>
                <div className="log-group-title">{g.title}</div>
                <div className="log-grid">
                  {g.items.map(it => (
                    <button key={it.key} className="log-tile" onClick={() => { SFX.tap(); haptic(8); setView(it.key); }}>
                      <span className="log-tile-icon" style={{ color: it.color }}>{it.icon}</span>
                      <span className="log-tile-label">{it.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
