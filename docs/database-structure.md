# Database Structure And Session Model

The active AINA collector schema is built around anonymous participant sessions.

## Core Tables

### `topics`

One seeded prompt-set copy for one volunteer session.

Fields include:

- `id`
- `name`
- `task_count`
- `metadata`

Each topic copy is seeded ahead of time by `pnpm run aina:seed`.

### `tasks`

Immutable prompts inside a topic copy.

Fields include:

- `id`
- `topic_id`
- `task_idx`
- `text`
- `metadata`

`metadata` stores prompt label/category/language information used during upload metadata derivation and export. The v2 prompt bank stores `phrase_id`, phrase-level `label`, nullable `semantic_label`, `category`, `language`, `dataset_id`, and `dataset_version`.

### `participant_sessions`

Anonymous browser-backed volunteer sessions.

Fields include:

- `id`
- `session_token`
- `topic_id`
- `status`
- `metadata`
- `created_at`
- `updated_at`
- `last_activity_at`
- `completed_at`
- `exited_at`

Status values:

- `active`
- `completed`
- `abandoned`

`metadata.ui.category_phrase_v1` stores the shuffled phrase order for the category UI. The order is created once per session and reused on refresh. If newly seeded phrases appear later, missing phrase IDs are appended in stable `task_idx` order.

### `recordings`

One saved recording row per upload. Repeat recordings for the same `(session_id, task_id)` are separate valid samples.

Fields include:

- `id`
- `session_id`
- `task_id`
- `storage_type`
- `storage_key`
- `duration_sec`
- `submitted_at`
- `metadata`

Useful indexes include:

- non-unique `recordings(session_id, task_id)` lookup
- `recordings(session_id, submitted_at)`
- `participant_sessions ((metadata->>'device_id'))`
- `recordings ((metadata->>'phrase_id'))`

## Allocation Model

- one topic copy is assigned to one session
- one session token auto-resumes in the same browser while active
- recordings determine progress; linear progress uses distinct current-session tasks, and category progress uses distinct `phrase_id` values
- tasks themselves are not marked complete globally

This avoids the old `users`-table coupling and makes partial sessions safe to keep.

## Concurrency Model

Session creation uses row locking with `FOR UPDATE SKIP LOCKED` so concurrent volunteers do not receive the same topic copy.

Topic reuse is prevented by a unique index on `participant_sessions.topic_id`.

`startSession()` only selects topics for the configured `DATASET_ID` and `DATASET_VERSION`, and only where no `participant_sessions` row exists. A topic copy is permanently consumed once it has been assigned. That means `completed` and `abandoned` sessions both continue to reserve their topic copy by design.

For local/dev testing, you can either:

- delete rows from `recordings` and `participant_sessions` to reuse the existing topic copies
- increase `AINA_TOPIC_COPIES` and rerun `pnpm run aina:seed` to create more topic copies

## Exit And Completion

- `completed` means every task in the assigned topic has at least one current-session recording
- `abandoned` means the volunteer exited or the session expired after inactivity
- both statuses keep already submitted recordings valid for export

The category UI unlock rule is separate from session completion: category unlocks use `min(3, total phrases)` unique `phrase_id` values and may count previous recordings from the same anonymous browser `device_id`.

## Export Relationship

Exporter joins:

- `participant_sessions`
- `recordings`
- `tasks`
- `topics`

No export logic depends on a `users` table.
