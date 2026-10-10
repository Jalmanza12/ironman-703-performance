# AI Coach — architecture, setup & usage

The AI Coach is a conversational agent (Claude, via your own secure backend) that reads your actual training plan through tools, talks with you naturally, and **proposes** changes. Nothing in the plan changes until you press **Accept Changes**.

## Why the first version wasn't conversational (root cause)

The first release shipped the backend code but it was never deployed and no API key existed, so every message took the UI's fallback branch to a keyword matcher (`planOffline` in the former `js/lib/coachRules.js`). Messages without a recognized keyword (e.g. "Change plan on October 10, 2026", "replace October 10, session", "Why are you recommending that?") fell into a generic `informational()` reply — the repeated welcome-like text. Even with a backend configured, the model got a one-shot snapshot with no tools and a flattened text history.

**Fixed by:** a real tool-using agent loop, an append-only Messages API transcript, browser-executed tools over the real data, and **no fallback** — missing configuration or a failed request is shown as an error, never as a fabricated reply.

## Architecture

```
Browser (GitHub Pages)                                   Cloudflare Worker (worker/)            Anthropic API
─────────────────────────────────────────────────        ─────────────────────────────          ─────────────
athlete message
  + <app_snapshot> (local date/time zone, date table,
    this + next week's real sessions with ids,
    pending proposal, accept/reject events)
→ appended to the API transcript (append-only) ───────▶  POST /coach  (access code, CORS,  ──▶  claude-opus-5-5
                                                          size + rate limits, validation)      tools + adaptive
◀──────────── assistant content (thinking/text/tool_use) ◀───────────────────────────────── ◀── thinking
if tool_use:
  run tools HERE against localStorage data
  (get_schedule, get_weekly_schedule, get_workout_details,
   get_recent_training, get_athlete_profile, propose_*)
  → append tool_result → POST /coach again (≤ 8 steps)
final text → chat; propose_* → validated proposal card (Accept / Reject)
Accept → applyProposal() (atomic, history, undo) → every page re-renders from the same data
```

- **Source of truth:** the generated plan (`js/plan/`) + approved overrides + logs in `localStorage`. Tools read through the same `effectiveSessionsOn()` the calendar uses, so the AI sees exactly what you see.
- **Tools run in your browser**, not on the server: the Worker only relays model steps. The model can read data and call `propose_*`; it has no way to apply changes.
- **Transcript:** stored in `state.coach.apiMessages` and replayed verbatim (thinking blocks, tool calls and results included), which keeps follow-ups ("move **it** to Sunday", "actually skip it") grounded. Requests send `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` so a thinking-block mismatch degrades instead of failing. When the transcript exceeds ~220 KB / 90 messages it restarts with a plain-text recap. A failed turn is rolled back so nothing half-finished is replayed.
- **Proposals:** one pending at a time. A new `propose_*` call replaces it ("superseded"); `withdraw_pending_proposal` withdraws it. Accept/Reject/Undo are reported to the model in the next message's snapshot.
- **Safety:** red-flag symptoms (chest pain, fainting, severe breathlessness, palpitations, dizziness, confusion) trigger an immediate app safety notice; the model is also instructed to put safety first and not rearrange training in that reply.

## Files

- `worker/src/schema.js` — system prompt, 12 strict tool definitions, transcript validation.
- `worker/src/handler.js` — HTTP handling (auth, CORS, limits, errors, mock mode) — SDK-free, unit-tested.
- `worker/src/index.js` — Anthropic SDK call (`claude-opus-5-5`, adaptive thinking, `effort: medium`, tools, prompt caching, server-side refusal fallback).
- `js/lib/coachAgent.js` — the agent loop, transcript, compaction, rollback, proposal bookkeeping.
- `js/lib/coachTools.js` — tool executors over real data + the per-message snapshot.
- `js/lib/coachCore.js` — HTTP client and health check (typed errors).
- `js/lib/coachSafety.js` — red-flag detection.
- `js/lib/adjustments.js` — validation, atomic apply, history, undo (unchanged rules).
- `js/ui/coach.js` — chat UI, proposal cards, connection settings, setup/error states.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Worker **secret** | Anthropic API key (console.anthropic.com) |
| `COACH_ACCESS_CODE` | Worker **secret** | Passphrase the browser sends in `X-Coach-Access` |
| `ALLOWED_ORIGINS` | `wrangler.toml` | CORS allow-list (GitHub Pages + localhost) |
| `COACH_MODEL` | `wrangler.toml` | `claude-opus-5-5` |
| `COACH_EFFORT` | `wrangler.toml` | `medium` (raise to `high` for deeper reasoning; slower and costlier) |
| `MOCK_MODE` | `wrangler.toml` | development only; replies are labeled "DEVELOPMENT MOCK — not AI-generated" |

The browser stores only the Worker URL and access code (separate `localStorage` key, excluded from backups).

## Deploy

```bash
cd worker
npm install
npx wrangler login                          # Cloudflare account (free tier is fine)
npx wrangler secret put ANTHROPIC_API_KEY   # paste your key — typed into the terminal, never committed
npx wrangler secret put COACH_ACCESS_CODE   # any long random passphrase
npx wrangler deploy                         # prints https://im703-coach.<subdomain>.workers.dev
```

Then on the site: **AI Coach → Connection** → paste the URL and access code → **Save** → **Test connection** (should read "AI connected · claude-opus-5-5").

GitHub Actions alternative: add repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`, `COACH_ACCESS_CODE` and run **Deploy AI Coach Worker**.

## What happens when something is missing

| Situation | What you see |
|---|---|
| No backend URL saved | "The AI Coach is not connected" setup card; sending shows an error — no reply is generated |
| Worker without `ANTHROPIC_API_KEY` | Status "Backend missing ANTHROPIC_API_KEY"; messages return that error |
| Wrong access code | "Access code rejected" |
| Model timeout / outage | Error notice with **Try again**; transcript rolled back; plan unchanged |

## Tests

`npm test` — includes a scripted fake model (tests only) that drives the real agent loop through your live-test conversation (A–F): the model receives your words + the local date + real sessions; `get_schedule`/`get_weekly_schedule` return the real Oct 10 sessions; follow-ups replay the transcript byte-for-byte; "move it to Sunday" creates a pending proposal; "skip it instead" replaces it (one pending, the other "superseded"); "why…" needs no tools; plus missing-config errors, rollback, compaction, step limits, approval/rejection, validator rejection of conflicting proposals, and Worker handling. **These tests verify the plumbing, not the model's judgment** — that is verified live after deployment.
