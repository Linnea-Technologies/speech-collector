# AINA Speech Collector Data Contract

## Purpose

`schema_version = "v1"` remains the stable session/recording metadata shape. The active AINA prompt bank is `short_finnish_responses` `v2`, which adds category UI metadata, `phrase_id`, and nullable `semantic_label` while keeping `normalized_label` as the phrase-level classifier target. The collector stores live data safely as PostgreSQL rows plus audio files in local storage or S3-compatible storage. The normal collector export is produced by `scripts/aina/exportDataset.js`. The current audio-classifier databuilder receives a separate compatibility bridge from `scripts/aina/exportDatabuilderDataset.js`.

The frontend must not append directly to a shared `samples.jsonl` file. Public volunteers can upload at the same time, and concurrent appends to one shared manifest can corrupt data. Each upload is stored as one database recording row plus one audio object/file, then exporters create derived handoff files.

## Live Storage Model

- PostgreSQL is the live source of truth for sessions, task assignments, session metadata, recording rows, durations, and storage keys.
- Local storage or S3 stores audio files.
- `recordings.metadata` stores recording-level v1 metadata without a DB schema change.
- `participant_sessions.metadata` stores session-level v1 metadata without a DB schema change.
- Each upload inserts a new `recordings` row. Repeat recordings for the same `(session_id, task_id)` are separate samples.
- Backend safety limits are authoritative. The frontend timer improves UX, but the backend rejects files that are too large or too long.

## Session Metadata

Collected once near the start of a volunteer session and stored in `participant_sessions.metadata`.

Required v1 shape:

```json
{
  "schema_version": "v1",
  "device_id": "anonymous-browser-uuid",
  "consent_response": "yes",
  "demographics": {
    "age_group": "26-35",
    "gender": "prefer_not_to_say",
    "native_language": "fi",
    "native_language_other": null,
    "dialect_region": "pori",
    "dialect_region_other": null
  },
  "environment": {
    "noise_level": "moderate",
    "audio_hardware": "not_sure"
  },
  "technical": {
    "user_agent": "Mozilla/5.0 ...",
    "inferred_os": "Windows",
    "inferred_browser": "Chrome",
    "inferred_device_type": "desktop"
  }
}
```

The volunteer does not type `device_id`, ISO language codes, browser user agent, OS, browser, or device type. `device_id` is an anonymous browser UUID stored in `localStorage` under `aina.speechCollector.deviceId` after consent is accepted; it is not a real hardware ID or serial number. It is used to resume an active session and show which phrases this browser has already recorded.

`native_language_other` is only shown and stored when `native_language` is `other`; otherwise it is `null`. `dialect_region_other` behaves the same way for `dialect_region = "other"`.

## Recording Metadata

Sent by the frontend as JSON-stringified multipart `metadata`, validated by the backend, completed with authoritative task data, and stored in `recordings.metadata`.

Required v1 shape:

```json
{
  "schema_version": "v1",
  "timestamp": "2026-05-03T12:00:00.000Z",
  "phrase_id": "yes_kylla",
  "semantic_label": "yes",
  "prompted_word": "Kyllä",
  "normalized_label": "kylla",
  "literal_transcript": null,
  "label_source": "prompt_assumed",
  "language": "fi",
  "category": "yes",
  "technical": {
    "sample_rate_hz": 48000,
    "channel_count": 1,
    "media_stream_settings": {
      "echoCancellation": true,
      "noiseSuppression": true,
      "autoGainControl": true
    }
  },
  "processed_audio": {
    "sample_rate_hz": 16000,
    "channel_count": 1,
    "encoding": "pcm_s16le"
  }
}
```

The backend derives `phrase_id`, `semantic_label`, `prompted_word`, `normalized_label`, `language`, and `category` from the task row. The frontend is not trusted for classifier labels or category metadata.

The `technical` object keeps browser/media-stream capture metadata. `processed_audio` describes the audio file after backend processing; saved recordings are WAV PCM 16-bit, 16 kHz, mono.

