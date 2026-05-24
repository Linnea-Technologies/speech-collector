import { createContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { SessionProgress, SessionState, SessionStatus, SessionTask } from '../types/session';

const SESSION_TOKEN_STORAGE_KEY = 'aina.speechCollector.sessionToken';

interface SessionContextType {
  sessionToken: string | null;
  setSessionToken: (sessionToken: string | null) => void;
  sessionStatus: SessionStatus | null;
  setSessionStatus: (sessionStatus: SessionStatus | null) => void;
  participantMetadata: Record<string, unknown>;
  setParticipantMetadata: (metadata: Record<string, unknown>) => void;
  currentTask: SessionTask | null;
  setCurrentTask: (task: SessionTask | null) => void;
  progress: SessionProgress;
  setProgress: (progress: SessionProgress) => void;
  applySession: (session: SessionState) => void;
  clearSession: () => void;
}

const defaultProgress: SessionProgress = {
  totalTasks: 0,
  completedTasks: 0,
  remainingTasks: 0,
};

const SessionContext = createContext<SessionContextType>({
  sessionToken: null,
  setSessionToken: () => {},
  sessionStatus: null,
  setSessionStatus: () => {},
  participantMetadata: {},
  setParticipantMetadata: () => {},
  currentTask: null,
  setCurrentTask: () => {},
  progress: defaultProgress,
  setProgress: () => {},
  applySession: () => {},
  clearSession: () => {},
});

interface Props {
  children: ReactNode;
}

export const SessionProvider = ({ children }: Props) => {
  const [sessionToken, setSessionToken] = useState<string | null>(
    () => window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)
  );
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [participantMetadata, setParticipantMetadata] = useState<Record<string, unknown>>({});
  const [currentTask, setCurrentTask] = useState<SessionTask | null>(null);
  const [progress, setProgress] = useState<SessionProgress>(defaultProgress);

  useEffect(() => {
    if (sessionToken) {
      window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, sessionToken);
      return;
    }

    window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  }, [sessionToken]);

  const value = useMemo<SessionContextType>(
    () => ({
      sessionToken,
      setSessionToken,
      sessionStatus,
      setSessionStatus,
      participantMetadata,
      setParticipantMetadata,
      currentTask,
      setCurrentTask,
      progress,
      setProgress,
      applySession: (session) => {
        setSessionToken(session.sessionToken);
        setSessionStatus(session.status);
        setParticipantMetadata(session.metadata || {});
        setProgress(session.progress || defaultProgress);
      },
      clearSession: () => {
        setSessionToken(null);
        setSessionStatus(null);
        setParticipantMetadata({});
        setCurrentTask(null);
        setProgress(defaultProgress);
      },
    }),
    [currentTask, participantMetadata, progress, sessionStatus, sessionToken]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export default SessionContext;
