import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

import {
  getAdminPasswordHash,
  getAdminSessionSecret,
  getAdminSessionTtlHours,
  getDatasetValidationFilter,
} from './config.js';
import { buildDatabuilderSidecar } from '../../scripts/aina/exportDatabuilderDataset.js';
import {
  getRecordingValidationStatus,
  isRowExportableByValidationFilter,
} from '../../scripts/aina/exportDataset.js';

const scryptAsync = promisify(scrypt);

const ADMIN_COOKIE_NAME = 'aina_admin_session';
const SESSION_ALGORITHM = 'sha256';
const PASSWORD_HASH_ALGORITHM = 'scrypt';
const DEFAULT_SCRYPT_OPTIONS = {
  n: 16384,
  r: 8,
  p: 1,
  keyLength: 64,
};
const MAX_ADMIN_LIMIT = 100;
const DEFAULT_ADMIN_LIMIT = 25;

export const ADMIN_VALIDATION_STATUSES = new Set([
  'pending',
  'validated',
  'needs_review',
  'rejected',
]);
export const ADMIN_LABEL_SOURCES = new Set(['prompt_assumed', 'user_confirmed', 'reviewed']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizePlainObject(value) {
  return isPlainObject(value) ? value : {};
}

function normalizeNullableString(value, fieldName) {
  if (value === null || value === undefined) {
    return { success: true, value: null };
  }

  if (typeof value !== 'string') {
    return {
      success: false,
      code: 'invalid_validation_payload',
      message: `${fieldName} must be a string or null.`,
    };
  }

  const trimmed = value.trim();
  return { success: true, value: trimmed || null };
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ADMIN_LIMIT;
  }

  return Math.min(parsed, MAX_ADMIN_LIMIT);
}

function normalizeOffset(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url');
}

function fromBase64UrlJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf-8'));
}

