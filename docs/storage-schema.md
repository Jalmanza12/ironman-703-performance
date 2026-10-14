# Browser storage schema (`im703:v1`)

All athlete data lives in the browser's `localStorage` on one device. Source: `js/store/store.js` (storage) and `js/store/records.js` (change stamps and merging). Regression tests: `tests/store.test.js` and `tests/records.test.js`.

## Keys

| `localStorage` key | Contents |
| --- | --- |
| `im703:v1` | The whole app state, as one JSON object (below). |
| `im703:cloud` | Cloud backup only: `{userId, rev, syncedAt}`, i.e. what this browser last synced (see `docs/cloud-backup.md`). |
| `im703:v1:pre-sync` | Cloud backup only: `{savedAt, reason, state}`, a copy of the data taken before the last backup or restore. Used by **Undo last sync**. |
| `sb-<project>-auth-token` | Supabase sign-in session, written by the Supabase client. |
| `im703:coach-conn` | **Obsolete.** Left by the removed AI Coach: a backend URL and an access code. The app no longer reads it. It's safe to delete with browser site-data tools. |

## State object (`SCHEMA_VERSION = 1`)

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | number | Always set to `SCHEMA_VERSION` on load. |
| `createdAt` | ISO string | When this state was first created. |
| `profile` | object | Athlete-entered data. Defaults: `weightLb: 183`, `heightIn: 72`. May also hold `availability` (`{mon..sun: {available, maxMinutes}}`), `sweatTests`, `wetsuit`, `bikeType`, `bikeKg`, `raceReminders` and `poolUnit`. |
| `benchmarks` | array | `{id, type, value, date, method, notes, raw}`. Every target in the plan is resolved from the latest benchmark of each type. |
| `logs` | object | Session ID (`YYYY-MM-DD#n`) → `{status, actual, feedback, updatedAt}`. `status` is `completed`, `modified`, `replaced` or `skipped`. `actual` holds duration, distance, pace, HR, power, RPE, fueling and notes. |
| `daily` | object | Date → check-in: `{sleepH, sleepQ, fatigue, soreness, motivation, pain, painLocation, symptoms[], weightLb, hunger, notes}`. |
| `strength` | array | `{id, date, sessionId, exercise, load, reps, rir}`. |
| `reschedules` | object | Session ID → new date. The original move store, still read for compatibility. |
| `overrides` | object | Session ID → `{cancelled, durationMin, replacement, changeId}` from approved plan changes. |
| `changeHistory` | array | `{id, at, source, summary, changes[{workoutId, action, before, after, reason}], status}`. Used for undo and as an audit trail. `source` is `manual` (or `ai`/`rules` on changes made before the AI Coach was removed). `status` is `applied` or `undone`. |
| `predictionHistory` | array | `{date, lo, mid, hi}` in minutes. At most one entry per day. |
| `settings` | object | `poolUnit` (`yd`/`m`) and `raceChecklist`. |
| `planVersion` | string \| null | Fingerprint of the generated plan that the session IDs refer to (`buildPlan().version`). It's recorded on each load if it has changed. A test in `tests/plan.test.js` fails if a code change alters it, because existing logs would then attach to different workouts. |
| `sync` | object | `{schema, stamps, tombstones}`: when each record last changed or was deleted on this device (see below). Not athlete data. |
| `coach` | object (legacy) | **No longer created.** The removed AI Coach's chat history. It's kept untouched if present, so no data is lost. |

The training plan itself is **not stored**. It's generated from code (`js/plan/`) on every load, and the athlete's changes are applied on top through `reschedules`, `overrides` and `changeHistory` (see `js/lib/adjustments.js`).

## Records and change stamps

For change tracking and merging, the state is viewed as **records**, each with a key:

| Key | Example |
| --- | --- |
| `logs/<sessionId>`, `daily/<date>`, `reschedules/<sessionId>`, `overrides/<sessionId>` | `logs/2026-10-13#1` |
| `benchmarks/<id>`, `strength/<id>`, `changeHistory/<id>`, `predictionHistory/<date>` | `benchmarks/k3x9…` |
| `profile/<field>`, `settings/<field>` | `profile/weightLb` |
| `root/<key>` for any other top-level key, including legacy `coach` | `root/coach` |

- **Stamping:**
  - `save()` compares each record with the last load or save and puts the time in `sync.stamps[key]` for every record that changed.
  - A record that disappeared gets `sync.tombstones[key]` instead.
  - Unchanged records are never re-stamped.
- **Restores aren't edits:** JSON import and "erase everything" replace the state **without** stamping. A restored old backup can never look newer than edits made on another device.
- **Older data:** data saved before stamping existed has no stamps and counts as oldest.
- **Merging two copies** (`mergeStates(local, remote)`, which is pure and not yet wired to any backend):
  - The newest stamp wins for each record.
  - A deletion wins only if it is newer than the other side's edit.
  - Records only one side has are kept.
  - Exact ties are broken the same way on every device, and merging is commutative and idempotent.
  - Data from a newer schema version is refused.
  - The report lists conflicts, deletions, and a `planMismatch` flag.
  - Known limit: a plan change and its history entry are separate records. In a rare two-device conflict, the newest of each wins independently.
- **Multiple tabs:** when another tab saves, this tab drops its cached copy (a `storage` event) and re-renders, unless a form is focused. The next save then builds on the latest data instead of overwriting it.

## Loading and migration rules (`migrate`)

- Missing or invalid input → a fresh `emptyState()`.
- Saved fields are laid over the defaults (`{...emptyState(), ...saved}`), so fields added later get their defaults.
- **Unknown or legacy keys are preserved.** Nothing is deleted on load.
- Collections with the wrong type are reset to their default: arrays `benchmarks`, `strength`, `predictionHistory`, `changeHistory`; objects `profile`, `logs`, `daily`, `reschedules`, `overrides`, `settings`.
- `migrate` repairs a missing or malformed `sync` block without touching data.
- `load()` never writes. Building the page context records `planVersion` once when it changes. If the saved JSON is corrupt, the app starts empty in memory and leaves the raw value in storage, so it can still be recovered.

## Backup format (JSON export/import)

- **Export:** `{app: "ironman-703-performance", exportedAt, ...state}`.
- **Import:**
  - Rejects invalid JSON, or any file whose `app` isn't `ironman-703-performance`, before writing anything.
  - Otherwise removes `app` and `exportedAt`, runs `migrate`, and replaces the saved state.
- CSV exports (logs, daily, benchmarks, strength) are one-way, for spreadsheets only.

## Rules for future changes

- **Additive changes** (new optional fields with defaults in `emptyState`): no version bump needed, because `migrate` fills them in.
- **Breaking changes** (renaming, re-typing or removing a field):
  - Bump `SCHEMA_VERSION`.
  - Add an explicit, tested migration step from the old version.
  - Never drop unknown data silently.
  - Add a legacy fixture to `tests/store.test.js`.
