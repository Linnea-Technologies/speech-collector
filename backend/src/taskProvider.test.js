import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCategoryStatePayload,
  calculateProgress,
  ensureCategoryPhraseUiState,
  hasRequiredSessionMetadata,
  TaskProvider,
} from './taskProvider.js';

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

test('category phrase order is stable and appends newly added phrases', () => {
  const topicMetadata = {
    category_order: ['yes'],
  };
  const initialTasks = [
    {
      id: 'topic_yes_kylla',
      task_idx: 0,
      text: 'Kylla',
      metadata: { phrase_id: 'yes_kylla', category: 'yes' },
    },
    {
      id: 'topic_yes_joo',
      task_idx: 1,
      text: 'Joo',
      metadata: { phrase_id: 'yes_joo', category: 'yes' },
    },
    {
      id: 'topic_yes_on',
      task_idx: 2,
      text: 'On',
      metadata: { phrase_id: 'yes_on', category: 'yes' },
    },
  ];

  const first = ensureCategoryPhraseUiState({}, initialTasks, topicMetadata, {
    now: '2026-05-25T00:00:00.000Z',
    rng: () => 0,
  });
  const next = ensureCategoryPhraseUiState(
    first.metadata,
    [
      ...initialTasks,
      {
        id: 'topic_yes_olen',
        task_idx: 3,
        text: 'Olen',
        metadata: { phrase_id: 'yes_olen', category: 'yes' },
      },
    ],
    topicMetadata,
    {
      now: '2026-05-25T00:01:00.000Z',
      rng: () => 0.99,
    }
  );

  assert.deepEqual(first.state.phrase_order_by_category.yes, [
    'yes_joo',
    'yes_on',
    'yes_kylla',
  ]);
  assert.deepEqual(next.state.phrase_order_by_category.yes, [
    'yes_joo',
    'yes_on',
    'yes_kylla',
    'yes_olen',
  ]);
});

test('new sessions can receive different phrase orders when enough phrases exist', () => {
  const tasks = [
    { id: 'topic_yes_1', task_idx: 0, text: 'A', metadata: { phrase_id: 'yes_1', category: 'yes' } },
    { id: 'topic_yes_2', task_idx: 1, text: 'B', metadata: { phrase_id: 'yes_2', category: 'yes' } },
    { id: 'topic_yes_3', task_idx: 2, text: 'C', metadata: { phrase_id: 'yes_3', category: 'yes' } },
  ];

  const first = ensureCategoryPhraseUiState({}, tasks, { category_order: ['yes'] }, { rng: () => 0 });
  const second = ensureCategoryPhraseUiState(
    {},
    tasks,
    { category_order: ['yes'] },
    { rng: () => 0.99 }
  );

  assert.notDeepEqual(
    first.state.phrase_order_by_category.yes,
    second.state.phrase_order_by_category.yes
  );
});

