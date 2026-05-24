import { config } from 'dotenv';
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import pkg from 'pg';
import { fileURLToPath } from 'url';

import {
  getCollectionAudioPrefix,
  getSessionIdleTimeoutHours,
  getSoundRecordingsRoot,
} from '../../backend/src/config.js';

const { Client } = pkg;

export function configValue(name, fallback) {
  return process.env[name] || fallback;
}

export function getActiveStorageType() {
  return configValue('STORAGE', 'local');
}

export function createDbClient() {
  config();
  const password = encodeURIComponent(process.env.PG_PASSWORD || '');
  const connString = `postgresql://${process.env.PG_USER}:${password}@${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}`;
  return new Client({ connectionString: connString });
}

export function ensureDirectory(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

export function getLabels(rows, knownLabels = []) {
  const labels = new Set(knownLabels.filter(Boolean));
  for (const row of rows) {
    const normalizedLabel = row.recording_metadata?.normalized_label || row.label;
    if (normalizedLabel) {
      labels.add(normalizedLabel);
    }
  }

  for (const label of ['unknown', 'silence', 'noise']) {
    labels.add(label);
  }

  return Array.from(labels);
}

export function pseudonymizeSpeaker(row) {
  const salt = configValue('DATASET_SPEAKER_HASH_SALT', 'development-only-salt');
  const source =
    row.session_metadata?.device_id || row.session_id || row.topic_id || row.task_id || 'unknown-session';
  return `spk_${createHash('sha256').update(`${salt}:${source}`).digest('hex').slice(0, 12)}`;
}

export function pseudonymizeDeviceId(row) {
  const deviceId = row.session_metadata?.device_id;
  if (!deviceId) {
    return null;
  }

  const salt = configValue('DATASET_SPEAKER_HASH_SALT', 'development-only-salt');
  return `dev_${createHash('sha256').update(`${salt}:${deviceId}`).digest('hex').slice(0, 12)}`;
}

export function inferAudioRoot() {
  const activeStorageType = getActiveStorageType();

  if (process.env.DATASET_AUDIO_ROOT) {
    return process.env.DATASET_AUDIO_ROOT;
  }

  if (activeStorageType === 'local') {
    return getSoundRecordingsRoot();
  }

  if ((activeStorageType === 'aws-s3' || activeStorageType === 'r2') && process.env.AWS_BUCKET_NAME) {
    const prefix = getCollectionAudioPrefix();
    return `s3://${process.env.AWS_BUCKET_NAME}/${prefix}/`;
  }

  if (activeStorageType === 'r2' && process.env.CF_R2_BUCKET_NAME) {
    const prefix = getCollectionAudioPrefix();
    return `s3://${process.env.CF_R2_BUCKET_NAME}/${prefix}/`;
  }

  throw new Error('DATASET_AUDIO_ROOT must be configured for this storage mode.');
}

export function getSampleId(row, index) {
  if (row.recording_id) {
    return row.recording_id;
  }

  const language = row.language || configValue('DATASET_LANGUAGE', 'fi');
  return `${language}_${String(index + 1).padStart(6, '0')}`;
}

export function getDurationSec(row) {
  const durationSec = Number(row.duration_sec || row.recording_metadata?.duration_sec || 0);
  if (durationSec > 0) {
    return durationSec;
  }

  return 0.001;
}

export function buildDatasetMetadata(rows, labels, audioRoot) {
  return {
    dataset_id: configValue('DATASET_ID', 'short_finnish_responses'),
    version: configValue('DATASET_VERSION', 'v1'),
    language: configValue('DATASET_LANGUAGE', 'fi'),
    description: configValue(
      'DATASET_DESCRIPTION',
      'Short Finnish speech responses for voicemail keyword/audio classification'
    ),
    task: configValue('DATASET_TASK', 'short_response_classification'),
    audio_root: audioRoot,
    samples_manifest: 'metadata/samples.jsonl',
    audio_format: {
      container: 'wav',
      sample_rate_hz: 16000,
      channels: 1,
    },
    labels,
    created_at: new Date().toISOString(),
    source: 'speech-collector-session-export',
  };
}

export function buildSample(row, index, dataset) {
  const sampleId = getSampleId(row, index);
  const recordingMetadata = row.recording_metadata || {};
  const sessionMetadata = row.session_metadata || {};
  const normalizedLabel = recordingMetadata.normalized_label || row.label;
  const promptedWord = recordingMetadata.prompted_word || row.transcript;
  const language = recordingMetadata.language || row.language || dataset.language;
  const category = recordingMetadata.category || row.category || null;
  const sessionTechnical =
    sessionMetadata.technical && typeof sessionMetadata.technical === 'object'
      ? sessionMetadata.technical
      : {};
  const recordingTechnical =
    recordingMetadata.technical && typeof recordingMetadata.technical === 'object'
      ? recordingMetadata.technical
      : {};

  return {
    sample_id: sampleId,
    audio_path: row.storage_key,
    prompted_word: promptedWord,
    normalized_label: normalizedLabel,
    label: normalizedLabel,
    transcript: promptedWord,
    literal_transcript: recordingMetadata.literal_transcript ?? null,
    label_source: recordingMetadata.label_source || 'prompt_assumed',
    language,
    duration_sec: getDurationSec(row),
    split: row.recording_metadata?.split || null,
    source: 'real',
    speaker_id: pseudonymizeSpeaker(row),
    metadata: {
      schema_version: recordingMetadata.schema_version || sessionMetadata.schema_version || 'v1',
      device_id: pseudonymizeDeviceId(row),
      demographics: sessionMetadata.demographics || {},
      environment: sessionMetadata.environment || {},
      technical: {
        ...sessionTechnical,
        ...recordingTechnical,
      },
      processed_audio: recordingMetadata.processed_audio || null,
      collection: {
        topic_id: row.topic_id,
        task_id: row.task_id,
        session_id: row.session_id,
        session_status: row.session_status,
        submitted_at: row.submitted_at,
        storage_type: row.storage_type,
        category,
      },
      storage: {
        storage_type: row.storage_type,
        storage_key: row.storage_key,
        object_key: recordingMetadata.storage?.object_key || recordingMetadata.object_key || null,
        bucket_name: recordingMetadata.storage?.bucket_name || recordingMetadata.bucket_name || null,
      },
    },
  };
}

export async function expireStaleSessions(client) {
  await client.query(
    `
      UPDATE participant_sessions
      SET status = $2,
          exited_at = COALESCE(exited_at, NOW()),
          updated_at = NOW()
      WHERE status = $1
        AND last_activity_at < NOW() - ($3::integer * INTERVAL '1 hour')
    `,
    ['active', 'abandoned', getSessionIdleTimeoutHours()]
  );
}

export async function fetchLabelVocabulary(client) {
  const result = await client.query(`
    SELECT DISTINCT metadata->>'label' AS label
    FROM tasks
    WHERE metadata ? 'label'
    ORDER BY metadata->>'label' ASC
  `);

  return result.rows.map((row) => row.label).filter(Boolean);
}

export async function fetchCompletedRows(client) {
  const result = await client.query(`
    SELECT
      r.id AS recording_id,
      ps.id AS session_id,
      ps.status AS session_status,
      COALESCE(ps.metadata, '{}'::jsonb) AS session_metadata,
      ps.created_at AS session_created_at,
      r.task_id,
      r.storage_type,
      r.storage_key,
      r.duration_sec,
      r.submitted_at,
      COALESCE(r.metadata, '{}'::jsonb) AS recording_metadata,
      tk.text AS transcript,
      COALESCE(tk.metadata, '{}'::jsonb) AS task_metadata,
      t.id AS topic_id
    FROM recordings r
    JOIN participant_sessions ps
      ON ps.id = r.session_id
    JOIN tasks tk
      ON tk.id = r.task_id
    JOIN topics t
      ON t.id = tk.topic_id
    WHERE ps.status IN ('completed', 'abandoned')
    ORDER BY ps.created_at ASC, tk.task_idx ASC, r.submitted_at ASC
  `);

  return result.rows.map((row) => ({
    ...row,
    label: row.task_metadata?.label,
    language: row.task_metadata?.language,
    category: row.task_metadata?.category,
  }));
}

function normalizeStorageType(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
}

export function filterRowsForActiveStorage(rows, activeStorageType = getActiveStorageType()) {
  const exportRows = [];
  const skippedCounts = {};

  for (const row of rows) {
    const rowStorageType = normalizeStorageType(row.storage_type);
    if (rowStorageType === activeStorageType) {
      exportRows.push(row);
      continue;
    }

    skippedCounts[rowStorageType] = (skippedCounts[rowStorageType] || 0) + 1;
  }

  return {
    activeStorageType,
    exportRows,
    skippedCounts,
    skippedRowCount: rows.length - exportRows.length,
  };
}

export function buildStorageFilterSummary({
  activeStorageType,
  skippedCounts,
  skippedRowCount,
}) {
  if (!skippedRowCount) {
    return null;
  }

  const skippedSummary = Object.entries(skippedCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([storageType, count]) => `${storageType}=${count}`)
    .join(', ');

  return (
    `Skipped ${skippedRowCount} recording(s) whose storage_type did not match ` +
    `active STORAGE=${activeStorageType}: ${skippedSummary}.`
  );
}

export async function exportDataset() {
  config();
  const outputDir = path.resolve(
    configValue('DATASET_OUTPUT_DIR', './exports/short-finnish-responses/v1')
  );
  const metadataDir = path.join(outputDir, 'metadata');
  ensureDirectory(metadataDir);

  const client = createDbClient();
  await client.connect();

  try {
    await expireStaleSessions(client);
    const [rows, knownLabels] = await Promise.all([
      fetchCompletedRows(client),
      fetchLabelVocabulary(client),
    ]);

    const storageFilter = filterRowsForActiveStorage(rows);
    const storageSummary = buildStorageFilterSummary(storageFilter);
    if (storageSummary) {
      console.warn(storageSummary);
    }

    const audioRoot = inferAudioRoot();
    const labels = getLabels(storageFilter.exportRows, knownLabels);
    const dataset = buildDatasetMetadata(storageFilter.exportRows, labels, audioRoot);
    const samples = storageFilter.exportRows.map((row, index) => buildSample(row, index, dataset));

    writeFileSync(
      path.join(metadataDir, 'dataset.json'),
      `${JSON.stringify(dataset, null, 2)}\n`,
      'utf-8'
    );

    writeFileSync(
      path.join(metadataDir, 'samples.jsonl'),
      samples.map((sample) => JSON.stringify(sample)).join('\n') + (samples.length ? '\n' : ''),
      'utf-8'
    );

    console.log(
      `Exported ${samples.length} sample(s) to ${outputDir} using storage_type=${storageFilter.activeStorageType}.`
    );
  } finally {
    await client.end();
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentPath = fileURLToPath(import.meta.url);

if (entryPath === currentPath) {
  await exportDataset();
}
