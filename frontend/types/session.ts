export type SessionStatus = 'active' | 'completed' | 'abandoned' | 'unavailable';

export interface SessionProgress {
  totalTasks: number;
  completedTasks: number;
  remainingTasks: number;
}

export interface SessionTask {
  id: string;
  topic_id: string;
  task_idx: number;
  text: string;
  metadata: Record<string, unknown>;
}

export interface SessionState {
  id: string;
  sessionToken: string;
  topicId: string;
  topicName: string;
  status: SessionStatus;
  metadata: Record<string, unknown>;
  progress: SessionProgress;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  completedAt?: string | null;
  exitedAt?: string | null;
}
