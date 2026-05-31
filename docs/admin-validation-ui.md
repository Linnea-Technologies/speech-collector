# Admin Validation UI

## Purpose

The internal admin validation UI lets project members review collected Speech Collector samples, listen to recordings, edit safe review metadata, and mark each sample as `pending`, `validated`, `needs_review`, or `rejected`.

The route is internal:

```text
/#/admin
```

There is no visible admin link in the volunteer recording UI. Volunteers should use the normal collection route.

## Deployment Compatibility

The admin UI fits the current production path:

```text
Cloudflare -> Nginx -> static React frontend + /api backend -> local PostgreSQL + Cloudflare R2
```

The frontend uses `/#/admin`, so no Nginx static fallback route is required. All admin API calls live under `/api/admin/*`, so the existing `/api` proxy handles them. The frontend never receives PostgreSQL, R2, Turnstile, or admin session credentials.

The existing remote build path remains compatible:

```text
/var/www/speech-collector/scripts/build-remote.sh
```

## Authentication

Admin login is shared-password only. There is no username and the system does not store `validated_by`.

Required server `.env` additions:

```env
ADMIN_PASSWORD_HASH=
ADMIN_SESSION_SECRET=
ADMIN_SESSION_TTL_HOURS=12
DATASET_VALIDATION_FILTER=validated
```

Generate the password hash:

```bash
pnpm run admin:hash-password
```

For non-interactive secret setup:

```bash
printf '%s' '<password>' | pnpm run admin:hash-password -- --stdin
```

The command prints only the hash. Do not put the plaintext password in code, `.env`, docs, shell history, or PR text.

Admin sessions use an HTTP-only cookie with `SameSite=Lax`; the cookie is marked `Secure` in production or when the backend sees HTTPS through the proxy. `ADMIN_SESSION_TTL_HOURS` defaults to 12.

If admin env vars are missing, `/api/admin/*` returns `admin_not_configured` and does not expose sample data.

## Editable Fields

v1 allows editing only:

- `literal_transcript`
- `label_source`
- `validation.status`
- `validation.notes`

Allowed `label_source` values:

- `prompt_assumed`
- `user_confirmed`
- `reviewed`

Allowed statuses:

- `pending`
- `validated`
- `needs_review`
- `rejected`

Trusted fields are read-only in v1, including `normalized_label`, `semantic_label`, `phrase_id`, `category`, `language`, processed-audio metadata, and storage keys. Future label correction should use separate reviewed fields rather than overwriting trusted task metadata.

## Sidecar Writes

When validation is saved, the backend:

1. Checks the admin cookie.
2. Loads the recording, session, task, and topic context from PostgreSQL.
3. Applies only allowed metadata changes.
4. Updates `recordings.metadata`.
5. Writes a complete JSON sidecar beside the WAV in local storage or R2/S3-compatible storage.

Example:

```text
short-finnish-responses/v2/audio/session_id/task_id/recording_id.wav
short-finnish-responses/v2/audio/session_id/task_id/recording_id.json
```

The sidecar includes dataset-ready metadata such as sample ID, prompt labels, validation status, processed-audio metadata, pseudonymous device/speaker IDs, collection fields, and storage object keys. It does not include secrets, usernames, plaintext passwords, or `validated_by`.

## Export Behavior

Validation affects exports immediately through `DATASET_VALIDATION_FILTER`.

Supported values:

- `validated`: export only recordings whose validation status is `validated`.
- `not_rejected`: export pending, needs_review, and validated recordings; exclude rejected.
- `all`: export all otherwise eligible recordings.

Missing or invalid values default to `validated`.

Both normal export and databuilder export respect the filter. In `validated` mode, pending, needs_review, rejected, and missing-status legacy rows are not exported. In `not_rejected` mode, rejected rows are excluded. In `all` mode, validation status does not affect eligibility.

## v1 Limitations

- No delete action.
- No download button.
- No direct label editing.
- No usernames.
- No `validated_by`.
- No frontend access to PostgreSQL or R2 credentials.
