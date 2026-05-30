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
    getCategoryStateCalls: 0,
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
            category: 'yes',
            phrase_id: 'yes_kylla',
            semantic_label: 'yes',
          },
        },
      };
    },
    async getCategoryState() {
      this.getCategoryStateCalls += 1;
      return {
        success: true,
        categoryOrder: ['yes'],
        activeCategoryId: 'yes',
        categories: [],
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
    async saveRecording(_file, options) {
      this.saveRecordingCalls += 1;
      this.lastSaveOptions = options;
      const storageKey = `${options.sessionId}/${options.taskId}/${options.recordingId}.wav`;
      return {
        storageType: 'local',
        storageKey,
        objectKey: storageKey,
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
        category: 'yes',
        phrase_id: 'yes_kylla',
        semantic_label: 'yes',
      },
    },
    '2026-05-03T12:00:00.000Z'
  );

  assert.equal(result.success, true);
  assert.equal(result.metadata.literal_transcript, null);
  assert.equal(result.metadata.label_source, 'prompt_assumed');
  assert.equal(result.metadata.prompted_word, 'Kyllä');
  assert.equal(result.metadata.phrase_id, 'yes_kylla');
  assert.equal(result.metadata.semantic_label, 'yes');
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

test('buildRecordingMetadata ignores frontend-provided trusted label fields', () => {
  const result = buildRecordingMetadata(
    {
      phrase_id: 'malicious_phrase',
      semantic_label: 'malicious_semantic',
      normalized_label: 'malicious_label',
      category: 'malicious_category',
      language: 'xx',
      prompted_word: 'malicious prompt',
      literal_transcript: null,
    },
    {
      id: 'task-123',
      text: 'Kyl',
      metadata: {
        phrase_id: 'yes_kyl',
        semantic_label: 'yes',
        label: 'kyl',
        category: 'yes',
        language: 'fi',
      },
    },
    '2026-05-03T12:00:00.000Z'
  );

  assert.equal(result.success, true);
  assert.equal(result.metadata.phrase_id, 'yes_kyl');
  assert.equal(result.metadata.semantic_label, 'yes');
  assert.equal(result.metadata.normalized_label, 'kyl');
  assert.equal(result.metadata.category, 'yes');
  assert.equal(result.metadata.language, 'fi');
  assert.equal(result.metadata.prompted_word, 'Kyl');
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
    assert.match(fileStorage.lastSaveOptions.recordingId, /^[0-9a-f-]{36}$/);
    assert.equal(provider.lastRecordingDetails.recordingId, fileStorage.lastSaveOptions.recordingId);
    assert.equal(
      provider.lastRecordingDetails.storageKey,
      `session-123/task-123/${fileStorage.lastSaveOptions.recordingId}.wav`
    );
    assert.equal(provider.lastRecordingDetails.metadata.phrase_id, 'yes_kylla');
    assert.equal(provider.lastRecordingDetails.metadata.semantic_label, 'yes');
    assert.deepEqual(provider.lastRecordingDetails.metadata.processed_audio, {
      sample_rate_hz: 16000,
      channel_count: 1,
      encoding: 'pcm_s16le',
    });
  });
});

test('category-state endpoint returns provider category progress', async () => {
  const provider = createProvider();
  const app = createApp({
    provider,
    fileStorage: createFileStorage(),
    turnstileSecretKey: '',
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/category-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: 'session-token' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(body.categoryOrder, ['yes']);
    assert.equal(body.activeCategoryId, 'yes');
    assert.equal(provider.getCategoryStateCalls, 1);
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
