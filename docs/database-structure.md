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

`metadata` stores prompt label/category/language information used during export.

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

### `recordings`

One saved recording per `(session_id, task_id)`.

Fields include:

- `id`
- `session_id`
- `task_id`
- `storage_type`
- `storage_key`
- `duration_sec`
- `submitted_at`
- `metadata`

## Allocation Model

- one topic copy is assigned to one session
- one session token auto-resumes in the same browser while active
- recordings determine progress
- tasks themselves are not marked complete globally

This avoids the old `users`-table coupling and makes partial sessions safe to keep.

## Concurrency Model

Session creation uses row locking with `FOR UPDATE SKIP LOCKED` so concurrent volunteers do not receive the same topic copy.

Topic reuse is prevented by a unique index on `participant_sessions.topic_id`.

`startSession()` also only selects topics with no `participant_sessions` row at all, so a topic copy is permanently consumed once it has been assigned. That means `completed` and `abandoned` sessions both continue to reserve their topic copy by design.

For local/dev testing, you can either:

- delete rows from `recordings` and `participant_sessions` to reuse the existing topic copies
- increase `AINA_TOPIC_COPIES` and rerun `pnpm run aina:seed` to create more topic copies

## Exit And Completion

- `completed` means every task in the assigned topic has a recording
- `abandoned` means the volunteer exited or the session expired after inactivity
- both statuses keep already submitted recordings valid for export

## Export Relationship

Exporter joins:

- `participant_sessions`
- `recordings`
- `tasks`
- `topics`

No export logic depends on a `users` table.
