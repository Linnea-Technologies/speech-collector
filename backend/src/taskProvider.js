import { randomUUID } from 'crypto';
import pkg from 'pg';

const { Client } = pkg;

export const SESSION_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned',
};

export function calculateProgress(totalTasks, completedTasks) {
  const total = Number.parseInt(totalTasks, 10) || 0;
  const completed = Number.parseInt(completedTasks, 10) || 0;
  return {
    totalTasks: total,
    completedTasks: completed,
    remainingTasks: Math.max(total - completed, 0),
  };
}

function normalizeMetadata(metadata) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasRequiredSessionMetadata(metadata) {
  return (
    isPlainObject(metadata) &&
    metadata.schema_version === 'v1' &&
    hasNonEmptyString(metadata.device_id) &&
    metadata.consent_response === 'yes' &&
    isPlainObject(metadata.demographics) &&
    isPlainObject(metadata.environment) &&
    isPlainObject(metadata.technical)
  );
}

export const CATEGORY_UI_METADATA_KEY = 'category_phrase_v1';
export const DEFAULT_CATEGORY_ORDER = ['yes', 'no', 'maybe', 'dont_know', 'correct', 'number'];
const DEFAULT_CATEGORY_REQUIRED_COUNT = 3;

function titleizeCategoryId(categoryId) {
  return categoryId
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
    : [];
}

function normalizeCategoryMetadata(topicMetadata) {
  const categories = Array.isArray(topicMetadata.categories) ? topicMetadata.categories : [];
  const result = new Map();

  for (const category of categories) {
    if (!isPlainObject(category)) {
      continue;
    }

    const id = normalizeOptionalString(category.id);
    if (!id) {
      continue;
    }

    const requiredCount = Number.parseInt(category.required_count, 10);
    result.set(id, {
      id,
      title: normalizeOptionalString(category.title) || titleizeCategoryId(id),
      required_count:
        Number.isFinite(requiredCount) && requiredCount > 0
          ? requiredCount
          : DEFAULT_CATEGORY_REQUIRED_COUNT,
    });
  }

  return result;
}

export function getTaskPhraseId(task) {
  const taskMetadata = normalizeMetadata(task?.metadata);
  return (
    normalizeOptionalString(taskMetadata.phrase_id) ||
    normalizeOptionalString(taskMetadata.prompt_id) ||
    normalizeOptionalString(task?.id)
  );
}

function getTaskCategory(task) {
  const taskMetadata = normalizeMetadata(task?.metadata);
  return normalizeOptionalString(taskMetadata.category) || 'uncategorized';
}

function getTaskNormalizedLabel(task) {
  const taskMetadata = normalizeMetadata(task?.metadata);
  return normalizeOptionalString(taskMetadata.label) || normalizeOptionalString(task?.text);
}

function getTaskSemanticLabel(task) {
  const taskMetadata = normalizeMetadata(task?.metadata);
  return normalizeOptionalString(taskMetadata.semantic_label);
}

export function getCategoryOrder(topicMetadata, tasks) {
  const configuredOrder = normalizeStringArray(topicMetadata.category_order);
  const orderedCategories = configuredOrder.length > 0 ? configuredOrder : DEFAULT_CATEGORY_ORDER;
  const taskCategories = [];

  for (const task of tasks) {
    const category = getTaskCategory(task);
    if (!taskCategories.includes(category)) {
      taskCategories.push(category);
    }
  }

  return [
    ...orderedCategories,
    ...taskCategories.filter((category) => !orderedCategories.includes(category)),
  ];
}

export function shuffleItems(items, rng = Math.random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function arraysEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function groupPhraseIdsByCategory(tasks, categoryOrder) {
  const grouped = new Map(categoryOrder.map((categoryId) => [categoryId, []]));

  for (const task of tasks) {
    const phraseId = getTaskPhraseId(task);
    if (!phraseId) {
      continue;
    }

    const category = getTaskCategory(task);
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }

    grouped.get(category).push(phraseId);
  }

  return grouped;
}

