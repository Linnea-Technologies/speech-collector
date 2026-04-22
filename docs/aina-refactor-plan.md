# AINA SpeechCollector Anonymous Session Refactor

## Goal

Refactor SpeechCollector from a username/password collection tool into an anonymous participant-session application for Finnish short-response data collection.

## Target Architecture

```text
browser
  -> anonymous session token
  -> metadata + prompt-by-prompt recording flow
  -> Express backend
  -> PostgreSQL session/task/recording metadata
  -> AWS S3 permanent audio storage
  -> export script
  -> dataset.json + samples.jsonl
  -> audio-classifier loader
```

## Main Changes

1. Replace volunteer login/account routes with anonymous session routes.
2. Replace `users`-based task assignment with `participant_sessions` + `recordings`.
3. Keep prompt copies as immutable topics/tasks seeded ahead of time.
4. Store audio with deterministic `{session_id}/{task_id}.wav` relative keys.
5. Make the exporter reference the real storage layout directly instead of copying local audio as the canonical path.
6. Replace login-first frontend UX with intro, metadata, recording, exit, and completion states.

## API Contract

- `POST /api/start-session`
- `POST /api/get-task`
- `POST /api/update-session-metadata`
- `POST /api/upload-sound`
- `POST /api/exit-session`
- `POST /api/complete-session`

## Schema Contract

- `topics`
- `tasks`
- `participant_sessions`
- `recordings`

## Storage Contract

- `storage_key` is always relative, for example `session-id/task-id.wav`
- S3 object key is `{COLLECTION_AUDIO_PREFIX}/{storage_key}`
- export manifest `audio_path` is `storage_key`
- export `audio_root` points at the permanent storage root

## Validation Goals

1. Anonymous session starts without a created account.
2. Required metadata is saved to the session.
3. Recordings are attributable to the session, not a username.
4. A volunteer can leave early and keep submitted recordings.
5. Completed sessions transition cleanly to a thank-you screen.
6. Exported manifests match the real storage layout and load in `audio-classifier`.
