import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';

import {
  buildDatabuilderExportSummary,
  buildDatabuilderSidecar,
  exportDatabuilderRows,
  md5Bytes,
  NO_CLASSIFIER_READY_RECORDINGS_MESSAGE,
  serializeDatabuilderJson,
} from './exportDatabuilderDataset.js';

const originalEnv = { ...process.env };
const tempDirs = new Set();

function makeTempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'speech-collector-databuilder-'));
  tempDirs.add(dir);
  return dir;
}

function cleanupTempDirs() {
  for (const dir of tempDirs) {
    const safePrefix = path.join(os.tmpdir(), 'speech-collector-databuilder-');
    if (path.resolve(dir).startsWith(path.resolve(safePrefix))) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.clear();
}

afterEach(() => {
  cleanupTempDirs();

  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, originalEnv);
});

function makeRow(overrides = {}) {
  return {
    recording_id: '11111111-1111-4111-8111-111111111111',
    session_id: 'session-123',
    session_status: 'completed',
    session_metadata: {
      schema_version: 'v1',
      device_id: 'device-123',
      demographics: {
        age_group: '26-35',
        gender: 'prefer_not_to_say',
        native_language: 'fi',
      },
      environment: {
        noise_level: 'moderate',
        audio_hardware: 'built_in_mic',
      },
      technical: {
        user_agent: 'Mozilla/5.0',
        inferred_browser: 'Chrome',
      },
    },
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
    recording_metadata: {
      schema_version: 'v1',
      prompted_word: 'Kylla',
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
      storage: {
        object_key: 'session-123/short_finnish_responses_v1_0001_kylla.wav',
        bucket_name: null,
      },
    },
    ...overrides,
  };
}

function writeLocalAudio(recordingsRoot, row, bytes = Buffer.from('wav-bytes')) {
  const audioPath = path.join(recordingsRoot, ...row.storage_key.split('/'));
  mkdirSync(path.dirname(audioPath), { recursive: true });
  writeFileSync(audioPath, bytes);
  return audioPath;
}

