import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

import {
  buildStorageFilterSummary,
  buildSample,
  buildDatasetMetadata,
  filterRowsForActiveStorage,
  inferAudioRoot,
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
    session_id: 'session-local',
    session_status: 'completed',
    session_metadata: {},
    topic_id: 'short_finnish_responses_v1_0001',
    task_id: 'short_finnish_responses_v1_0001_kylla',
    storage_type: 'local',
    storage_key: 'session-local/short_finnish_responses_v1_0001_kylla.wav',
    transcript: 'Kylla',
    label: 'kylla',
    language: 'fi',
    category: 'affirmative',
    duration_sec: 0.82,
    submitted_at: '2026-04-22T10:00:00.000Z',
    recording_metadata: {},
  };
  const s3Row = {
    ...localRow,
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
  assert.equal(samples[0].audio_path, localRow.storage_key);
});

test('buildSample keeps storage_key as the manifest audio_path', () => {
  process.env.DATASET_SPEAKER_HASH_SALT = 'test-salt';

  const dataset = buildDatasetMetadata([], ['kylla'], 's3://aina-data/short-finnish-responses/v1/audio/');
  const sample = buildSample(
    {
      session_id: 'session-123',
      session_status: 'completed',
      session_metadata: { age_group: '20-29' },
      topic_id: 'short_finnish_responses_v1_0001',
      task_id: 'short_finnish_responses_v1_0001_kylla',
      storage_key: 'session-123/short_finnish_responses_v1_0001_kylla.wav',
      transcript: 'Kyllä',
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

  assert.equal(sample.audio_path, 'session-123/short_finnish_responses_v1_0001_kylla.wav');
  assert.equal(sample.speaker_id, pseudonymizeSpeaker({ session_id: 'session-123' }));
  assert.equal(sample.metadata.collection_session_status, 'completed');
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
