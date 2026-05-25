# Category Phrase Backend Foundation

This note describes the backend/data foundation for the planned category-based phrase recording UI. The full frontend category UI is not implemented yet.

## Prompt Bank

The active AINA seed is `short_finnish_responses` `v2`.

Each task stores trusted metadata in `tasks.metadata`:

- `phrase_id`: stable phrase identity, for example `yes_kylla`
- `label`: phrase-level classifier label, for example `kylla`
- `semantic_label`: broader future target, for example `yes`
- `category`: UI group, for example `yes`
- `language`, `dataset_id`, and `dataset_version`

`normalized_label` in recording/export metadata is still the phrase-level classifier target. It is not replaced by `semantic_label`.

When reseeding an existing v2 topic copy, the seeder removes obsolete task rows only if they have no recordings. If obsolete tasks have recordings, seeding stops and asks for an explicit reset/archive decision.

## Category State

`POST /api/category-state` accepts:

```json
{ "sessionToken": "..." }
```

It returns category order, active category, progress, unlock state, and phrase cards. Progress counts unique `phrase_id` values, not raw recording rows. Previous recordings from the same anonymous browser `device_id` count toward category unlocks.

Unlock rule:

- first category is unlocked
- later categories unlock when every previous category has `uniqueRecordedCount >= requiredCount`
- `requiredCount = min(3, totalPhrases)`

Phrase order is shuffled once per session and stored in `participant_sessions.metadata.ui.category_phrase_v1`. Refreshing a session reuses the stored order. Newly added phrase IDs are appended in stable `task_idx` order.

## Repeat Recordings

Each upload inserts a new `recordings` row. The backend generates `recordings.id` before saving audio and stores audio at:

```text
{session_id}/{task_id}/{recording_id}.wav
```

This prevents re-recordings of the same phrase from overwriting earlier samples.

## Completion And Reset Notes

`exit-session` remains the anytime stop path. Early exits are `abandoned`, and submitted recordings remain exportable. `completed` means every assigned current-session task/phrase has at least one recording; category unlock minimums do not automatically close the session.

Experimental local/Supabase/S3 data can be reset manually during validation, but reset commands are documented rather than automated. Generated exports, audio, and temp files should not be committed.