test('buildDatabuilderSidecar creates root-level databuilder fields', () => {
  process.env.DATASET_SPEAKER_HASH_SALT = 'test-salt';

  const sidecar = buildDatabuilderSidecar(makeRow());

  assert.equal(sidecar.sample_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(sidecar.timestamp, '2026-04-22T10:00:00.000Z');
  assert.equal(sidecar.prompted_word, 'Kylla');
  assert.equal(sidecar.normalized_label, 'kylla');
  assert.equal(sidecar.literal_transcript, 'kyl');
  assert.equal(sidecar.label_source, 'user_confirmed');
  assert.equal(sidecar.language, 'fi');
  assert.equal(sidecar.category, 'affirmative');
  assert.equal(sidecar.augmentation_strategy, null);
  assert.deepEqual(sidecar.augmentations, []);
  assert.match(sidecar.device_id, /^dev_[a-f0-9]{12}$/);
  assert.match(sidecar.speaker_id, /^spk_[a-f0-9]{12}$/);
  assert.equal(sidecar.demographics.native_language, 'fi');
  assert.equal(sidecar.environment.noise_level, 'moderate');
  assert.equal(sidecar.technical.inferred_browser, 'Chrome');
  assert.equal(sidecar.technical.sample_rate_hz, 48000);
  assert.deepEqual(sidecar.processed_audio, {
    sample_rate_hz: 16000,
    channel_count: 1,
    encoding: 'pcm_s16le',
  });
  assert.equal(sidecar.collection.session_id, 'session-123');
  assert.equal(sidecar.storage.storage_key, 'session-123/short_finnish_responses_v1_0001_kylla.wav');
  assert.equal(Object.hasOwn(sidecar, 'metadata'), false);
});

test('required sidecar keys always exist for original recordings', () => {
  const sidecar = buildDatabuilderSidecar(
    makeRow({
      recording_metadata: {
        normalized_label: 'kylla',
      },
      session_metadata: {},
    })
  );

  assert.equal(Object.hasOwn(sidecar, 'literal_transcript'), true);
  assert.equal(sidecar.literal_transcript, null);
  assert.equal(Object.hasOwn(sidecar, 'augmentation_strategy'), true);
  assert.equal(sidecar.augmentation_strategy, null);
  assert.equal(Object.hasOwn(sidecar, 'augmentations'), true);
  assert.deepEqual(sidecar.augmentations, []);
  assert.equal(Object.hasOwn(sidecar, 'processed_audio'), true);
  assert.equal(sidecar.processed_audio, null);
  assert.equal(Object.hasOwn(sidecar, 'demographics'), true);
  assert.equal(Object.hasOwn(sidecar, 'environment'), true);
  assert.equal(Object.hasOwn(sidecar, 'technical'), true);
  assert.equal(Object.hasOwn(sidecar, 'collection'), true);
  assert.equal(Object.hasOwn(sidecar, 'storage'), true);
  assert.equal(Object.hasOwn(sidecar, 'speaker_id'), true);
  assert.equal(Object.hasOwn(sidecar, 'device_id'), true);
});

test('exportDatabuilderRows copies local audio as sample_id.wav', async () => {
  const recordingsRoot = makeTempDir();
  const outputDir = makeTempDir();
  const row = makeRow();
  const wavBytes = Buffer.from('copied wav bytes');
  writeLocalAudio(recordingsRoot, row, wavBytes);

  const result = await exportDatabuilderRows([row], {
    outputDir,
    recordingsRoot,
    activeStorageType: 'local',
    manifestVersion: 'test-version',
    log: false,
  });

  const sampleWav = path.join(outputDir, `${row.recording_id}.wav`);
  const sampleJson = path.join(outputDir, `${row.recording_id}.json`);

  assert.equal(result.samples[0].sampleId, row.recording_id);
  assert.deepEqual(readFileSync(sampleWav), wavBytes);
  assert.equal(existsSync(sampleJson), true);
  assert.equal(existsSync(path.join(outputDir, 'manifest.json')), true);
});

test('manifest hashes are computed from exact written wav and json bytes', async () => {
  const recordingsRoot = makeTempDir();
  const outputDir = makeTempDir();
  const row = makeRow();
  const wavBytes = Buffer.from('hash me exactly');
  writeLocalAudio(recordingsRoot, row, wavBytes);

  const result = await exportDatabuilderRows([row], {
    outputDir,
    recordingsRoot,
    activeStorageType: 'local',
    manifestVersion: 'test-version',
    log: false,
  });

  const manifestEntry = result.manifest.samples[row.recording_id];
  const writtenWav = readFileSync(path.join(outputDir, `${row.recording_id}.wav`));
  const writtenJson = readFileSync(path.join(outputDir, `${row.recording_id}.json`));
  const sidecar = JSON.parse(writtenJson.toString('utf-8'));

  assert.equal(result.manifest.hash_algorithm, 'md5');
  assert.equal(result.manifest.version, 'test-version');
  assert.equal(manifestEntry.wav_hash, md5Bytes(writtenWav));
  assert.equal(manifestEntry.json_hash, md5Bytes(writtenJson));
  assert.equal(sidecar.sample_id, row.recording_id);
  assert.equal(Object.keys(result.manifest.samples)[0], row.recording_id);
});

test('rows whose storage_type does not match active STORAGE are skipped', async () => {
  const recordingsRoot = makeTempDir();
  const outputDir = makeTempDir();
  const localRow = makeRow();
  const s3Row = makeRow({
    recording_id: '22222222-2222-4222-8222-222222222222',
    storage_type: 'aws-s3',
    storage_key: 'session-456/short_finnish_responses_v1_0001_kylla.wav',
  });
  writeLocalAudio(recordingsRoot, localRow);

  const result = await exportDatabuilderRows([localRow, s3Row], {
    outputDir,
    recordingsRoot,
    activeStorageType: 'local',
    manifestVersion: 'test-version',
    log: false,
  });

  assert.deepEqual(Object.keys(result.manifest.samples), [localRow.recording_id]);
  assert.deepEqual(result.storageFilter.skippedCounts, { 'aws-s3': 1 });
  assert.equal(existsSync(path.join(outputDir, `${localRow.recording_id}.wav`)), true);
  assert.equal(existsSync(path.join(outputDir, `${s3Row.recording_id}.wav`)), false);
  assert.equal(existsSync(path.join(outputDir, `${s3Row.recording_id}.json`)), false);
});

test('aws-s3 export downloads the metadata object key as sample_id.wav', async () => {
  const outputDir = makeTempDir();
  const row = makeRow({
    storage_type: 'aws-s3',
    storage_key: 'session-123/short_finnish_responses_v1_0001_kylla.wav',
    recording_metadata: {
      normalized_label: 'kylla',
      processed_audio: {
        sample_rate_hz: 16000,
        channel_count: 1,
        encoding: 'pcm_s16le',
      },
      storage: {
        object_key: 'short-finnish-responses/v1/audio/session-123/short_finnish_responses_v1_0001_kylla.wav',
        bucket_name: 'voice-training',
      },
    },
  });
  const calls = [];

  await exportDatabuilderRows([row], {
    outputDir,
    activeStorageType: 'aws-s3',
    manifestVersion: 'test-version',
    log: false,
    downloadObject: async (details) => {
      calls.push(details);
      writeFileSync(details.destinationPath, Buffer.from('downloaded wav'));
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].storageType, 'aws-s3');
  assert.equal(
    calls[0].objectKey,
    'short-finnish-responses/v1/audio/session-123/short_finnish_responses_v1_0001_kylla.wav'
  );
  assert.equal(calls[0].bucketName, 'voice-training');
  assert.deepEqual(
    readFileSync(path.join(outputDir, `${row.recording_id}.wav`)),
    Buffer.from('downloaded wav')
  );
});

test('valid processed_audio rows are exported and summarized', async () => {
  const recordingsRoot = makeTempDir();
  const outputDir = makeTempDir();
  const row = makeRow();
  writeLocalAudio(recordingsRoot, row);

  const result = await exportDatabuilderRows([row], {
    outputDir,
    recordingsRoot,
    activeStorageType: 'local',
    manifestVersion: 'test-version',
    log: false,
  });

  assert.deepEqual(Object.keys(result.manifest.samples), [row.recording_id]);
  assert.equal(result.summary.consideredRowCount, 1);
  assert.equal(result.summary.exportedRowCount, 1);
  assert.equal(result.summary.skippedLegacyProcessedAudioCount, 0);
  assert.equal(result.summary.skippedStorageMismatchCount, 0);
});

test('rows with null or missing processed_audio are skipped by default', async () => {
  const recordingsRoot = makeTempDir();
  const outputDir = makeTempDir();
  const validRow = makeRow({
    recording_id: '11111111-1111-4111-8111-111111111111',
  });
  const nullProcessedAudioRow = makeRow({
    recording_id: '22222222-2222-4222-8222-222222222222',
    recording_metadata: {
      normalized_label: 'kylla',
      processed_audio: null,
    },
  });
  const missingProcessedAudioRow = makeRow({
    recording_id: '33333333-3333-4333-8333-333333333333',
    recording_metadata: {
      normalized_label: 'kylla',
    },
  });
  writeLocalAudio(recordingsRoot, validRow);

  const result = await exportDatabuilderRows(
    [validRow, nullProcessedAudioRow, missingProcessedAudioRow],
    {
      outputDir,
      recordingsRoot,
      activeStorageType: 'local',
      manifestVersion: 'test-version',
      log: false,
    }
  );

  assert.deepEqual(Object.keys(result.manifest.samples), [validRow.recording_id]);
  assert.equal(result.summary.skippedLegacyProcessedAudioCount, 2);
  assert.equal(existsSync(path.join(outputDir, `${nullProcessedAudioRow.recording_id}.wav`)), false);
  assert.equal(existsSync(path.join(outputDir, `${missingProcessedAudioRow.recording_id}.json`)), false);
});

test('rows with wrong processed_audio values are skipped by default', async () => {
  const recordingsRoot = makeTempDir();
  const outputDir = makeTempDir();
  const validRow = makeRow({
    recording_id: '11111111-1111-4111-8111-111111111111',
  });
  const wrongRateRow = makeRow({
    recording_id: '22222222-2222-4222-8222-222222222222',
    recording_metadata: {
      normalized_label: 'kylla',
      processed_audio: {
        sample_rate_hz: 48000,
        channel_count: 1,
        encoding: 'pcm_s16le',
      },
    },
  });
  const wrongChannelRow = makeRow({
    recording_id: '33333333-3333-4333-8333-333333333333',
    recording_metadata: {
      normalized_label: 'kylla',
      processed_audio: {
        sample_rate_hz: 16000,
        channel_count: 2,
        encoding: 'pcm_s16le',
      },
    },
  });
  const wrongEncodingRow = makeRow({
    recording_id: '44444444-4444-4444-8444-444444444444',
    recording_metadata: {
      normalized_label: 'kylla',
      processed_audio: {
        sample_rate_hz: 16000,
        channel_count: 1,
        encoding: 'opus',
      },
    },
  });
  writeLocalAudio(recordingsRoot, validRow);

  const result = await exportDatabuilderRows(
    [validRow, wrongRateRow, wrongChannelRow, wrongEncodingRow],
    {
      outputDir,
      recordingsRoot,
      activeStorageType: 'local',
      manifestVersion: 'test-version',
      log: false,
    }
  );

  assert.deepEqual(Object.keys(result.manifest.samples), [validRow.recording_id]);
  assert.equal(result.summary.skippedLegacyProcessedAudioCount, 3);
});

test('databuilder export fails clearly when no classifier-ready rows remain', async () => {
  const outputDir = makeTempDir();
  const invalidRow = makeRow({
    recording_metadata: {
      normalized_label: 'kylla',
      processed_audio: null,
    },
  });

  await assert.rejects(
    () =>
      exportDatabuilderRows([invalidRow], {
        outputDir,
        activeStorageType: 'local',
        manifestVersion: 'test-version',
        log: false,
      }),
    { message: NO_CLASSIFIER_READY_RECORDINGS_MESSAGE }
  );
  assert.equal(existsSync(path.join(outputDir, 'manifest.json')), false);
});

test('databuilder export summary includes skipped legacy count', () => {
  const summaryText = buildDatabuilderExportSummary({
    consideredRowCount: 4,
    exportedRowCount: 1,
    skippedLegacyProcessedAudioCount: 3,
    skippedStorageMismatchCount: 0,
    outputDir: 'out',
  });

  assert.match(summaryText, /Databuilder export summary:/);
  assert.match(summaryText, /- skipped legacy\/missing processed_audio: 3/);
});

test('serialized sidecar JSON is deterministic for stable hash generation', () => {
  const sidecar = buildDatabuilderSidecar(makeRow());

  assert.equal(serializeDatabuilderJson(sidecar), serializeDatabuilderJson(sidecar));
});
