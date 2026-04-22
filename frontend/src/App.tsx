import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import SessionContext from "../contexts/SessionProvider";
import InfoForm from "../components/InfoForm";
import SessionIntro from "../components/SessionIntro";
import SessionEndScreen from "../components/SessionEndScreen";
import SoundRecorder from "../components/SoundRecorder";
import TextContainer from "../components/TextContainer";
import {
  getConsentDeclineMessage,
  hasDeclinedConsent,
  isMetadataComplete,
} from "../utils/sessionMetadata";
import type { SessionState, SessionTask } from "../types/session";

import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";

type Phase =
  | "bootstrapping"
  | "intro"
  | "metadata"
  | "task"
  | "completed"
  | "abandoned"
  | "declined"
  | "unavailable"
  | "error";

type MetadataMode = "required" | "edit";

function App() {
  const {
    sessionToken,
    participantMetadata,
    currentTask,
    progress,
    applySession,
    clearSession,
    setCurrentTask,
    setProgress,
  } = useContext(SessionContext);

  const [phase, setPhase] = useState<Phase>("bootstrapping");
  const [metadataMode, setMetadataMode] = useState<MetadataMode>("required");
  const [message, setMessage] = useState<string>("");
  const [taskLoading, setTaskLoading] = useState<boolean>(false);
  const hasBootstrapped = useRef(false);

  const apiUrl = import.meta.env.VITE_API_URL;
  const appName = import.meta.env.VITE_APP_TITLE || "AINA Speech Collector";

  const metadataComplete = useMemo(
    () => isMetadataComplete(participantMetadata),
    [participantMetadata]
  );

  const moveToTerminalPhase = useCallback(
    (
      nextPhase: Extract<Phase, "completed" | "abandoned" | "declined" | "unavailable" | "error">,
      nextMessage: string
    ) => {
      setCurrentTask(null);
      clearSession();
      setPhase(nextPhase);
      setMessage(nextMessage);
    },
    [clearSession, setCurrentTask]
  );

  const syncSession = useCallback(
    (session: SessionState) => {
      applySession(session);
      setProgress(session.progress);
    },
    [applySession, setProgress]
  );

  const closeSession = useCallback(
    async (
      token: string | null | undefined,
      nextPhase: Extract<Phase, "abandoned" | "declined">,
      successMessage: string
    ) => {
      if (!token) {
        moveToTerminalPhase(nextPhase, successMessage);
        return;
      }

      try {
        const response = await fetch(`${apiUrl}/api/exit-session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionToken: token }),
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.message || "Could not close the session.");
        }

        moveToTerminalPhase(nextPhase, successMessage);
      } catch (error) {
        moveToTerminalPhase(
          "error",
          error instanceof Error ? error.message : "Could not close the session."
        );
      }
    },
    [apiUrl, moveToTerminalPhase]
  );

  const loadTask = useCallback(
    async (tokenOverride?: string | null) => {
      const activeToken = tokenOverride ?? sessionToken;
      if (!activeToken) {
        moveToTerminalPhase("error", "A session token is required before loading prompts.");
        return;
      }

      setTaskLoading(true);
      setMessage("");

      try {
        const response = await fetch(`${apiUrl}/api/get-task`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionToken: activeToken }),
        });

        const data = await response.json();
        if (!data.success) {
          if (data.code === "invalid_session") {
            moveToTerminalPhase("error", "The previous session could not be resumed.");
            return;
          }

          throw new Error(data.message || "Could not load the next prompt.");
        }

        if (data.session) {
          syncSession(data.session);
        }

        if (data.sessionStatus === "completed") {
          moveToTerminalPhase("completed", data.message || "Thank you for completing the session.");
          return;
        }

        if (data.sessionStatus === "abandoned") {
          moveToTerminalPhase("abandoned", data.message || "This session has been closed.");
          return;
        }

        setCurrentTask((data.task as SessionTask | null) ?? null);
        setProgress(data.progress);
        setPhase("task");
      } catch (error) {
        moveToTerminalPhase(
          "error",
          error instanceof Error ? error.message : "Could not load the next prompt."
        );
      } finally {
        setTaskLoading(false);
      }
    },
    [apiUrl, moveToTerminalPhase, sessionToken, setCurrentTask, setProgress, syncSession]
  );

  const startOrResumeSession = useCallback(
    async (tokenOverride?: string | null) => {
      setPhase("bootstrapping");
      setMessage("");
      setCurrentTask(null);

      try {
        const response = await fetch(`${apiUrl}/api/start-session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionToken: tokenOverride === undefined ? sessionToken : tokenOverride,
          }),
        });

        const data = await response.json();
        if (!data.success) {
          if (data.sessionStatus === "unavailable" || data.code === "no_topics") {
            moveToTerminalPhase("unavailable", data.message || "No prompt sets are available right now.");
            return;
          }

          throw new Error(data.message || "Could not start a session.");
        }

        syncSession(data.session as SessionState);
        if (hasDeclinedConsent(data.session?.metadata)) {
          await closeSession(
            data.session?.sessionToken,
            "declined",
            getConsentDeclineMessage(data.session?.metadata)
          );
          return;
        }

        if (!isMetadataComplete(data.session?.metadata)) {
          setMetadataMode("required");
          setPhase("intro");
          return;
        }

        await loadTask(data.session.sessionToken);
      } catch (error) {
        moveToTerminalPhase(
          "error",
          error instanceof Error ? error.message : "Could not start a session."
        );
      }
    },
    [apiUrl, closeSession, loadTask, moveToTerminalPhase, sessionToken, setCurrentTask, syncSession]
  );

  useEffect(() => {
    if (hasBootstrapped.current) {
      return;
    }

    hasBootstrapped.current = true;
    void startOrResumeSession(sessionToken);
  }, [sessionToken, startOrResumeSession]);

  const handleMetadataSaved = useCallback(
    async (session: SessionState) => {
      syncSession(session);

      if (hasDeclinedConsent(session.metadata)) {
        await closeSession(
          session.sessionToken,
          "declined",
          getConsentDeclineMessage(session.metadata)
        );
        return;
      }

      setMetadataMode("edit");
      await loadTask(session.sessionToken);
    },
    [closeSession, loadTask, syncSession]
  );

  const handleExitSession = useCallback(async () => {
    await closeSession(
      sessionToken,
      "abandoned",
      "Your submitted recordings were saved. You can safely leave now."
    );
  }, [closeSession, sessionToken]);

  const handleRestart = useCallback(async () => {
    clearSession();
    setMetadataMode("required");
    await startOrResumeSession(null);
  }, [clearSession, startOrResumeSession]);

  if (phase === "bootstrapping") {
    return (
      <main className="app-shell">
        <section className="app-panel app-panel--narrow">
          <span className="app-eyebrow">AINA Session</span>
          <h1 className="app-title">Preparing your session</h1>
          <p className="app-copy">Connecting to the next available prompt set.</p>
        </section>
      </main>
    );
  }

  if (phase === "intro") {
    return (
      <main className="app-shell">
        <SessionIntro
          title="Short Finnish response collection"
          summary="This session records short spoken answers for phone-quality speech classification."
          details={[
            "No account is required.",
            "You can stop at any time.",
            "Submitted prompts stay saved even if you leave early.",
          ]}
          actionLabel="Continue"
          onContinue={() => setPhase("metadata")}
        />
      </main>
    );
  }

  if (phase === "metadata") {
    return (
      <main className="app-shell">
        <InfoForm
          message={
            metadataMode === "required"
              ? "Tell us a little about the recording conditions and confirm consent before you begin."
              : "Update the session details if something changed."
          }
          canCancel={metadataMode === "edit" && metadataComplete}
          onCancel={() => setPhase("task")}
          onSaved={handleMetadataSaved}
        />
      </main>
    );
  }

  if (phase === "completed") {
    return (
      <main className="app-shell">
        <SessionEndScreen
          title="Session complete"
          message={message || "Thank you. Your recordings were saved."}
          actionLabel="Start a new session"
          onRestart={handleRestart}
        />
      </main>
    );
  }

  if (phase === "abandoned") {
    return (
      <main className="app-shell">
        <SessionEndScreen
          title="Session closed"
          message={message || "Your submitted recordings were saved."}
          actionLabel="Start a new session"
          onRestart={handleRestart}
        />
      </main>
    );
  }

  if (phase === "declined") {
    return (
      <main className="app-shell">
        <SessionEndScreen
          title="Thanks for your response"
          message={message || "This session has been closed and no prompts were shown."}
          actionLabel="Start over"
          onRestart={handleRestart}
        />
      </main>
    );
  }

  if (phase === "unavailable") {
    return (
      <main className="app-shell">
        <SessionEndScreen
          title="No prompts available"
          message={message || "There are no prompt sets available right now."}
          actionLabel="Try again"
          onRestart={handleRestart}
        />
      </main>
    );
  }

  if (phase === "error") {
    return (
      <main className="app-shell">
        <SessionEndScreen
          title="Something went wrong"
          message={message || "The session could not continue."}
          actionLabel="Start over"
          onRestart={handleRestart}
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="app-panel app-panel--wide">
        <header className="app-header">
          <div>
            <span className="app-eyebrow">{appName}</span>
            <h1 className="app-session-title">Current session</h1>
            <p className="app-copy">
              {progress.completedTasks} of {progress.totalTasks} prompts saved.
            </p>
          </div>
          <div className="app-header-actions">
            <button
              type="button"
              className="app-secondary-button"
              onClick={() => {
                setMetadataMode("edit");
                setPhase("metadata");
              }}
            >
              Update details
            </button>
            <button type="button" className="app-secondary-button" onClick={handleExitSession}>
              Exit
            </button>
          </div>
        </header>

        <div className="app-progress" aria-hidden="true">
          <div
            className="app-progress__bar"
            style={{
              width: progress.totalTasks
                ? `${(progress.completedTasks / progress.totalTasks) * 100}%`
                : "0%",
            }}
          />
        </div>

        {taskLoading && <p className="app-copy">Loading the next prompt.</p>}
        {!taskLoading && currentTask && <TextContainer task={currentTask} />}
        {!taskLoading && !currentTask && (
          <p className="app-copy">No prompt is ready yet. Try refreshing the session.</p>
        )}

        {currentTask && (
          <SoundRecorder
            sessionToken={sessionToken}
            taskId={currentTask.id}
            onUploadComplete={(result) => {
              if (result.session) {
                syncSession(result.session as SessionState);
              }

              if (result.sessionStatus === "completed") {
                moveToTerminalPhase("completed", "Thank you. Your recordings were saved.");
                return;
              }

              setMessage("Recording saved. Continue when you are ready for the next prompt.");
            }}
            onNextTask={loadTask}
          />
        )}

        {message && phase === "task" && <p className="app-inline-message">{message}</p>}
      </section>
    </main>
  );
}

export default App;
