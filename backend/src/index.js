import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import { TaskProvider } from './taskProvider.js';
import { FileStorage, RecordingTooLongError } from './fileStorage.js';
import {
  getDbConnectionString,
  getMaxUploadBytes,
  getSessionIdleTimeoutHours,
  getTurnstileSecretKey,
} from './config.js';

const DEFAULT_PORT = 8000;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const LABEL_SOURCES = new Set(['prompt_assumed', 'user_confirmed', 'reviewed']);

export function normalizeSessionToken(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeLabelSource(value) {
  return typeof value === 'string' && LABEL_SOURCES.has(value) ? value : 'prompt_assumed';
}

export function parseUploadMetadata(rawMetadata) {
  if (rawMetadata === undefined || rawMetadata === null || rawMetadata === '') {
    return { success: true, metadata: {} };
  }

  if (typeof rawMetadata !== 'string') {
    return {
      success: false,
      code: 'invalid_metadata',
      message: 'metadata must be valid JSON.',
    };
  }

  try {
    const parsed = JSON.parse(rawMetadata);
    if (!isPlainObject(parsed)) {
      return {
        success: false,
        code: 'invalid_metadata',
        message: 'metadata must be a JSON object.',
      };
    }

    return { success: true, metadata: parsed };
  } catch (_error) {
    return {
      success: false,
      code: 'invalid_metadata',
      message: 'metadata must be valid JSON.',
    };
  }
}

export function buildRecordingMetadata(frontendMetadata, task, submittedAt, storageDetails = {}) {
  const metadata = isPlainObject(frontendMetadata) ? frontendMetadata : {};
  const taskMetadata = isPlainObject(task?.metadata) ? task.metadata : {};
  const literalTranscript = metadata.literal_transcript;

  if (
    literalTranscript !== undefined &&
    literalTranscript !== null &&
    typeof literalTranscript !== 'string'
  ) {
    return {
      success: false,
      code: 'invalid_metadata',
      message: 'literal_transcript must be a string or null.',
    };
  }

  const normalizedLabel = normalizeOptionalString(taskMetadata.label) || normalizeOptionalString(task?.text);

  return {
    success: true,
    metadata: {
      schema_version: 'v1',
      timestamp: submittedAt,
      phrase_id:
        normalizeOptionalString(taskMetadata.phrase_id) ||
        normalizeOptionalString(taskMetadata.prompt_id) ||
        normalizeOptionalString(task?.id),
      semantic_label: normalizeOptionalString(taskMetadata.semantic_label),
      prompted_word: normalizeOptionalString(task?.text),
      normalized_label: normalizedLabel,
      literal_transcript: normalizeOptionalString(literalTranscript),
      label_source: normalizeLabelSource(metadata.label_source),
      language: normalizeOptionalString(taskMetadata.language),
      category: normalizeOptionalString(taskMetadata.category),
      technical: isPlainObject(metadata.technical) ? metadata.technical : {},
      storage: {
        object_key: storageDetails.objectKey || null,
        bucket_name: storageDetails.bucketName || null,
      },
      object_key: storageDetails.objectKey || null,
      bucket_name: storageDetails.bucketName || null,
    },
  };
}

async function verifyTurnstileToken(token, secretKey, fetchImpl = fetch) {
  if (!secretKey) {
    console.log('Turnstile secret key is not configured; local-dev bypass is active.');
    return { success: true, bypassed: true };
  }

  if (!token) {
    return {
      success: false,
      code: 'missing_turnstile_token',
      message: 'Human verification is required before starting a session.',
    };
  }

  const body = new URLSearchParams();
  body.set('secret', secretKey);
  body.set('response', token);

  try {
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
    });
    const result = await response.json();

    if (result?.success) {
      return { success: true, bypassed: false };
    }

    return {
      success: false,
      code: 'turnstile_failed',
      message: 'Human verification failed. Please try again.',
    };
  } catch (error) {
    console.error('Turnstile verification failed:', error);
    return {
      success: false,
      code: 'turnstile_failed',
      message: 'Human verification failed. Please try again.',
    };
  }
}

function createUploadMiddleware(upload) {
  return (req, res, next) => {
    upload.single('file')(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          success: false,
          code: 'file_too_large',
          message: 'Recording file is too large.',
        });
        return;
      }

      res.status(400).json({
        success: false,
        code: 'invalid_upload',
        message: 'Recording upload is invalid.',
      });
    });
  };
}

function createDefaultProvider() {
  return new TaskProvider(getDbConnectionString(), {
    sessionIdleTimeoutHours: getSessionIdleTimeoutHours(),
  });
}

function createDefaultFileStorage() {
  return new FileStorage(process.env.STORAGE || 'local');
}

function createDefaultUpload() {
  return multer({
    limits: {
      fileSize: getMaxUploadBytes(),
    },
  });
}

