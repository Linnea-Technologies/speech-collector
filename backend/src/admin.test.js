import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Readable } from 'node:stream';

import { AdminService, createAdminPasswordHash, verifyAdminPassword } from './admin.js';
import { createApp } from './index.js';

function createProvider(overrides = {}) {
  return {
    async startSession() {
      return { success: true, session: { sessionToken: 'session-token' } };
    },
    async getCategoryState() {
      return { success: true, categories: [] };
    },
    ...overrides,
  };
}

function createFileStorage(overrides = {}) {
  return {
    storageType: 'local',
    async saveRecording() {
      return {
        storageType: 'local',
        storageKey: 'session-123/task-123/recording-123.wav',
        objectKey: 'session-123/task-123/recording-123.wav',
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

function createAdminService(overrides = {}) {
  return {
    async listSamples() {
      return { success: true, samples: [], pagination: { total: 0, limit: 25, offset: 0 } };
    },
    async getAudioStream() {
      return {
        success: true,
        audio: {
          stream: Readable.from(Buffer.from('wav-data')),
          statusCode: 200,
          contentType: 'audio/wav',
          contentLength: 8,
          headers: { 'Accept-Ranges': 'bytes' },
        },
      };
    },
    async getSummary() {
      return { success: true, summary: { total_recordings: 0 } };
    },
    async getDistributions() {
      return { success: true, distributions: {} };
    },
    async getExportReadiness() {
      return { success: true, readiness: {} };
    },
    async getHealth() {
      return { success: true, health: { ready: true, warnings: [] } };
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

function getSetCookie(response) {
  return response.headers.get('set-cookie') || '';
}

test('admin password hashes verify only the matching password', async () => {
  const hash = await createAdminPasswordHash('correct horse battery staple');

  assert.equal(hash.startsWith('scrypt$'), true);
  assert.equal(await verifyAdminPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyAdminPassword('wrong password', hash), false);
  assert.equal(hash.includes('correct horse battery staple'), false);
});

test('admin config missing blocks data endpoints', async () => {
  const app = createApp({
    provider: createProvider(),
    fileStorage: createFileStorage(),
    adminService: createAdminService(),
    adminPasswordHash: '',
    adminSessionSecret: '',
    turnstileSecretKey: '',
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/samples`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.code, 'admin_not_configured');
    assert.equal(JSON.stringify(body).includes('ADMIN_SESSION_SECRET'), false);
  });
});

test('admin login rejects wrong password and accepts correct hash', async () => {
  const hash = await createAdminPasswordHash('review-password');
  const app = createApp({
    provider: createProvider(),
    fileStorage: createFileStorage(),
    adminService: createAdminService(),
    adminPasswordHash: hash,
    adminSessionSecret: 'test-secret',
    disableAdminThrottle: true,
    turnstileSecretKey: '',
  });

  await withServer(app, async (baseUrl) => {
    const wrongResponse = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    const wrongBody = await wrongResponse.json();

    assert.equal(wrongResponse.status, 401);
    assert.equal(wrongBody.code, 'invalid_admin_login');

    const loginResponse = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'review-password' }),
    });
    const loginBody = await loginResponse.json();
    const cookie = getSetCookie(loginResponse);

    assert.equal(loginResponse.status, 200);
    assert.equal(loginBody.success, true);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /review-password/);

    const meResponse = await fetch(`${baseUrl}/api/admin/me`, {
      headers: { Cookie: cookie },
    });
    const meBody = await meResponse.json();

    assert.equal(meResponse.status, 200);
    assert.equal(meBody.authenticated, true);
    assert.deepEqual(meBody.admin, { role: 'project_member' });

    const logoutResponse = await fetch(`${baseUrl}/api/admin/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.match(getSetCookie(logoutResponse), /Max-Age=0/);
  });
});

test('admin data and audio endpoints reject unauthenticated requests', async () => {
  const hash = await createAdminPasswordHash('review-password');
  const adminService = createAdminService({
    async listSamples() {
      throw new Error('should not be called');
    },
  });
  const app = createApp({
    provider: createProvider(),
    fileStorage: createFileStorage(),
    adminService,
    adminPasswordHash: hash,
    adminSessionSecret: 'test-secret',
    disableAdminThrottle: true,
    turnstileSecretKey: '',
  });

  await withServer(app, async (baseUrl) => {
    const listResponse = await fetch(`${baseUrl}/api/admin/samples`);
    const audioResponse = await fetch(`${baseUrl}/api/admin/samples/recording-123/audio`);

    assert.equal(listResponse.status, 401);
    assert.equal(audioResponse.status, 401);
  });
});

test('authenticated admin audio endpoint streams through backend', async () => {
  const hash = await createAdminPasswordHash('review-password');
  const app = createApp({
    provider: createProvider(),
    fileStorage: createFileStorage(),
    adminService: createAdminService(),
    adminPasswordHash: hash,
    adminSessionSecret: 'test-secret',
    disableAdminThrottle: true,
    turnstileSecretKey: '',
  });

  await withServer(app, async (baseUrl) => {
    const loginResponse = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'review-password' }),
    });
    const cookie = getSetCookie(loginResponse);
    const audioResponse = await fetch(`${baseUrl}/api/admin/samples/recording-123/audio`, {
      headers: { Cookie: cookie, Range: 'bytes=0-3' },
    });

    assert.equal(audioResponse.status, 200);
    assert.equal(audioResponse.headers.get('content-type'), 'audio/wav');
    assert.equal(await audioResponse.text(), 'wav-data');
  });
});

test('validation update accepts allowed fields and preserves trusted metadata', async () => {
  const row = {
    recording_id: '11111111-1111-4111-8111-111111111111',
    session_id: 'session-123',
    session_status: 'completed',
    session_metadata: {
      schema_version: 'v1',
      device_id: 'device-123',
      demographics: {},
      environment: {},
      technical: {},
    },
    topic_id: 'short_finnish_responses_v2_0001',
    topic_metadata: {},
    task_id: 'short_finnish_responses_v2_0001_yes_joo',
    task_metadata: {
      phrase_id: 'yes_joo',
      label: 'joo',
      semantic_label: 'yes',
      category: 'yes',
      language: 'fi',
    },
    transcript: 'Joo',
    label: 'joo',
    language: 'fi',
    category: 'yes',
    storage_type: 'local',
    storage_key: 'session-123/task-123/recording-123.wav',
    duration_sec: 0.72,
    submitted_at: '2026-05-31T10:00:00.000Z',
    recording_metadata: {
      schema_version: 'v1',
      timestamp: '2026-05-31T10:00:00.000Z',
      prompted_word: 'Joo',
      phrase_id: 'yes_joo',
      normalized_label: 'joo',
      semantic_label: 'yes',
      literal_transcript: null,
      label_source: 'prompt_assumed',
      language: 'fi',
      category: 'yes',
      processed_audio: {
        sample_rate_hz: 16000,
        channel_count: 1,
        encoding: 'pcm_s16le',
      },
      storage: {
        object_key: 'session-123/task-123/recording-123.wav',
        bucket_name: null,
      },
    },
  };
  let updatedMetadata = null;
  let writtenSidecar = null;
  const client = {
    async query(sql, params = []) {
      if (sql.includes('SELECT') && sql.includes('FROM recordings')) {
        return { rows: [row], rowCount: 1 };
      }

      if (sql.includes('UPDATE recordings')) {
        updatedMetadata = params[1];
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
  const provider = {
    async withClient(run) {
      return run(client);
    },
  };
  const fileStorage = {
    storageType: 'local',
    getRecordingObjectKey() {
      return 'session-123/task-123/recording-123.wav';
    },
    getMetadataSidecarInfo() {
      return {
        storage_type: 'local',
        storage_key: 'session-123/task-123/recording-123.json',
        object_key: 'session-123/task-123/recording-123.json',
        metadata_object_key: 'session-123/task-123/recording-123.json',
        bucket_name: null,
      };
    },
    async writeJsonSidecar(_row, sidecar) {
      writtenSidecar = sidecar;
      return this.getMetadataSidecarInfo();
    },
  };
  const service = new AdminService({ provider, fileStorage, validationFilter: 'validated' });

  const result = await service.saveValidation(row.recording_id, {
    literal_transcript: 'Joo',
    label_source: 'reviewed',
    validation: {
      status: 'validated',
      notes: 'clear sample',
    },
    normalized_label: 'malicious',
    semantic_label: 'malicious',
    phrase_id: 'malicious',
    storage_key: 'malicious.wav',
  });

  assert.equal(result.success, true);
  assert.equal(updatedMetadata.literal_transcript, 'Joo');
  assert.equal(updatedMetadata.label_source, 'reviewed');
  assert.equal(updatedMetadata.validation.status, 'validated');
  assert.equal(updatedMetadata.validation.notes, 'clear sample');
  assert.equal(updatedMetadata.normalized_label, 'joo');
  assert.equal(updatedMetadata.semantic_label, 'yes');
  assert.equal(updatedMetadata.phrase_id, 'yes_joo');
  assert.equal(updatedMetadata.storage.metadata_object_key, 'session-123/task-123/recording-123.json');
  assert.equal(Object.hasOwn(updatedMetadata.validation, 'validated_by'), false);
  assert.equal(writtenSidecar.normalized_label, 'joo');
  assert.equal(writtenSidecar.semantic_label, 'yes');
  assert.equal(writtenSidecar.validation.status, 'validated');
  assert.equal(writtenSidecar.storage.metadata_object_key, 'session-123/task-123/recording-123.json');
  assert.equal(Object.hasOwn(writtenSidecar.validation, 'validated_by'), false);
  assert.equal(JSON.stringify(writtenSidecar).includes('ADMIN_SESSION_SECRET'), false);
});