export function ensureCategoryPhraseUiState(
  sessionMetadata,
  tasks,
  topicMetadata,
  options = {}
) {
  const metadata = normalizeMetadata(sessionMetadata);
  const topic = normalizeMetadata(topicMetadata);
  const now = options.now || new Date().toISOString();
  const rng = options.rng || Math.random;
  const uiMetadata = normalizeMetadata(metadata.ui);
  const existingState = normalizeMetadata(uiMetadata[CATEGORY_UI_METADATA_KEY]);
  const existingOrderByCategory = normalizeMetadata(existingState.phrase_order_by_category);
  const categoryOrder = getCategoryOrder(topic, tasks);
  const grouped = groupPhraseIdsByCategory(tasks, categoryOrder);
  const phraseOrderByCategory = {};
  let changed = !isPlainObject(uiMetadata[CATEGORY_UI_METADATA_KEY]);

  for (const categoryId of categoryOrder) {
    const phraseIds = grouped.get(categoryId) || [];
    const phraseIdSet = new Set(phraseIds);
    const storedOrder = normalizeStringArray(existingOrderByCategory[categoryId]).filter((phraseId) =>
      phraseIdSet.has(phraseId)
    );
    const missingPhraseIds = phraseIds.filter((phraseId) => !storedOrder.includes(phraseId));
    const nextOrder =
      storedOrder.length > 0 || isPlainObject(uiMetadata[CATEGORY_UI_METADATA_KEY])
        ? [...storedOrder, ...missingPhraseIds]
        : shuffleItems(phraseIds, rng);

    phraseOrderByCategory[categoryId] = nextOrder;

    if (
      !arraysEqual(normalizeStringArray(existingOrderByCategory[categoryId]), nextOrder) ||
      !arraysEqual(normalizeStringArray(existingState.category_order), categoryOrder)
    ) {
      changed = true;
    }
  }

  const state = {
    category_order: categoryOrder,
    phrase_order_by_category: phraseOrderByCategory,
    created_at: normalizeOptionalString(existingState.created_at) || now,
    updated_at: changed
      ? now
      : normalizeOptionalString(existingState.updated_at) ||
        normalizeOptionalString(existingState.created_at) ||
        now,
  };

  return {
    changed,
    state,
    metadata: {
      ...metadata,
      ui: {
        ...uiMetadata,
        [CATEGORY_UI_METADATA_KEY]: state,
      },
    },
  };
}

function getCountForPhrase(counts, phraseId) {
  if (counts instanceof Map) {
    return Number.parseInt(counts.get(phraseId), 10) || 0;
  }

  if (isPlainObject(counts)) {
    return Number.parseInt(counts[phraseId], 10) || 0;
  }

  return 0;
}

function setHas(setLike, phraseId) {
  if (setLike instanceof Set) {
    return setLike.has(phraseId);
  }

  if (Array.isArray(setLike)) {
    return setLike.includes(phraseId);
  }

  return false;
}

function getTasksByPhraseId(tasks) {
  const result = new Map();
  for (const task of tasks) {
    const phraseId = getTaskPhraseId(task);
    if (phraseId && !result.has(phraseId)) {
      result.set(phraseId, task);
    }
  }

  return result;
}

