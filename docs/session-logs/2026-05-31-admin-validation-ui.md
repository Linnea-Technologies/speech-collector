# 2026-05-31 Admin Validation UI

## Goal

Build Admin Validation UI v1 for internal Speech Collector sample review.

## Final Agreed Design

- Internal route is `/#/admin`.
- No visible admin link is shown in the volunteer UI.
- Admin login is shared password only.
- No username is required.
- No `validated_by` field is stored.
- Audio playback goes through a backend-protected admin endpoint.
- Admins can edit only safe review metadata:
  - `literal_transcript`
  - `label_source`
  - `validation.status`
  - `validation.notes`
- Trusted task labels are read-only:
  - `phrase_id`
  - `normalized_label`
  - `semantic_label`
  - `category`
  - `language`
- Validation statuses are:
  - `pending`
  - `validated`
  - `needs_review`
  - `rejected`
- Saving validation updates PostgreSQL and writes a JSON sidecar beside the WAV.
- Validation affects exports immediately through `DATASET_VALIDATION_FILTER`.

## Production Context

The production architecture is:

```text
Cloudflare -> Nginx -> static React frontend + /api backend -> local PostgreSQL + Cloudflare R2
```

Admin APIs live under `/api/admin`, so the existing Nginx `/api` proxy model applies. The frontend never receives PostgreSQL, R2, Turnstile, or admin session credentials.

Deployment remains compatible with:

```text
/var/www/speech-collector/scripts/build-remote.sh
```

Production admin URL after deployment:

```text
https://participate.hellolinnea.com/#/admin
```

## Local Auth Debugging

During local setup, the admin UI alternated between `admin_not_configured` and invalid-password responses.

Root cause:

- `dotenv-cli` expands `$` inside quoted values.
- The generated scrypt password hash contains `$`.
- The local `.env` hash was being loaded incorrectly by the dev backend.

Local fix:

- Regenerated a local-only test hash for the temporary admin test password.
- Stored it in `.env` with dotenv-safe escaped `$` characters.
- Verified the value loads through the same `dotenv-cli` path used by `pnpm dev`.
- `.env` and `.env.admin-debug-backup.local` were not committed.

Production must generate a fresh admin password hash and fresh admin session secret. Do not use the local test password or hash in production.

Because scrypt hashes contain `$`, production storage must use a dotenv-safe format. Escape `$` characters in `ADMIN_PASSWORD_HASH`, or use an equivalent storage method that preserves the literal hash value when dotenv tooling loads it.

## Validation Completed

- `corepack pnpm install`: passed.
- `corepack pnpm run test:backend`: passed, 73/73.
- `corepack pnpm build`: passed.
- `corepack pnpm --filter sound-collector-frontend lint`: passed.
- Admin API auth smoke: passed.
- Sample list loaded: 19 samples.
- Summary/readiness endpoints loaded.
- Audio endpoint returned content for a real sample.
- Validation save passed on one real sample.
- PostgreSQL metadata was updated with `validation.status = "validated"` and `validated_at`.
- JSON sidecar was written beside the WAV path and read back from S3-compatible storage.
- Sidecar did not include secrets or `validated_by`.
- `python .\scripts\aina\verify_v2_exports.py --run-exports`: passed after one sample was marked validated.
- Export verifier confirmed `DATASET_VALIDATION_FILTER=validated` skipped 18 pending samples and exported 1 validated classifier-ready sample.
- Manual browser test by Avishek showed login, sample list, dashboard, sample detail, audio playback, and validation controls working.
- Screenshot captured for PR visual evidence only; it must not be committed.

## Production Env Additions

```env
ADMIN_PASSWORD_HASH=
ADMIN_SESSION_SECRET=
ADMIN_SESSION_TTL_HOURS=12
DATASET_VALIDATION_FILTER=validated
```

## Screenshot Handling

The local Admin Validation UI screenshot is PR evidence only.

- Do not commit the screenshot.
- Do not add it to `docs/assets`.
- Do not stage screenshots or browser artifacts.
- If automatic GitHub image upload is unavailable, leave a UI Preview placeholder in the draft PR and add the screenshot manually through the GitHub UI.

## Remaining TODOs

- Senior must add production admin env values.
- Senior/team should choose and privately share the production admin password.
- Production deployment should happen after merge.
- Run one live production smoke test after deployment.
- Optional future improvements:
  - individual reviewer accounts
  - validation history
  - label correction workflow
  - audio download if needed
