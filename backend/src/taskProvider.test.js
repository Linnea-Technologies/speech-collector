import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateProgress, hasRequiredSessionMetadata, TaskProvider } from './taskProvider.js';

const validV1SessionMetadata = {
  schema_version: 'v1',
  device_id: 'browser-device-id',
  consent_response: 'yes',
  demographics: {},
  environment: {},
  technical: {},
};

function createUploadTargetProvider(sessionMetadata) {
  const provider = new TaskProvider('postgresql://example');
  let taskQueryCount = 0;

  provider.withClient = async (run) =>
    run({
      query: async () => {
        taskQueryCount += 1;
        return {
          rowCount: 1,
          rows: [
            {
              id: 'task-123',
              text: 'Kyllä',
              metadata: {
                label: 'kylla',
                language: 'fi',
                category: 'affirmative',
              },
            },
          ],
        };
      },
    });
  provider.expireStaleSessions = async () => {};
  provider.getSessionSummaryByToken = async () => ({
    id: 'session-123',
    sessionToken: 'session-token',
    topicId: 'topic-123',
    status: 'active',
    metadata: sessionMetadata,
  });

  return {
    provider,
    getTaskQueryCount: () => taskQueryCount,
  };
}

test('calculateProgress returns total, completed, and remaining counts', () => {
  assert.deepEqual(calculateProgress(9, 3), {
    totalTasks: 9,
    completedTasks: 3,
    remainingTasks: 6,
  });
});

test('calculateProgress never returns a negative remaining count', () => {
  assert.deepEqual(calculateProgress(2, 5), {
    totalTasks: 2,
    completedTasks: 5,
    remainingTasks: 0,
  });
});

test('hasRequiredSessionMetadata rejects missing or incomplete metadata', () => {
  assert.equal(hasRequiredSessionMetadata({}), false);
  assert.equal(
    hasRequiredSessionMetadata({
      ...validV1SessionMetadata,
      device_id: '',
    }),
    false
  );
  assert.equal(
    hasRequiredSessionMetadata({
      ...validV1SessionMetadata,
      consent_response: 'no',
    }),
    false
  );
  assert.equal(
    hasRequiredSessionMetadata({
      ...validV1SessionMetadata,
      technical: null,
    }),
    false
  );
});

test('hasRequiredSessionMetadata accepts valid v1 metadata shape', () => {
  assert.equal(hasRequiredSessionMetadata(validV1SessionMetadata), true);
});

test('getUploadTarget rejects sessions without completed v1 metadata before task lookup', async () => {
  const { provider, getTaskQueryCount } = createUploadTargetProvider({});

  const result = await provider.getUploadTarget('session-token', 'task-123');

  assert.equal(result.success, false);
  assert.equal(result.code, 'session_metadata_required');
  assert.equal(result.message, 'Session details must be completed before uploading recordings.');
  assert.equal(getTaskQueryCount(), 0);
});

test('getUploadTarget allows valid v1 session metadata', async () => {
  const { provider, getTaskQueryCount } = createUploadTargetProvider(validV1SessionMetadata);

  const result = await provider.getUploadTarget('session-token', 'task-123');

  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'session-123');
  assert.equal(result.task.text, 'Kyllä');
  assert.equal(result.task.metadata.label, 'kylla');
  assert.equal(getTaskQueryCount(), 1);
});
