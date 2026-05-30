# AINA Speech Collector

This app collects short Finnish spoken responses for the AINA classifier project.

It is built for anonymous volunteer sessions:

- no username/password login for volunteers
- one prompt-set topic copy per session
- metadata saved against the session
- prompt-by-prompt recording flow today, with backend category-state support for the next UI
- exit anytime without losing submitted prompts
- PostgreSQL for session/task/recording state
- AWS S3 as the production audio store

## Architecture

```text
volunteer browser
  -> anonymous session token
  -> metadata + prompt recording flow
  -> Express backend
  -> PostgreSQL
  -> permanent audio storage
     - local path in development
     - AWS S3 in production-like mode
  -> exportDataset.js
  -> metadata/dataset.json + metadata/samples.jsonl
  -> exportDatabuilderDataset.js
  -> databuilder/manifest.json + databuilder/<sample_id>.wav + databuilder/<sample_id>.json
  -> audio-classifier databuilder
```

## What Changed In This Fork

This fork no longer treats volunteers as normal user accounts.

The old account flow has been replaced with:

- `POST /api/start-session`
- `POST /api/get-task`
- `POST /api/category-state`
- `POST /api/update-session-metadata`
- `POST /api/upload-sound`
- `POST /api/exit-session`
- `POST /api/complete-session`

The active schema is now centered on:

- `topics`
- `tasks`
- `participant_sessions`
- `recordings`

`users` is no longer part of the volunteer collection path.

## Environment

Copy the example file:

```bash
cp .env.example .env
```

Important variables:

```env
APP_URL=http://localhost:5173
VITE_API_URL=http://localhost:8000
VITE_APP_TITLE=AINA Speech Collector
VITE_MAX_RECORDING_SECONDS=5
VITE_TURNSTILE_SITE_KEY=

PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=speechcollector
PG_USER=postgres
PG_PASSWORD=postgres

STORAGE=local
SOUND_RECORDINGS_PATH=tmp/recordings
COLLECTION_AUDIO_PREFIX=short-finnish-responses/v2/audio
SESSION_IDLE_TIMEOUT_HOURS=24
MAX_RECORDING_SECONDS=5
MAX_UPLOAD_BYTES=2000000
MAX_RECORDING_DURATION_TOLERANCE_SECONDS=1
TURNSTILE_SECRET_KEY=

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=eu-north-1
AWS_BUCKET_NAME=

AINA_TOPIC_COPIES=100

DATASET_ID=short_finnish_responses
DATASET_VERSION=v2
DATASET_LANGUAGE=fi
DATASET_DESCRIPTION=Short Finnish speech responses for voicemail keyword/audio classification
DATASET_TASK=short_response_classification
DATASET_OUTPUT_DIR=./exports/short-finnish-responses/v2
DATASET_AUDIO_ROOT=
DATASET_SPEAKER_HASH_SALT=change-me-before-real-export

DATABUILDER_OUTPUT_DIR=./exports/short-finnish-responses/v2/databuilder
DATABUILDER_MANIFEST_VERSION=20260501001
```

Notes:

- `SOUND_RECORDINGS_PATH` is the canonical local audio root in development.
- Relative `SOUND_RECORDINGS_PATH` values are resolved from the `apps/speech-collector` root.
- Increase `AINA_TOPIC_COPIES` and rerun `pnpm run aina:seed` whenever you need more topic copies for local testing.
- In S3 mode it is used only as a temporary processing area.
- `COLLECTION_AUDIO_PREFIX` defines the permanent object-key prefix in S3.
- `DATASET_AUDIO_ROOT` is optional. If empty, export derives the correct storage root from local mode or AWS S3 settings.
- `DATABUILDER_OUTPUT_DIR` is the optional output directory for the audio-classifier databuilder compatibility package.
- `DATABUILDER_MANIFEST_VERSION` controls the flat databuilder `manifest.json` version field.
- `VITE_MAX_RECORDING_SECONDS` controls the frontend auto-stop timer. `MAX_RECORDING_SECONDS` plus `MAX_RECORDING_DURATION_TOLERANCE_SECONDS` is the backend duration limit.
- `MAX_UPLOAD_BYTES` limits multipart audio upload size before storage.
- Leave `VITE_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` empty for local development. Configure both for public collection.

## Database Setup

PostgreSQL is required because the app stores:

- anonymous participant sessions
- assigned prompt topics
- metadata updates
- per-task recordings and progress

For installation help, see [docs/database-setup.md](docs/database-setup.md).

## Seed AINA Prompts

The AINA seed script creates v2 category phrase-bank copies ahead of time so concurrent volunteers can each get their own session topic.

```bash
pnpm run aina:seed
```

The seeding step uses:

- [scripts/aina/migration.sql](scripts/aina/migration.sql)
- [scripts/aina/short_finnish_prompts.json](scripts/aina/short_finnish_prompts.json)

