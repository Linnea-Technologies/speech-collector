import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

import {
  buildStorageFilterSummary,
  buildSample,
  buildDatasetMetadata,
  filterRowsForActiveStorage,
  inferAudioRoot,
  pseudonymizeDeviceId,
  pseudonymizeSpeaker,
} from './exportDataset.js';
import { getSpeechCollectorRoot } from '../../backend/src/config.js';

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, originalEnv);
});

test('inferAudioRoot uses the local recordings root in local mode', () => {
  process.env.STORAGE = 'local';
  process.env.SOUND_RECORDINGS_PATH = 'tmp/recordings';
  delete process.env.DATASET_AUDIO_ROOT;

  const audioRoot = inferAudioRoot();
  assert.equal(audioRoot, path.join(getSpeechCollectorRoot(), 'tmp', 'recordings'));
});

test('inferAudioRoot keeps absolute local recordings roots unchanged', () => {
  const absoluteRoot = path.join(getSpeechCollectorRoot(), 'tmp', 'absolute-recordings');
  process.env.STORAGE = 'local';
  process.env.SOUND_RECORDINGS_PATH = absoluteRoot;
  delete process.env.DATASET_AUDIO_ROOT;

  assert.equal(inferAudioRoot(), absoluteRoot);
});

test('inferAudioRoot derives the S3 root from bucket and prefix', () => {
  process.env.STORAGE = 'aws-s3';
  process.env.AWS_BUCKET_NAME = 'aina-data';
  process.env.COLLECTION_AUDIO_PREFIX = 'short-finnish-responses/v1/audio';
  delete process.env.DATASET_AUDIO_ROOT;

  assert.equal(inferAudioRoot(), 's3://aina-data/short-finnish-responses/v1/audio/');
});

test('all-local export keeps all local rows', () => {
  process.env.STORAGE = 'local';
  const rows = [
    { storage_type: 'local', storage_key: 'session-1/task-1.wav' },
    { storage_type: 'local', storage_key: 'session-2/task-2.wav' },
  ];

  const result = filterRowsForActiveStorage(rows);

  assert.equal(result.activeStorageType, 'local');
  assert.deepEqual(result.exportRows, rows);
  assert.deepEqual(result.skippedCounts, {});
  assert.equal(buildStorageFilterSummary(result), null);
});

test('all-aws-s3 export keeps all aws-s3 rows', () => {
  process.env.STORAGE = 'aws-s3';
  process.env.AWS_BUCKET_NAME = 'aina-data';
  process.env.COLLECTION_AUDIO_PREFIX = 'short-finnish-responses/v1/audio';

  const rows = [
    { storage_type: 'aws-s3', storage_key: 'session-1/task-1.wav' },
    { storage_type: 'aws-s3', storage_key: 'session-2/task-2.wav' },
  ];

  const result = filterRowsForActiveStorage(rows);

  assert.equal(result.activeStorageType, 'aws-s3');
  assert.deepEqual(result.exportRows, rows);
  assert.deepEqual(result.skippedCounts, {});
  assert.equal(inferAudioRoot(), 's3://aina-data/short-finnish-responses/v1/audio/');
});

