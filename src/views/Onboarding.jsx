import { useState } from "react";
import { fitnessGoals, SPLIT_TYPES } from "../config";
import { WEEKDAYS } from "../lib/dates";
import { haptic, SFX } from "../lib/fx";

// ===== extracted body =====
export function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState("Build Muscle");
  const [calories, setCalories] = useState(2500);
  const [split, setSplit] = useState("Push / Pull / Legs");
  const [trainingDays, setTrainingDays] = useState(["Mon", "Tue", "Thu", "Fri", "Sat"]);
  const todayName = WEEKDAYS[(new Date().getDay() + 6) % 7];

  const macros = (() => {
    const c = calories;
    if (goal === "Build Muscle") return { protein: Math.round(c*.30/4), carbs: Math.round(c*.45/4), fat: Math.round(c*.25/9) };
    if (goal === "Lose Fat") return { protein: Math.round(c*.35/4), carbs: Math.round(c*.35/4), fat: Math.round(c*.30/9) };
    if (goal === "Improve Endurance") return { protein: Math.round(c*.20/4), carbs: Math.round(c*.55/4), fat: Math.round(c*.25/9) };
    if (goal === "Athletic Performance") return { protein: Math.round(c*.25/4), carbs: Math.round(c*.50/4), fat: Math.round(c*.25/9) };
    return { protein: Math.round(c*.25/4), carbs: Math.round(c*.45/4), fat: Math.round(c*.30/9) };
  })();

  function finish() {
    haptic([12, 30, 12]);
    SFX.success();
    onDone({ goal, calories, ...macros, plan: { split, trainingDays, assignments: {}, notes: "" } });
  }

  function toggleDay(d) {
    haptic(10);
    setTrainingDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)));
  }

  const steps = [
    // 0 — welcome
    <div key="w" className="ob-step">
      <div className="ob-logo">FitLog</div>
      <h2 className="ob-h">Welcome 👋</h2>
      <p className="ob-p">Your personal AI fitness tracker. Let's set you up in 30 seconds — you can change anything later.</p>
      <button className="btn full" onClick={() => setStep(1)}>Get started</button>
    </div>,
    // 1 — goal
    <div key="g" className="ob-step">
      <h2 className="ob-h">What's your main goal?</h2>
      <div className="ob-choices">
        {fitnessGoals.map(g => (
          <button key={g} className={`ob-choice ${goal === g ? "on" : ""}`} onClick={() => { setGoal(g); haptic(10); }}>{g}</button>
        ))}
      </div>
      <button className="btn full" onClick={() => setStep(2)}>Next</button>
    </div>,
    // 2 — calories
    <div key="c" className="ob-step">
      <h2 className="ob-h">Daily calorie target</h2>
      <p className="ob-p">A rough number is fine — your coach can help you dial it in later.</p>
      <div className="ob-cal">
        <button className="ob-step-btn" onClick={() => { setCalories(c => Math.max(1000, c - 100)); haptic(8); }}>−</button>
        <div className="ob-cal-val">{calories}<span>kcal</span></div>
        <button className="ob-step-btn" onClick={() => { setCalories(c => c + 100); haptic(8); }}>+</button>
      </div>
      <div className="ob-macros">Suggested: {macros.protein}g protein · {macros.carbs}g carbs · {macros.fat}g fat</div>
      <button className="btn full" onClick={() => setStep(3)}>Next</button>
    </div>,
    // 3 — split + days
    <div key="s" className="ob-step">
      <h2 className="ob-h">Your training week</h2>
      <label>Split<select value={split} onChange={e => setSplit(e.target.value)}>{SPLIT_TYPES.map(s => <option key={s}>{s}</option>)}</select></label>
      <div className="weekgrid-label">Which days can you train?</div>
      <div className="weekgrid">
        {WEEKDAYS.map(d => (
          <button key={d} className={`weekday ${trainingDays.includes(d) ? "on" : ""} ${d === todayName ? "today" : ""}`} onClick={() => toggleDay(d)}>{d}</button>
        ))}
      </div>
      <button className="btn full" style={{ marginTop: 16 }} onClick={finish}>Start tracking 🎉</button>
    </div>,
  ];

  return (
    <div className="ob">
      <div className="ob-box">
        {step > 0 && <div className="ob-progress">{[1,2,3].map(i => <span key={i} className={`ob-dot ${i <= step ? "on" : ""}`} />)}</div>}
        {steps[step]}
        {step > 0 && step < 3 && <button className="link-btn ob-back" onClick={() => setStep(step - 1)}>← Back</button>}
      </div>
    </div>
  );
}