function getRequestIp(req) {
  return (
    normalizeOptionalString(req.headers['cf-connecting-ip']) ||
    normalizeOptionalString(req.headers['x-forwarded-for'])?.split(',')[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function safeTimingEqual(left, right) {
  const leftBuffer = Buffer.isBuffer(left) ? left : Buffer.from(String(left));
  const rightBuffer = Buffer.isBuffer(right) ? right : Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function signSessionPayload(encodedPayload, secret) {
  return createHmac(SESSION_ALGORITHM, secret).update(encodedPayload).digest('base64url');
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) {
      continue;
    }

    cookies[decodeURIComponent(rawName)] = decodeURIComponent(rawValue.join('='));
  }

  return cookies;
}

function isSecureRequest(req) {
  const forwardedProto = normalizeOptionalString(req.headers['x-forwarded-proto']);
  return req.secure || forwardedProto === 'https' || process.env.NODE_ENV === 'production';
}

function serializeAdminCookie(value, req, options = {}) {
  const parts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/api/admin',
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (Number.isFinite(options.maxAgeSeconds)) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }

  if (isSecureRequest(req)) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function getAdminConfig(options = {}) {
  const passwordHash =
    options.passwordHash === undefined ? getAdminPasswordHash() : options.passwordHash;
  const sessionSecret =
    options.sessionSecret === undefined ? getAdminSessionSecret() : options.sessionSecret;
  const ttlHours = options.sessionTtlHours || getAdminSessionTtlHours();

  return {
    passwordHash,
    sessionSecret,
    ttlHours,
    configured: Boolean(passwordHash && sessionSecret),
  };
}

function createAdminSessionToken(config, now = Date.now()) {
  const ttlMs = config.ttlHours * 60 * 60 * 1000;
  const payload = {
    iat: now,
    exp: now + ttlMs,
    nonce: randomBytes(16).toString('base64url'),
  };
  const encodedPayload = toBase64UrlJson(payload);
  const signature = signSessionPayload(encodedPayload, config.sessionSecret);
  return `${encodedPayload}.${signature}`;
}

function verifyAdminSessionToken(token, config, now = Date.now()) {
  if (!config.configured || !token || !token.includes('.')) {
    return false;
  }

  const [encodedPayload, signature] = token.split('.');
  const expectedSignature = signSessionPayload(encodedPayload, config.sessionSecret);
  if (!safeTimingEqual(signature, expectedSignature)) {
    return false;
  }

  try {
    const payload = fromBase64UrlJson(encodedPayload);
    return Number.isFinite(payload.exp) && payload.exp > now;
  } catch (_error) {
    return false;
  }
}

export async function createAdminPasswordHash(password, options = {}) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Admin password must be a non-empty string.');
  }

  const scryptOptions = {
    ...DEFAULT_SCRYPT_OPTIONS,
    ...options,
  };
  const salt = randomBytes(16).toString('base64url');
  const derivedKey = await scryptAsync(password, salt, scryptOptions.keyLength, {
    N: scryptOptions.n,
    r: scryptOptions.r,
    p: scryptOptions.p,
  });

  return [
    PASSWORD_HASH_ALGORITHM,
    scryptOptions.n,
    scryptOptions.r,
    scryptOptions.p,
    scryptOptions.keyLength,
    salt,
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyAdminPassword(password, passwordHash) {
  if (typeof password !== 'string' || typeof passwordHash !== 'string') {
    return false;
  }

  const [algorithm, rawN, rawR, rawP, rawKeyLength, salt, expectedHash] = passwordHash.split('$');
  if (algorithm !== PASSWORD_HASH_ALGORITHM || !salt || !expectedHash) {
    return false;
  }

  const n = Number.parseInt(rawN, 10);
  const r = Number.parseInt(rawR, 10);
  const p = Number.parseInt(rawP, 10);
  const keyLength = Number.parseInt(rawKeyLength, 10);
  if (![n, r, p, keyLength].every((value) => Number.isFinite(value) && value > 0)) {
    return false;
  }

  try {
    const derivedKey = await scryptAsync(password, salt, keyLength, { N: n, r, p });
    return safeTimingEqual(derivedKey, Buffer.from(expectedHash, 'base64url'));
  } catch (_error) {
    return false;
  }
}

export function getValidationStatusFromMetadata(metadata) {
  const validation = normalizePlainObject(metadata?.validation);
  const status = normalizeOptionalString(validation.status);
  return ADMIN_VALIDATION_STATUSES.has(status) ? status : 'pending';
}

function getValidationFromMetadata(metadata) {
  const validation = normalizePlainObject(metadata?.validation);
  const status = getValidationStatusFromMetadata(metadata);
  return {
    status,
    validated_at: normalizeOptionalString(validation.validated_at),
    notes: normalizeOptionalString(validation.notes),
  };
}

function getProcessedAudioStatus(processedAudio) {
  if (!isPlainObject(processedAudio)) {
    return 'missing';
  }

  if (
    processedAudio.sample_rate_hz === 16000 &&
    processedAudio.channel_count === 1 &&
    processedAudio.encoding === 'pcm_s16le'
  ) {
    return 'ready';
  }

  return 'wrong_format';
}

function getRowNormalizedLabel(row, recordingMetadata, taskMetadata) {
  return (
    normalizeOptionalString(recordingMetadata.normalized_label) ||
    normalizeOptionalString(taskMetadata.label) ||
    normalizeOptionalString(row.label)
  );
}

function getRowPhraseId(row, recordingMetadata, taskMetadata) {
  return (
    normalizeOptionalString(recordingMetadata.phrase_id) ||
    normalizeOptionalString(taskMetadata.phrase_id) ||
    normalizeOptionalString(taskMetadata.prompt_id) ||
    normalizeOptionalString(row.task_id)
  );
}

function getRowSemanticLabel(row, recordingMetadata, taskMetadata) {
  return (
    normalizeOptionalString(recordingMetadata.semantic_label) ||
    normalizeOptionalString(taskMetadata.semantic_label) ||
    normalizeOptionalString(row.semantic_label)
  );
}

function getRowCategory(row, recordingMetadata, taskMetadata) {
  return (
    normalizeOptionalString(recordingMetadata.category) ||
    normalizeOptionalString(taskMetadata.category) ||
    normalizeOptionalString(row.category)
  );
}

function getRowLanguage(row, recordingMetadata, taskMetadata) {
  return (
    normalizeOptionalString(recordingMetadata.language) ||
    normalizeOptionalString(taskMetadata.language) ||
    normalizeOptionalString(row.language)
  );
}

function mapAdminSample(row, options = {}) {
  const recordingMetadata = normalizePlainObject(row.recording_metadata);
  const sessionMetadata = normalizePlainObject(row.session_metadata);
  const taskMetadata = normalizePlainObject(row.task_metadata);
  const topicMetadata = normalizePlainObject(row.topic_metadata);
  const storageMetadata = normalizePlainObject(recordingMetadata.storage);
  const validation = getValidationFromMetadata(recordingMetadata);
  const processedAudio = isPlainObject(recordingMetadata.processed_audio)
    ? recordingMetadata.processed_audio
    : null;
  const promptedWord =
    normalizeOptionalString(recordingMetadata.prompted_word) ||
    normalizeOptionalString(row.prompted_word) ||
    normalizeOptionalString(row.transcript);
  const phraseId = getRowPhraseId(row, recordingMetadata, taskMetadata);
  const normalizedLabel = getRowNormalizedLabel(row, recordingMetadata, taskMetadata);
  const semanticLabel = getRowSemanticLabel(row, recordingMetadata, taskMetadata);
  const category = getRowCategory(row, recordingMetadata, taskMetadata);
  const language = getRowLanguage(row, recordingMetadata, taskMetadata);

  const sample = {
    id: row.recording_id,
    sample_id: row.recording_id,
    recording_id: row.recording_id,
    session_id: row.session_id,
    task_id: row.task_id,
    topic_id: row.topic_id,
    submitted_at: row.submitted_at,
    duration_sec: row.duration_sec,
    session_status: row.session_status,
    prompted_word: promptedWord,
    phrase_id: phraseId,
    normalized_label: normalizedLabel,
    semantic_label: semanticLabel,
    category,
    language,
    literal_transcript: recordingMetadata.literal_transcript ?? null,
    label_source: recordingMetadata.label_source || 'prompt_assumed',
    validation,
    processed_audio: processedAudio,
    processed_audio_status: getProcessedAudioStatus(processedAudio),
    storage: {
      storage_type: row.storage_type,
      storage_key: row.storage_key,
      object_key:
        normalizeOptionalString(storageMetadata.object_key) ||
        normalizeOptionalString(recordingMetadata.object_key) ||
        null,
      metadata_object_key:
        normalizeOptionalString(storageMetadata.metadata_object_key) ||
        normalizeOptionalString(recordingMetadata.metadata_object_key) ||
        null,
      bucket_name:
        normalizeOptionalString(storageMetadata.bucket_name) ||
        normalizeOptionalString(recordingMetadata.bucket_name) ||
        null,
    },
  };

  if (options.detail) {
    sample.metadata = {
      recording: recordingMetadata,
      session: sessionMetadata,
      task: taskMetadata,
      topic: topicMetadata,
    };
    sample.read_only = {
      device_id: sessionMetadata.device_id || null,
      speaker_id: null,
      demographics: normalizePlainObject(sessionMetadata.demographics),
      environment: normalizePlainObject(sessionMetadata.environment),
      technical: {
        session: normalizePlainObject(sessionMetadata.technical),
        recording: normalizePlainObject(recordingMetadata.technical),
      },
      storage_key: row.storage_key,
      object_key: sample.storage.object_key,
      bucket_name: sample.storage.bucket_name,
      processed_audio: processedAudio,
    };
    sample.editable = {
      literal_transcript: sample.literal_transcript,
      label_source: sample.label_source,
      validation,
    };
  }

  return sample;
}

function buildSampleSelectSql({ forUpdate = false } = {}) {
  return `
    SELECT
      r.id::text AS recording_id,
      r.session_id::text AS session_id,
      r.task_id,
      r.storage_type,
      r.storage_key,
      r.duration_sec,
      r.submitted_at,
      COALESCE(r.metadata, '{}'::jsonb) AS recording_metadata,
      ps.status AS session_status,
      COALESCE(ps.metadata, '{}'::jsonb) AS session_metadata,
      ps.created_at AS session_created_at,
      tk.text AS transcript,
      tk.text AS prompted_word,
      COALESCE(tk.metadata, '{}'::jsonb) AS task_metadata,
      tk.metadata->>'label' AS label,
      tk.metadata->>'language' AS language,
      tk.metadata->>'category' AS category,
      tk.metadata->>'semantic_label' AS semantic_label,
      t.id AS topic_id,
      t.name AS topic_name,
      COALESCE(t.metadata, '{}'::jsonb) AS topic_metadata
    FROM recordings r
    JOIN participant_sessions ps
      ON ps.id = r.session_id
    JOIN tasks tk
      ON tk.id = r.task_id
    JOIN topics t
      ON t.id = tk.topic_id
    WHERE r.id = $1
    ${forUpdate ? 'FOR UPDATE OF r' : ''}
  `;
}

function buildAllRowsSql() {
  return `
    SELECT
      r.id::text AS recording_id,
      r.session_id::text AS session_id,
      r.task_id,
      r.storage_type,
      r.storage_key,
      r.duration_sec,
      r.submitted_at,
      COALESCE(r.metadata, '{}'::jsonb) AS recording_metadata,
      ps.status AS session_status,
      COALESCE(ps.metadata, '{}'::jsonb) AS session_metadata,
      ps.created_at AS session_created_at,
      tk.text AS transcript,
      tk.text AS prompted_word,
      COALESCE(tk.metadata, '{}'::jsonb) AS task_metadata,
      tk.metadata->>'label' AS label,
      tk.metadata->>'language' AS language,
      tk.metadata->>'category' AS category,
      tk.metadata->>'semantic_label' AS semantic_label,
      t.id AS topic_id,
      t.name AS topic_name,
      COALESCE(t.metadata, '{}'::jsonb) AS topic_metadata
    FROM recordings r
    JOIN participant_sessions ps
      ON ps.id = r.session_id
    JOIN tasks tk
      ON tk.id = r.task_id
    JOIN topics t
      ON t.id = tk.topic_id
  `;
}

function incrementCount(target, key) {
  const normalizedKey = key || '(missing)';
  target[normalizedKey] = (target[normalizedKey] || 0) + 1;
}

function buildStatusCounts(rows) {
  const counts = {
    pending: 0,
    validated: 0,
    needs_review: 0,
    rejected: 0,
  };

  for (const row of rows) {
    const status = getRecordingValidationStatus(row);
    counts[status] = (counts[status] || 0) + 1;
  }

  return counts;
}

function buildReadiness(rows, activeStorageType, validationFilter) {
  const status_counts = buildStatusCounts(rows);
  let missing_metadata_count = 0;
  let missing_processed_audio_count = 0;
  let wrong_processed_audio_count = 0;
  let missing_phrase_id_count = 0;
  let missing_semantic_label_count = 0;
  let missing_literal_transcript_key_count = 0;
  let classifier_ready_validated_count = 0;
  let exportable_count = 0;
  let rejected_count = 0;

  for (const row of rows) {
    const metadata = normalizePlainObject(row.recording_metadata);
    const taskMetadata = normalizePlainObject(row.task_metadata);
    const status = getRecordingValidationStatus(row);
    const processedStatus = getProcessedAudioStatus(metadata.processed_audio);

    if (Object.keys(metadata).length === 0) {
      missing_metadata_count += 1;
    }

    if (!Object.hasOwn(metadata, 'literal_transcript')) {
      missing_literal_transcript_key_count += 1;
    }

    if (processedStatus === 'missing') {
      missing_processed_audio_count += 1;
    } else if (processedStatus === 'wrong_format') {
      wrong_processed_audio_count += 1;
    }

    if (!getRowPhraseId(row, metadata, taskMetadata)) {
      missing_phrase_id_count += 1;
    }

    if (!getRowSemanticLabel(row, metadata, taskMetadata)) {
      missing_semantic_label_count += 1;
    }

    if (status === 'rejected') {
      rejected_count += 1;
    }

    if (status === 'validated' && processedStatus === 'ready') {
      classifier_ready_validated_count += 1;
    }

    if (
      ['completed', 'abandoned'].includes(row.session_status) &&
      row.storage_type === activeStorageType &&
      isRowExportableByValidationFilter(row, validationFilter)
    ) {
      exportable_count += 1;
    }
  }

  return {
    total_recordings: rows.length,
    status_counts,
    pending_count: status_counts.pending || 0,
    validated_count: status_counts.validated || 0,
    needs_review_count: status_counts.needs_review || 0,
    rejected_count,
    classifier_ready_validated_count,
    exportable_count,
    validation_filter: validationFilter,
    missing_metadata_count,
    missing_processed_audio_count,
    wrong_processed_audio_count,
    missing_phrase_id_count,
    missing_semantic_label_count,
    missing_literal_transcript_key_count,
  };
}

function buildValidationMetadata(existingMetadata, payload, now) {
  const metadata = { ...normalizePlainObject(existingMetadata) };
  const validationInput = normalizePlainObject(payload.validation);

  if (Object.hasOwn(payload, 'literal_transcript')) {
    const result = normalizeNullableString(payload.literal_transcript, 'literal_transcript');
    if (!result.success) {
      return result;
    }
    metadata.literal_transcript = result.value;
  }

  if (Object.hasOwn(payload, 'label_source')) {
    const labelSource = normalizeOptionalString(payload.label_source);
    if (!ADMIN_LABEL_SOURCES.has(labelSource)) {
      return {
        success: false,
        code: 'invalid_validation_payload',
        message: 'label_source is invalid.',
      };
    }
    metadata.label_source = labelSource;
  }

  const existingValidation = normalizePlainObject(metadata.validation);
  const requestedStatus =
    normalizeOptionalString(validationInput.status) ||
    normalizeOptionalString(payload.status) ||
    getValidationStatusFromMetadata(metadata);

  if (!ADMIN_VALIDATION_STATUSES.has(requestedStatus)) {
    return {
      success: false,
      code: 'invalid_validation_payload',
      message: 'validation.status is invalid.',
    };
  }

  let notes = normalizeOptionalString(existingValidation.notes);
  if (Object.hasOwn(validationInput, 'notes') || Object.hasOwn(payload, 'notes')) {
    const result = normalizeNullableString(
      Object.hasOwn(validationInput, 'notes') ? validationInput.notes : payload.notes,
      'validation.notes'
    );
    if (!result.success) {
      return result;
    }
    notes = result.value;
  }

  metadata.validation = {
    status: requestedStatus,
    validated_at:
      requestedStatus === 'validated'
        ? normalizeOptionalString(existingValidation.validated_at) || now
        : null,
    notes,
  };

  if (!Object.hasOwn(metadata, 'literal_transcript')) {
    metadata.literal_transcript = null;
  }

  if (!metadata.label_source) {
    metadata.label_source = 'prompt_assumed';
  }

  return {
    success: true,
    metadata,
  };
}

function attachSidecarStorageMetadata(row, fileStorage, metadata) {
  const sidecarInfo = fileStorage.getMetadataSidecarInfo({
    ...row,
    recording_metadata: metadata,
  });
  const storageMetadata = normalizePlainObject(metadata.storage);

  return {
    ...metadata,
    storage: {
      ...storageMetadata,
      object_key:
        normalizeOptionalString(storageMetadata.object_key) ||
        normalizeOptionalString(metadata.object_key) ||
        fileStorage.getRecordingObjectKey({
          ...row,
          recording_metadata: metadata,
        }),
      bucket_name:
        normalizeOptionalString(storageMetadata.bucket_name) ||
        normalizeOptionalString(metadata.bucket_name) ||
        sidecarInfo.bucket_name ||
        null,
      metadata_object_key: sidecarInfo.metadata_object_key,
    },
  };
}

export class AdminService {
  constructor({ provider, fileStorage, validationFilter = getDatasetValidationFilter() }) {
    this.provider = provider;
    this.fileStorage = fileStorage;
    this.validationFilter = validationFilter;
  }

  async withClient(run) {
    if (!this.provider || typeof this.provider.withClient !== 'function') {
      throw new Error('Admin data access requires a provider with withClient().');
    }

    return this.provider.withClient(run);
  }

  async fetchSampleRow(client, id, options = {}) {
    const result = await client.query(buildSampleSelectSql(options), [id]);
    return result.rows[0] || null;
  }

  async fetchAllRows(client) {
    const result = await client.query(`${buildAllRowsSql()} ORDER BY r.submitted_at DESC`);
    return result.rows;
  }

  async listSamples(query = {}) {
    const limit = normalizeLimit(query.limit);
    const offset = normalizeOffset(query.offset);
    const values = [];
    const filters = [];

    const status = normalizeOptionalString(query.status);
    if (status && status !== 'all') {
      if (!ADMIN_VALIDATION_STATUSES.has(status)) {
        return {
          success: false,
          code: 'invalid_filter',
          message: 'validation status filter is invalid.',
        };
      }

      values.push(status);
      filters.push(`COALESCE(r.metadata->'validation'->>'status', 'pending') = $${values.length}`);
    }

    const category = normalizeOptionalString(query.category);
    if (category) {
      values.push(category);
      filters.push(
        `COALESCE(r.metadata->>'category', tk.metadata->>'category') = $${values.length}`
      );
    }

    const label = normalizeOptionalString(query.label);
    if (label) {
      values.push(label);
      filters.push(`(
        COALESCE(r.metadata->>'normalized_label', tk.metadata->>'label') = $${values.length}
        OR COALESCE(r.metadata->>'semantic_label', tk.metadata->>'semantic_label') = $${values.length}
      )`);
    }

    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    values.push(limit, offset);
    const limitIndex = values.length - 1;
    const offsetIndex = values.length;

    return this.withClient(async (client) => {
      const rowsResult = await client.query(
        `
          ${buildAllRowsSql()}
          ${whereSql}
          ORDER BY
            CASE COALESCE(r.metadata->'validation'->>'status', 'pending')
              WHEN 'pending' THEN 0
              WHEN 'needs_review' THEN 1
              WHEN 'validated' THEN 2
              WHEN 'rejected' THEN 3
              ELSE 4
            END,
            r.submitted_at DESC
          LIMIT $${limitIndex}
          OFFSET $${offsetIndex}
        `,
        values
      );
      const countResult = await client.query(
        `
          SELECT COUNT(*)::integer AS total
          FROM recordings r
          JOIN participant_sessions ps
            ON ps.id = r.session_id
          JOIN tasks tk
            ON tk.id = r.task_id
          ${whereSql}
        `,
        values.slice(0, values.length - 2)
      );

      return {
        success: true,
        samples: rowsResult.rows.map((row) => mapAdminSample(row)),
        pagination: {
          limit,
          offset,
          total: countResult.rows[0]?.total || 0,
          has_next: offset + rowsResult.rows.length < (countResult.rows[0]?.total || 0),
          has_previous: offset > 0,
        },
      };
    });
  }

  async getSample(id) {
    return this.withClient(async (client) => {
      const row = await this.fetchSampleRow(client, id);
      if (!row) {
        return {
          success: false,
          code: 'sample_not_found',
          message: 'Sample was not found.',
        };
      }

      return {
        success: true,
        sample: mapAdminSample(row, { detail: true }),
      };
    });
  }

  async getAudioStream(id, rangeHeader) {
    return this.withClient(async (client) => {
      const row = await this.fetchSampleRow(client, id);
      if (!row) {
        return {
          success: false,
          code: 'sample_not_found',
          message: 'Sample was not found.',
        };
      }

      return {
        success: true,
        audio: await this.fileStorage.getRecordingAudioStream(row, { rangeHeader }),
      };
    });
  }

  async saveValidation(id, payload = {}) {
    return this.withClient(async (client) => {
      await client.query('BEGIN');

      try {
        const row = await this.fetchSampleRow(client, id, { forUpdate: true });
        if (!row) {
          await client.query('ROLLBACK');
          return {
            success: false,
            code: 'sample_not_found',
            message: 'Sample was not found.',
          };
        }

        const updateResult = buildValidationMetadata(
          row.recording_metadata,
          normalizePlainObject(payload),
          new Date().toISOString()
        );
        if (!updateResult.success) {
          await client.query('ROLLBACK');
          return updateResult;
        }

        const nextMetadata = attachSidecarStorageMetadata(row, this.fileStorage, updateResult.metadata);
        const updatedRow = {
          ...row,
          recording_metadata: nextMetadata,
        };
        const sidecar = buildDatabuilderSidecar(updatedRow);
        const sidecarWrite = await this.fileStorage.writeJsonSidecar(updatedRow, sidecar);

        await client.query(
          `
            UPDATE recordings
            SET metadata = $2::jsonb
            WHERE id = $1
          `,
          [id, nextMetadata]
        );
        await client.query('COMMIT');

        return {
          success: true,
          sample: mapAdminSample(updatedRow, { detail: true }),
          sidecar: {
            storage_type: sidecarWrite.storage_type,
            storage_key: sidecarWrite.storage_key,
            object_key: sidecarWrite.object_key,
            metadata_object_key: sidecarWrite.metadata_object_key,
            bucket_name: sidecarWrite.bucket_name,
          },
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    });
  }

  async getSummary() {
    return this.withClient(async (client) => {
      const rows = await this.fetchAllRows(client);
      const readiness = buildReadiness(rows, this.fileStorage.storageType, this.validationFilter);

      return {
        success: true,
        summary: {
          total_recordings: rows.length,
          pending: readiness.pending_count,
          validated: readiness.validated_count,
          needs_review: readiness.needs_review_count,
          rejected: readiness.rejected_count,
          classifier_ready_validated: readiness.classifier_ready_validated_count,
          exportable: readiness.exportable_count,
          missing_metadata: readiness.missing_metadata_count,
          missing_processed_audio: readiness.missing_processed_audio_count,
          wrong_processed_audio: readiness.wrong_processed_audio_count,
        },
      };
    });
  }

  async getDistributions() {
    return this.withClient(async (client) => {
      const rows = await this.fetchAllRows(client);
      const distributions = {
        category: {},
        normalized_label: {},
        semantic_label: {},
        validation_status: {},
      };

      for (const row of rows) {
        const recordingMetadata = normalizePlainObject(row.recording_metadata);
        const taskMetadata = normalizePlainObject(row.task_metadata);
        incrementCount(distributions.category, getRowCategory(row, recordingMetadata, taskMetadata));
        incrementCount(
          distributions.normalized_label,
          getRowNormalizedLabel(row, recordingMetadata, taskMetadata)
        );
        incrementCount(
          distributions.semantic_label,
          getRowSemanticLabel(row, recordingMetadata, taskMetadata)
        );
        incrementCount(distributions.validation_status, getRecordingValidationStatus(row));
      }

      return {
        success: true,
        distributions,
      };
    });
  }

  async getExportReadiness() {
    return this.withClient(async (client) => {
      const rows = await this.fetchAllRows(client);
      return {
        success: true,
        readiness: buildReadiness(rows, this.fileStorage.storageType, this.validationFilter),
      };
    });
  }

  async getHealth() {
    return this.withClient(async (client) => {
      const rows = await this.fetchAllRows(client);
      const readiness = buildReadiness(rows, this.fileStorage.storageType, this.validationFilter);
      const categories = new Set();
      const categoriesWithRecordings = new Set();
      const warnings = [];

      const v2TaskResult = await client.query(
        `
          SELECT
            COUNT(*)::integer AS task_count,
            COUNT(*) FILTER (
              WHERE NOT (
                COALESCE(metadata, '{}'::jsonb) ? 'phrase_id'
                AND COALESCE(metadata, '{}'::jsonb) ? 'semantic_label'
                AND COALESCE(metadata, '{}'::jsonb) ? 'category'
              )
            )::integer AS missing_v2_metadata_count
          FROM tasks
          WHERE COALESCE(metadata, '{}'::jsonb)->>'dataset_version' = 'v2'
             OR id LIKE 'short_finnish_responses_v2_%'
        `
      );

      const categoryResult = await client.query(`
        SELECT DISTINCT metadata->>'category' AS category
        FROM tasks
        WHERE COALESCE(metadata, '{}'::jsonb) ? 'category'
        ORDER BY metadata->>'category'
      `);

      for (const row of categoryResult.rows) {
        if (row.category) {
          categories.add(row.category);
        }
      }

      for (const row of rows) {
        const recordingMetadata = normalizePlainObject(row.recording_metadata);
        const taskMetadata = normalizePlainObject(row.task_metadata);
        const category = getRowCategory(row, recordingMetadata, taskMetadata);
        if (category) {
          categoriesWithRecordings.add(category);
        }
      }

      const zeroRecordingCategories = [...categories].filter(
        (category) => !categoriesWithRecordings.has(category)
      );
      const v2TaskCount = v2TaskResult.rows[0]?.task_count || 0;
      const missingV2MetadataCount = v2TaskResult.rows[0]?.missing_v2_metadata_count || 0;
      const unexpectedStorageCount = rows.filter(
        (row) => row.storage_type !== this.fileStorage.storageType
      ).length;

      if (readiness.missing_metadata_count) {
        warnings.push({
          code: 'missing_metadata',
          count: readiness.missing_metadata_count,
          message: 'Recordings linked to empty recording metadata exist.',
        });
      }
      if (readiness.missing_phrase_id_count) {
        warnings.push({
          code: 'missing_phrase_id',
          count: readiness.missing_phrase_id_count,
          message: 'Recordings missing phrase_id exist.',
        });
      }
      if (readiness.missing_semantic_label_count) {
        warnings.push({
          code: 'missing_semantic_label',
          count: readiness.missing_semantic_label_count,
          message: 'Recordings missing semantic_label exist.',
        });
      }
      if (readiness.missing_literal_transcript_key_count) {
        warnings.push({
          code: 'missing_literal_transcript_key',
          count: readiness.missing_literal_transcript_key_count,
          message: 'Recordings missing literal_transcript key exist.',
        });
      }
      if (readiness.missing_processed_audio_count) {
        warnings.push({
          code: 'missing_processed_audio',
          count: readiness.missing_processed_audio_count,
          message: 'Recordings missing processed_audio exist.',
        });
      }
      if (readiness.wrong_processed_audio_count) {
        warnings.push({
          code: 'wrong_processed_audio',
          count: readiness.wrong_processed_audio_count,
          message: 'Recordings with non-16kHz mono pcm_s16le processed_audio exist.',
        });
      }
      if (v2TaskCount === 0) {
        warnings.push({
          code: 'no_v2_tasks',
          count: 0,
          message: 'DB has no v2 tasks seeded.',
        });
      }
      if (missingV2MetadataCount) {
        warnings.push({
          code: 'tasks_missing_v2_phrase_metadata',
          count: missingV2MetadataCount,
          message: 'Tasks missing v2 phrase metadata exist.',
        });
      }
      if (zeroRecordingCategories.length) {
        warnings.push({
          code: 'categories_with_zero_recordings',
          count: zeroRecordingCategories.length,
          categories: zeroRecordingCategories,
          message: 'Some seeded categories have zero recordings.',
        });
      }
      if (unexpectedStorageCount) {
        warnings.push({
          code: 'storage_type_unexpected',
          count: unexpectedStorageCount,
          message: 'Some recordings do not match the active storage mode.',
        });
      }

      return {
        success: true,
        health: {
          ready: true,
          backend_time: new Date().toISOString(),
          app_environment: process.env.NODE_ENV || 'development',
          storage_mode: this.fileStorage.storageType,
          validation_filter: this.validationFilter,
          warnings,
        },
      };
    });
  }
}

export function createAdminRouter(options = {}) {
  const adminService = options.adminService;
  const loginAttempts = new Map();

  function sendNotConfigured(res) {
    return res.status(503).json({
      success: false,
      code: 'admin_not_configured',
      message: 'Admin authentication is not configured.',
    });
  }

  function requireConfigured(req, res) {
    const config = getAdminConfig(options);
    if (!config.configured) {
      sendNotConfigured(res);
      return null;
    }

    return config;
  }

  function isAuthenticated(req, config) {
    const cookies = parseCookies(req.headers.cookie || '');
    return verifyAdminSessionToken(cookies[ADMIN_COOKIE_NAME], config);
  }

  function requireAdmin(req, res) {
    const config = requireConfigured(req, res);
    if (!config) {
      return false;
    }

    if (!isAuthenticated(req, config)) {
      res.status(401).json({
        success: false,
        code: 'admin_auth_required',
        message: 'Admin authentication is required.',
      });
      return false;
    }

    return true;
  }

  function recordLoginFailure(req) {
    if (options.disableThrottle) {
      return;
    }

    const key = getRequestIp(req);
    const now = Date.now();
    const entry = loginAttempts.get(key) || { count: 0, blockedUntil: 0 };
    const count = entry.blockedUntil > now ? entry.count + 1 : entry.count + 1;
    loginAttempts.set(key, {
      count,
      blockedUntil: count >= 5 ? now + Math.min(count * 500, 5000) : 0,
    });
  }

  async function maybeThrottle(req) {
    if (options.disableThrottle) {
      return;
    }

    const entry = loginAttempts.get(getRequestIp(req));
    const now = Date.now();
    if (entry?.blockedUntil > now) {
      await delay(entry.blockedUntil - now);
    }
  }

  function clearLoginFailures(req) {
    loginAttempts.delete(getRequestIp(req));
  }

  async function handleAdminService(req, res, run) {
    if (!requireAdmin(req, res)) {
      return;
    }

    try {
      const result = await run(adminService);
      if (!result.success) {
        const status = result.code === 'sample_not_found' ? 404 : 400;
        res.status(status).json(result);
        return;
      }

      res.json(result);
    } catch (error) {
      console.error('Admin API error:', error);
      res.status(500).json({
        success: false,
        code: 'admin_request_failed',
        message: 'Admin request failed.',
      });
    }
  }

  return {
    routes(app) {
      app.post('/api/admin/login', async (req, res) => {
        const config = requireConfigured(req, res);
        if (!config) {
          return;
        }

        await maybeThrottle(req);
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const ok = await verifyAdminPassword(password, config.passwordHash);
        if (!ok) {
          recordLoginFailure(req);
          res.status(401).json({
            success: false,
            code: 'invalid_admin_login',
            message: 'Invalid admin credentials.',
          });
          return;
        }

        clearLoginFailures(req);
        const token = createAdminSessionToken(config);
        res.setHeader(
          'Set-Cookie',
          serializeAdminCookie(token, req, { maxAgeSeconds: config.ttlHours * 60 * 60 })
        );
        res.json({
          success: true,
          authenticated: true,
          ttl_hours: config.ttlHours,
        });
      });

      app.post('/api/admin/logout', (req, res) => {
        res.setHeader('Set-Cookie', serializeAdminCookie('', req, { maxAgeSeconds: 0 }));
        res.json({ success: true });
      });

      app.get('/api/admin/me', (req, res) => {
        const config = requireConfigured(req, res);
        if (!config) {
          return;
        }

        if (!isAuthenticated(req, config)) {
          res.status(401).json({
            success: false,
            authenticated: false,
            code: 'admin_auth_required',
            message: 'Admin authentication is required.',
          });
          return;
        }

        res.json({
          success: true,
          authenticated: true,
          admin: {
            role: 'project_member',
          },
        });
      });

      app.get('/api/admin/samples', (req, res) =>
        handleAdminService(req, res, (service) => service.listSamples(req.query))
      );

      app.get('/api/admin/samples/:id', (req, res) =>
        handleAdminService(req, res, (service) => service.getSample(req.params.id))
      );

      app.get('/api/admin/samples/:id/audio', async (req, res) => {
        if (!requireAdmin(req, res)) {
          return;
        }

        try {
          const result = await adminService.getAudioStream(req.params.id, req.headers.range);
          if (!result.success) {
            res.status(result.code === 'sample_not_found' ? 404 : 400).json(result);
            return;
          }

          const { audio } = result;
          res.status(audio.statusCode || 200);
          res.setHeader('Content-Type', audio.contentType || 'audio/wav');
          if (audio.contentLength !== undefined) {
            res.setHeader('Content-Length', String(audio.contentLength));
          }
          for (const [name, value] of Object.entries(audio.headers || {})) {
            res.setHeader(name, value);
          }
          audio.stream.pipe(res);
        } catch (error) {
          console.error('Admin audio stream error:', error);
          res.status(500).json({
            success: false,
            code: 'admin_audio_failed',
            message: 'Could not stream admin audio.',
          });
        }
      });

      app.post('/api/admin/samples/:id/validation', (req, res) =>
        handleAdminService(req, res, (service) => service.saveValidation(req.params.id, req.body))
      );

      app.get('/api/admin/summary', (req, res) =>
        handleAdminService(req, res, (service) => service.getSummary())
      );

      app.get('/api/admin/distributions', (req, res) =>
        handleAdminService(req, res, (service) => service.getDistributions())
      );

      app.get('/api/admin/export-readiness', (req, res) =>
        handleAdminService(req, res, (service) => service.getExportReadiness())
      );

      app.get('/api/admin/health', (req, res) =>
        handleAdminService(req, res, (service) => service.getHealth())
      );
    },
  };
}

export function createDefaultAdminService(provider, fileStorage) {
  return new AdminService({ provider, fileStorage });
}