`normalized_label` is the required canonical classifier training label. For compatibility with the current audio-classifier loader, labels remain ASCII, for example `kylla`, `ei_oo`, and `kaks`. `semantic_label` is broader metadata for future targets, for example `yes`, `no`, or `number_2`. `prompted_word` stores the Finnish display text, for example `Kyllä`.

`literal_transcript` is optional metadata for review/debugging. It is `null` when the volunteer leaves the transcript unchanged or empty. It is a trimmed string when the volunteer edits the "What did you actually say?" field.

Allowed `label_source` values:

- `prompt_assumed`: the prompt label is assumed correct.
- `user_confirmed`: the volunteer supplied a different literal transcript.
- `reviewed`: reserved for a later manual review workflow.

The classifier should train on `normalized_label`, not `literal_transcript`.

## Category Progress Metadata

The category UI backend stores session-specific phrase order in `participant_sessions.metadata.ui.category_phrase_v1`:

```json
{
  "category_order": ["yes", "no", "maybe", "dont_know", "correct", "number"],
  "phrase_order_by_category": {
    "yes": ["yes_kyl", "yes_joo", "yes_kylla"]
  },
  "created_at": "2026-05-25T00:00:00.000Z",
  "updated_at": "2026-05-25T00:00:00.000Z"
}
```

Progress counts unique `phrase_id` values. Repeat recordings are exported as additional samples but do not increase unique phrase progress twice. Previous recordings from the same anonymous browser `device_id` count toward category unlocks.

## Safety And Turnstile

Relevant environment variables:

```env
VITE_MAX_RECORDING_SECONDS=5
MAX_RECORDING_SECONDS=5
MAX_UPLOAD_BYTES=2000000
MAX_RECORDING_DURATION_TOLERANCE_SECONDS=1
VITE_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

The frontend auto-stops recordings after `VITE_MAX_RECORDING_SECONDS`, defaulting to 5 seconds. The backend rejects uploads larger than `MAX_UPLOAD_BYTES` and rejects audio longer than `MAX_RECORDING_SECONDS + MAX_RECORDING_DURATION_TOLERANCE_SECONDS`.

Turnstile is a session-start gate only. When `TURNSTILE_SECRET_KEY` is configured, `/api/start-session` requires and verifies a Turnstile token before creating or resuming a session. When the secret is empty, local development bypasses Turnstile.

## Collector Export Output

`scripts/aina/exportDataset.js` writes:

```text
exports/short-finnish-responses/v2/
  metadata/
    dataset.json
    samples.jsonl
```

Each sample row combines:

- `recordings` row values, including `recordings.id` as `sample_id`
- `recordings.metadata`
- `participant_sessions.metadata`
- task metadata
- storage information

Example exported row:

```json
{
  "sample_id": "recording-uuid",
  "audio_path": "session-uuid/task-id/recording-uuid.wav",
  "prompted_word": "Kyllä",
  "phrase_id": "yes_kylla",
  "semantic_label": "yes",
  "normalized_label": "kylla",
  "label": "kylla",
  "transcript": "Kyllä",
  "literal_transcript": null,
  "label_source": "prompt_assumed",
  "language": "fi",
  "duration_sec": 0.82,
  "split": null,
  "source": "real",
  "speaker_id": "spk_ab12cd34ef56",
  "metadata": {
    "schema_version": "v1",
    "device_id": "dev_ab12cd34ef56",
    "demographics": {
      "age_group": "26-35",
      "gender": "prefer_not_to_say",
      "native_language": "fi",
      "native_language_other": null,
      "dialect_region": "pori",
      "dialect_region_other": null
    },
    "environment": {
      "noise_level": "moderate",
      "audio_hardware": "not_sure"
    },
    "technical": {
      "user_agent": "Mozilla/5.0 ...",
      "inferred_os": "Windows",
      "inferred_browser": "Chrome",
      "inferred_device_type": "desktop",
      "sample_rate_hz": 48000,
      "channel_count": 1
    },
    "processed_audio": {
      "sample_rate_hz": 16000,
      "channel_count": 1,
      "encoding": "pcm_s16le"
    },
    "collection": {
      "topic_id": "short_finnish_responses_v2_0001",
      "task_id": "short_finnish_responses_v2_0001_yes_kylla",
      "session_id": "session-uuid",
      "session_status": "completed",
      "submitted_at": "2026-05-03T12:00:00.000Z",
      "storage_type": "local",
      "category": "yes",
      "phrase_id": "yes_kylla",
      "semantic_label": "yes"
    }
  }
}
```

`label` remains an alias of `normalized_label` for the current audio-classifier loader. `speaker_id` is stable for the same browser `device_id` and is hashed with `DATASET_SPEAKER_HASH_SALT` during export.

## Databuilder Compatibility Export

`scripts/aina/exportDatabuilderDataset.js` is an additional bridge for the current `audio-classifier` `feature/databuilder` package layout. It does not replace the collector export above.

It writes:

```text
exports/short-finnish-responses/v2/databuilder/
  manifest.json
  <sample_id>.wav
  <sample_id>.json
