# Creatine saturation model

`creatineModel.js` powers the **Creatine saturation** card. It models muscle
creatine saturation as a percentage (`baseline .. 100`) and decides, from your
logged intake, whether you're in a **loading phase**.

## The kinetic model

Discrete daily first-order model. Each day two things happen:

```
gapFraction = (MAX - S) / (MAX - BASELINE)     // diminishing returns as it fills
uptake      = K_UPTAKE * doseGrams * gapFraction
decay       = K_DECAY  * (S - BASELINE)         // drains surplus toward baseline
S           = clamp(S + uptake - decay, BASELINE, MAX)
```

- Computed over your **entire** intake history in date order, with every missing
  calendar day filled as `doseGrams = 0` (decay-only) so gaps lower saturation.
- Saturation is **continuous across weeks** — the card slices out the visible
  week for the ring/labels but never resets to baseline at a week boundary.
- Rounded only at display time.

### Constants (`MAX`, `K_UPTAKE`, `K_DECAY`)

Tuned against published monohydrate anchors:

| Anchor | Behaviour |
|---|---|
| 20 g/day loading | ≈98–99% by ~day 5 |
| 5 g/day steady | ≈93% plateau, ≥90% by ~day 28 |
| stop taking it | back toward baseline over ~5–6 weeks |

**Calibration note.** The spec's starting `K_UPTAKE=1.0 / K_DECAY=0.018` are
mutually incompatible: a decay of `0.018/day` leaves a 6-week washout at ~80%
(nowhere near baseline), while a decay fast enough to wash out in ~6 weeks
mathematically caps the loading plateau below 99% in this linear model. Shipped
values are **`K_UPTAKE=1.4`, `K_DECAY=0.05`**, which satisfy all three anchors
and the unit tests. Change the two together, not individually.

## Load detection (system-driven — drives the tick)

The tick is **not** a user toggle. It reflects `inLoadingPhase(history, saturation)`:

- **New user** (no history) → loading (tick checked).
- `daysSinceLastDose >= 3` → you stopped; reload (checked).
- `saturation <= 72` → near baseline; reload (checked).
- Otherwise loading stays on until `isLoadingComplete`: **≥5 consecutive dosing
  days AND saturation ≥95%**, at which point the recommended dose drops from the
  loading dose to the maintenance dose.

`recommendedDose(settings, phase)` — loading `0.3 g/kg` (default 20 g),
maintenance `0.03 g/kg` (default 5 g, floor 3 g).

## Connecting your real intake

Intake comes from the **supplement log** (`data.supplements` — the same entries
the Supplements card in the Log tab writes). `creatineIntakeAdapter.js` filters
to name/brand matching `creatin`, normalizes each free-text dose to grams
(mg → ÷1000; scoops/servings → × **`GRAMS_PER_SERVING`, default 5 g** since the
app stores no structured serving size), sums same-day doses, buckets by local
date, and gap-fills to a continuous ≤90-day series. The card is **read-only** on
the log: it never keeps its own intake store.

Live updates are automatic — `data` is one App-level state shared by the writer
(SupplementCard → `addEntry`) and this card, so a logged dose re-renders the card
and moves the ring / flips the tick. Tapping a bar logs a dose for that day
through the **same `addEntry("supplements")` path** (one source of truth). The
sample loading week is used only when no creatine has ever been logged (the
new-user default-loading state).

- **`settings`** — pass a `CreatineSettings` (body weight enables per-kg dosing)
  from wherever profile/goals live; defaults to `DEFAULT_SETTINGS`.

## Tests

`creatineModel.test.js` (vitest) asserts: loading ≈99% by day 5; 5 g ≥90% by
day 28; a 6-week 0 g gap returns near baseline; saturation stays within
`[baseline, 100]`; `needsLoading` true for a new user and after a 3-day gap;
`isLoadingComplete` / `recommendedDose`.

`creatineIntakeAdapter.test.js` covers the log→CreatineDay[] adapter: unit
conversion (g/mg/scoops/unknown), same-day summation, gap-fill to zeros,
local-date bucketing (incl. `ts`-only fallback), out-of-order entries, and the
lookback cap.
