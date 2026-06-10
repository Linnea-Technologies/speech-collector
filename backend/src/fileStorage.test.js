import fs from 'fs';
import path from 'path';
import { execFile } from 'node:child_process';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

import { inferAudioRoot } from '../../scripts/aina/exportDataset.js';
import { getSpeechCollectorRoot, getSoundRecordingsRoot } from './config.js';
import {
  buildMetadataSidecarStorageKey,
  buildRecordingStorageKey,
  FileStorage,
  getProcessedAudioMetadata,
  PROCESSED_AUDIO_FFMPEG_OPTIONS,
} from './fileStorage.js';

const originalEnv = { ...process.env };
const cleanupPaths = [];
const execFileAsync = promisify(execFile);

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

test('buildRecordingStorageKey uses a unique session/task/recording layout', () => {
  assert.equal(
    buildRecordingStorageKey(
      'session-123',
      'short_finnish_responses_v2_0001_yes_kylla',
      'recording-789'
    ),
    'session-123/short_finnish_responses_v2_0001_yes_kylla/recording-789.wav'
  );
});

async function generateTinyAudioFixture(outputPath, outputOptions) {
  try {
    await execFileAsync(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.25',
      ...outputOptions,
      '-y',
      outputPath,
    ]);
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(stderr || error.message);
  }
}

async function probeAudioFile(inputPath) {
  const { stdout } = await execFileAsync(ffprobe.path, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name,sample_rate,channels',
    '-of',
    'json',
    inputPath,
  ]);

  return JSON.parse(stdout).streams?.[0] || {};
}

async function assertReencodedFixture(inputPath) {
  const storage = new FileStorage('local');
  await storage.reencodeFile(inputPath);

  const metadata = await probeAudioFile(inputPath);
  assert.equal(metadata.codec_name, 'pcm_s16le');
  assert.equal(metadata.sample_rate, '16000');
  assert.equal(metadata.channels, 1);
}

test('buildMetadataSidecarStorageKey replaces wav extension with json', () => {
  assert.equal(
    buildMetadataSidecarStorageKey('session-123/task-456/recording-789.wav'),
    'session-123/task-456/recording-789.json'
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

test('reencodeFile normalizes WebM Opus input to 16 kHz mono PCM audio', async () => {
  const appRoot = getSpeechCollectorRoot();
  const testParent = path.join(appRoot, 'tmp');
  fs.mkdirSync(testParent, { recursive: true });

  const tempRoot = fs.mkdtempSync(path.join(testParent, 'webm-reencode-root-'));
  cleanupPaths.push(tempRoot);

  const inputPath = path.join(tempRoot, 'browser-webm-bytes-in-wav-temp-file.wav');
  process.env.STORAGE = 'local';
  process.env.SOUND_RECORDINGS_PATH = path.relative(appRoot, path.join(tempRoot, 'recordings'));

  await generateTinyAudioFixture(inputPath, ['-c:a', 'libopus', '-f', 'webm']);
  await assertReencodedFixture(inputPath);
});

test('reencodeFile normalizes MP4 AAC input to 16 kHz mono PCM audio', async () => {
  const appRoot = getSpeechCollectorRoot();
  const testParent = path.join(appRoot, 'tmp');
  fs.mkdirSync(testParent, { recursive: true });

  const tempRoot = fs.mkdtempSync(path.join(testParent, 'mp4-reencode-root-'));
  cleanupPaths.push(tempRoot);

  const inputPath = path.join(tempRoot, 'browser-mp4-bytes-in-wav-temp-file.wav');
  process.env.STORAGE = 'local';
  process.env.SOUND_RECORDINGS_PATH = path.relative(appRoot, path.join(tempRoot, 'recordings'));

  await generateTinyAudioFixture(inputPath, ['-c:a', 'aac', '-f', 'mp4']);
  await assertReencodedFixture(inputPath);
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
  const storageKey = buildRecordingStorageKey('session-123', 'task-456', 'recording-789');

  process.env.STORAGE = 'local';
  process.env.SOUND_RECORDINGS_PATH = path.relative(appRoot, recordingsRoot);

  const storage = new FileStorage('local');
  fs.writeFileSync(sourceFilePath, Buffer.from('wav-data'));

  const finalPath = await storage.persistLocally(sourceFilePath, storageKey);
  const expectedPath = path.join(inferAudioRoot(), 'session-123', 'task-456', 'recording-789.wav');

  assert.equal(finalPath, expectedPath);
  assert.equal(fs.readFileSync(finalPath, 'utf-8'), 'wav-data');
});

test('local JSON sidecar is written beside the wav file', async () => {
  const appRoot = getSpeechCollectorRoot();
  const testParent = path.join(appRoot, 'tmp');
  fs.mkdirSync(testParent, { recursive: true });

  const tempRoot = fs.mkdtempSync(path.join(testParent, 'sidecar-root-'));
  cleanupPaths.push(tempRoot);

  const recordingsRoot = path.join(tempRoot, 'recordings');
  process.env.STORAGE = 'local';
  process.env.SOUND_RECORDINGS_PATH = path.relative(appRoot, recordingsRoot);

  const storage = new FileStorage('local');
  const result = await storage.writeJsonSidecar(
    {
      storage_type: 'local',
      storage_key: 'session-123/task-456/recording-789.wav',
      recording_metadata: {
        storage: {
          object_key: 'session-123/task-456/recording-789.wav',
        },
      },
    },
    { sample_id: 'recording-789' }
  );

  const expectedPath = path.join(recordingsRoot, 'session-123', 'task-456', 'recording-789.json');
  assert.equal(result.metadata_object_key, 'session-123/task-456/recording-789.json');
  assert.equal(fs.existsSync(expectedPath), true);
  assert.equal(JSON.parse(fs.readFileSync(expectedPath, 'utf-8')).sample_id, 'recording-789');
});

test('local audio stream supports byte ranges', async () => {
  const appRoot = getSpeechCollectorRoot();
  const testParent = path.join(appRoot, 'tmp');
  fs.mkdirSync(testParent, { recursive: true });

  const tempRoot = fs.mkdtempSync(path.join(testParent, 'audio-stream-root-'));
  cleanupPaths.push(tempRoot);

  const recordingsRoot = path.join(tempRoot, 'recordings');
  const audioPath = path.join(recordingsRoot, 'session-123', 'task-456', 'recording-789.wav');
  process.env.STORAGE = 'local';
  process.env.SOUND_RECORDINGS_PATH = path.relative(appRoot, recordingsRoot);
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  fs.writeFileSync(audioPath, Buffer.from('0123456789'));

  const storage = new FileStorage('local');
  const result = await storage.getRecordingAudioStream(
    {
      storage_type: 'local',
      storage_key: 'session-123/task-456/recording-789.wav',
    },
    { rangeHeader: 'bytes=2-5' }
  );
  const chunks = [];
  for await (const chunk of result.stream) {
    chunks.push(chunk);
  }

  assert.equal(result.statusCode, 206);
  assert.equal(result.contentLength, 4);
  assert.equal(Buffer.concat(chunks).toString('utf-8'), '2345');
  assert.equal(result.headers['Content-Range'], 'bytes 2-5/10');
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
    { sessionId: 'session-123', taskId: 'task-456', recordingId: 'recording-789' }
  );

  assert.deepEqual(result.processedAudio, getProcessedAudioMetadata());
  assert.equal(result.storageKey, 'session-123/task-456/recording-789.wav');
});