`AINA_TOPIC_COPIES` controls how many topic copies exist. If local testing exhausts them, raise `AINA_TOPIC_COPIES` in `.env` and rerun `pnpm run aina:seed` to add more copies. Existing v2 copies are upserted; new higher-numbered copies are created.

When reseeding the same v2 topic copy, the seeder removes obsolete task rows only when they have no recordings. If an obsolete task already has recordings, seeding stops with an explicit reset/archive message instead of deleting collected samples.

The v2 prompt bank stores:

- `phrase_id`: stable phrase identity such as `yes_kylla`
- `label`: phrase-level classifier target such as `kylla`
- `semantic_label`: broader future target such as `yes`
- `category`: UI grouping such as `yes`

If your local database was seeded with old prompt rows and you want a clean v2 run, reset the seeded collection tables before reseeding:

```sql
DELETE FROM recordings;
DELETE FROM participant_sessions;
DELETE FROM tasks;
DELETE FROM topics;
```

Then rerun `pnpm run aina:seed`. This reset deletes local test sessions and recordings, so only use it for development data.

## Run The App

Install dependencies:

```bash
pnpm install
```

Start the backend and frontend:

```bash
pnpm dev
```

Ports:

- backend: `http://localhost:8000`
- frontend: `http://localhost:5173`

## Volunteer Flow

The main collection flow is:

1. Volunteer opens the app.
2. If Turnstile is configured, the volunteer completes the human verification gate.
3. Backend starts or resumes an anonymous session.
4. Volunteer sees the intro and metadata form.
5. Volunteer records one prompt at a time in the current frontend; the backend also exposes category progress for the next UI.
6. Each successful upload is stored and linked to the session.
7. Volunteer can continue, refresh, or leave.
8. Submitted recordings stay valid even if the session ends early.
9. Completed sessions show a thank-you screen.

The browser stores the active session token locally so an active session can resume automatically in the same browser.

## Category Progress API

`POST /api/category-state` prepares the backend for the category-based UI. It returns fixed category order, per-session shuffled phrase order, current-session phrase counts, same-device previous phrase state, and unlock eligibility.

Progress counts distinct `phrase_id` values, not raw recording rows. Re-recording the same phrase inserts another valid sample but does not advance unique phrase progress twice. Previous recordings from the same anonymous browser ID count toward category unlocks.

The shuffled phrase order is stored in `participant_sessions.metadata.ui.category_phrase_v1` so refreshing a session does not reshuffle phrases. If new phrases are later added to a seeded topic, missing phrase IDs are appended in `task_idx` order.

`exit-session` remains the anytime stop path. A `completed` session still means every assigned task/phrase in the current topic has at least one current-session recording; early exits are `abandoned`, and submitted recordings remain exportable.

## No Prompts Available During Testing

If you see "No prompts available", that usually means all seeded topic copies have already been consumed.

Root cause:

- `startSession()` only selects a topic that has no `participant_sessions` row
- `participant_sessions.topic_id` is unique, so each topic copy can only be assigned once
- `completed` and `abandoned` sessions both continue to reserve that topic copy for data-purity reasons

That single-use allocation is intentional for production data collection.

For local/dev testing, use one of these reset paths:

1. Reuse the same seeded topics:

```sql
DELETE FROM recordings;
DELETE FROM participant_sessions;
```

The same SQL is also available in [docs/dev-reset-session-data.sql](docs/dev-reset-session-data.sql).

2. Add more topic copies without deleting topics/tasks:

```bash
pnpm run aina:seed
```

Before rerunning the seed command, increase `AINA_TOPIC_COPIES` in `.env` so the seeder creates additional topic copies.

## Local Development Mode

Use local storage when you want the easiest end-to-end dev loop:

```env
STORAGE=local
SOUND_RECORDINGS_PATH=tmp/recordings
DATASET_AUDIO_ROOT=
```

In local mode:

- uploads are re-encoded and persisted under `SOUND_RECORDINGS_PATH/{session_id}/{task_id}/{recording_id}.wav`
- relative local paths are anchored to `apps/speech-collector`, not the backend package directory
- exporter writes manifests that reference the same local audio root directly
- audio is not copied into the export folder as the source of truth

## Production-Like S3 Mode

For a production-like test:

```env
STORAGE=aws-s3
AWS_REGION=eu-north-1
AWS_BUCKET_NAME=<bucket>
AWS_ACCESS_KEY_ID=<access-key>
AWS_SECRET_ACCESS_KEY=<secret>
COLLECTION_AUDIO_PREFIX=short-finnish-responses/v2/audio
```

In S3 mode:

- uploads are re-encoded locally first
- final object key is `{COLLECTION_AUDIO_PREFIX}/{session_id}/{task_id}/{recording_id}.wav`
- PostgreSQL stores `storage_key` as `{session_id}/{task_id}/{recording_id}.wav`
- exporter writes `audio_root=s3://<bucket>/<COLLECTION_AUDIO_PREFIX>/`
- manifest `audio_path` values stay relative to that root

