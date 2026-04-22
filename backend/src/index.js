import express from 'express';
import cors from 'cors';
import multer from 'multer';

import { TaskProvider } from './taskProvider.js';
import { FileStorage } from './fileStorage.js';
import { getDbConnectionString, getSessionIdleTimeoutHours } from './config.js';

const connString = getDbConnectionString();
const provider = new TaskProvider(connString, {
  sessionIdleTimeoutHours: getSessionIdleTimeoutHours(),
});
const fileStorage = new FileStorage(process.env.STORAGE || 'local');

const app = express();
const upload = multer();

app.use(cors({ origin: process.env.APP_URL }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function normalizeSessionToken(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

app.post('/api/start-session', async (req, res) => {
  try {
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

app.post('/api/upload-sound', upload.single('file'), async (req, res) => {
  const sessionToken = normalizeSessionToken(req.body?.sessionToken);
  const taskId = typeof req.body?.taskId === 'string' && req.body.taskId.trim()
    ? req.body.taskId.trim()
    : null;
  const file = req.file;

  if (!sessionToken || !taskId || !file) {
    return res.status(400).json({
      success: false,
      code: 'invalid_upload_request',
      message: 'sessionToken, taskId, and file are required.',
    });
  }

  try {
    const uploadTarget = await provider.getUploadTarget(sessionToken, taskId);
    if (!uploadTarget.success) {
      return res.status(400).json(uploadTarget);
    }

    const recording = await fileStorage.saveRecording(file, {
      sessionId: uploadTarget.sessionId,
      taskId,
    });

    const result = await provider.submitRecording(sessionToken, taskId, {
      storageType: recording.storageType,
      storageKey: recording.storageKey,
      durationSec: recording.durationSec,
      submittedAt: new Date().toISOString(),
      metadata: {
        object_key: recording.objectKey,
        bucket_name: recording.bucketName,
      },
    });

    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
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

app.listen(8000, () => {
  console.log('Server is running on port 8000');
});
