# FitLog — Nutrition / Calorie Tab Redesign Brief

You are redesigning the **Nutrition** sub-tab under the **Goals** tab of FitLog
(React 18 + Vite, dark theme). Below is exactly how it works today — the data, the
engine outputs, every card, and the constraints. Redesign the **layout and visual
presentation**; consume the data/engines as-is (don't change the data model).

---

## 1. Where the data comes from

- **Food logs** — `data.diet[]`, one row per logged item/meal. Each carries
  `{ date:"YYYY-MM-DD", calories, protein, carbs, fat, name?, time? }`. Some rows are
  flagged as cheat meals (excluded from targets).
- **Weight** — `data.weight[]` (morning weigh-ins) feeds the trend + real-maintenance
  engine.
- **Targets** — `goals`: `{ calories, protein, carbs, fat, waterGoalMl, goal:"Build
  Muscle"|"Cut"|… }`.
- **Water** — `data.water[]` (ml); **Creatine/supplements** — `data.supplements[]`.

Daily totals are simple sums of that day's `diet` rows (cheat meals excluded from the
"counted" total). Today's ring on the Home dashboard already shows kcal-left + P/C/F.

## 2. The headline engine — `computeEnergyBalance(data, goals)`

Measures the user's **real maintenance (TDEE)** from logged intake + weight trend
(not a formula). Returns:

```
{ ready:false, reason, loggedDays, spanDays, completeness, haveWeight }   // not enough data
// or, when ready:
{
  ready:true,
  tdee,                 // measured real maintenance, kcal
  meanIntake,           // avg logged intake/day
  realDelta,            // meanIntake − tdee (negative = deficit)
  intent:"cut"|"bulk"|"maintain",
  recommendedIntake,    // suggested kcal for the intent
  currentTarget,        // goals.calories
  weightRateKgWk,       // trend weight change, kg/week (+/-)
  weightChangeKg, spanDays, loggedDays, completeness,   // 0..1 logging completeness
  confidence:"High"|"Moderate"|"Low",
  bmr, underLogging:bool, plateau:bool, insights
}
```

Two important flags to surface: **`underLogging`** (measured maintenance implausibly
low → logs incomplete) and **`plateau`** (fat loss stalled despite an apparent deficit).

## 3. Cards currently rendered (top → bottom)

1. **Energy balance** (`EnergyBalanceCard`) — the hero. Big **real-maintenance kcal**,
   "eating ~X/day · deficit/surplus" (colored by whether the delta matches the intent),
   a **3-cell grid** (Trend weight kg/wk · Your target · Suggested(intent)), a
   confidence status pill, and a warning strip when `underLogging`/`plateau`. Not-ready
   state shows a "logged X/14 days" progress bar.
2. **Range segment** — 7 / 14 / 30-day toggle (shared across nutrition charts).
3. **Calories** — Average vs Target stats + line chart (`MiniChart`, goal line + rolling
   average) with experiment bands overlaid.
4. **Protein** — "target hit X/Y days" + line chart vs protein goal (g).
5. **Water** — daily target + line chart vs `waterGoalMl`.
6. **Creatine saturation** — supplement saturation card.

## 4. Data available for new visualizations

- Per-day series over the selected range: **calories, protein, carbs, fat, water**
  (each `[{ value|null, label:date }]`).
- Per-day **macro split** (P/C/F grams and kcal) for a stacked/rings view.
- **Target adherence** (days hit / logged), **streaks**, **cheat-meal** days.
- **Weight trend** line + rate, to pair calories against outcome.
- Energy-balance numbers (TDEE, deficit, recommended) for a "plan vs reality" panel.

## 5. Visual system (match the Sleep redesign)

- Dark theme. Palette: accent `#4fb3bd`, teal `#6ee7f7`, good `#5fcf80`,
  amber `#f9c97e`, red `#f47e6e`, text `#eef2f6`, muted `#6b7480`, hairline `#232c38`.
- Macro colors (reuse app convention): **Protein** `#f9c97e` (amber), **Carbs**
  `#4fb3bd`/teal, **Fat** `#8b6cff`/violet — pick a consistent trio and legend it.
- Cards: ~22px radius, dark gradient surface, 1px hairline border, soft shadow, thin
  top glass highlight. Tabular-nums for all numbers.
- Reuse primitives: `<Card title sub action>`, `<MiniChart points showGoal rollingAvg
  unit>`, `<StatusPill>`. **Scope all custom CSS under a root class** (e.g. `.nutx`)
  with prefixed vars — the Sleep redesign uses `.sleepx`; do the same so generic class
  names never leak into the rest of the app.

## 6. Tech constraints

- React 18, inline-style objects; global CSS injected from `src/styles.js` (append a
  scoped block, don't create a .css file). SVG charts via pure builder functions +
  `dangerouslySetInnerHTML` is fine (see `src/lib/sleepViz.js` for the pattern).
- Rendered by `HistoryTab` (Goals tab) when the Nutrition sub-tab is active; props
  reach it as `{ data, goals, addEntry, range, setRange, series, calPts, proteinPts,
  waterPts }`.
- Single `fitlog_v5` localStorage blob + Supabase cloud sync — no second store.
- Mobile-first; must also read on desktop.

## 7. What to design

A cohesive **nutrition dashboard** with a clear hierarchy:
1. **Hero — Energy balance / "plan vs reality"**: measured maintenance, the deficit/
   surplus vs intent, trend-weight outcome, recommended intake, confidence. Make the
   deficit↔weight-trend relationship legible (are they actually losing/gaining as the
   numbers predict?). Surface the `underLogging`/`plateau` warnings prominently.
2. **Today / macro composition**: kcal-left ring + P/C/F breakdown (bars or rings) with
   targets.
3. **Trends**: calories vs target, protein adherence, macro composition over the range,
   water — with the 7/14/30 toggle.
4. Keep creatine/supplement saturation.

New visualizations of the existing data welcome (calorie-vs-weight dual axis, macro
donut, adherence heat-strip, deficit-bank like the sleep-debt bars). Deliver as a
self-contained dark-theme HTML/CSS mockup I can port to React — same as the Sleep tab.
