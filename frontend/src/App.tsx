import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import SessionContext from "../contexts/SessionProvider";
import InfoForm from "../components/InfoForm";
import SessionIntro from "../components/SessionIntro";
import SessionEndScreen from "../components/SessionEndScreen";
import SoundRecorder from "../components/SoundRecorder";
import TurnstileGate from "../components/TurnstileGate";
import {
  getConsentDeclineMessage,
  hasDeclinedConsent,
  isMetadataComplete,
} from "../utils/sessionMetadata";
import type {
  CategoryPhraseState,
  CategoryStateCategory,
  CategoryStateResponse,
  SessionState,
} from "../types/session";

import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";

type Phase =
  | "bootstrapping"
  | "verification"
  | "intro"
  | "metadata"
  | "categoryIntro"
  | "categoryRecording"
  | "completed"
  | "abandoned"
  | "declined"
  | "unavailable"
  | "error";

type MetadataMode = "required" | "edit";
type CategoryStateApiResponse = CategoryStateResponse & {
  code?: string;
  message?: string;
};

const CATEGORY_HELPER_TEXT: Record<string, string> = {
  yes: "Choose natural Finnish ways to answer yes. Recording more than the minimum helps balance the dataset.",
  no: "Record short negative answers. You can repeat a phrase if you want to contribute another sample.",
  maybe: "Record phrases that mean maybe or possibly.",
  dont_know: "Record short not-sure answers, including local or informal forms when they feel natural.",
  correct: "Record short confirmation phrases.",
  number: "Record number words in a clear, natural voice.",
};

function getVolunteerAppTitle(value: unknown) {
  const title = typeof value === "string" ? value.replace(/\bAINA\s*/gi, "").trim() : "";
  return title || "Speech Collector";
}

function getCategoryHelpText(category: CategoryStateCategory | null) {
  if (!category) {
    return "";
  }

  return CATEGORY_HELPER_TEXT[category.id] || "Record several different phrases in this category.";
}

function getCategoryById(
  state: CategoryStateResponse | null,
  categoryId: string | null | undefined
) {
  if (!state || !categoryId) {
    return null;
  }

  return state.categories.find((category) => category.id === categoryId) || null;
}

function getCategoryIndex(state: CategoryStateResponse | null, categoryId: string | null | undefined) {
  if (!state || !categoryId) {
    return -1;
  }

  return state.categories.findIndex((category) => category.id === categoryId);
}

function getInitialCategoryId(
  state: CategoryStateResponse,
  preferredCategoryId: string | null | undefined
) {
  const preferredCategory = getCategoryById(state, preferredCategoryId);
  if (preferredCategory?.unlocked) {
    return preferredCategory.id;
  }

  const backendActiveCategory = getCategoryById(state, state.activeCategoryId);
  if (backendActiveCategory?.unlocked) {
    return backendActiveCategory.id;
  }

  return state.categories.find((category) => category.unlocked)?.id || state.categories[0]?.id || null;
}

function phraseHasBackendRecordedState(phrase: CategoryPhraseState) {
  return phrase.recordedInCurrentSession || phrase.recordedPreviouslyOnDevice;
}

function getInitialPhraseId(
  category: CategoryStateCategory | null,
  preferredPhraseId: string | null | undefined
) {
  if (!category) {
    return null;
  }

  if (preferredPhraseId && category.phrases.some((phrase) => phrase.phraseId === preferredPhraseId)) {
    return preferredPhraseId;
  }

  return (
    category.phrases.find((phrase) => !phraseHasBackendRecordedState(phrase))?.phraseId ||
    category.phrases[0]?.phraseId ||
    null
  );
}

function getNextCategory(state: CategoryStateResponse | null, categoryId: string | null | undefined) {
  const index = getCategoryIndex(state, categoryId);
  return index >= 0 ? state?.categories[index + 1] || null : null;
}

function getPreviousCategory(
  state: CategoryStateResponse | null,
  categoryId: string | null | undefined
) {
  const index = getCategoryIndex(state, categoryId);
  return index > 0 ? state?.categories[index - 1] || null : null;
}

function isCategoryEligibleForNext(category: CategoryStateCategory | null) {
  if (!category) {
    return false;
  }

  return (
    category.complete ||
    category.requiredCount === 0 ||
    category.progress.uniqueRecordedCount >= category.requiredCount
  );
}

function getProgressPercent(category: CategoryStateCategory) {
  if (!category.progress.totalPhrases) {
    return 0;
  }

  return Math.min(
    (category.progress.uniqueRecordedCount / category.progress.totalPhrases) * 100,
    100
  );
}

