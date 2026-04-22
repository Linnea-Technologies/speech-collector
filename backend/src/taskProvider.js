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
          COUNT(r.id)::integer AS completed_task_count
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
        const topicResult = await client.query(`
          SELECT t.id
          FROM topics t
          WHERE NOT EXISTS (
            SELECT 1
            FROM participant_sessions ps
            WHERE ps.topic_id = t.id
          )
          ORDER BY t.id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);

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

      return {
        success: true,
        sessionId: session.id,
        sessionToken: session.sessionToken,
        topicId: session.topicId,
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
        await client.query(
          `
            INSERT INTO recordings (
              session_id,
              task_id,
              storage_type,
              storage_key,
              duration_sec,
              submitted_at,
              metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            ON CONFLICT (session_id, task_id)
            DO UPDATE SET
              storage_type = EXCLUDED.storage_type,
              storage_key = EXCLUDED.storage_key,
              duration_sec = EXCLUDED.duration_sec,
              submitted_at = EXCLUDED.submitted_at,
              metadata = EXCLUDED.metadata
          `,
          [
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
