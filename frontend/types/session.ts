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

export interface CategoryPhraseState {
  taskId: string;
  phraseId: string;
  text: string;
  category: string;
  semanticLabel: string | null;
  normalizedLabel: string | null;
  recordedInCurrentSession: boolean;
  recordedPreviouslyOnDevice: boolean;
  recordingCountCurrentSession: number;
}

export interface CategoryProgressState {
  currentSessionUniqueCount: number;
  previousSameDeviceUniqueCount: number;
  uniqueRecordedCount: number;
  totalPhrases: number;
}

export interface CategoryStateCategory {
  id: string;
  title: string;
  totalPhrases: number;
  requiredCount: number;
  unlocked: boolean;
  complete: boolean;
  progress: CategoryProgressState;
  phrases: CategoryPhraseState[];
}

export interface CategoryStateResponse {
  success: boolean;
  sessionStatus?: SessionStatus;
  session?: SessionState;
  categoryOrder: string[];
  activeCategoryId: string | null;
  categories: CategoryStateCategory[];
}
