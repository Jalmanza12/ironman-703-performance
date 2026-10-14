# Phase 1 — Environment Protection Report

Date: 2026-10-14 · Branch: `development` · Baseline commit: `4fc771f` ("Connect the site to the deployed AI Coach Worker by default")

Scope of this phase: inspect, protect production, create a development branch, record a baseline. No application code, configuration, secrets, or deployment settings were changed. This report is the only file created.

## 1. Repository and branch status

| Item | Finding |
| --- | --- |
| Local path | `~/ironman-703-performance` |
| Remote | `origin` → `https://github.com/Jalmanza12/ironman-703-performance.git` (public) |
| Default branch | `main` |
| Working tree before work | Clean: no modified, staged, or untracked files |
| Sync with origin | `main` and `origin/main` both at `4fc771fc465b0140fa5d46335e72d0eb7feb337b` after `git fetch --prune`. No ahead/behind, no divergence. |
| Remote branches before work | `main` only |
| History | 5 commits, linear |

## 2. Production protection measures

- **Production baseline is `main` @ `4fc771f`.** It was not modified, rebased, reset, or merged into.
- `development` was created from that exact commit, so production code is preserved byte-for-byte on both branches.
- **No production deployment was triggered.** Both deploy workflows (`pages.yml`, `deploy-coach-worker.yml`) and the test workflow (`test.yml`) fire on `push` to `main` only. After pushing `development`, `gh run list` showed no new runs (latest runs are from 2026-10-10).
- **Gap: `main` has no branch protection** (GitHub API: "Branch not protected"). Any direct push to `main` deploys the site immediately. Enabling protection is a repository-settings change and was not done in this phase; see §8.

## 3. Development branch status

- Local `development` created from `main` @ `4fc771f`; no remote `development` existed beforehand.
- Pushed to `origin/development` with upstream tracking (`git push -u origin development`). Remote now has `main` and `development`, both at `4fc771f`.
- Nothing was merged into `main`.
- This report is written on `development` and is **not committed yet**. Committing it is left to the owner.

## 4. Deployment configuration findings

**GitHub Pages**
- Source: GitHub Actions workflow (`build_type: workflow`), HTTPS enforced. URL: https://jalmanza12.github.io/ironman-703-performance/
- `pages.yml`: on push to `main` (or manual dispatch) → `npm test` → `node scripts/build-site.mjs <sha>` (cache-busted copy into `_site/`) → `deploy-pages`. A failing test blocks the deploy.
- `.nojekyll` is present.

**AI Coach backend (Cloudflare Worker `im703-coach`)**
- Deployed manually with Wrangler on 2026-10-10 at `https://im703-coach.im703-coach-worker.workers.dev`.
- `deploy-coach-worker.yml` deploys on push to `main` touching `worker/**`. It skips itself because no repository secrets are set (`gh secret list` is empty).
- Live `/health` today: `configured: false`, `apiKey: false`, `accessCode: true`, `model: claude-opus-5-5`, `mock: false`. **The Anthropic API key is still not set, so the AI Coach cannot generate replies in production.** This was left unchanged.
- `wrangler.toml` vars: `ALLOWED_ORIGINS` (Pages origin + `localhost:8080`), `COACH_MODEL`, `COACH_EFFORT`, `MOCK_MODE=false`. It contains no secrets.

**Test workflow:** `test.yml` runs `npm test` and `scripts/smoke.mjs` on push to `main` and on all pull requests. PRs from `development` → `main` will therefore be tested before merge.

## 5. Baseline tests and build results

Run on `development` @ `4fc771f`, Node v26.7.0 (CI uses Node 22).

| Check | Command | Result |
| --- | --- | --- |
| Unit tests | `npm test` | **50 / 50 pass**, 0 fail, 0 skipped (~158 ms) |
| View smoke test | `node scripts/smoke.mjs` | Pass: "All views rendered cleanly." Sample prediction 329 min (5:29). One Node `ExperimentalWarning` about `localStorage`, which is harmless. |
| Site build | `node scripts/build-site.mjs baseline` | Pass: 48 modules, 160 imports versioned, output in gitignored `_site/` |
| Worker bundle | `npx wrangler deploy --dry-run --outdir <scratch>` | Pass: bundles and exits before upload. Nothing deployed. |

- **Pre-existing failures:** none.
- **Working tree after checks:** clean, apart from this new report. `_site/` is ignored, and the dry-run output was written outside the repo.

## 6. Current project architecture

**Frontend:** a dependency-free static single-page app using ES modules, hash routing, and no build step for development.
- **Entry points:** `index.html` and `js/app.js` (router), plus `js/context.js` (shared plan/state context).
- **`js/plan/`:** the generated 23-week plan (`weeks.js`, per-discipline session builders, `generator.js`) ending on race day, 2027-03-14.
- **`js/lib/`:** pure logic.
  - Training: zones, target resolver, benchmarks, physics bike model, race prediction, load and readiness, review, nutrition, rescheduling.
  - Plan adjustments: an overlay applied on top of the generated plan.
  - AI Coach: agent loop, tools, safety, and core.