test('mixed local and aws-s3 rows export only the active storage_type', () => {
  process.env.STORAGE = 'local';
  process.env.SOUND_RECORDINGS_PATH = 'tmp/recordings';

  const localRow = {
    recording_id: 'recording-local',
    session_id: 'session-local',
    session_status: 'completed',
    session_metadata: {
      schema_version: 'v1',
      device_id: 'device-local',
    },
    topic_id: 'short_finnish_responses_v1_0001',
    task_id: 'short_finnish_responses_v1_0001_kylla',
    storage_type: 'local',
    storage_key: 'session-local/short_finnish_responses_v1_0001_kylla.wav',
    transcript: 'Kyllä',
    label: 'kylla',
    language: 'fi',
    category: 'affirmative',
    duration_sec: 0.82,
    submitted_at: '2026-04-22T10:00:00.000Z',
    recording_metadata: {
      schema_version: 'v1',
      prompted_word: 'Kyllä',
      normalized_label: 'kylla',
      literal_transcript: null,
      label_source: 'prompt_assumed',
    },
  };
  const s3Row = {
    ...localRow,
    recording_id: 'recording-s3',
    session_id: 'session-s3',
    storage_type: 'aws-s3',
    storage_key: 'session-s3/short_finnish_responses_v1_0001_kylla.wav',
  };

  const result = filterRowsForActiveStorage([localRow, s3Row]);
  const dataset = buildDatasetMetadata(result.exportRows, ['kylla'], inferAudioRoot());
  const samples = result.exportRows.map((row, index) => buildSample(row, index, dataset));

  assert.equal(result.exportRows.length, 1);
  assert.deepEqual(result.exportRows, [localRow]);
  assert.deepEqual(result.skippedCounts, { 'aws-s3': 1 });
  assert.equal(
    buildStorageFilterSummary(result),
    'Skipped 1 recording(s) whose storage_type did not match active STORAGE=local: aws-s3=1.'
  );
  assert.equal(dataset.audio_root, path.join(getSpeechCollectorRoot(), 'tmp', 'recordings'));
  assert.equal(samples[0].sample_id, 'recording-local');
  assert.equal(samples[0].audio_path, localRow.storage_key);
});

test('buildSample uses recording id and v1 labels in the manifest row', () => {
  process.env.DATASET_SPEAKER_HASH_SALT = 'test-salt';

  const dataset = buildDatasetMetadata([], ['kylla'], 's3://aina-data/short-finnish-responses/v1/audio/');
  const sample = buildSample(
    {
      recording_id: 'recording-123',
      session_id: 'session-123',
      session_status: 'completed',
      session_metadata: {
        schema_version: 'v1',
        device_id: 'device-123',
        demographics: {
          age_group: '26-35',
          gender: 'prefer_not_to_say',
          native_language: 'fi',
          native_language_other: null,
          dialect_region: 'pori',
          dialect_region_other: null,
        },
        environment: {
          noise_level: 'moderate',
          audio_hardware: 'not_sure',
        },
        technical: {
          user_agent: 'Mozilla/5.0',
          inferred_os: 'Windows',
          inferred_browser: 'Chrome',
          inferred_device_type: 'desktop',
        },
      },
      topic_id: 'short_finnish_responses_v1_0001',
      task_id: 'short_finnish_responses_v1_0001_kylla',
      storage_type: 'local',
      storage_key: 'session-123/short_finnish_responses_v1_0001_kylla.wav',
      transcript: 'Kyllä',
      label: 'kylla',
      language: 'fi',
      category: 'affirmative',
      duration_sec: 0.82,
      submitted_at: '2026-04-22T10:00:00.000Z',
      recording_metadata: {
        schema_version: 'v1',
        prompted_word: 'Kyllä',
        phrase_id: 'yes_kylla',
        semantic_label: 'yes',
        normalized_label: 'kylla',
        literal_transcript: 'kyl',
        label_source: 'user_confirmed',
        language: 'fi',
        category: 'affirmative',
        technical: {
          sample_rate_hz: 48000,
          channel_count: 1,
        },
        processed_audio: {
          sample_rate_hz: 16000,
          channel_count: 1,
          encoding: 'pcm_s16le',
        },
      },
    },
    0,
    dataset
  );

  assert.equal(sample.sample_id, 'recording-123');
  assert.equal(sample.audio_path, 'session-123/short_finnish_responses_v1_0001_kylla.wav');
  assert.equal(sample.prompted_word, 'Kyllä');
  assert.equal(sample.phrase_id, 'yes_kylla');
  assert.equal(sample.semantic_label, 'yes');
  assert.equal(sample.normalized_label, 'kylla');
  assert.equal(sample.label, 'kylla');
  assert.equal(sample.literal_transcript, 'kyl');
  assert.equal(sample.label_source, 'user_confirmed');
  assert.equal(sample.speaker_id, pseudonymizeSpeaker({ session_metadata: { device_id: 'device-123' } }));
  assert.equal(sample.metadata.device_id, pseudonymizeDeviceId({ session_metadata: { device_id: 'device-123' } }));
  assert.equal(sample.metadata.demographics.age_group, '26-35');
  assert.equal(sample.metadata.environment.audio_hardware, 'not_sure');
  assert.equal(sample.metadata.technical.inferred_browser, 'Chrome');
  assert.equal(sample.metadata.technical.sample_rate_hz, 48000);
  assert.deepEqual(sample.metadata.processed_audio, {
    sample_rate_hz: 16000,
    channel_count: 1,
    encoding: 'pcm_s16le',
  });
  assert.equal(sample.metadata.collection.session_status, 'completed');
  assert.equal(sample.metadata.collection.phrase_id, 'yes_kylla');
  assert.equal(sample.metadata.collection.semantic_label, 'yes');
});

