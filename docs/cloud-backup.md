# Cloud backup (optional)

This lets you back up this browser's training data to a private Supabase account, then restore or merge it on another device. **Browser storage stays the main copy.** Nothing syncs automatically, and the app works exactly as before for anyone who never signs in.

## How you use it (Profile → Cloud backup)

1. **Sign in:** enter your email and choose **Email me a sign-in link**. Open the link **on the same device, in the same browser**. The app uses PKCE, so the link only works in the browser that asked for it. You come back to Profile, signed in.
2. **Back up now:**
   - **Cloud is empty:** your data is uploaded.
   - **Cloud hasn't changed since this browser last synced:** your data is uploaded as is.
   - **Another device saved in the meantime:** the two are merged record by record (see `docs/storage-schema.md`), then uploaded.
   - **This browser has never synced with an account that already has a backup:** you choose **Merge both** (recommended), **Use the cloud copy here**, or **Replace the cloud with this browser**.
   - **Nothing changed on either side:** "Already backed up".
3. **Restore from cloud…:** either **Merge into this browser** or **Replace this browser's data**.
4. **Undo last sync:** before every backup or restore, the app keeps a copy of this browser's data. This button puts the browser back exactly as it was, without touching the cloud.
5. **Sign out:** your data stays in this browser.

## Architecture

| Piece | File |
| --- | --- |
| Project URLs and publishable keys. The live site uses production; any other host (e.g. localhost) uses staging. | `js/data/cloudConfig.js` |
| Supabase client, pinned and bundled into one ES module, loaded only when cloud backup is used | `js/vendor/supabase.js` (rebuild: `sh scripts/vendor-supabase.sh`) |
| Network and storage: sign-in, fetch, `save_state` RPC, safety copy, sync metadata | `js/store/cloud.js` |
| Pure decision logic: upload / merge / choose / none, plus how each choice resolves | `js/store/sync.js` (tests: `tests/sync.test.js`) |
| Profile card UI | `js/ui/cloudCard.js` |
| Database, security rules (RLS), `save_state`, history | `supabase/migrations/`, `supabase/tests/` |

- **Concurrency:** every save sends the cloud `rev` it started from.
  - If another device saved first, the server rejects it with `PT409` (HTTP 409).
  - The app then pulls the newer copy, merges and retries once.
- **History:** the server keeps the latest 30 earlier versions per athlete in `athlete_state_history`.

## Security

- The **publishable keys** in `cloudConfig.js` are meant to be public.
  - Row-level security means each signed-in athlete can read only their own row, and can write only through `save_state`.
  - Anonymous requests are refused.
  - Secret and service keys are never in the repo.
- The CSP's `connect-src` allows only the two project URLs.
- **Sign-up is open:** anyone with an email address can create an account, but they can only ever see their own data (max 1 MB). If you want only yourself, turn off sign-ups in the dashboard after creating your account: **Authentication → Sign In / Providers → Allow new users to sign up**.
- **Email limits:** Supabase's built-in email sender is rate-limited, and only delivers to members of your Supabase organization. For other athletes, set up custom SMTP: **Authentication → Emails → SMTP settings**.

## Verification (staging)

`tests/sync.test.js` covers the decision rules. An end-to-end run in headless Chrome against staging covered:
- two isolated browsers on one account: first-sync choice, automatic merge, no-op backup, undo, restore (merge), and history rows
- a bad sign-in link, and sign-out
- no CSP violations, and only the staging host contacted

The test account was deleted afterwards.

The one thing that can't be automated is the **real email link**. Test it once on the live site after deploying.

## Operations

- **Auth URLs:** set in `supabase/config.toml` under `[remotes.*]`, and applied with `npx supabase@2.118.0 config push --project-ref <ref>`. Always read the preview before answering `y`.
- **New migrations:** `db push` to staging first, then production. This needs outbound port 5432.
- **Rolling back the app:** revert the PR. Local data is unaffected, and cloud rows remain for when the feature returns.
