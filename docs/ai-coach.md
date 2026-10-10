# AI Coach — architecture, setup & usage

The AI Coach lets the athlete talk to the plan ("I can't train tomorrow", "I'm traveling Mon–Wed next week") and receive **proposals** that change the training calendar **only after explicit approval**.

## 1. Architecture

```
Browser (GitHub Pages, static)                         Cloudflare Worker (worker/)                Anthropic API
┌────────────────────────────────────┐   HTTPS POST   ┌─────────────────────────────────┐      ┌──────────────┐
│ AI Coach page (js/ui/coach.js)     │ ─────────────▶ │ /coach                          │ ───▶ │ claude-opus-5-5│
│  • builds minimal context          │  access code   │  • CORS + origin allow-list     │      │ JSON-schema    │
│    (js/lib/coachCore.js)           │                │  • access code (secret)         │ ◀─── │ structured     │
│  • shows proposal card             │ ◀───────────── │  • size limit, rate limit       │      │ output         │
│  • Accept → validateProposal()     │  validated JSON│  • timeout + safe errors        │      └──────────────┘
│    → applyProposal() (atomic)      │                │  • validates output vs schema   │
│  • rules-based fallback (not AI)   │                │    and vs workout ids sent      │
└────────────────────────────────────┘                └─────────────────────────────────┘
          │ localStorage (single source of truth: plan code + overrides + logs)
```

- **Source of truth.** The generated plan (`js/plan/`) plus athlete-approved overrides in `localStorage`:
  `reschedules` (moves — the pre-existing store), `overrides` (skip / shorten / replace), and `changeHistory` (before/after values, source, reason, undo). Conversation history (`coach.messages`) is never authoritative.
- **Every page reads the same effective schedule** through `effectiveSession()` / `effectiveSessionsOn()` (`js/lib/adjustments.js`): Dashboard, Today, Calendar (✎ adjusted, struck-through skipped), Session pages, weekly totals, Analytics and Reviews. Logged results (`state.logs`) are never modified by the coach.
- **Secrets.** The Anthropic API key exists only as a Cloudflare Worker secret. The browser stores only the Worker URL and the athlete's own *access code* (a passphrase that gates the Worker) in a separate `localStorage` key that is excluded from backups.
- **Model use.** `claude-opus-5-5` via the official `@anthropic-ai/sdk`, `output_config.format` JSON schema (no free-text JSON scraping), adaptive thinking at `effort: medium`, server-side refusal fallback (`fallbacks: "default"`), prompt caching on the stable system prompt. The model cannot change data — it can only return a proposal.

## 2. Files

**New**
- `js/lib/adjustments.js` — effective plan, `validateProposal`, `applyProposal` (atomic, stale-detection), `undoChange`, availability.
- `js/lib/coachRules.js` — intent classification, red-flag detection, local-date resolution, rules-based planner (labeled "not AI").
- `js/lib/coachCore.js` — context builder, backend client (timeouts, typed errors), proposal normalization.
- `js/context.js` — shared render context (moved out of `app.js`).
- `js/ui/coach.js` — AI Coach page.
- `worker/` — `src/index.js` (SDK call), `src/handler.js` (HTTP, auth, limits, errors), `src/schema.js` (output schema, validation, system prompt), `wrangler.toml`, `package.json`.
- `.github/workflows/deploy-coach-worker.yml`, `.github/workflows/test.yml`.
- `tests/coach.test.js`, `tests/worker.test.js`.

**Modified**
- `js/store/store.js` (new fields + migration), `js/lib/load.js` (effective planned volume), `js/ui/day.js`, `js/ui/session.js` (adjusted badges; manual moves now validated + recorded), `js/ui/calendar.js`, `js/ui/dashboard.js` (change notices), `js/ui/analytics.js`, `js/lib/review.js`, `js/lib/coaching.js`, `js/lib/readiness.js`, `js/ui/profile.js` (weekly availability editor), `js/ui/more.js`, `js/app.js`, `index.html` (nav), `css/styles.css`.

## 3. How proposals are validated and approved

1. The athlete's message is checked locally for **red-flag symptoms** (chest pain, fainting, severe breathlessness, palpitations, dizziness, confusion). If present: advice to stop and seek urgent care, **no** schedule change, no network call.
2. The browser sends the transcript (last 16 turns) plus a **minimal context**: local date + time zone + a 15-day date table, race/phase, last/this/next week's effective sessions (ids, type, intensity, priority, duration, status), availability, recent check-in scores, coaching flags, and the pending proposal. No notes, injury text, contact info, or nutrition logs are sent.
3. The Worker validates the request, calls the model, validates the structured output against the schema, and **withholds any proposal that references a workout id not in the context** or that accompanies an urgent safety reply.
4. The browser **re-validates against the current local plan** (`validateProposal`):
   - workout exists, not race/rest, not already logged (completed history is immutable), not in the past (except moving a missed session forward);
   - move: valid local date in the plan window, not past, not the final 5 days for demanding sessions, not an unavailable day;
   - no two demanding bike/run sessions on one day (judged on the **final** schedule, so weekend swaps work); warnings for back-to-back hard days, losing the Monday rest day, day over the athlete's time limit, cross-week moves;
   - shorten/replace bounds; ≤14 changes; no duplicates;
   - **weekly load guard**: any affected week may not exceed its planned load by >10% (missed work is never crammed in).
