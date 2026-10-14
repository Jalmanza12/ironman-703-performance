# 70.3 Dallas HQ — personal IRONMAN 70.3 performance system

A personal training and performance platform for **IRONMAN 70.3 Dallas–Little Elm (Sunday, March 14, 2027)**, built around a sub-5:15 goal. It is a working tool, not a static plan: you open it each morning, see exactly what to do, log what happened, and get feedback.

**Live site:** https://jalmanza12.github.io/ironman-703-performance/

## What's inside

| Area | What it does |
|---|---|
| **Daily plan** | 161 days (Oct 5, 2026 → race day): 248 fully specified sessions, each with warm-up, main set, cool-down, targets (power / pace / HR / RPE / cadence), terrain, equipment, fueling, cues, success criteria, modifications (fatigue, weather, limited time, pain/illness), priority, and *why it exists*. |
| **Periodization** | Recovery → Base 1 → Base 2 → Build 1 → Race-specific build → Peak → Taper → Race week, with explicit deload weeks (7, 11, 15, 19) and a 2-week taper. |
| **Benchmarks → targets** | Enter FTP, CSS, threshold pace and LTHR (or use the built-in test forms on test days); every target in the plan updates automatically. Missing benchmarks show **"Not yet established"** and provisional RPE/HR targets — nothing is invented. |
| **Calendar** | Month / week / day views; build, recovery, peak, taper and race weeks visually distinct; status per session. |
| **Logging & feedback** | Completed / modified / replaced / skipped; duration, distance, pace, HR, power, NP, cadence, intervals, RPE, pain, fueling, strength sets. Automatic planned-vs-actual feedback. |
| **Daily check-in** | Sleep, fatigue, soreness, motivation, hunger, pain, symptoms, body weight. |
| **Adaptive coaching** | Transparent rules (red flags → medical guidance; sleep + fatigue → reduce stress; repeated target misses; easy days too hard; efficiency trends; weight loss/REDs; fueling; load spikes; benchmark trends). Every note shows observation, suggestion and *why*. |
| **Rescheduling** | Recovery-aware: key sessions only, same week, no Mondays, no back-to-back hard days, long sessions only on weekends. |
| **Prediction engine** | Swim (CSS model), bike (physics model over a ~1,400 ft rolling course with wind), run (threshold/race-based off-bike model), transitions → fast / likely / slow range with confidence and history. |
| **Readiness indicator** | Weighted, transparent components with data coverage; explicitly a coaching aid. |
| **Race-day mode** | Phone-friendly splits, pacing bands, fueling schedule, checklists, reminders, race-day passage. |
| **Fuel** | Daily carbohydrate/protein by day type, session fueling, sweat-rate calculator, weight trend, body-composition guidance. |
| **Reviews** | Weekly reviews and 4-week block reviews generated from your logs. |
| **Faith** | A unique passage every day (161 passages, Old and New Testament) with summary, reflection tied to that day's training, and a question or intention. |

## Docs

- [`docs/research-and-methodology.md`](docs/research-and-methodology.md) — event verification, sources (with DOIs), key findings, limitations, and how each translates into the plan.
- [`docs/storage-schema.md`](docs/storage-schema.md) — the `im703:v1` browser-storage format, migration rules, and backup format.
- [`docs/training-plan.md`](docs/training-plan.md) — the complete day-by-day plan in text (regenerate with `npm run plan:export`).

## Getting started (athlete)

1. Open the site → **Profile** → fill in the onboarding questionnaire (equipment, pool unit, Waco splits, availability, injuries, nutrition).
2. Follow **Today** each day; log every session and the daily check-in.
3. On test days (Oct 27 FTP, Oct 28 CSS, Nov 1 run TT, then end of deload weeks), enter results in the form on the session page.
4. Export a **JSON backup** weekly (Profile → Data).

## Data & privacy

- Data lives **only in your browser** (`localStorage`) on the device you use. Nothing is sent anywhere; the public repository contains no personal training data, keys, or credentials.
- Limitations: no automatic sync between devices; private browsing or clearing site data erases it. Use **Export JSON** / **Import JSON** to move between phone and laptop, and CSV exports for spreadsheets.
- Cross-device sync would require an authenticated backend (e.g., Supabase or Firebase with per-user access rules). It is intentionally not included so no service or credentials are needed.

## Development

No build step and no dependencies — native ES modules served as static files.

```bash
npm test                 # node:test suite (calculations, plan integrity, adjustments)
node scripts/smoke.mjs   # renders every view with empty and populated data
npm run plan:export      # regenerate docs/training-plan.md
npm run serve            # http://localhost:8080
```

Structure:

```
js/data/        race facts (verified), Bible passages
js/plan/        workout builders (swim/bike/run/strength), week table, calendar generator
js/lib/         dates, units, zones, targets, benchmarks, load, prediction, bike physics,
                coaching rules, readiness, reschedule, nutrition, reviews
js/store/       localStorage persistence, JSON/CSV import-export
js/ui/          views (dashboard, day, session, calendar, analytics, race, race-day, reviews, fuel, profile)
tests/          unit tests
```

Deployment: GitHub Actions (`.github/workflows/pages.yml`) runs the tests, builds a cache-busted copy of the site with `node scripts/build-site.mjs` (every module URL gets `?v=<commit>` so browsers never mix old and new files), and publishes it to GitHub Pages.

## Disclaimer

The coaching engine produces automated observations from your data. It is not medical advice or a substitute for a qualified coach or clinician. Stop and seek medical evaluation for chest pain, dizziness, fainting, or pain that changes how you move.