- **`js/data/`:** race facts, Bible passages, and the public coach endpoint.
- **`js/ui/`:** views (dashboard, day, calendar, analytics, fuel, coach, profile, more), plus an SVG chart helper and the `h.js` DOM helper.
- **`js/store/store.js`:** all athlete data lives in browser `localStorage` under key `im703:v1`, with a schema version and migration support.
  - It holds the profile, benchmarks, logs, check-ins, adjustments, and coach transcript.
  - JSON/CSV export and import is the only backup.
  - Data is single-device: there are no accounts and no server persistence.

**Backend:** a Cloudflare Worker in `worker/src/`.
- `handler.js` is SDK-free and unit-tested. It handles CORS/origin checks, the access-code check, a per-isolate rate limit, validation, and mock mode.
- `schema.js` holds the tool definitions.
- `index.js` calls Anthropic through `@anthropic-ai/sdk` 0.132.1.
- One model step runs per request. The browser runs the tool loop against local data, and proposals pass the existing validator before the user approves them.

**Tooling:** Node's built-in test runner (8 test files), `scripts/smoke.mjs`, `scripts/build-site.mjs`, and `scripts/export-plan.mjs`.

**Docs:** `README.md`, `docs/ai-coach.md`, `docs/research-and-methodology.md`, `docs/training-plan.md`.

## 7. Potential security concerns (no secret values exposed)

1. **Public repository.** All code, the plan, and the Worker URL are public. That's acceptable today because no secrets are committed.
   - A scan of tracked files for key patterns found only the placeholder `sk-ant-...` in `worker/.dev.vars.example`.
   - Future phases (Garmin tokens, accounts) must keep every credential in server-side secrets.
2. **`.gitignore` covers** `worker/.dev.vars`, `worker/.wrangler/`, `node_modules/`, `_site/`, `*.log`, and `im703-backup-*.json`.
   - **Not covered:** root-level `.env` / `.env.*` files, and other `.dev.vars*` paths.
   - Recommend adding these patterns before Phase 2 introduces database or OAuth credentials.
3. **No branch protection on `main`.** An accidental push deploys straight to production.
4. **Shared access code as the only auth on the Worker.** The browser keeps it in `localStorage` (`im703:coach-conn`, never included in exports). The local copy is in `~/.im703-coach-access-code`, outside the repo.
   - This is adequate for one user but not for multi-athlete accounts.
   - Phase 2 should replace it with real per-user authentication.
5. **Rate limiting is per-isolate and best-effort.** A Cloudflare Rate Limiting binding is supported in code but not configured.
6. **CORS allows `http://localhost:8080`** in production. This is low risk because the access code is still required, but a dev-only origin could move to a separate Wrangler environment.
7. **Athlete data in `localStorage`** is unencrypted and lost if browser data is cleared. Health data (HR, weight, and later Garmin) will need a deliberate privacy and storage design once it goes server-side.
8. **The Worker has no staging environment.** The `development` branch has no backend of its own, so any Worker testing currently hits production. See §8.

## 8. Recommended next steps for Phase 2 (database and application architecture)

**Owner actions (need approval; not done in Phase 1)**
- Commit this report to `development`.
- Enable branch protection on `main`: require PRs, the "Tests" check, and no force pushes.
- Optionally set the Anthropic API key so the production AI Coach works.

**Safe development workflow**
- Work on `development` or feature branches, then open PRs into `main`. `test.yml` already runs on PRs.
- Add a preview/staging target, for example:
  - a Wrangler `[env.staging]` Worker (`im703-coach-staging`) with its own secrets and `MOCK_MODE` option, and
  - a staging site served from a separate path, Cloudflare Pages preview, or local `npm run serve`,

  so development never touches production services.

**Phase 2 architecture decisions**
1. **Accounts and auth.** Choose a provider and model, e.g.:
   - Cloudflare Access / Workers + D1, or
   - Supabase (Postgres + Auth + Row Level Security).

   Either way, replace the shared access code with per-user sessions.
2. **Data model.** Map the current `im703:v1` state to tables:
   - `athletes`, `profiles`, `benchmarks`, `plans` (generator version + parameters), `plan_adjustments`, `session_logs`, `checkins`, `coach_conversations`/`messages`, `races`/`courses`.
   - Keep the plan *generated* from code plus stored parameters and adjustments, not as stored rows. This preserves today's "single source of truth" design.
3. **Migration path.** Import existing `localStorage` data through the current JSON export format, offer local-first + sync, and keep offline use working.
4. **Race and course database.** Seed it from the existing `js/data/race.js`, with fields that cover the physics model's needs (distance, elevation, surface, typical wind and temperature).
5. **Garmin integration prerequisites.**
   - Garmin Connect developer program approval, OAuth flow, and webhook ingestion. These require a server and secret storage.
   - Plan token storage and data-retention rules before writing code.
6. **Tests first.** Extend the Node test suite with data-layer and migration tests, and keep the existing 50 tests green as the regression baseline.
7. **Hygiene.** Extend `.gitignore` (§7.2) and document environment variables in a single `.env.example`/`.dev.vars.example` per service.
