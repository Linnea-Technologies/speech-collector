import fs from 'fs';
import path from 'path';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { inferAudioRoot } from '../../scripts/aina/exportDataset.js';
import { getSpeechCollectorRoot, getSoundRecordingsRoot } from './config.js';
import {
  buildRecordingStorageKey,
  FileStorage,
  getProcessedAudioMetadata,
  PROCESSED_AUDIO_FFMPEG_OPTIONS,
} from './fileStorage.js';

const originalEnv = { ...process.env };
const cleanupPaths = [];

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, originalEnv);

  for (const cleanupPath of cleanupPaths.splice(0)) {
    fs.rmSync(cleanupPath, { recursive: true, force: true });
  }
});

test('buildRecordingStorageKey uses a stable session/task layout', () => {
  assert.equal(
    buildRecordingStorageKey('session-123', 'short_finnish_responses_v1_0001_kylla'),
    'session-123/short_finnish_responses_v1_0001_kylla.wav'
  );
});

test('processed audio ffmpeg options enforce 16 kHz mono PCM WAV', () => {
  assert.deepEqual(PROCESSED_AUDIO_FFMPEG_OPTIONS, [
    '-c:a pcm_s16le',
    '-ar 16000',
    '-ac 1',
  ]);
  assert.deepEqual(getProcessedAudioMetadata(), {
    sample_rate_hz: 16000,
    channel_count: 1,
    encoding: 'pcm_s16le',
  });
});

test('relative SOUND_RECORDINGS_PATH resolves from the speech-collector root in backend and exporter', () => {
  const appRoot = getSpeechCollectorRoot();
  const testParent = path.join(appRoot, 'tmp');
  fs.mkdirSync(testParent, { recursive: true });

  const tempRoot = fs.mkdtempSync(path.join(testParent, 'recordings-root-'));
  cleanupPaths.push(tempRoot);

  const recordingsRoot = path.join(tempRoot, 'audio');
  process.env.STORAGE = 'local';
  process.env.SOUND_RECORDINGS_PATH = path.relative(appRoot, recordingsRoot);

  const storage = new FileStorage('local');

  assert.equal(getSoundRecordingsRoot(), recordingsRoot);
  assert.equal(storage.recordingsRoot, recordingsRoot);
  assert.equal(inferAudioRoot(), recordingsRoot);
});

test('local persistence writes files under the same root the exporter publishes', async () => {
  const appRoot = getSpeechCollectorRoot();
  const testParent = path.join(appRoot, 'tmp');
  fs.mkdirSync(testParent, { recursive: true });

  const tempRoot = fs.mkdtempSync(path.join(testParent, 'persist-root-'));
  cleanupPaths.push(tempRoot);

  const recordingsRoot = path.join(tempRoot, 'recordings');
  const sourceFilePath = path.join(tempRoot, 'source.wav');
  const storageKey = buildRecordingStorageKey('session-123', 'task-456');

  process.env.STORAGE = 'local';
  process.env.SOUND_RECORDINGS_PATH = path.relative(appRoot, recordingsRoot);

  const storage = new FileStorage('local');
  fs.writeFileSync(sourceFilePath, Buffer.from('wav-data'));

  const finalPath = await storage.persistLocally(sourceFilePath, storageKey);
  const expectedPath = path.join(inferAudioRoot(), 'session-123', 'task-456.wav');

  assert.equal(finalPath, expectedPath);
  assert.equal(fs.readFileSync(finalPath, 'utf-8'), 'wav-data');
});

test('saveRecording returns processed audio metadata with persisted local recordings', async () => {
  const appRoot = getSpeechCollectorRoot();
  const testParent = path.join(appRoot, 'tmp');
  fs.mkdirSync(testParent, { recursive: true });

  const tempRoot = fs.mkdtempSync(path.join(testParent, 'processed-meta-root-'));
  cleanupPaths.push(tempRoot);

  const recordingsRoot = path.join(tempRoot, 'recordings');
  process.env.STORAGE = 'local';
  process.env.SOUND_RECORDINGS_PATH = path.relative(appRoot, recordingsRoot);

  const storage = new FileStorage('local');
  storage.reencodeFile = async () => {};
  storage.getAudioDurationSec = async () => 0.82;

  const result = await storage.saveRecording(
    { buffer: Buffer.from('wav-data') },
    { sessionId: 'session-123', taskId: 'task-456' }
  );

  assert.deepEqual(result.processedAudio, getProcessedAudioMetadata());
});