5. The card shows original → proposed, reasons, warnings/errors, expected impact and recovery notes, with **Accept Changes / Reject Changes / Request changes**. Only one proposal is pending; a newer one supersedes it.
6. **Accept** re-checks a fingerprint of the affected sessions and the local date. If anything changed (a session was logged, another change applied, midnight passed) the proposal is re-validated and must be accepted again — or is marked invalid. All changes apply **atomically** (all or nothing), a `changeHistory` entry is written, and every page re-renders from the same data. **Reject** changes nothing. **Undo** is offered while the affected sessions are unlogged and unchanged since.

## 4. Backend configuration

| Variable | Where | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Worker **secret** | Anthropic API key |
| `COACH_ACCESS_CODE` | Worker **secret** | Passphrase the browser must send (`X-Coach-Access`) |
| `ALLOWED_ORIGINS` | `wrangler.toml` var | CORS allow-list (default: GitHub Pages + localhost) |
| `COACH_MODEL` | var | Defaults to `claude-opus-5-5` |
| `COACH_EFFORT` | var | `medium` (raise to `high` for deeper reasoning at more cost/latency) |
| `MOCK_MODE` | var | `"true"` returns clearly labeled mock replies when no API key is set |
| `RATE_LIMITER` | optional binding | Cloudflare Rate Limiting binding for global limits (built-in limiter is per-isolate) |

Limits: 64 KB request body, 16 turns, 4,000 chars/turn, ~30 requests / 10 min / IP (per isolate), 55 s model timeout (browser waits 60 s). Errors are logged by class/status only — never request bodies or keys.

## 5. Deployment

The site itself is unchanged: GitHub Pages serves `main`. The Worker is deployed separately.

**Option A — from your Mac (fastest)**
```bash
cd worker
npm install
npx wrangler login                       # opens Cloudflare in the browser (free account is fine)
npx wrangler secret put ANTHROPIC_API_KEY   # paste your key from console.anthropic.com
npx wrangler secret put COACH_ACCESS_CODE   # choose a long random passphrase
npx wrangler deploy                      # prints https://im703-coach.<your-subdomain>.workers.dev
```

**Option B — GitHub Actions** (`.github/workflows/deploy-coach-worker.yml`)
Add repository secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers"), `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`, `COACH_ACCESS_CODE`, then run the workflow (Actions → Deploy AI Coach Worker → Run). Without the Cloudflare token the workflow skips itself with a notice.

**Connect the site:** open the live site → **AI Coach** → **Connection** → paste the Worker URL and your access code → **Test connection**. The status pill should read **AI connected**.

Local development: `cp worker/.dev.vars.example worker/.dev.vars`, fill it in, `cd worker && npm run dev`, and set the Connection URL to `http://localhost:8787` while serving the site with `npm run serve`.

## 6. Tests

`npm test` runs 53 tests including:
- request classification, local-date resolution, red-flag detection;
- the **Wednesday scenario** ("I cannot run Wednesday. Can you adjust my plan?"): reads the correct week incl. weekend sessions, never stacks onto a demanding day, plan unchanged until acceptance, acceptance applies only the validated change, rejection changes nothing, logs untouched;
- follow-up memory (move-or-skip → "move it to Friday" → "actually only 25 minutes Friday"), multi-day travel;
- all 18 edge cases (empty message, provider down, timeout, no plan / no upcoming sessions, completed workout, conflicting date, excessive load, plan changed while pending, reject, modify, unknown id, reload persistence, malformed output, failed multi-change validation, symptoms, date/time-zone rollover, overlapping proposals);
- Worker: CORS/origin, auth, size limit, invalid JSON, missing key (503) and labeled mock mode, schema-validated success, timeout 504, provider errors, rate limits, malformed output, refusal, invented-id withholding, strict schema shape.

`node scripts/smoke.mjs` renders every page (including AI Coach) with empty and populated data. An end-to-end browser run (headless Chrome) verified: proposal card → plan unchanged → Accept → one override + history entry, no logs written.

## 7. Limitations

- **Live AI calls were not tested** in development because no Anthropic API key or Cloudflare account was available. The SDK call is built from the official documentation and bundles with Wrangler, and everything around it is tested with a fake model — but the first real request should be checked after deployment.
- Data is per-device (`localStorage`); conversation and plan changes do not sync between phone and laptop (use JSON export/import).
- The built-in rate limiter is per Worker isolate; add a Cloudflare Rate Limiting binding for strict global limits.
- The rules-based planner handles common requests well but is not a language model; it asks for clarification or gives general answers for anything else.
- AI suggestions are coaching aids, not medical advice.

## 8. Athlete quick guide

1. Open **AI Coach** (top nav, or "Coach" on the phone tab bar).
2. Type naturally — or tap a suggestion — e.g. *"I can't train tomorrow because of work."*
3. If the coach needs a detail it asks one question (*"Move it or skip it?"*). Reply naturally: *"Move it to Friday."*
4. Review the card: original vs. proposed, reasons, any ⚠ trade-offs. **Accept Changes** to apply, **Reject Changes** to keep your plan, or **Request changes** (*"Actually I only have 25 minutes Friday"*).
5. Applied changes appear immediately on Today, the Calendar (✎ / struck-through) and the Dashboard. Undo from **Change history** while the sessions are still unlogged.
6. Each reply is labeled **AI · Claude** or **Rules-based planner — not AI**. Report chest pain, fainting or similar symptoms and the coach will tell you to stop and seek care instead of rearranging training.