export function buildCategoryStatePayload({
  tasks,
  topicMetadata = {},
  phraseUiState = {},
  currentRecordingCounts = new Map(),
  previousPhraseIds = new Set(),
}) {
  const topic = normalizeMetadata(topicMetadata);
  const categoryMetadata = normalizeCategoryMetadata(topic);
  const categoryOrder = normalizeStringArray(phraseUiState.category_order);
  const effectiveCategoryOrder = categoryOrder.length > 0 ? categoryOrder : getCategoryOrder(topic, tasks);
  const orderByCategory = normalizeMetadata(phraseUiState.phrase_order_by_category);
  const tasksByPhraseId = getTasksByPhraseId(tasks);
  let previousCategoriesMeetRequired = true;

  const categories = effectiveCategoryOrder.map((categoryId, categoryIndex) => {
    const taskIdsInCategory = tasks
      .filter((task) => getTaskCategory(task) === categoryId)
      .map((task) => getTaskPhraseId(task))
      .filter(Boolean);
    const storedOrder = normalizeStringArray(orderByCategory[categoryId]).filter((phraseId) =>
      tasksByPhraseId.has(phraseId)
    );
    const orderedPhraseIds = [
      ...storedOrder,
      ...taskIdsInCategory.filter((phraseId) => !storedOrder.includes(phraseId)),
    ];
    const categoryInfo = categoryMetadata.get(categoryId) || {
      id: categoryId,
      title: titleizeCategoryId(categoryId),
      required_count: DEFAULT_CATEGORY_REQUIRED_COUNT,
    };
    const currentUnique = new Set();
    const previousUnique = new Set();
    const combinedUnique = new Set();
    const phrases = orderedPhraseIds
      .map((phraseId) => tasksByPhraseId.get(phraseId))
      .filter(Boolean)
      .map((task) => {
        const phraseId = getTaskPhraseId(task);
        const currentCount = getCountForPhrase(currentRecordingCounts, phraseId);
        const recordedInCurrentSession = currentCount > 0;
        const recordedPreviouslyOnDevice = setHas(previousPhraseIds, phraseId);

        if (recordedInCurrentSession) {
          currentUnique.add(phraseId);
          combinedUnique.add(phraseId);
        }

        if (recordedPreviouslyOnDevice) {
          previousUnique.add(phraseId);
          combinedUnique.add(phraseId);
        }

        return {
          taskId: task.id,
          phraseId,
          text: task.text,
          category: getTaskCategory(task),
          semanticLabel: getTaskSemanticLabel(task),
          normalizedLabel: getTaskNormalizedLabel(task),
          recordedInCurrentSession,
          recordedPreviouslyOnDevice,
          recordingCountCurrentSession: currentCount,
        };
      });
    const totalPhrases = phrases.length;
    const requiredCount =
      totalPhrases > 0 ? Math.min(categoryInfo.required_count, totalPhrases) : 0;
    const uniqueRecordedCount = combinedUnique.size;
    const unlocked = categoryIndex === 0 || previousCategoriesMeetRequired;
    const complete = totalPhrases === 0 || uniqueRecordedCount >= totalPhrases;
    const category = {
      id: categoryId,
      title: categoryInfo.title,
      totalPhrases,
      requiredCount,
      unlocked,
      complete,
      progress: {
        currentSessionUniqueCount: currentUnique.size,
        previousSameDeviceUniqueCount: previousUnique.size,
        uniqueRecordedCount,
        totalPhrases,
      },
      phrases,
    };

    previousCategoriesMeetRequired =
      previousCategoriesMeetRequired && uniqueRecordedCount >= requiredCount;

    return category;
  });

  const firstBelowRequired = categories.find(
    (category) => category.progress.uniqueRecordedCount < category.requiredCount
  );
  const firstIncomplete = categories.find((category) => !category.complete);

  return {
    categoryOrder: effectiveCategoryOrder,
    activeCategoryId:
      firstBelowRequired?.id || firstIncomplete?.id || categories[categories.length - 1]?.id || null,
    categories,
  };
}