```

The output directory and manifest version can be configured with:

```env
DATABUILDER_OUTPUT_DIR=./exports/short-finnish-responses/v2/databuilder
DATABUILDER_MANIFEST_VERSION=20260501001
```

`sample_id` is always `recordings.id`, and the same value is used as:

- the manifest key
- the WAV basename
- the sidecar JSON basename
- the sidecar `sample_id` field

The manifest format is:

```json
{
  "version": "20260501001",
  "hash_algorithm": "md5",
  "samples": {
    "recording-uuid": {
      "wav_hash": "md5-of-written-wav",
      "json_hash": "md5-of-written-json"
    }
  }
}
```

The MD5 hashes are computed from the exact files written into the databuilder output directory.

Each `<sample_id>.json` sidecar is root-level for fields used by classifier filters:

```json
{
  "sample_id": "recording-uuid",
  "timestamp": "2026-05-03T12:00:00.000Z",
  "prompted_word": "Kyllä",
  "phrase_id": "yes_kylla",
  "semantic_label": "yes",
  "normalized_label": "kylla",
  "literal_transcript": null,
  "label_source": "prompt_assumed",
  "language": "fi",
  "category": "yes",
  "augmentation_strategy": null,
  "augmentations": [],
  "device_id": "dev_ab12cd34ef56",
  "speaker_id": "spk_ab12cd34ef56",
  "duration_sec": 0.82,
  "demographics": {},
  "environment": {},
  "technical": {},
  "processed_audio": {
    "sample_rate_hz": 16000,
    "channel_count": 1,
    "encoding": "pcm_s16le"
  },
  "collection": {},
  "storage": {}
}
```

The sidecar keeps `demographics`, `environment`, `technical`, `processed_audio`, and `category` at the root because audio-classifier filters use dotted paths such as `demographics.native_language` and `technical.sample_rate_hz`, not `metadata.demographics.native_language`.

In local storage mode, the bridge copies the stored audio file to `<sample_id>.wav`. In S3 mode, it downloads the stored object and writes it as `<sample_id>.wav`. Live collection still uses PostgreSQL plus local/S3 audio storage; the databuilder package is a generated handoff artifact and should not be committed.

The databuilder export is strict by default. It exports only classifier-ready recordings whose `recording.metadata.processed_audio` is exactly:

```json
{
  "sample_rate_hz": 16000,
  "channel_count": 1,
  "encoding": "pcm_s16le"
}
```

Old recordings collected before the processed-audio fix may not contain `processed_audio` or may point to 48 kHz audio. Those recordings are skipped by the databuilder bridge so they cannot enter the classifier cache by accident. If no classifier-ready recordings remain, the databuilder export fails and asks for fresh samples or explicit legacy reprocessing.

## Classifier Handoff Notes

- Train on `normalized_label` or its compatibility alias `label`.
- Use `prompted_word`/`transcript` for display and review.
- Treat `literal_transcript` as optional metadata, not the default target label.
- `sample_id` is the UUID from `recordings.id`.
- Export filters recordings by the active `STORAGE` setting so one manifest does not mix local and S3 audio roots.
- Use `scripts/aina/exportDataset.js` for the collector-native `dataset.json + samples.jsonl` export.
- Use `scripts/aina/exportDatabuilderDataset.js` when the current audio-classifier databuilder needs `manifest.json + <sample_id>.wav + <sample_id>.json`.
