# Databuilder Export Bridge

## Purpose

The normal Speech Collector export remains:

```text
exports/short-finnish-responses/v2/
  metadata/
    dataset.json
    samples.jsonl
```

The current `audio-classifier` `feature/databuilder` branch expects a different flat package, so Speech Collector adds a separate compatibility export:

```text
exports/short-finnish-responses/v2/databuilder/
  manifest.json
  <sample_id>.wav
  <sample_id>.json
```

This bridge is generated from PostgreSQL metadata plus local/S3 audio storage. The frontend still never appends to a shared JSONL file.

## Command

```bash
pnpm run aina:export:databuilder
```

Optional settings:

```env
DATABUILDER_OUTPUT_DIR=./exports/short-finnish-responses/v2/databuilder
DATABUILDER_MANIFEST_VERSION=20260501001
```

Generated databuilder outputs contain audio and should not be committed.

## Storage Behavior

The bridge filters rows by the active `STORAGE` value, matching `scripts/aina/exportDataset.js`.

It also filters out recordings that are not classifier-ready. A row is exported only when `recording.metadata.processed_audio` is exactly:

```json
{
  "sample_rate_hz": 16000,
  "channel_count": 1,
  "encoding": "pcm_s16le"
}
```

Rows with missing, null, or different `processed_audio` values are treated as legacy recordings and skipped. If no classifier-ready rows remain, the export fails with:

```text
No classifier-ready recordings found. Record fresh samples after the 16 kHz processed-audio fix or reprocess legacy audio.
```

In `STORAGE=local`, it copies the existing stored audio from `SOUND_RECORDINGS_PATH` and writes it as `<sample_id>.wav`.

In `STORAGE=aws-s3`, it downloads the stored object using row metadata such as `metadata.storage.object_key`, `metadata.storage.bucket_name`, `storage_key`, `AWS_BUCKET_NAME`, and `COLLECTION_AUDIO_PREFIX`, then writes it as `<sample_id>.wav`.

No AWS credentials are exposed to the frontend.

## Sidecar Shape

Each `<sample_id>.json` sidecar is root-level:

```json
{
  "sample_id": "recording-uuid",
  "timestamp": "submitted_at",
  "prompted_word": "Kylla",
  "phrase_id": "yes_kylla",
  "semantic_label": "yes",
  "normalized_label": "kylla",
  "literal_transcript": null,
  "label_source": "prompt_assumed",
  "language": "fi",
  "category": "yes",
  "augmentation_strategy": null,
  "augmentations": [],
  "device_id": "dev_...",
  "speaker_id": "spk_...",
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

It is flat because audio-classifier filters use dotted paths like `demographics.native_language`, `environment.noise_level`, and `technical.sample_rate_hz`.

`literal_transcript`, `augmentation_strategy`, and `augmentations` always exist. Original recordings use `augmentation_strategy: null` and `augmentations: []`.

Older recordings collected before the processed-audio fix may not contain `processed_audio`; those sidecars keep the root-level key with `null`. Legacy recordings without `phrase_id` or `semantic_label` keep those keys as `null`; missing semantic metadata does not make an otherwise classifier-ready recording invalid.

The same `phrase_id` and `semantic_label` values are also included under `collection.phrase_id` and `collection.semantic_label`. `normalized_label` remains the phrase-level classifier target.

## Manifest

`manifest.json` uses:

```json
{
  "version": "20260501001",
  "hash_algorithm": "md5",
  "samples": {
    "recording-uuid": {
      "wav_hash": "...",
      "json_hash": "..."
    }
  }
}
```

Hashes are computed from the exact WAV and JSON bytes written into the databuilder output directory.

## Local Databuilder Smoke Test

The current databuilder can be smoke-tested directly against the generated directory as a local cache:

```powershell
cd D:\ass_vscode\AIN\tmp\audio-classifier-audit
python -c "import sys; sys.path.insert(0, 'src'); from pathlib import Path; from databuilder.builder import build_dataset; from databuilder.config import Config, SourceConfig, CacheDirConfig, DatasetConfig, FiltersConfig, AugmentationsConfig; cache=Path(r'D:\ass_vscode\AIN\apps\speech-collector\exports\short-finnish-responses\v2\databuilder'); out=cache.parent / 'databuilder-smoke-dataset'; cfg=Config(source=SourceConfig(endpoint_url='local', bucket='local', prefix='local'), cache_dir=CacheDirConfig(path=cache), dataset=DatasetConfig(path=out, clear=True), filters=FiltersConfig(include={}, exclude={}), augmentations=AugmentationsConfig()); print(build_dataset(cfg))"
```

That check verifies that the classifier can read `manifest.json`, find each `<sample_id>.wav` and `<sample_id>.json`, validate that sidecar `sample_id` equals the manifest key, and write its local dataset output.