## Mixed Storage Backends In One Database

The exporter writes one dataset manifest with one dataset-wide `audio_root`, so it cannot safely mix local and S3 recordings in the same export.

Current behavior:

- `pnpm run aina:export` only exports recordings whose `recordings.storage_type` matches the active `STORAGE` value in `.env`
- rows from other storage backends are skipped
- the exporter logs a summary of skipped rows by `storage_type`

Examples:

- with `STORAGE=local`, only `recordings.storage_type='local'` rows are exported
- with `STORAGE=aws-s3`, only `recordings.storage_type='aws-s3'` rows are exported

This keeps `dataset.json.audio_root` and every sample `audio_path` loader-compatible even if the same PostgreSQL database contains historical rows from both local and S3 collection runs.

## Export Dataset

After recordings exist, export the normal collector dataset manifests with:

```bash
pnpm run aina:export
```

The exporter writes:

```text
exports/short-finnish-responses/v2/
  metadata/
    dataset.json
    samples.jsonl
```

Export behavior:

- includes `completed` sessions
- includes `abandoned` sessions
- excludes still-`active` sessions
- filters rows to the active `STORAGE` backend before building the manifest
- uses `recordings.id` as `sample_id`
- exports `normalized_label` and keeps `label` as its compatibility alias
- exports `phrase_id` and nullable `semantic_label` at the sample root and in collection metadata
- stores Finnish prompt text separately as `prompted_word`
- hashes the anonymous browser `device_id` into stable `speaker_id`
- references permanent storage directly

This export remains the collector-native contract. It does not copy audio into the export folder.

## Export Databuilder Package

The current `audio-classifier` `feature/databuilder` branch expects a flat cache package, so the collector also provides a compatibility bridge:

```bash
pnpm run aina:export:databuilder
```

Default output:

```text
exports/short-finnish-responses/v2/databuilder/
  manifest.json
  <sample_id>.wav
  <sample_id>.json
```

Databuilder export behavior:

- keeps `pnpm run aina:export` unchanged
- filters rows to the active `STORAGE` backend, like the normal exporter
- exports only classifier-ready recordings with `processed_audio` set to WAV PCM 16-bit, 16 kHz, mono
- skips legacy recordings where `processed_audio` is missing, null, or different from the classifier-ready format
- fails clearly when no classifier-ready recordings remain
- uses `recordings.id` as `sample_id`, the file basename, and the manifest key
- includes `phrase_id` and nullable `semantic_label` at the sidecar root and under `collection`
- copies local audio or downloads S3 audio into `<sample_id>.wav`
- writes root-level sidecar JSON because databuilder filters use paths such as `demographics.native_language`
- writes MD5 hashes for the exact WAV and JSON bytes in `manifest.json`

Generated exports and audio files are ignored by Git and should not be committed.

## Validate Against audio-classifier

For the databuilder package, see [docs/databuilder-export.md](docs/databuilder-export.md).

```bash
cd D:\ass_vscode\AIN\packages\audio-classifier
python - <<'PY'
from audio_classifier.data import load_dataset

dataset = load_dataset(r"D:\ass_vscode\AIN\apps\speech-collector\exports\short-finnish-responses\v2")
print(f"loaded {len(dataset)} samples")
print(dataset[0] if dataset else "no samples")
PY
```

## Testing Commands

Frontend build:

```bash
pnpm build
```

Backend contract tests:

```bash
pnpm run test:backend
```

## Reset-Friendly Development

This refactor assumes local/dev database resets are acceptable while the anonymous-session model is being stabilized.

If you want a completely fresh local run, recreate the database or drop the session/recording/topic/task tables before seeding again.

If you only need more test sessions and want to keep the existing prompt copies, clear just `recordings` and `participant_sessions` with [docs/dev-reset-session-data.sql](docs/dev-reset-session-data.sql).

## Related Docs

- [docs/aina-refactor-plan.md](docs/aina-refactor-plan.md)
- [docs/category-phrase-ui-plan.md](docs/category-phrase-ui-plan.md)
- [docs/aina-s3-integration.md](docs/aina-s3-integration.md)
- [docs/aina-data-contract.md](docs/aina-data-contract.md)
- [docs/databuilder-export.md](docs/databuilder-export.md)
- [docs/cloud-validation-session-2026-05-04.md](docs/cloud-validation-session-2026-05-04.md)
- [docs/database-structure.md](docs/database-structure.md)
- [docs/database-setup.md](docs/database-setup.md)
- [docs/dev-reset-session-data.sql](docs/dev-reset-session-data.sql)

## License

This project is licensed under the [MIT license](https://github.com/neuralwork/speech-collector/blob/main/LICENSE).