test('buildSample keeps legacy semantic fields nullable', () => {
  const dataset = buildDatasetMetadata([], ['kylla'], 'local-root');
  const sample = buildSample(
    {
      recording_id: 'recording-legacy',
      session_id: 'session-legacy',
      session_status: 'abandoned',
      session_metadata: {},
      topic_id: 'short_finnish_responses_v1_0001',
      task_id: 'short_finnish_responses_v1_0001_kylla',
      storage_type: 'local',
      storage_key: 'session-legacy/short_finnish_responses_v1_0001_kylla.wav',
      transcript: 'Kylla',
      label: 'kylla',
      language: 'fi',
      category: 'affirmative',
      duration_sec: 0.82,
      submitted_at: '2026-04-22T10:00:00.000Z',
      recording_metadata: {},
      task_metadata: {},
    },
    0,
    dataset
  );

  assert.equal(sample.phrase_id, null);
  assert.equal(sample.semantic_label, null);
  assert.equal(sample.metadata.collection.phrase_id, null);
  assert.equal(sample.metadata.collection.semantic_label, null);
});

test('speaker id is stable for the same device id across sessions', () => {
  process.env.DATASET_SPEAKER_HASH_SALT = 'test-salt';

  const first = pseudonymizeSpeaker({
    session_id: 'session-1',
    session_metadata: { device_id: 'same-device' },
  });
  const second = pseudonymizeSpeaker({
    session_id: 'session-2',
    session_metadata: { device_id: 'same-device' },
  });

  assert.equal(first, second);
});

test('local manifests keep an absolute audio_root with relative audio_path values', () => {
  process.env.STORAGE = 'local';
  process.env.SOUND_RECORDINGS_PATH = 'tmp/recordings';
  process.env.DATASET_SPEAKER_HASH_SALT = 'test-salt';
  delete process.env.DATASET_AUDIO_ROOT;

  const dataset = buildDatasetMetadata([], ['kylla'], inferAudioRoot());
  const sample = buildSample(
    {
      session_id: 'session-123',
      session_status: 'completed',
      session_metadata: {},
      topic_id: 'short_finnish_responses_v1_0001',
      task_id: 'short_finnish_responses_v1_0001_kylla',
      storage_type: 'local',
      storage_key: 'session-123/short_finnish_responses_v1_0001_kylla.wav',
      transcript: 'Kylla',
      label: 'kylla',
      language: 'fi',
      category: 'affirmative',
      duration_sec: 0.82,
      submitted_at: '2026-04-22T10:00:00.000Z',
      recording_metadata: {},
    },
    0,
    dataset
  );

  assert.equal(dataset.audio_root, path.join(getSpeechCollectorRoot(), 'tmp', 'recordings'));
  assert.equal(
    path.resolve(dataset.audio_root, sample.audio_path),
    path.join(dataset.audio_root, 'session-123', 'short_finnish_responses_v1_0001_kylla.wav')
  );
});
