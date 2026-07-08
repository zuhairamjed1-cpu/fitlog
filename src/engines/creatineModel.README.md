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

The card reads `creatineDaysFromSupplements(data.supplements, today)` — it scans
the **supplement log** (the same entries `SupplementCard` writes) for anything
whose name/brand matches `creatin`, parses grams from the dose string
(`"5 g"`, `"1 scoop (5g)"`, `"3"`), and builds a continuous daily series.

Integration seams, each marked `// TODO` in code:

1. **`CreatineSaturationCard.jsx`** — falls back to `sampleLoadingWeek(today)`
   (7 × 20 g) when no creatine is logged, so the card renders with the tick
   checked. Remove the fallback once real data is reliable.
2. **Bar edits** — tapping a bar writes to local `overrides` state and recomputes
   saturation. Persist those back to the supplement log to make edits durable.
3. **`settings`** — pass a `CreatineSettings` (body weight enables per-kg dosing)
   from wherever profile/goals live; defaults to `DEFAULT_SETTINGS`.

## Tests

`creatineModel.test.js` (vitest) asserts: loading ≈99% by day 5; 5 g ≥90% by
day 28; a 6-week 0 g gap returns near baseline; saturation stays within
`[baseline, 100]`; `needsLoading` true for a new user and after a 3-day gap;
`isLoadingComplete` / `recommendedDose` / dose parsing.
