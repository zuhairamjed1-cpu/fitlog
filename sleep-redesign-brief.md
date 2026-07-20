# FitLog — Sleep Tab Redesign Brief

You are redesigning the **Sleep** sub-tab that lives under the **Goals** tab of FitLog
(a React 18 + Vite personal health app). Below is exactly how the current system works:
the data, where it comes from, every card rendered today, and the constraints. Redesign
the **layout and visual presentation** of this data. Do not change the data model or the
engine outputs — you consume them.

---

## 1. Where sleep data comes from

Sleep is sourced from a **Google Fitbit Air** tracker via the **Google Health API**
(server-side OAuth broker → Supabase-stored tokens → `/api/google-health`). The user
connects once, then syncs. There is **no manual sleep logging anymore** — the hand-entry
form was removed.

Two stores, kept **physically separate**, **merged at read time** for display:

- `data.sleep[]` — **live** nights from Google Health (`source: "googlehealth"`). These
  carry sleep-stage detail.
- `data.sleepArchive[]` — **legacy** manually-logged nights (49 of them), preserved
  read-only. No stage data. Shown in charts/trends but tagged separately.

A `mergeSleep(data)` union feeds the intelligence + duration/score/debt/need charts and the
recent list. **Stage-only visualizations use `data.sleep` alone** (archived nights have no
stages).

## 2. Sleep entry schema

Every night object:

```
{
  id, date: "YYYY-MM-DD",
  bedtime: "HH:MM", wakeTime: "HH:MM",
  duration: Number,            // HOURS ASLEEP (Google) or hours in bed (legacy)
  quality: "Great"|"Good"|"Fair"|"Poor"|"—",
  // Google Health nights add:
  source: "googlehealth",
  ghId,
  efficiency: 0..100,          // % asleep vs in-bed
  inBedHours: Number,
  derivedScore: 0..100 | null, // WE compute this (Google has no native sleep score)
  sleepType: "stages"|"classic",
  stageTotals: { DEEP, REM, LIGHT, AWAKE, OUT_OF_BED },   // minutes per stage
  stages: [ { type:"DEEP"|"REM"|"LIGHT"|"AWAKE", label, start, end, min } ]
}
```

### Derived sleep score (0–100), computed by us
`efficiency (50%) + deep-adequacy (17.5%, target 13% of asleep) + REM-adequacy (17.5%,
target 23%) + low-restlessness (15%)`. Google exposes **no** native score — this is ours.

## 3. What `computeSleep(mergedData, goals)` returns (drives the intelligence cards)

```
{
  need:        { hours, source:"override|learned|learning|default", confidence:"high|moderate|low|set", nGood, nUnassisted },
  nightsLogged, confidence,
  quantity:    { avgTST7, avgTST14, need, debt7, status, label, loggedNights7 },
  regularity:  { midSD, wakeSD, socialJetlag, status, label, anchorWake:"HH:MM", bedTarget:"HH:MM" },
  continuity:  { avgEff, avgLatency, avgWaso, qualityTrend, unrefreshing, status, label, hasEffData },
  coupling, insights, topLever:{text}, appetite,
  debt:        { debtH, deltaVsYesterdayH, agedOutReliefH, paydownNights, paydownExtraMin, lowConfidence, loggedNights },
  today:       { tst, eff, quality } | null,
  series:      { tst:[{value,label}], quality:[{value,label}] }   // 14-day series
}
```
Returns `null` when there is no usable history → show an empty "connect Google Health" state.

**Sleep need** is auto-learned from alarm-free good nights (Bayesian shrinkage toward an 8h
prior), user-overridable. **Sleep debt** = rolling 14-night deficit vs need, floored at 0.

## 4. Cards currently rendered (top → bottom)

1. **⌚ Fitbit Air card** — connect / connected state. When connected: "Sync sleep now"
   button, last-night **stage bar** (Deep/REM/Light/Awake stacked) + derived score +
   efficiency, disconnect link. Handles `needsReconnect` (weekly Testing-mode token expiry).
2. **Sleep score card** (`SleepScoreCard`) — score + 14-night score sparkline.
3. **Sleep need + confidence** — learned need (h), source explanation, confidence, "set
   manually" override input.
4. **Sleep debt** — rolling 14-night hours-behind, delta vs yesterday, pay-down plan
   ("+X min for N nights"), aged-out relief nudge, low-confidence note.
5. **Biggest sleep lever** — single highest-impact behavioral insight (`topLever.text`).
6. **Circadian anchor** — fixed anchor wake time ↔ target in-bed time.
7. **Duration** — 7-day avg asleep vs need, status pill, 14-day mini chart with goal line
   + rolling average.
8. **Stage trends** (`StageTrendCard`, Google-only) — Deep (h), REM (h), Efficiency (%)
   mini-charts over last 14 stage nights, with per-metric averages.
9. **Recent nights** — collapsible list of last 30 nights; each row `duration · quality`
   tagged ⌚ (Fitbit) or ✎ (manual).
10. **Archive note** — "N manually-logged nights included — stored separately, no stages."

## 5. Visual system (must match the app)

- Dark theme. Palette: accent `#4fb3bd`, sleep-teal `#6ee7f7`, good `#5fcf80`,
  amber `#f9c97e`, red `#f47e6e`, text `#eef2f6`, text-2 `#9aa4b2`, muted `#6b7480`,
  hairline `#232c38`.
- Stage colors: **Deep** `#4f6bff`, **REM** `#8b6cff`, **Light** `#4fb3bd`,
  **Awake** `#f9c97e`.
- Card style: rounded ~22px, dark gradient surface, 1px hairline border, soft drop shadow.
- Existing primitives to reuse: `<Card title sub action>`, `<MiniChart points showGoal
  rollingAvg unit>`, `<StatusPill>`, `<Empty>`. Charts are simple line/area sparklines.

## 6. Tech constraints

- React 18, inline-style objects (no CSS modules); global CSS injected from `src/styles.js`.
- Component: `src/views/SleepSection.jsx`, rendered by `HistoryTab` (the Goals tab) when the
  Sleep sub-tab is active. Props: `{ data, goals, addEntry, onSaveGoals }`.
- Single `fitlog_v5` localStorage blob + Supabase cloud sync — don't add a second store.
- Mobile-first (used mostly on phone); must also read well on desktop width.

## 7. What to design

A cohesive, modern **sleep dashboard** for Goals → Sleep that presents the above data with
a clear hierarchy — hero (last night: stages + score + duration), then need/debt, then
trends, then recent/archive. Keep the ⌚ connect/sync affordance obvious. You may merge,
reorder, or restyle cards, and propose new visualizations of the existing data (e.g. a
stage hypnogram from the `stages[]` timeline, weekly stage-composition, consistency ring).
Deliver as a self-contained HTML/CSS mockup (dark theme) I can port to React.
