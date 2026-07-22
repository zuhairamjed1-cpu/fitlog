# FitLog — Architecture

## 1. Overview

FitLog is a personal fitness & health tracker: you log food, training, sleep, weight, water, supplements, nicotine, skin, and more, and it turns those logs into coaching insights. It's a single-page React app that runs almost entirely in the browser — a stack of pure "engine" functions read your raw logs and compute derived intelligence (real maintenance calories, learned sleep need, recovery state, meal timing, etc.). An optional AI "Coach" answers questions using a text digest of everything the engines produced. Data lives in one `localStorage` blob and syncs to Supabase so it follows you across devices.

## 2. Tech stack

- **React 18 + Vite** — the whole UI. No router, no Redux; navigation and state are plain React (`useState` + tab switches). Vite for dev server + build.
- **Plain JS + a little TypeScript** — views/engines are `.jsx`/`.js`; the store and a few libs are `.ts`. Types are advisory (`tsc --noEmit`), not enforced at build.
- **Supabase** (`@supabase/supabase-js`) — auth (email) + one Postgres table for cross-device sync. Optional: if env keys are absent the app runs local-only.
- **Vitest** — unit tests for the pure engines (the logic worth protecting).
- **Vercel serverless functions** (`/api/*.js`, Node) — thin proxies that hold secrets: `chat.js` (Anthropic/Claude), `google-health.js` (Fitbit sleep OAuth), `fdc.js` (USDA food DB). The browser never sees an API key.
- **Anthropic Claude** — powers food-photo analysis and the Coach. Called through `api/chat.js`, never directly.
- CSS is one big template string in `src/styles.js`, injected as a `<style>` tag. No CSS files, no Tailwind.

## 3. Directory map

```
src/
  App.jsx            Root: auth gate, tab shell, the `data`/`goals` state, addEntry/deleteEntry, cloud sync wiring.
  config.js          defaultData / defaultGoals / defaultProfile shapes, tab lists, enums. The schema lives here.
  styles.js          Entire stylesheet as a JS string. Component-specific blocks are scoped (e.g. `.sleepx`, `.nutx`).
  supabase.js        Supabase client (null if env unset → local-only mode).

  state/store.ts     Load/save localStorage + debounced Supabase push/pull + migrations. The ONLY persistence path.
  types/models.ts    TypeScript interfaces for the entities (advisory).

  views/             Screens & big cards. One file per tab (HomeTab, HistoryTab, CoachTab, MeTab, LogOverlay…)
                     plus per-domain sections (SleepSection, DietForm, WorkoutScreen, PlanTab…).
  components/        Reusable cards/widgets (primitives.jsx = Card/Ring/MiniChart/toast; StatusPill; StreakCard…).

  engines/           THE BRAINS. ~40 pure functions, one per domain: energy.js (TDEE), sleep.js, recovery.js,
                     fatigue.js, volume.js, progression.js, nicotine.js, skin.js, circadian.js, correlations.js…
                     Input = raw `data`+`goals`, output = derived numbers/insights. No React, no I/O. Unit-tested.
  brain/brain.js     Runs every engine, assembles the results into structured "signals", and flattens them to the
                     plain-text digest that gets injected into every AI prompt.

  lib/               Pure helpers: dates.ts, partitioning.js (meal-timing engine), googleHealthSleep.js +
                     sleepViz.js + nutritionViz.js (SVG chart builders), fx.js (haptics/sound), keys.js.
  api/               Browser-side API client: client.jsx (all Claude calls + prompt building), foodAnalysis.js,
                     fdcResolver.js. These call the /api/* serverless proxies.

api/                 Vercel serverless functions (Node). Secret-holding proxies: chat.js, google-health.js, fdc.js.
```

Real logic concentration: **`engines/` + `lib/partitioning.js` + `brain/brain.js`**. Views are mostly presentation over engine output.

## 4. Data flow

**Example: user photographs a meal.**

1. In `DietForm` (a view), the user picks a photo. The view calls `analyzeFood(...)` in `src/api/foodAnalysis.js`.
2. That resizes the image (`api/client.jsx`) and POSTs to the Vercel function `api/chat.js`, which adds the `ANTHROPIC_API_KEY` server-side and forwards to Claude. Claude returns macros as JSON.
3. The view builds an entry `{ id, date, calories, protein, carbs, fat, … }` and calls `addEntry("diet")(entry)`.
4. `addEntry` (defined in `App.jsx`) does `setData(d => ({ ...d, diet: [entry, ...d.diet] }))` — one immutable update to the single `data` object.
5. A `useEffect` in `AppShell` watches `data`, writes it to `localStorage` (`saveData`) and calls `cloudSync()` — a **debounced** (1.2s) push to Supabase.
6. React re-renders. Any card that reads `data` recomputes: e.g. the Nutrition dashboard re-runs `computeEnergyBalance(data, goals)` and the meal timeline re-runs `buildTimeline(...)`. The Coach, when next asked, re-runs `buildBrain` → new text digest → Claude.

The through-line: **user action → `addEntry`/`setData` → single `data` object → engines recompute → views + AI digest reflect it → debounced sync to cloud.**

## 5. Key abstractions

