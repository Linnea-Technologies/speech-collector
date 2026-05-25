import { config } from 'dotenv';
import { createHash } from 'crypto';
import { copyFileSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  configValue,
  createDbClient,
  ensureDirectory,
  expireStaleSessions,
  fetchCompletedRows,
  filterRowsForActiveStorage,
  getActiveStorageType,
  getDurationSec,
  getPhraseId,
  getSemanticLabel,
  pseudonymizeDeviceId,
  pseudonymizeSpeaker,
} from './exportDataset.js';
import {
  getCollectionAudioPrefix,
  getSoundRecordingsRoot,
  normalizeStorageKey,
} from '../../backend/src/config.js';
import { FileStorage } from '../../backend/src/fileStorage.js';

const DEFAULT_DATABUILDER_OUTPUT_DIR = './exports/short-finnish-responses/v2/databuilder';
const DEFAULT_DATABUILDER_MANIFEST_VERSION = '20260501001';
export const NO_CLASSIFIER_READY_RECORDINGS_MESSAGE =
  'No classifier-ready recordings found. Record fresh samples after the 16 kHz processed-audio fix or reprocess legacy audio.';

const EXPECTED_PROCESSED_AUDIO = {
  sample_rate_hz: 16000,
  channel_count: 1,
  encoding: 'pcm_s16le',
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeTimestamp(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return null;
}

function assertSafeSampleId(sampleId) {
  if (!sampleId || typeof sampleId !== 'string') {
    throw new Error('recordings.id is required for databuilder export sample_id.');
  }

  if (sampleId.includes('/') || sampleId.includes('\\')) {
    throw new Error(`Unsafe sample_id for databuilder export: ${sampleId}`);
  }

  return sampleId;
}

function assertPathInside(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Refusing to read audio outside the local recordings root: ${targetPath}`);
  }
}

function normalizeStorageObjectKey(objectKey) {
  return normalizeStorageKey(objectKey);
}

function inferRemoteObjectKey(row, recordingMetadata) {
  const storageMetadata = isPlainObject(recordingMetadata.storage) ? recordingMetadata.storage : {};
  const explicitObjectKey =
    normalizeOptionalString(storageMetadata.object_key) ||
    normalizeOptionalString(recordingMetadata.object_key);

  if (explicitObjectKey) {
    return normalizeStorageObjectKey(explicitObjectKey);
  }

  const storageKey = normalizeStorageObjectKey(row.storage_key);
  const prefix = getCollectionAudioPrefix();

  if (!prefix || storageKey === prefix || storageKey.startsWith(`${prefix}/`)) {
    return storageKey;
  }

  return normalizeStorageKey(prefix, storageKey);
}

function getBucketName(row, recordingMetadata) {
  const storageMetadata = isPlainObject(recordingMetadata.storage) ? recordingMetadata.storage : {};
  const explicitBucketName =
    normalizeOptionalString(storageMetadata.bucket_name) ||
    normalizeOptionalString(recordingMetadata.bucket_name);

  if (explicitBucketName) {
    return explicitBucketName;
  }

  if (row.storage_type === 'aws-s3') {
    return normalizeOptionalString(process.env.AWS_BUCKET_NAME);
  }

  if (row.storage_type === 'r2') {
    return normalizeOptionalString(process.env.CF_R2_BUCKET_NAME);
  }

  return null;
}

export function getDatabuilderOutputDir() {
  return path.resolve(configValue('DATABUILDER_OUTPUT_DIR', DEFAULT_DATABUILDER_OUTPUT_DIR));
}

export function getDatabuilderManifestVersion() {
  return configValue('DATABUILDER_MANIFEST_VERSION', DEFAULT_DATABUILDER_MANIFEST_VERSION);
}

export function getDatabuilderSampleId(row) {
  return assertSafeSampleId(row.recording_id);
}

export function getDatabuilderStorageInfo(row) {
  const recordingMetadata = isPlainObject(row.recording_metadata) ? row.recording_metadata : {};
  const storageType = normalizeOptionalString(row.storage_type) || 'unknown';
  const storageKey = normalizeStorageObjectKey(row.storage_key);
  const objectKey =
    storageType === 'local' ? storageKey : inferRemoteObjectKey(row, recordingMetadata);

  return {
    storage_type: storageType,
    storage_key: storageKey,
    object_key: objectKey || null,
    bucket_name: getBucketName(row, recordingMetadata),
  };
}

export function isClassifierReadyProcessedAudio(processedAudio) {
  return (
    isPlainObject(processedAudio) &&
    processedAudio.sample_rate_hz === EXPECTED_PROCESSED_AUDIO.sample_rate_hz &&
    processedAudio.channel_count === EXPECTED_PROCESSED_AUDIO.channel_count &&
    processedAudio.encoding === EXPECTED_PROCESSED_AUDIO.encoding
  );
}

export function isClassifierReadyRow(row) {
  const recordingMetadata = isPlainObject(row.recording_metadata) ? row.recording_metadata : {};
  return isClassifierReadyProcessedAudio(recordingMetadata.processed_audio);
}

export function filterRowsForClassifierReadyAudio(rows) {
  const exportRows = [];
  const skippedRows = [];

  for (const row of rows) {
    if (isClassifierReadyRow(row)) {
      exportRows.push(row);
      continue;
    }

    skippedRows.push(row);
  }

  return {
    exportRows,
    skippedRows,
    skippedRowCount: skippedRows.length,
  };
}

export function buildDatabuilderSidecar(row) {
  const sampleId = getDatabuilderSampleId(row);
  const recordingMetadata = isPlainObject(row.recording_metadata) ? row.recording_metadata : {};
  const sessionMetadata = isPlainObject(row.session_metadata) ? row.session_metadata : {};
  const sessionTechnical = isPlainObject(sessionMetadata.technical) ? sessionMetadata.technical : {};
  const recordingTechnical = isPlainObject(recordingMetadata.technical)
    ? recordingMetadata.technical
    : {};
  const normalizedLabel =
    normalizeOptionalString(recordingMetadata.normalized_label) ||
    normalizeOptionalString(row.label);
  const promptedWord =
    normalizeOptionalString(recordingMetadata.prompted_word) ||
    normalizeOptionalString(row.transcript);
  const language =
    normalizeOptionalString(recordingMetadata.language) ||
    normalizeOptionalString(row.language) ||
    configValue('DATASET_LANGUAGE', 'fi');
  const category =
    normalizeOptionalString(recordingMetadata.category) ||
    normalizeOptionalString(row.category);
  const phraseId = getPhraseId(row);
  const semanticLabel = getSemanticLabel(row);
  const submittedAt = normalizeTimestamp(row.submitted_at || recordingMetadata.timestamp);

  if (!normalizedLabel) {
    throw new Error(`Recording ${sampleId} is missing normalized_label.`);
  }

  return {
    sample_id: sampleId,
    timestamp: submittedAt,
    prompted_word: promptedWord,
    phrase_id: phraseId,
    semantic_label: semanticLabel,
    normalized_label: normalizedLabel,
    literal_transcript: recordingMetadata.literal_transcript ?? null,
    label_source: recordingMetadata.label_source || 'prompt_assumed',
    language,
    category: category || null,
    augmentation_strategy: null,
    augmentations: [],
    device_id: pseudonymizeDeviceId(row),
    speaker_id: pseudonymizeSpeaker(row),
    duration_sec: getDurationSec(row),
    demographics: isPlainObject(sessionMetadata.demographics) ? sessionMetadata.demographics : {},
    environment: isPlainObject(sessionMetadata.environment) ? sessionMetadata.environment : {},
    technical: {
      ...sessionTechnical,
      ...recordingTechnical,
    },
    processed_audio: isPlainObject(recordingMetadata.processed_audio)
      ? recordingMetadata.processed_audio
      : null,
    collection: {
      topic_id: row.topic_id,
      task_id: row.task_id,
      session_id: row.session_id,
      session_status: row.session_status,
      submitted_at: submittedAt,
      storage_type: row.storage_type,
      category: category || null,
      phrase_id: phraseId,
      semantic_label: semanticLabel,
    },
    storage: getDatabuilderStorageInfo(row),
  };
}

export function serializeDatabuilderJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function writeDatabuilderJsonFile(filePath, data) {
  const bytes = Buffer.from(serializeDatabuilderJson(data), 'utf-8');
  writeFileSync(filePath, bytes);
  return bytes;
}

export function cleanDatabuilderOutputDir(outputDir) {
  ensureDirectory(outputDir);

  for (const entry of readdirSync(outputDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    if (entry.name.endsWith('.wav') || entry.name.endsWith('.json')) {
      rmSync(path.join(outputDir, entry.name), { force: true });
    }
  }
}

export function md5Bytes(bytes) {
  return createHash('md5').update(bytes).digest('hex');
}

export function md5File(filePath) {
  return md5Bytes(readFileSync(filePath));
}

export function getLocalAudioSourcePath(row, recordingsRoot = getSoundRecordingsRoot()) {
  const storageKey = normalizeStorageObjectKey(row.storage_key);
  if (!storageKey) {
    throw new Error(`Recording ${row.recording_id} is missing storage_key.`);
  }

  const sourcePath = path.isAbsolute(storageKey)
    ? path.normalize(storageKey)
    : path.resolve(recordingsRoot, ...storageKey.split('/'));

  assertPathInside(recordingsRoot, sourcePath);
  return sourcePath;
}

export async function defaultDownloadObject({ storageType, objectKey, bucketName, destinationPath }) {
  const fileStorage = new FileStorage(storageType);
  await fileStorage.downloadObject(objectKey, destinationPath, { bucketName });
}

export async function writeDatabuilderAudioFile(row, outputDir, options = {}) {
  const sampleId = getDatabuilderSampleId(row);
  const activeStorageType = options.activeStorageType || getActiveStorageType();
  const destinationPath = path.join(outputDir, `${sampleId}.wav`);
  ensureDirectory(path.dirname(destinationPath));

  if (activeStorageType === 'local') {
    const sourcePath = getLocalAudioSourcePath(row, options.recordingsRoot || getSoundRecordingsRoot());
    copyFileSync(sourcePath, destinationPath);
    return destinationPath;
  }

  if (activeStorageType === 'aws-s3' || activeStorageType === 'r2') {
    const storage = getDatabuilderStorageInfo(row);
    if (!storage.object_key) {
      throw new Error(`Recording ${sampleId} is missing a remote object key.`);
    }

    const downloadObject = options.downloadObject || defaultDownloadObject;
    await downloadObject({
      storageType: activeStorageType,
      objectKey: storage.object_key,
      bucketName: storage.bucket_name,
      destinationPath,
      row,
    });
    return destinationPath;
  }

  throw new Error(`Unsupported STORAGE value for databuilder export: ${activeStorageType}`);
}

export function buildDatabuilderManifest(writtenSamples, version = getDatabuilderManifestVersion()) {
  const samples = {};

  for (const sample of writtenSamples) {
    samples[sample.sampleId] = {
      wav_hash: md5File(sample.wavPath),
      json_hash: md5File(sample.jsonPath),
    };
  }

  return {
    version,
    hash_algorithm: 'md5',
    samples,
  };
}

export function buildDatabuilderExportSummary(summary) {
  return [
    'Databuilder export summary:',
    `- considered recordings: ${summary.consideredRowCount}`,
    `- exported recordings: ${summary.exportedRowCount}`,
    `- skipped legacy/missing processed_audio: ${summary.skippedLegacyProcessedAudioCount}`,
    `- skipped storage mismatch: ${summary.skippedStorageMismatchCount}`,
    `- output directory: ${summary.outputDir}`,
  ].join('\n');
}

export async function exportDatabuilderRows(rows, options = {}) {
  const outputDir = path.resolve(options.outputDir || getDatabuilderOutputDir());
  ensureDirectory(outputDir);

  const storageFilter = filterRowsForActiveStorage(
    rows,
    options.activeStorageType || getActiveStorageType()
  );
  const classifierReadyFilter = filterRowsForClassifierReadyAudio(storageFilter.exportRows);
  const summary = {
    consideredRowCount: rows.length,
    exportedRowCount: classifierReadyFilter.exportRows.length,
    skippedLegacyProcessedAudioCount: classifierReadyFilter.skippedRowCount,
    skippedStorageMismatchCount: storageFilter.skippedRowCount,
    outputDir,
  };
  const summaryText = buildDatabuilderExportSummary(summary);

  if (options.log !== false) {
    console.log(summaryText);
  }

  cleanDatabuilderOutputDir(outputDir);

  if (classifierReadyFilter.exportRows.length === 0) {
    throw new Error(NO_CLASSIFIER_READY_RECORDINGS_MESSAGE);
  }

  const writtenSamples = [];
  for (const row of classifierReadyFilter.exportRows) {
    const sampleId = getDatabuilderSampleId(row);
    const wavPath = await writeDatabuilderAudioFile(row, outputDir, {
      ...options,
      activeStorageType: storageFilter.activeStorageType,
    });
    const sidecar = buildDatabuilderSidecar(row);
    const jsonPath = path.join(outputDir, `${sampleId}.json`);

    writeDatabuilderJsonFile(jsonPath, sidecar);
    writtenSamples.push({ sampleId, wavPath, jsonPath });
  }

  const manifest = buildDatabuilderManifest(
    writtenSamples,
    options.manifestVersion || getDatabuilderManifestVersion()
  );
  const manifestPath = path.join(outputDir, 'manifest.json');
  writeDatabuilderJsonFile(manifestPath, manifest);

  return {
    outputDir,
    manifest,
    manifestPath,
    samples: writtenSamples,
    storageFilter,
    classifierReadyFilter,
    summary,
    summaryText,
  };
}

export async function exportDatabuilderDataset() {
  config();

  const client = createDbClient();
  await client.connect();

  try {
    await expireStaleSessions(client);
    const rows = await fetchCompletedRows(client);
    const result = await exportDatabuilderRows(rows);

    console.log(`Exported ${result.samples.length} classifier-ready databuilder sample(s).`);
  } finally {
    await client.end();
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentPath = fileURLToPath(import.meta.url);

if (entryPath === currentPath) {
  try {
    await exportDatabuilderDataset();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
