# AINA S3 Integration

This app now treats S3 as the production source of truth for audio and PostgreSQL as the source of truth for session, task, and recording metadata.

## Contract

```text
volunteer session
  -> PostgreSQL participant_sessions row
  -> prompt task from tasks/topic copy
  -> upload processed by backend
  -> unique storage_key
  -> S3 object key
  -> recordings row
  -> exportDataset.js writes manifests
```

## Storage Layout

Relative recording key:

```text
{session_id}/{task_id}/{recording_id}.wav
```

S3 object key:

```text
{COLLECTION_AUDIO_PREFIX}/{session_id}/{task_id}/{recording_id}.wav
```

Example:

```text
short-finnish-responses/v2/audio/92b65d47-.../short_finnish_responses_v2_0001_yes_kylla/11111111-1111-4111-8111-111111111111.wav
```

## Why The Exporter Uses Direct References

The exporter no longer copies audio into `exports/audio/` as the canonical source.

Instead:

- `recordings.storage_key` keeps the relative path
- `dataset.json.audio_root` points at the real storage root
- `samples.jsonl.audio_path` stays relative

That keeps the manifest aligned with the real audio location in both local and S3 modes.

`recordings.id` is generated before storage, and the ID is included in the audio path. Re-recording the same phrase creates a new row and a new object/file instead of overwriting the earlier sample.

## Local Mode

```env
STORAGE=local
SOUND_RECORDINGS_PATH=tmp/recordings
```

Local uploads are persisted to:

```text
SOUND_RECORDINGS_PATH/{session_id}/{task_id}/{recording_id}.wav
```

Relative local paths are resolved from the `apps/speech-collector` root so backend persistence and export use the same absolute directory.

Export derives:

```text
audio_root=<absolute SOUND_RECORDINGS_PATH>
audio_path={session_id}/{task_id}/{recording_id}.wav
```

## AWS S3 Mode

```env
STORAGE=aws-s3
AWS_BUCKET_NAME=<bucket>
AWS_REGION=eu-north-1
COLLECTION_AUDIO_PREFIX=short-finnish-responses/v2/audio
```

Export derives:

```text
audio_root=s3://<bucket>/<COLLECTION_AUDIO_PREFIX>/
audio_path={session_id}/{task_id}/{recording_id}.wav
```

## Session Status And Export

Exporter includes:

- `completed` sessions
- `abandoned` sessions

Exporter excludes:

- `active` sessions

This keeps partial but finalized contributions valid without exporting sessions that are still in progress.

Sessions that end before any recording is submitted, such as a declined-consent flow, do not produce sample rows because export is driven by `recordings`.

## Mixed Storage Rows

Because one exported dataset has one `dataset.json.audio_root`, the exporter now filters finalized recordings to the active backend selected by `STORAGE`.

That means:

- `STORAGE=local` exports only rows where `recordings.storage_type='local'`
- `STORAGE=aws-s3` exports only rows where `recordings.storage_type='aws-s3'`
- any rows from other storage backends are skipped and summarized in the export log

This protects the manifest contract when a single database contains older local rows and newer S3 rows at the same time.

## Compatibility Check

```bash
cd D:\ass_vscode\AIN\packages\audio-classifier
python - <<'PY'
from audio_classifier.data import load_dataset

dataset = load_dataset(r"D:\ass_vscode\AIN\apps\speech-collector\exports\short-finnish-responses\v2")
print(f"loaded {len(dataset)} samples")
print(dataset[0] if dataset else "no samples")
PY
```

If this loads correctly, the manifest contract matches the classifier loader.