function getRequirementText(category: CategoryStateCategory) {
  if (category.requiredCount <= 1) {
    return "1 phrase required to continue";
  }

  return `${category.requiredCount} different phrases required to continue`;
}

function getPhraseStatusLabel(phrase: CategoryPhraseState) {
  if (phrase.recordedInCurrentSession) {
    return "Recorded this session";
  }

  if (phrase.recordedPreviouslyOnDevice) {
    return "Recorded before on this browser/device";
  }

  return "Not recorded yet";
}

function getPhraseStatusClassName(phrase: CategoryPhraseState) {
  if (phrase.recordedInCurrentSession) {
    return "category-phrase-card__status category-phrase-card__status--current";
  }

  if (phrase.recordedPreviouslyOnDevice) {
    return "category-phrase-card__status category-phrase-card__status--previous";
  }

  return "category-phrase-card__status";
}

function App() {
  const {
    sessionToken,
    participantMetadata,
    applySession,
    clearSession,
    setCurrentTask,
    setProgress,
  } = useContext(SessionContext);

  const [phase, setPhase] = useState<Phase>("bootstrapping");
  const [metadataMode, setMetadataMode] = useState<MetadataMode>("required");
  const [message, setMessage] = useState<string>("");
  const [categoryState, setCategoryState] = useState<CategoryStateResponse | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedPhraseId, setSelectedPhraseId] = useState<string | null>(null);
  const [categoryLoading, setCategoryLoading] = useState<boolean>(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const hasBootstrapped = useRef(false);

  const apiUrl = import.meta.env.VITE_API_URL;
  const appName = getVolunteerAppTitle(import.meta.env.VITE_APP_TITLE);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";

  const metadataComplete = useMemo(
    () => isMetadataComplete(participantMetadata),
    [participantMetadata]
  );

  const selectedCategory = useMemo(
    () => getCategoryById(categoryState, selectedCategoryId),
    [categoryState, selectedCategoryId]
  );

  const selectedPhrase = useMemo(() => {
    if (!selectedCategory || !selectedPhraseId) {
      return null;
    }

    return selectedCategory.phrases.find((phrase) => phrase.phraseId === selectedPhraseId) || null;
  }, [selectedCategory, selectedPhraseId]);

  const nextCategory = useMemo(
    () => getNextCategory(categoryState, selectedCategoryId),
    [categoryState, selectedCategoryId]
  );

  const previousCategory = useMemo(
    () => getPreviousCategory(categoryState, selectedCategoryId),
    [categoryState, selectedCategoryId]
  );

  const canMoveToNextCategory = Boolean(
    nextCategory && (nextCategory.unlocked || isCategoryEligibleForNext(selectedCategory))
  );

  const allCategoryMinimumsCovered = Boolean(
    categoryState?.categories.length &&
      categoryState.categories.every((category) => isCategoryEligibleForNext(category))
  );

  const moveToTerminalPhase = useCallback(
    (
      nextPhase: Extract<Phase, "completed" | "abandoned" | "declined" | "unavailable" | "error">,
      nextMessage: string
    ) => {
      setCurrentTask(null);
      setCategoryState(null);
      setSelectedCategoryId(null);
      setSelectedPhraseId(null);
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

  const loadCategoryState = useCallback(
    async (tokenOverride?: string | null) => {
      const activeToken = tokenOverride ?? sessionToken;
      if (!activeToken) {
        moveToTerminalPhase("error", "A session token is required before loading categories.");
        return null;
      }

      setCategoryLoading(true);
      setMessage("");

      try {
        const response = await fetch(`${apiUrl}/api/category-state`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionToken: activeToken }),
        });

        const data = (await response.json()) as CategoryStateApiResponse;
        if (!data.success) {
          if (data.code === "session_metadata_required") {
            if (data.session) {
              syncSession(data.session);
            }
            setMetadataMode("required");
            setPhase("metadata");
            setMessage(data.message || "Complete the session details before recording.");
            return null;
          }

          if (data.code === "invalid_session") {
            moveToTerminalPhase("error", "The previous session could not be resumed.");
            return null;
          }

          throw new Error(data.message || "Could not load category progress.");
        }

        if (data.session) {
          syncSession(data.session);
        }

        if (data.sessionStatus === "completed") {
          moveToTerminalPhase(
            "completed",
            data.message ||
              "Thank you. Your recordings were saved. You can come back later on the same browser/device to record more phrases."
          );
          return null;
        }

        if (data.sessionStatus === "abandoned") {
          moveToTerminalPhase(
            "abandoned",
            data.message ||
              "Your submitted recordings were saved. You can come back later on the same browser/device to record more phrases."
          );
          return null;
        }

        setCategoryState(data);
        const nextCategoryId = getInitialCategoryId(data, selectedCategoryId);
        const nextSelectedCategory = getCategoryById(data, nextCategoryId);
        setSelectedCategoryId(nextCategoryId);
        setSelectedPhraseId(getInitialPhraseId(nextSelectedCategory, selectedPhraseId));
        setPhase("categoryRecording");
        return data;
      } catch (error) {
        moveToTerminalPhase(
          "error",
          error instanceof Error ? error.message : "Could not load category progress."
        );
        return null;
      } finally {
        setCategoryLoading(false);
      }
    },
    [apiUrl, moveToTerminalPhase, selectedCategoryId, selectedPhraseId, sessionToken, syncSession]
  );

  const startOrResumeSession = useCallback(
    async (tokenOverride?: string | null, turnstileTokenOverride?: string | null) => {
      setPhase("bootstrapping");
      setMessage("");
      setCurrentTask(null);
      setCategoryState(null);
      setSelectedCategoryId(null);
      setSelectedPhraseId(null);

      try {
        const activeTurnstileToken = turnstileTokenOverride ?? turnstileToken;
        const response = await fetch(`${apiUrl}/api/start-session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionToken: tokenOverride === undefined ? sessionToken : tokenOverride,
            turnstileToken: activeTurnstileToken || undefined,
          }),
        });

        const data = await response.json();
        if (!data.success) {
          if (data.code === "turnstile_failed" || data.code === "missing_turnstile_token") {
            setTurnstileToken(null);
            setPhase("verification");
            setMessage(data.message || "Human verification failed. Please try again.");
            return;
          }

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

        setMetadataMode("edit");
        setPhase("categoryIntro");
      } catch (error) {
        moveToTerminalPhase(
          "error",
          error instanceof Error ? error.message : "Could not start a session."
        );
      }
    },
    [
      apiUrl,
      closeSession,
      moveToTerminalPhase,
      sessionToken,
      setCurrentTask,
      syncSession,
      turnstileToken,
    ]
  );

  useEffect(() => {
    if (hasBootstrapped.current) {
      return;
    }

    hasBootstrapped.current = true;
    if (turnstileSiteKey && !turnstileToken) {
      setPhase("verification");
      return;
    }

    void startOrResumeSession(sessionToken, turnstileToken);
  }, [sessionToken, startOrResumeSession, turnstileSiteKey, turnstileToken]);

  const handleTurnstileVerified = useCallback(
    async (token: string) => {
      setTurnstileToken(token);
      await startOrResumeSession(sessionToken, token);
    },
    [sessionToken, startOrResumeSession]
  );

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
      setMessage("");
      if (categoryState) {
        await loadCategoryState(session.sessionToken);
        return;
      }

      setPhase("categoryIntro");
    },
    [categoryState, closeSession, loadCategoryState, syncSession]
  );

  const handleExitSession = useCallback(async () => {
    await closeSession(
      sessionToken,
      "abandoned",
      "Thank you. Your submitted recordings were saved. You can come back later on the same browser/device to record more phrases."
    );
  }, [closeSession, sessionToken]);

  const handleRestart = useCallback(async () => {
    clearSession();
    setCategoryState(null);
    setSelectedCategoryId(null);
    setSelectedPhraseId(null);
    setMetadataMode("required");
    setMessage("");
    if (turnstileSiteKey) {
      setTurnstileToken(null);
      setPhase("verification");
      return;
    }

    await startOrResumeSession(null);
  }, [clearSession, startOrResumeSession, turnstileSiteKey]);

  const handleSelectCategory = useCallback((category: CategoryStateCategory) => {
    if (!category.unlocked) {
      return;
    }

    setMessage("");
    setSelectedCategoryId(category.id);
    setSelectedPhraseId(getInitialPhraseId(category, null));
  }, []);

  const handleMoveToPreviousCategory = useCallback(() => {
    if (!previousCategory?.unlocked) {
      return;
    }

    setMessage("");
    setSelectedCategoryId(previousCategory.id);
    setSelectedPhraseId(getInitialPhraseId(previousCategory, null));
  }, [previousCategory]);

  const handleMoveToNextCategory = useCallback(() => {
    if (!nextCategory || !canMoveToNextCategory) {
      return;
    }

    setMessage("");
    setSelectedCategoryId(nextCategory.id);
    setSelectedPhraseId(getInitialPhraseId(nextCategory, null));
  }, [canMoveToNextCategory, nextCategory]);

  const handleRecordingUploaded = useCallback(
    async (result: { session?: SessionState; sessionStatus?: string }) => {
      if (result.session) {
        syncSession(result.session);
      }

      if (result.sessionStatus === "completed") {
        moveToTerminalPhase(
          "completed",
          "Thank you. Your recordings were saved. You can come back later on the same browser/device to record more phrases."
        );
        return;
      }

      const uploadedCategoryId = selectedCategoryId;
      const uploadedPhraseId = selectedPhraseId;
      const refreshedState = await loadCategoryState();

      if (!refreshedState || !uploadedCategoryId) {
        return;
      }

      const refreshedCategory = getCategoryById(refreshedState, uploadedCategoryId);
      if (!refreshedCategory) {
        return;
      }

      const nextUnrecordedPhrase =
        refreshedCategory.phrases.find(
          (phrase) =>
            phrase.phraseId !== uploadedPhraseId && !phraseHasBackendRecordedState(phrase)
        ) || refreshedCategory.phrases.find((phrase) => !phraseHasBackendRecordedState(phrase));

      if (nextUnrecordedPhrase) {
        setSelectedCategoryId(refreshedCategory.id);
        setSelectedPhraseId(nextUnrecordedPhrase.phraseId);
      }

      if (refreshedCategory.complete) {
        setMessage("Recording saved. All phrases in this category have been recorded.");
      } else if (isCategoryEligibleForNext(refreshedCategory)) {
        setMessage("Recording saved. You can continue here or move to the next category.");
      } else {
        setMessage("Recording saved. Choose another phrase in this category.");
      }
    },
    [
      loadCategoryState,
      moveToTerminalPhase,
      selectedCategoryId,
      selectedPhraseId,
      syncSession,
    ]
  );

  if (phase === "bootstrapping") {
    return (
      <main className="app-shell">
        <section className="app-panel app-panel--narrow">
          <span className="app-eyebrow">Speech Collector</span>
          <h1 className="app-title">Preparing your session</h1>
          <p className="app-copy">Connecting to the next available prompt set.</p>
        </section>
      </main>
    );
  }

  if (phase === "verification") {
    if (!turnstileSiteKey) {
      return (
        <main className="app-shell">
          <section className="app-panel app-panel--narrow">
            <span className="app-eyebrow">Speech Collector</span>
            <h1 className="app-title">Verification unavailable</h1>
            <p className="app-copy">
              Human verification is required, but the Turnstile site key is not configured.
            </p>
          </section>
        </main>
      );
    }

    return (
      <main className="app-shell">
        <TurnstileGate
          siteKey={turnstileSiteKey}
          message={message}
          onVerified={handleTurnstileVerified}
        />
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
            message ||
            (metadataMode === "required"
              ? "Tell us a little about the recording conditions and confirm consent before you begin."
              : "Update the session details if something changed.")
          }
          canCancel={metadataMode === "edit" && metadataComplete}
          onCancel={() => setPhase(categoryState ? "categoryRecording" : "categoryIntro")}
          onSaved={handleMetadataSaved}
        />
      </main>
    );
  }

  if (phase === "categoryIntro") {
    return (
      <main className="app-shell">
        <section className="app-panel app-panel--narrow">
          <span className="app-eyebrow">{appName}</span>
          <h1 className="app-title">Category recording</h1>
          <div className="category-intro-copy">
            <p>
              Thank you for helping us collect Finnish short speech samples.
            </p>
            <p>
              The task is divided into categories such as Yes, No, Maybe, Not sure, Correct,
              and Numbers.
            </p>
            <p>
              Please record at least 3 different phrases from each category when possible.
              Recording more phrases is very helpful, and recording all phrases is even better.
            </p>
            <p>
              You can listen to each recording before submitting, re-record if needed, and stop
              the session at any time.
            </p>
          </div>
          <div className="category-intro-actions">
            <button
              type="button"
              className="app-primary-button"
              onClick={() => void loadCategoryState()}
              disabled={categoryLoading}
            >
              {categoryLoading ? "Loading..." : "Start recording"}
            </button>
            <button type="button" className="app-secondary-button" onClick={handleExitSession}>
              Finish for now
            </button>
          </div>
          {message && <p className="app-inline-message app-inline-message--error">{message}</p>}
        </section>
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
          <div className="app-header__content">
            <span className="app-eyebrow">{appName}</span>
            <h1 className="app-session-title">Record category phrases</h1>
            <p className="app-copy">
              Pick a phrase, record it, listen back, and submit it when you are happy with it.
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
              Finish for now
            </button>
          </div>
        </header>

        {categoryLoading && <p className="app-copy">Loading category progress.</p>}

        {categoryState && (
          <>
            <nav className="category-stepper" aria-label="Recording categories">
              {categoryState.categories.map((category, index) => {
                const selected = category.id === selectedCategoryId;
                const categoryEligible = isCategoryEligibleForNext(category);
                return (
                  <button
                    key={category.id}
                    type="button"
                    className={
                      selected
                        ? "category-stepper__item category-stepper__item--selected"
                        : "category-stepper__item"
                    }
                    onClick={() => handleSelectCategory(category)}
                    disabled={!category.unlocked}
                    aria-current={selected ? "step" : undefined}
                  >
                    <span className="category-stepper__number">{index + 1}</span>
                    <span className="category-stepper__body">
                      <span className="category-stepper__title">{category.title}</span>
                      <span className="category-stepper__meta">
                        {category.progress.uniqueRecordedCount} / {category.totalPhrases} phrases
                        {categoryEligible ? " covered" : category.unlocked ? " open" : " locked"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>

            {selectedCategory ? (
              <section className="category-workspace" aria-labelledby="category-title">
                <div className="category-summary">
                  <div>
                    <span className="app-eyebrow">Current category</span>
                    <h2 id="category-title" className="category-summary__title">
                      {selectedCategory.title}
                    </h2>
                    <p className="app-copy">{getCategoryHelpText(selectedCategory)}</p>
                  </div>
                  <div className="category-summary__counter">
                    Recorded {selectedCategory.progress.uniqueRecordedCount} /{" "}
                    {selectedCategory.totalPhrases} phrases
                  </div>
                </div>

                <div className="category-progress">
                  <div className="category-progress__bar" aria-hidden="true">
                    <div
                      className="category-progress__fill"
                      style={{ width: `${getProgressPercent(selectedCategory)}%` }}
                    />
                  </div>
                  <div className="category-progress__labels">
                    <span>{getRequirementText(selectedCategory)}</span>
                    <span>
                      {selectedCategory.complete
                        ? "All phrases recorded"
                        : `${Math.max(
                            selectedCategory.requiredCount -
                              selectedCategory.progress.uniqueRecordedCount,
                            0
                          )} more for next category`}
                    </span>
                  </div>
                </div>

                <div className="category-layout">
                  <div className="category-phrase-list" aria-label="Phrases in this category">
                    {selectedCategory.phrases.map((phrase) => {
                      const selected = phrase.phraseId === selectedPhraseId;
                      return (
                        <button
                          key={phrase.phraseId}
                          type="button"
                          className={
                            selected
                              ? "category-phrase-card category-phrase-card--selected"
                              : "category-phrase-card"
                          }
                          onClick={() => {
                            setMessage("");
                            setSelectedPhraseId(phrase.phraseId);
                          }}
                        >
                          <span className="category-phrase-card__text">{phrase.text}</span>
                          <span className={getPhraseStatusClassName(phrase)}>
                            {getPhraseStatusLabel(phrase)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="selected-phrase-panel">
                    {selectedPhrase ? (
                      <>
                        <span className="app-eyebrow">Selected phrase</span>
                        <h3 className="selected-phrase-panel__text">{selectedPhrase.text}</h3>
                        <p className="app-copy">
                          Record this phrase naturally. You can record it again even if it was
                          already submitted.
                        </p>
                        <SoundRecorder
                          sessionToken={sessionToken}
                          taskId={selectedPhrase.taskId}
                          promptedWord={selectedPhrase.text}
                          onUploadComplete={handleRecordingUploaded}
                        />
                      </>
                    ) : (
                      <p className="app-copy">Choose a phrase to start recording.</p>
                    )}
                  </div>
                </div>

                <div className="category-navigation">
                  <button
                    type="button"
                    className="app-secondary-button"
                    onClick={handleMoveToPreviousCategory}
                    disabled={!previousCategory?.unlocked}
                  >
                    Previous category
                  </button>
                  <button
                    type="button"
                    className="app-primary-button"
                    onClick={handleMoveToNextCategory}
                    disabled={!canMoveToNextCategory}
                  >
                    Next category
                  </button>
                  <button type="button" className="app-secondary-button" onClick={handleExitSession}>
                    Finish for now
                  </button>
                </div>

                {allCategoryMinimumsCovered && (
                  <div className="category-complete-note">
                    <strong>All category minimums are covered.</strong>
                    <span>You can keep recording more phrases or finish for now.</span>
                  </div>
                )}
              </section>
            ) : (
              <p className="app-copy">No category is ready yet. Try refreshing the session.</p>
            )}
          </>
        )}

        {message && phase === "categoryRecording" && (
          <p className="app-inline-message">{message}</p>
        )}
      </section>
    </main>
  );
}

export default App;