function buildSessionPayload(row) {
  return {
    id: row.id,
    sessionToken: row.session_token,
    topicId: row.topic_id,
    topicName: row.topic_name,
    status: row.status,
    metadata: normalizeMetadata(row.metadata),
    progress: calculateProgress(row.task_count, row.completed_task_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
    completedAt: row.completed_at,
    exitedAt: row.exited_at,
  };
}

export class TaskProvider {
  constructor(connString, options = {}) {
    this.connString = connString;
    this.sessionIdleTimeoutHours = options.sessionIdleTimeoutHours || 24;
    this.datasetId = options.datasetId || process.env.DATASET_ID || 'short_finnish_responses';
    this.datasetVersion = options.datasetVersion || process.env.DATASET_VERSION || 'v2';
    this.rng = options.rng || Math.random;
  }

  async withClient(run) {
    const client = new Client({ connectionString: this.connString });
    await client.connect();
    try {
      return await run(client);
    } finally {
      await client.end();
    }
  }

  async expireStaleSessions(client) {
    await client.query(
      `
        UPDATE participant_sessions
        SET status = $2,
            exited_at = COALESCE(exited_at, NOW()),
            updated_at = NOW()
        WHERE status = $1
          AND last_activity_at < NOW() - ($3::integer * INTERVAL '1 hour')
      `,
      [SESSION_STATUS.ACTIVE, SESSION_STATUS.ABANDONED, this.sessionIdleTimeoutHours]
    );
  }

  async getSessionSummaryByToken(client, sessionToken) {
    const result = await client.query(
      `
        SELECT
          ps.id,
          ps.session_token,
          ps.topic_id,
          ps.status,
          COALESCE(ps.metadata, '{}'::jsonb) AS metadata,
          ps.created_at,
          ps.updated_at,
          ps.last_activity_at,
          ps.completed_at,
          ps.exited_at,
          t.name AS topic_name,
          t.task_count,
          COUNT(DISTINCT r.task_id)::integer AS completed_task_count
        FROM participant_sessions ps
        JOIN topics t
          ON t.id = ps.topic_id
        LEFT JOIN recordings r
          ON r.session_id = ps.id
        WHERE ps.session_token = $1
        GROUP BY
          ps.id,
          ps.session_token,
          ps.topic_id,
          ps.status,
          ps.metadata,
          ps.created_at,
          ps.updated_at,
          ps.last_activity_at,
          ps.completed_at,
          ps.exited_at,
          t.name,
          t.task_count
      `,
      [sessionToken]
    );

    if (result.rowCount === 0) {
      return null;
    }

    return buildSessionPayload(result.rows[0]);
  }

  async touchSession(client, sessionId) {
    await client.query(
      `
        UPDATE participant_sessions
        SET updated_at = NOW(),
            last_activity_at = NOW()
        WHERE id = $1
      `,
      [sessionId]
    );
  }

  async markSessionCompleted(client, sessionId) {
    await client.query(
      `
        UPDATE participant_sessions
        SET status = $2,
            completed_at = COALESCE(completed_at, NOW()),
            updated_at = NOW(),
            last_activity_at = NOW()
        WHERE id = $1
      `,
      [sessionId, SESSION_STATUS.COMPLETED]
    );
  }

  async startSession(existingToken = null) {
    return this.withClient(async (client) => {
      await this.expireStaleSessions(client);

      if (existingToken) {
        const existingSession = await this.getSessionSummaryByToken(client, existingToken);
        if (existingSession?.status === SESSION_STATUS.ACTIVE) {
          await this.touchSession(client, existingSession.id);
          return {
            success: true,
            resumed: true,
            session: await this.getSessionSummaryByToken(client, existingToken),
          };
        }
      }

      const sessionToken = randomUUID();

      try {
        await client.query('BEGIN');

        // Topic copies are intentionally single-use. Once a participant_sessions row exists for
        // a topic, that copy is not reused, even after the session is completed or abandoned.
        const topicIdPrefix = `${this.datasetId}_${this.datasetVersion}_%`;
        const topicResult = await client.query(
          `
          SELECT t.id
          FROM topics t
          WHERE (
              (
                COALESCE(t.metadata, '{}'::jsonb)->>'dataset_id' = $1
                AND COALESCE(t.metadata, '{}'::jsonb)->>'dataset_version' = $2
              )
              OR t.id LIKE $3
            )
            AND NOT EXISTS (
            SELECT 1
            FROM participant_sessions ps
            WHERE ps.topic_id = t.id
          )
          ORDER BY t.id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `,
          [this.datasetId, this.datasetVersion, topicIdPrefix]
        );

        if (topicResult.rowCount === 0) {
          await client.query('ROLLBACK');
          return {
            success: false,
            code: 'no_topics',
            sessionStatus: 'unavailable',
            message: 'No prompt sets are currently available.',
          };
        }

        const topicId = topicResult.rows[0].id;
        await client.query(
          `
            INSERT INTO participant_sessions (session_token, topic_id, status)
            VALUES ($1, $2, $3)
          `,
          [sessionToken, topicId, SESSION_STATUS.ACTIVE]
        );

        await client.query('COMMIT');
        return {
          success: true,
          resumed: false,
          session: await this.getSessionSummaryByToken(client, sessionToken),
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error starting session:', error);
        return {
          success: false,
          code: 'start_session_failed',
          message: 'Could not start a new session.',
        };
      }
    });
  }

  async getTask(sessionToken) {
    return this.withClient(async (client) => {
      await this.expireStaleSessions(client);
      const session = await this.getSessionSummaryByToken(client, sessionToken);

      if (!session) {
        return {
          success: false,
          code: 'invalid_session',
          message: 'Session was not found.',
        };
      }

      if (session.status !== SESSION_STATUS.ACTIVE) {
        return {
          success: true,
          sessionStatus: session.status,
          session,
          task: null,
          progress: session.progress,
          message:
            session.status === SESSION_STATUS.COMPLETED
              ? 'Thank you for completing this session.'
              : 'This session has already been closed.',
        };
      }

      const taskResult = await client.query(
        `
          SELECT
            tk.id,
            tk.topic_id,
            tk.task_idx,
            tk.text,
            COALESCE(tk.metadata, '{}'::jsonb) AS metadata
          FROM tasks tk
          WHERE tk.topic_id = $1
            AND NOT EXISTS (
              SELECT 1
              FROM recordings r
              WHERE r.session_id = $2
                AND r.task_id = tk.id
            )
          ORDER BY tk.task_idx ASC
          LIMIT 1
        `,
        [session.topicId, session.id]
      );

      if (taskResult.rowCount === 0) {
        await this.markSessionCompleted(client, session.id);
        const completedSession = await this.getSessionSummaryByToken(client, sessionToken);
        return {
          success: true,
          sessionStatus: SESSION_STATUS.COMPLETED,
          session: completedSession,
          task: null,
          progress: completedSession.progress,
          message: 'Thank you for completing this session.',
        };
      }

      await this.touchSession(client, session.id);
      const refreshedSession = await this.getSessionSummaryByToken(client, sessionToken);

      return {
        success: true,
        sessionStatus: SESSION_STATUS.ACTIVE,
        session: refreshedSession,
        task: taskResult.rows[0],
        progress: refreshedSession.progress,
      };
    });
  }

  async getTopicTasks(client, topicId) {
    const topicResult = await client.query(
      `
        SELECT COALESCE(metadata, '{}'::jsonb) AS metadata
        FROM topics
        WHERE id = $1
        LIMIT 1
      `,
      [topicId]
    );
    const taskResult = await client.query(
      `
        SELECT
          id,
          topic_id,
          task_idx,
          text,
          COALESCE(metadata, '{}'::jsonb) AS metadata
        FROM tasks
        WHERE topic_id = $1
        ORDER BY task_idx ASC
      `,
      [topicId]
    );

    return {
      topicMetadata: normalizeMetadata(topicResult.rows[0]?.metadata),
      tasks: taskResult.rows,
    };
  }

  async updateSessionMetadataDocument(client, sessionId, metadata) {
    await client.query(
      `
        UPDATE participant_sessions
        SET metadata = $2::jsonb,
            updated_at = NOW(),
            last_activity_at = NOW()
        WHERE id = $1
      `,
      [sessionId, normalizeMetadata(metadata)]
    );
  }

  async getCurrentSessionPhraseCounts(client, sessionId) {
    const result = await client.query(
      `
        SELECT
          COALESCE(
            r.metadata->>'phrase_id',
            tk.metadata->>'phrase_id',
            tk.metadata->>'prompt_id',
            r.task_id
          ) AS phrase_id,
          COUNT(r.id)::integer AS recording_count
        FROM recordings r
        LEFT JOIN tasks tk
          ON tk.id = r.task_id
        WHERE r.session_id = $1
        GROUP BY COALESCE(
          r.metadata->>'phrase_id',
          tk.metadata->>'phrase_id',
          tk.metadata->>'prompt_id',
          r.task_id
        )
      `,
      [sessionId]
    );

    return new Map(
      result.rows
        .map((row) => [normalizeOptionalString(row.phrase_id), row.recording_count])
        .filter(([phraseId]) => phraseId)
    );
  }

  async getPreviousSameDevicePhraseIds(client, session, currentPhraseIds) {
    const deviceId = normalizeOptionalString(session.metadata?.device_id);
    if (!deviceId) {
      return new Set();
    }

    const result = await client.query(
      `
        SELECT DISTINCT
          COALESCE(
            r.metadata->>'phrase_id',
            tk.metadata->>'phrase_id',
            tk.metadata->>'prompt_id',
            r.task_id
          ) AS phrase_id
        FROM recordings r
        JOIN participant_sessions ps
          ON ps.id = r.session_id
        LEFT JOIN tasks tk
          ON tk.id = r.task_id
        WHERE ps.id <> $1
          AND ps.metadata->>'device_id' = $2
      `,
      [session.id, deviceId]
    );

    return new Set(
      result.rows
        .map((row) => normalizeOptionalString(row.phrase_id))
        .filter((phraseId) => phraseId && currentPhraseIds.has(phraseId))
    );
  }

  async getCategoryState(sessionToken) {
    return this.withClient(async (client) => {
      await this.expireStaleSessions(client);
      let session = await this.getSessionSummaryByToken(client, sessionToken);

      if (!session) {
        return {
          success: false,
          code: 'invalid_session',
          message: 'Session was not found.',
        };
      }

      if (session.status === SESSION_STATUS.ACTIVE && !hasRequiredSessionMetadata(session.metadata)) {
        return {
          success: false,
          code: 'session_metadata_required',
          message: 'Session details must be completed before loading category progress.',
          session,
        };
      }

      const { tasks, topicMetadata } = await this.getTopicTasks(client, session.topicId);
      const phraseUiState = ensureCategoryPhraseUiState(session.metadata, tasks, topicMetadata, {
        rng: this.rng,
      });

      if (phraseUiState.changed && session.status === SESSION_STATUS.ACTIVE) {
        await this.updateSessionMetadataDocument(client, session.id, phraseUiState.metadata);
        session = await this.getSessionSummaryByToken(client, sessionToken);
      }

      const currentPhraseIds = new Set(tasks.map((task) => getTaskPhraseId(task)).filter(Boolean));
      const currentRecordingCounts = await this.getCurrentSessionPhraseCounts(client, session.id);
      const previousPhraseIds = await this.getPreviousSameDevicePhraseIds(
        client,
        session,
        currentPhraseIds
      );
      const categoryState = buildCategoryStatePayload({
        tasks,
        topicMetadata,
        phraseUiState: phraseUiState.state,
        currentRecordingCounts,
        previousPhraseIds,
      });

      if (session.status === SESSION_STATUS.ACTIVE) {
        await this.touchSession(client, session.id);
        session = await this.getSessionSummaryByToken(client, sessionToken);
      }

      return {
        success: true,
        sessionStatus: session.status,
        session,
        ...categoryState,
      };
    });
  }

  async updateSessionMetadata(sessionToken, metadata) {
    return this.withClient(async (client) => {
      await this.expireStaleSessions(client);
      const session = await this.getSessionSummaryByToken(client, sessionToken);

      if (!session) {
        return {
          success: false,
          code: 'invalid_session',
          message: 'Session was not found.',
        };
      }

      if (session.status !== SESSION_STATUS.ACTIVE) {
        return {
          success: false,
          code: 'session_not_active',
          message: 'Only active sessions can be updated.',
          session,
        };
      }

      await client.query(
        `
          UPDATE participant_sessions
          SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW(),
              last_activity_at = NOW()
          WHERE session_token = $1
        `,
        [sessionToken, normalizeMetadata(metadata)]
      );

      return {
        success: true,
        session: await this.getSessionSummaryByToken(client, sessionToken),
      };
    });
  }

  async getUploadTarget(sessionToken, taskId) {
    return this.withClient(async (client) => {
      await this.expireStaleSessions(client);
      const session = await this.getSessionSummaryByToken(client, sessionToken);

      if (!session) {
        return {
          success: false,
          code: 'invalid_session',
          message: 'Session was not found.',
        };
      }

      if (session.status !== SESSION_STATUS.ACTIVE) {
        return {
          success: false,
          code: 'session_not_active',
          message: 'Only active sessions can upload recordings.',
          session,
        };
      }

      if (!hasRequiredSessionMetadata(session.metadata)) {
        return {
          success: false,
          code: 'session_metadata_required',
          message: 'Session details must be completed before uploading recordings.',
        };
      }

      const taskResult = await client.query(
        `
          SELECT
            id,
            text,
            COALESCE(metadata, '{}'::jsonb) AS metadata
          FROM tasks
          WHERE id = $1
            AND topic_id = $2
          LIMIT 1
        `,
        [taskId, session.topicId]
      );

      if (taskResult.rowCount === 0) {
        return {
          success: false,
          code: 'invalid_task',
          message: 'Task does not belong to this session.',
        };
      }

      return {
        success: true,
        sessionId: session.id,
        sessionToken: session.sessionToken,
        topicId: session.topicId,
        task: taskResult.rows[0],
      };
    });
  }

  async submitRecording(sessionToken, taskId, recordingDetails) {
    return this.withClient(async (client) => {
      await this.expireStaleSessions(client);
      const session = await this.getSessionSummaryByToken(client, sessionToken);

      if (!session) {
        return {
          success: false,
          code: 'invalid_session',
          message: 'Session was not found.',
        };
      }

      if (session.status !== SESSION_STATUS.ACTIVE) {
        return {
          success: false,
          code: 'session_not_active',
          message: 'Only active sessions can upload recordings.',
          session,
        };
      }

      const taskResult = await client.query(
        `
          SELECT id
          FROM tasks
          WHERE id = $1
            AND topic_id = $2
          LIMIT 1
        `,
        [taskId, session.topicId]
      );

      if (taskResult.rowCount === 0) {
        return {
          success: false,
          code: 'invalid_task',
          message: 'Task does not belong to this session.',
        };
      }

      try {
        await client.query('BEGIN');
        const recordingId = recordingDetails.recordingId || randomUUID();
        const insertResult = await client.query(
          `
            INSERT INTO recordings (
              id,
              session_id,
              task_id,
              storage_type,
              storage_key,
              duration_sec,
              submitted_at,
              metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            RETURNING id
          `,
          [
            recordingId,
            session.id,
            taskId,
            recordingDetails.storageType,
            recordingDetails.storageKey,
            recordingDetails.durationSec,
            recordingDetails.submittedAt || new Date().toISOString(),
            normalizeMetadata(recordingDetails.metadata),
          ]
        );

        await this.touchSession(client, session.id);
        const updatedSession = await this.getSessionSummaryByToken(client, sessionToken);

        if (updatedSession.progress.remainingTasks === 0) {
          await this.markSessionCompleted(client, session.id);
        }

        await client.query('COMMIT');
        const finalSession = await this.getSessionSummaryByToken(client, sessionToken);

        return {
          success: true,
          session: finalSession,
          sessionStatus: finalSession.status,
          progress: finalSession.progress,
          recording: {
            id: insertResult.rows[0]?.id,
            storageKey: recordingDetails.storageKey,
            durationSec: recordingDetails.durationSec,
          },
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error submitting recording:', error);
        return {
          success: false,
          code: 'submit_recording_failed',
          message: 'Could not save the recording.',
        };
      }
    });
  }

  async exitSession(sessionToken) {
    return this.withClient(async (client) => {
      await this.expireStaleSessions(client);
      const session = await this.getSessionSummaryByToken(client, sessionToken);

      if (!session) {
        return {
          success: false,
          code: 'invalid_session',
          message: 'Session was not found.',
        };
      }

      if (session.status === SESSION_STATUS.ABANDONED) {
        return { success: true, session };
      }

      if (session.status === SESSION_STATUS.COMPLETED) {
        return { success: true, session };
      }

      await client.query(
        `
          UPDATE participant_sessions
          SET status = $2,
              exited_at = COALESCE(exited_at, NOW()),
              updated_at = NOW(),
              last_activity_at = NOW()
          WHERE session_token = $1
        `,
        [sessionToken, SESSION_STATUS.ABANDONED]
      );

      return {
        success: true,
        session: await this.getSessionSummaryByToken(client, sessionToken),
      };
    });
  }

  async completeSession(sessionToken) {
    return this.withClient(async (client) => {
      await this.expireStaleSessions(client);
      const session = await this.getSessionSummaryByToken(client, sessionToken);

      if (!session) {
        return {
          success: false,
          code: 'invalid_session',
          message: 'Session was not found.',
        };
      }

      if (session.status === SESSION_STATUS.COMPLETED) {
        return { success: true, session };
      }

      if (session.status === SESSION_STATUS.ABANDONED) {
        return {
          success: false,
          code: 'session_abandoned',
          message: 'An abandoned session cannot be completed.',
          session,
        };
      }

      if (session.progress.remainingTasks > 0) {
        return {
          success: false,
          code: 'session_incomplete',
          message: 'All prompts must be recorded before completing the session.',
          session,
        };
      }

      await this.markSessionCompleted(client, session.id);
      return {
        success: true,
        session: await this.getSessionSummaryByToken(client, sessionToken),
      };
    });
  }
}
