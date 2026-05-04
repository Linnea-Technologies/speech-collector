import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getMaxRecordingDurationToleranceSeconds,
  getMaxRecordingSeconds,
  getMaxUploadBytes,
} from './config.js';

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, originalEnv);
});

test('config reads max recording seconds', () => {
  process.env.MAX_RECORDING_SECONDS = '7';

  assert.equal(getMaxRecordingSeconds(), 7);
});

test('config reads max upload bytes', () => {
  process.env.MAX_UPLOAD_BYTES = '123456';

  assert.equal(getMaxUploadBytes(), 123456);
});

test('config reads duration tolerance seconds', () => {
  process.env.MAX_RECORDING_DURATION_TOLERANCE_SECONDS = '1.5';

  assert.equal(getMaxRecordingDurationToleranceSeconds(), 1.5);
});

test('config falls back when safety limits are invalid', () => {
  process.env.MAX_RECORDING_SECONDS = '0';
  process.env.MAX_UPLOAD_BYTES = '-1';
  process.env.MAX_RECORDING_DURATION_TOLERANCE_SECONDS = '-2';

  assert.equal(getMaxRecordingSeconds(), 5);
  assert.equal(getMaxUploadBytes(), 2000000);
  assert.equal(getMaxRecordingDurationToleranceSeconds(), 1);
});