export function createApp(options = {}) {
  const provider = options.provider || createDefaultProvider();
  const fileStorage = options.fileStorage || createDefaultFileStorage();
  const upload = options.upload || createDefaultUpload();
  const turnstileSecretKey =
    options.turnstileSecretKey === undefined ? getTurnstileSecretKey() : options.turnstileSecretKey;
  const fetchImpl = options.fetchImpl || fetch;

  const app = express();

  app.use(cors({ origin: process.env.APP_URL }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.post('/api/start-session', async (req, res) => {
    try {
      const turnstileResult = await verifyTurnstileToken(
        normalizeSessionToken(req.body?.turnstileToken),
        turnstileSecretKey,
        fetchImpl
      );

      if (!turnstileResult.success) {
        return res.status(400).json({
          success: false,
          code: turnstileResult.code,
          message: turnstileResult.message,
        });
      }

      const sessionToken = normalizeSessionToken(req.body?.sessionToken);
      const result = await provider.startSession(sessionToken);
      res.status(200).json(result);
    } catch (error) {
      console.error('Error in /api/start-session:', error);
      res.status(500).json({
        success: false,
        message: 'An internal server error occurred.',
      });
    }
  });

  app.post('/api/get-task', async (req, res) => {
    const sessionToken = normalizeSessionToken(req.body?.sessionToken);
    if (!sessionToken) {
      return res.status(400).json({
        success: false,
        code: 'missing_session_token',
        message: 'sessionToken is required.',
      });
    }

    try {
      const result = await provider.getTask(sessionToken);
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error('Error in /api/get-task:', error);
      res.status(500).json({
        success: false,
        message: 'An internal server error occurred.',
      });
    }
  });

  app.post('/api/update-session-metadata', async (req, res) => {
    const sessionToken = normalizeSessionToken(req.body?.sessionToken);
    if (!sessionToken) {
      return res.status(400).json({
        success: false,
        code: 'missing_session_token',
        message: 'sessionToken is required.',
      });
    }

    const metadata = req.body?.metadata;
    if (!isPlainObject(metadata)) {
      return res.status(400).json({
        success: false,
        code: 'invalid_metadata',
        message: 'metadata must be an object.',
      });
    }

    try {
      const result = await provider.updateSessionMetadata(sessionToken, metadata);
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error('Error in /api/update-session-metadata:', error);
      res.status(500).json({
        success: false,
        message: 'An internal server error occurred.',
      });
    }
  });

  app.post('/api/category-state', async (req, res) => {
    const sessionToken = normalizeSessionToken(req.body?.sessionToken);
    if (!sessionToken) {
      return res.status(400).json({
        success: false,
        code: 'missing_session_token',
        message: 'sessionToken is required.',
      });
    }

    try {
      const result = await provider.getCategoryState(sessionToken);
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error('Error in /api/category-state:', error);
      res.status(500).json({
        success: false,
        message: 'An internal server error occurred.',
      });
    }
  });

  app.post('/api/upload-sound', createUploadMiddleware(upload), async (req, res) => {
    const sessionToken = normalizeSessionToken(req.body?.sessionToken);
    const taskId =
      typeof req.body?.taskId === 'string' && req.body.taskId.trim()
        ? req.body.taskId.trim()
        : null;
    const file = req.file;

    if (!sessionToken || !taskId || !file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'invalid_upload_request',
        message: 'sessionToken, taskId, and a non-empty file are required.',
      });
    }

    const parsedMetadata = parseUploadMetadata(req.body?.metadata);
    if (!parsedMetadata.success) {
      return res.status(400).json(parsedMetadata);
    }

    try {
      const uploadTarget = await provider.getUploadTarget(sessionToken, taskId);
      if (!uploadTarget.success) {
        return res.status(400).json(uploadTarget);
      }

      const submittedAt = new Date().toISOString();
      const recordingId = randomUUID();
      const recordingMetadata = buildRecordingMetadata(
        parsedMetadata.metadata,
        uploadTarget.task,
        submittedAt
      );

      if (!recordingMetadata.success) {
        return res.status(400).json(recordingMetadata);
      }

      const recording = await fileStorage.saveRecording(file, {
        sessionId: uploadTarget.sessionId,
        taskId,
        recordingId,
      });

      const metadataWithStorage = {
        ...recordingMetadata.metadata,
        processed_audio: recording.processedAudio || null,
        storage: {
          object_key: recording.objectKey,
          bucket_name: recording.bucketName,
        },
        object_key: recording.objectKey,
        bucket_name: recording.bucketName,
      };

      const result = await provider.submitRecording(sessionToken, taskId, {
        recordingId,
        storageType: recording.storageType,
        storageKey: recording.storageKey,
        durationSec: recording.durationSec,
        submittedAt,
        metadata: metadataWithStorage,
      });

      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      if (error instanceof RecordingTooLongError || error.code === 'recording_too_long') {
        return res.status(400).json({
          success: false,
          code: 'recording_too_long',
          message: 'Recording is longer than the allowed maximum.',
        });
      }

      console.error('Error in /api/upload-sound:', error);
      res.status(500).json({
        success: false,
        message: 'An internal server error occurred.',
      });
    }
  });

  app.post('/api/exit-session', async (req, res) => {
    const sessionToken = normalizeSessionToken(req.body?.sessionToken);
    if (!sessionToken) {
      return res.status(400).json({
        success: false,
        code: 'missing_session_token',
        message: 'sessionToken is required.',
      });
    }

    try {
      const result = await provider.exitSession(sessionToken);
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error('Error in /api/exit-session:', error);
      res.status(500).json({
        success: false,
        message: 'An internal server error occurred.',
      });
    }
  });

  app.post('/api/complete-session', async (req, res) => {
    const sessionToken = normalizeSessionToken(req.body?.sessionToken);
    if (!sessionToken) {
      return res.status(400).json({
        success: false,
        code: 'missing_session_token',
        message: 'sessionToken is required.',
      });
    }

    try {
      const result = await provider.completeSession(sessionToken);
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error('Error in /api/complete-session:', error);
      res.status(500).json({
        success: false,
        message: 'An internal server error occurred.',
      });
    }
  });

  app.get('/ping', (_req, res) => {
    res.json({ ready: true });
  });

  return app;
}

const currentPath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entryPath === currentPath) {
  const app = createApp();
  app.listen(DEFAULT_PORT, () => {
    console.log(`Server is running on port ${DEFAULT_PORT}`);
  });
}
