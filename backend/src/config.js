import path from 'path';
import { fileURLToPath } from 'url';

const SPEECH_COLLECTOR_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
const DEFAULT_SOUND_RECORDINGS_PATH = 'tmp/recordings';
const DEFAULT_MAX_RECORDING_SECONDS = 5;
const DEFAULT_MAX_UPLOAD_BYTES = 2_000_000;
const DEFAULT_MAX_RECORDING_DURATION_TOLERANCE_SECONDS = 1;

function normalizePosixPrefix(prefix) {
  return (prefix || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export function getSpeechCollectorRoot() {
  return SPEECH_COLLECTOR_ROOT;
}

export function resolveSpeechCollectorPath(targetPath, fallback = '') {
  const value = targetPath || fallback;
  if (!value) {
    return SPEECH_COLLECTOR_ROOT;
  }

  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(SPEECH_COLLECTOR_ROOT, value);
}

export function getDbConnectionString() {
  const password = encodeURIComponent(process.env.PG_PASSWORD || '');
  return `postgresql://${process.env.PG_USER}:${password}@${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}`;
}

export function getSessionIdleTimeoutHours() {
  const parsed = Number.parseInt(process.env.SESSION_IDLE_TIMEOUT_HOURS || '24', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

function getPositiveIntegerEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getNonNegativeNumberEnv(name, fallback) {
  const parsed = Number.parseFloat(process.env[name] || String(fallback));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getMaxRecordingSeconds() {
  return getPositiveIntegerEnv('MAX_RECORDING_SECONDS', DEFAULT_MAX_RECORDING_SECONDS);
}

export function getMaxUploadBytes() {
  return getPositiveIntegerEnv('MAX_UPLOAD_BYTES', DEFAULT_MAX_UPLOAD_BYTES);
}

export function getMaxRecordingDurationToleranceSeconds() {
  return getNonNegativeNumberEnv(
    'MAX_RECORDING_DURATION_TOLERANCE_SECONDS',
    DEFAULT_MAX_RECORDING_DURATION_TOLERANCE_SECONDS
  );
}

export function getMaxAllowedRecordingDurationSeconds() {
  return getMaxRecordingSeconds() + getMaxRecordingDurationToleranceSeconds();
}

export function getTurnstileSecretKey() {
  return (process.env.TURNSTILE_SECRET_KEY || '').trim();
}

export function getCollectionAudioPrefix() {
  const datasetId = (process.env.DATASET_ID || 'short_finnish_responses').replace(/_/g, '-');
  const datasetVersion = process.env.DATASET_VERSION || 'v1';
  return normalizePosixPrefix(
    process.env.COLLECTION_AUDIO_PREFIX || `${datasetId}/${datasetVersion}/audio`
  );
}

export function getSoundRecordingsPath() {
  return process.env.SOUND_RECORDINGS_PATH || DEFAULT_SOUND_RECORDINGS_PATH;
}

export function getSoundRecordingsRoot() {
  return resolveSpeechCollectorPath(process.env.SOUND_RECORDINGS_PATH, DEFAULT_SOUND_RECORDINGS_PATH);
}

export function normalizeStorageKey(...segments) {
  return segments
    .flat()
    .filter(Boolean)
    .map((segment) => String(segment).replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}