- **`data` and `goals` — two plain objects, one source of truth.** `data` holds every log array (`diet`, `sleep`, `exercise`, `weight`, …). `goals` holds targets + profile + strategy. Everything downstream is a pure function of these two. Chosen for simplicity: no store library, trivially serializable, trivially synced.
- **Engines (pure functions).** Each domain (`energy`, `sleep`, `recovery`, …) is a function `f(data, goals) → derived`. They're separated from React so they can be unit-tested, reused by both the UI and the AI, and reasoned about in isolation. This is the app's defining pattern — most "features" are a new engine + a card that renders it.
- **The Brain (`brain/brain.js`).** A deliberate seam between "computed truth" and "the LLM." It runs all engines and produces one text blob. The AI never sees raw logs or does math on them — it reads the digest. Keeps the model grounded and cheap, and means improving an engine automatically improves the Coach.
- **`addEntry(type)(entry)` / `deleteEntry(type)(id)`.** Curried helpers so any view can append/remove from any log array without knowing about persistence. Persistence + sync happen centrally in `App.jsx`, not in views. `addEntry` also **intercepts the "timed" types** (`diet`, `exercise`, `sports`): instead of committing immediately it opens a `TimeRangeModal` (from/to time), then commits the entry with `timeStart`/`timeEnd`/`durationMin` attached (`time` is set to `timeStart`). This is why every meal/workout/sport carries a real time range — done once at the chokepoint so no individual form needs to ask.
- **Serverless proxies as the secret boundary.** Every third-party key lives in a Vercel function; the client calls same-origin `/api/*`. Prevents leaking keys into the bundle and lets the functions add origin/JWT/rate-limit checks.
- **SVG-builder libs (`sleepViz.js`, `nutritionViz.js`).** Charts are pure functions returning SVG strings, injected via `dangerouslySetInnerHTML`. Lets rich redesign mockups be ported verbatim, with CSS scoped under a root class (`.sleepx`, `.nutx`).

## 6. State & data

- **Storage:** one `localStorage` key (`fitlog_v5`) for `data`, a second (`_goals`) for `goals`. `state/store.ts` is the only module that touches persistence. On load it spread-merges over `defaultData`/`defaultGoals` so existing users automatically get new fields (non-destructive migration).
- **Cloud:** Supabase Postgres, one row per user in a `fitlog_data` table holding the whole `{data, goals, chat}` bundle. Writes are debounced (1.2s), **flushed on tab background/close** (`flushSync`), and **pulled on foreground / sign-in** (`cloudPull`) so a phone edit reaches the laptop.
- **Main entities** (see `config.js` `defaultData` + `types/models.ts`): `diet`, `sleep` (+`sleepArchive`), `exercise`, `sports`, `weight`, `water`, `supplements`, `nicotine`, `journal`, `skin`, `experiments`, plus goal/phase history arrays. Entries are flat objects with `id` + `date` + domain fields.
- **State management:** all in `App.jsx`'s `AppShell` via `useState(loadData)` / `useState(loadGoals)`, passed down as props. No context, no reducer. Derived state is always recomputed by engines inside `useMemo`, never stored.

## 7. Extension points

Adding a feature usually means some subset of:

1. **New data field?** Add it to `defaultData`/`defaultGoals` in `config.js` (and the interface in `types/models.ts`). The spread-merge on load back-fills it for existing users — never assume a field exists on old blobs.
2. **New logging surface?** Add a form/section under `views/`, wire it with `addEntry("yourType")`. Persistence + sync are automatic.
3. **New derived intelligence?** Add a pure `engines/yourThing.js` that takes `(data, goals)`, plus a `*.test.js` next to it. Render it in a card. If the Coach should know about it, import it in `brain/brain.js` and add it to the digest.
4. **New chart?** Add a pure SVG builder in `lib/` and a scoped CSS block in `styles.js` (`.yourx { --yourx-… }`).
5. **New AI capability?** Extend `api/client.jsx` (prompt building) and, if a new secret is needed, add a serverless proxy under `api/`.

Conventions: engines stay pure (no React/I/O), keep the daily-total/invariant math honest, prefer recomputing over storing, and **always deploy** — pushing to `main` auto-deploys to Vercel prod.

## 8. Gotchas

- **Naming drift between UI and code.** The bottom nav says "Goals," but internally that tab is `activeTab === "Insights"` and rendered by `HistoryTab`. The `TABS` array in `config.js` (Home/Log/History/Coach/Journal/Settings/Ejac) is not the live bottom-nav set. Don't trust the label — follow the component.
- **One giant `data` object.** Every write is a full immutable spread. Cheap now, but there's no per-slice subscription — a change anywhere re-renders broadly. Fine at current scale; keep engines in `useMemo`.
- **Migrations run on every load.** `migrateSleep` (and the merge in `loadData`) re-run each boot and must stay idempotent + non-destructive. Never overwrite a populated array with an empty default.
- **Timezones.** Timestamps from Google Health can be UTC instants; displaying the literal hour is wrong. Use the local converters (`localHM` in `googleHealthSleep.js`), and format dates with the local helpers in `lib/dates.ts` — `toISOString()` is UTC and off-by-one for date keys.
- **Sync is last-write-wins on the whole blob.** No field-level merge. A stale foreground tab that doesn't pull first can clobber newer cloud data — hence the flush-on-hide + pull-on-foreground dance. Respect it.
- **Sleep is Google-only now.** Manual sleep entries were moved to `sleepArchive`; the live `sleep` array is Fitbit/Google data. Sleep-stage charts read `data.sleep`; blended history views merge `sleep` + `sleepArchive` at read time.
- **CSS is a JS string with generic class names.** New component styles must be scoped under a unique root class (`.sleepx`, `.nutx`) or they'll collide with app-wide classes like `.card`/`.row`/`.pill`.
- **Serverless env vars.** Features silently degrade if a function's env isn't set (e.g. Supabase keys absent → local-only; `GOOGLE_CLIENT_ID` absent → Fitbit connect 500s). Check Vercel env when a proxy misbehaves.
- **`tsc` is advisory.** Type errors don't fail the Vite build. Run `npm run typecheck` separately.