test('category state counts distinct current and previous same-device phrases for unlocks', () => {
  const tasks = [
    {
      id: 'topic_yes_kylla',
      task_idx: 0,
      text: 'Kylla',
      metadata: {
        phrase_id: 'yes_kylla',
        label: 'kylla',
        semantic_label: 'yes',
        category: 'yes',
      },
    },
    {
      id: 'topic_yes_joo',
      task_idx: 1,
      text: 'Joo',
      metadata: { phrase_id: 'yes_joo', label: 'joo', semantic_label: 'yes', category: 'yes' },
    },
    {
      id: 'topic_yes_on',
      task_idx: 2,
      text: 'On',
      metadata: { phrase_id: 'yes_on', label: 'on', semantic_label: 'yes', category: 'yes' },
    },
    {
      id: 'topic_no_ei',
      task_idx: 3,
      text: 'Ei',
      metadata: { phrase_id: 'no_ei', label: 'ei', semantic_label: 'no', category: 'no' },
    },
    {
      id: 'topic_no_en',
      task_idx: 4,
      text: 'En',
      metadata: { phrase_id: 'no_en', label: 'en', semantic_label: 'no', category: 'no' },
    },
    {
      id: 'topic_correct_niin',
      task_idx: 5,
      text: 'Niin',
      metadata: {
        phrase_id: 'correct_niin',
        label: 'niin',
        semantic_label: 'correct',
        category: 'correct',
      },
    },
  ];
  const phraseUiState = {
    category_order: ['yes', 'no', 'correct'],
    phrase_order_by_category: {
      yes: ['yes_kylla', 'yes_joo', 'yes_on'],
      no: ['no_ei', 'no_en'],
      correct: ['correct_niin'],
    },
  };

  const payload = buildCategoryStatePayload({
    tasks,
    topicMetadata: {
      category_order: ['yes', 'no', 'correct'],
      categories: [
        { id: 'yes', title: 'Yes', required_count: 3 },
        { id: 'no', title: 'No', required_count: 3 },
        { id: 'correct', title: 'Correct', required_count: 3 },
      ],
    },
    phraseUiState,
    currentRecordingCounts: new Map([
      ['yes_kylla', 2],
      ['yes_joo', 1],
      ['no_ei', 2],
    ]),
    previousPhraseIds: new Set(['yes_on', 'no_en', 'correct_niin']),
  });

  const [yes, no, correct] = payload.categories;

  assert.equal(yes.requiredCount, 3);
  assert.equal(yes.progress.currentSessionUniqueCount, 2);
  assert.equal(yes.progress.previousSameDeviceUniqueCount, 1);
  assert.equal(yes.progress.uniqueRecordedCount, 3);
  assert.equal(yes.phrases[0].recordingCountCurrentSession, 2);
  assert.equal(no.requiredCount, 2);
  assert.equal(no.unlocked, true);
  assert.equal(no.progress.uniqueRecordedCount, 2);
  assert.equal(correct.requiredCount, 1);
  assert.equal(correct.unlocked, true);
  assert.equal(correct.progress.uniqueRecordedCount, 1);
  assert.equal(payload.activeCategoryId, 'correct');
});

test('legacy category rows without semantic_label stay readable', () => {
  const payload = buildCategoryStatePayload({
    tasks: [
      {
        id: 'legacy_topic_kylla',
        task_idx: 0,
        text: 'Kylla',
        metadata: {
          prompt_id: 'kylla',
          label: 'kylla',
          category: 'affirmative',
        },
      },
    ],
    topicMetadata: { category_order: ['affirmative'] },
    phraseUiState: {
      category_order: ['affirmative'],
      phrase_order_by_category: { affirmative: ['kylla'] },
    },
  });

  assert.equal(payload.categories[0].phrases[0].phraseId, 'kylla');
  assert.equal(payload.categories[0].phrases[0].semanticLabel, null);
});

test('submitRecording inserts repeat recordings as separate rows', async () => {
  const provider = new TaskProvider('postgresql://example');
  const inserts = [];

  provider.withClient = async (run) =>
    run({
      query: async (sql, params = []) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }

        if (sql.includes('FROM tasks')) {
          return { rowCount: 1, rows: [{ id: 'task-123' }] };
        }

        if (sql.includes('INSERT INTO recordings')) {
          assert.doesNotMatch(sql, /ON CONFLICT/);
          inserts.push(params);
          return { rowCount: 1, rows: [{ id: params[0] }] };
        }

        return { rowCount: 0, rows: [] };
      },
    });
  provider.expireStaleSessions = async () => {};
  provider.touchSession = async () => {};
  provider.getSessionSummaryByToken = async () => ({
    id: 'session-123',
    sessionToken: 'session-token',
    topicId: 'topic-123',
    status: 'active',
    metadata: validV1SessionMetadata,
    progress: {
      totalTasks: 2,
      completedTasks: 1,
      remainingTasks: 1,
    },
  });

  const first = await provider.submitRecording('session-token', 'task-123', {
    recordingId: '11111111-1111-4111-8111-111111111111',
    storageType: 'local',
    storageKey: 'session-123/task-123/11111111-1111-4111-8111-111111111111.wav',
    durationSec: 0.8,
    metadata: { phrase_id: 'yes_kylla' },
  });
  const second = await provider.submitRecording('session-token', 'task-123', {
    recordingId: '22222222-2222-4222-8222-222222222222',
    storageType: 'local',
    storageKey: 'session-123/task-123/22222222-2222-4222-8222-222222222222.wav',
    durationSec: 0.9,
    metadata: { phrase_id: 'yes_kylla' },
  });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0][0], '11111111-1111-4111-8111-111111111111');
  assert.equal(inserts[1][0], '22222222-2222-4222-8222-222222222222');
});
