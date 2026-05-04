import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import multer from 'multer';

import {
  buildRecordingMetadata,
  createApp,
  parseUploadMetadata,
} from './index.js';
import { RecordingTooLongError } from './fileStorage.js';

function createProvider(overrides = {}) {
  return {
    startSessionCalls: 0,
    getUploadTargetCalls: 0,
    submitRecordingCalls: 0,
    async startSession() {
      this.startSessionCalls += 1;
      return { success: true, session: { sessionToken: 'session-token' } };
    },
    async getUploadTarget() {
      this.getUploadTargetCalls += 1;
      return {
        success: true,
        sessionId: 'session-123',
        task: {
          id: 'task-123',
          text: 'Kyllä',
          metadata: {
            label: 'kylla',
            language: 'fi',
            category: 'affirmative',
          },
        },
      };
    },
    async submitRecording(_sessionToken, _taskId, recordingDetails) {
      this.submitRecordingCalls += 1;
      this.lastRecordingDetails = recordingDetails;
      return { success: true, sessionStatus: 'active' };
    },
    ...overrides,
  };
}

function createFileStorage(overrides = {}) {
  return {
    saveRecordingCalls: 0,
    async saveRecording() {
      this.saveRecordingCalls += 1;
      return {
        storageType: 'local',
        storageKey: 'session-123/task-123.wav',
        objectKey: 'session-123/task-123.wav',
        bucketName: null,
        durationSec: 0.8,
        processedAudio: {
          sample_rate_hz: 16000,
          channel_count: 1,
          encoding: 'pcm_s16le',
        },
      };
    },
    ...overrides,
  };
}

async function withServer(app, run) {
  const server = app.listen(0);
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function createUploadForm({ metadata = undefined, fileBytes = 'wav-data' } = {}) {
  const form = new FormData();
  form.set('sessionToken', 'session-token');
  form.set('taskId', 'task-123');
  if (metadata !== undefined) {
    form.set('metadata', metadata);
  }

  form.set('file', new Blob([fileBytes], { type: 'audio/wav' }), 'task-123.wav');
  return form;
}

test('parseUploadMetadata rejects invalid JSON', () => {
  const result = parseUploadMetadata('{not-json');

  assert.equal(result.success, false);
  assert.equal(result.code, 'invalid_metadata');
});

test('buildRecordingMetadata accepts null literal_transcript and defaults label_source', () => {
  const result = buildRecordingMetadata(
    {
      schema_version: 'v1',
      literal_transcript: null,
      technical: {},
    },
    {
      text: 'Kyllä',
      metadata: {
        label: 'kylla',
        language: 'fi',
        category: 'affirmative',
      },
    },
    '2026-05-03T12:00:00.000Z'
  );

  assert.equal(result.success, true);
  assert.equal(result.metadata.literal_transcript, null);
  assert.equal(result.metadata.label_source, 'prompt_assumed');
  assert.equal(result.metadata.prompted_word, 'Kyllä');
  assert.equal(result.metadata.normalized_label, 'kylla');
});

test('buildRecordingMetadata stores user-confirmed literal transcript', () => {
  const result = buildRecordingMetadata(
    {
      literal_transcript: 'kyl',
      label_source: 'user_confirmed',
    },
    {
      text: 'Kyllä',
      metadata: {
        label: 'kylla',
      },
    },
    '2026-05-03T12:00:00.000Z'
  );

  assert.equal(result.success, true);
  assert.equal(result.metadata.literal_transcript, 'kyl');
  assert.equal(result.metadata.label_source, 'user_confirmed');
});

test('too-large uploads are rejected before provider or storage work', async () => {
  const provider = createProvider();
  const fileStorage = createFileStorage();
  const app = createApp({
    provider,
    fileStorage,
    upload: multer({ limits: { fileSize: 3 } }),
    turnstileSecretKey: '',
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/upload-sound`, {
      method: 'POST',
      body: createUploadForm({ fileBytes: 'too-large' }),
    });
    const body = await response.json();

    assert.equal(response.status, 413);
    assert.equal(body.code, 'file_too_large');
    assert.equal(provider.getUploadTargetCalls, 0);
    assert.equal(fileStorage.saveRecordingCalls, 0);
  });
});

test('Turnstile failure rejects session start before creating a session', async () => {
  const provider = createProvider();
  const app = createApp({
    provider,
    fileStorage: createFileStorage(),
    turnstileSecretKey: 'secret',
    fetchImpl: async () => ({
      async json() {
        return { success: false };
      },
    }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/start-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: 'bad-token' }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, 'turnstile_failed');
    assert.equal(provider.startSessionCalls, 0);
  });
});

test('invalid upload metadata JSON is rejected before storage', async () => {
  const provider = createProvider();
  const fileStorage = createFileStorage();
  const app = createApp({
    provider,
    fileStorage,
    turnstileSecretKey: '',
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/upload-sound`, {
      method: 'POST',
      body: createUploadForm({ metadata: '{not-json' }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, 'invalid_metadata');
    assert.equal(provider.getUploadTargetCalls, 0);
    assert.equal(fileStorage.saveRecordingCalls, 0);
  });
});

test('session metadata guard rejection prevents storage and DB submit', async () => {
  const provider = createProvider({
    async getUploadTarget() {
      this.getUploadTargetCalls += 1;
      return {
        success: false,
        code: 'session_metadata_required',
        message: 'Session details must be completed before uploading recordings.',
      };
    },
  });
  const fileStorage = createFileStorage();
  const app = createApp({
    provider,
    fileStorage,
    turnstileSecretKey: '',
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/upload-sound`, {
      method: 'POST',
      body: createUploadForm({
        metadata: JSON.stringify({
          literal_transcript: null,
          label_source: 'prompt_assumed',
        }),
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, 'session_metadata_required');
    assert.equal(body.message, 'Session details must be completed before uploading recordings.');
    assert.equal(provider.getUploadTargetCalls, 1);
    assert.equal(fileStorage.saveRecordingCalls, 0);
    assert.equal(provider.submitRecordingCalls, 0);
  });
});

test('upload continues past upload target when session metadata is valid', async () => {
  const provider = createProvider();
  const fileStorage = createFileStorage();
  const app = createApp({
    provider,
    fileStorage,
    turnstileSecretKey: '',
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/upload-sound`, {
      method: 'POST',
      body: createUploadForm({
        metadata: JSON.stringify({
          literal_transcript: null,
          label_source: 'prompt_assumed',
        }),
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(provider.getUploadTargetCalls, 1);
    assert.equal(fileStorage.saveRecordingCalls, 1);
    assert.equal(provider.submitRecordingCalls, 1);
    assert.deepEqual(provider.lastRecordingDetails.metadata.processed_audio, {
      sample_rate_hz: 16000,
      channel_count: 1,
      encoding: 'pcm_s16le',
    });
  });
});

test('too-long recordings are rejected without DB submit', async () => {
  const provider = createProvider();
  const fileStorage = createFileStorage({
    async saveRecording() {
      this.saveRecordingCalls += 1;
      throw new RecordingTooLongError(7, 6);
    },
  });
  const app = createApp({
    provider,
    fileStorage,
    turnstileSecretKey: '',
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/upload-sound`, {
      method: 'POST',
      body: createUploadForm({
        metadata: JSON.stringify({
          literal_transcript: null,
          label_source: 'prompt_assumed',
        }),
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, 'recording_too_long');
    assert.equal(provider.getUploadTargetCalls, 1);
    assert.equal(fileStorage.saveRecordingCalls, 1);
    assert.equal(provider.submitRecordingCalls, 0);
  });
});
