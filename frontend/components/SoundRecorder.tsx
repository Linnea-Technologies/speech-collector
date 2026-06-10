import { useEffect, useMemo, useRef, useState } from "react";
import { useReactMediaRecorder } from "react-media-recorder";

import {
  buildRecordingUploadFile,
  getActualRecordingMimeType,
  getAudioFileExtension,
  selectRecordingMimeType,
} from "../utils/recordingMime";
import type { SessionState, SessionStatus } from "../types/session";
import { getAudioTrackTechnicalMetadata } from "../utils/technicalMetadata";
import "./SoundRecorder.css";

interface UploadSoundResult {
  success?: boolean;
  message?: string;
  session?: SessionState;
  sessionStatus?: SessionStatus;
  [key: string]: unknown;
}

interface SoundRecorderProps {
  sessionToken: string | null;
  taskId: string;
  promptedWord: string;
  onUploadComplete: (result: UploadSoundResult) => Promise<void> | void;
  onNextTask?: () => Promise<void> | void;
  nextActionLabel?: string;
}

type TranscriptMode = "same" | "different";

function getMaxRecordingSeconds() {
  const parsed = Number.parseInt(import.meta.env.VITE_MAX_RECORDING_SECONDS || "5", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

const SoundRecorder = ({
  sessionToken,
  taskId,
  promptedWord,
  onUploadComplete,
  onNextTask,
  nextActionLabel = "Next prompt",
}: SoundRecorderProps) => {
  const selectedRecordingMimeType = useMemo(() => selectRecordingMimeType(), []);
  const mediaDebugEnabled = useMemo(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") {
      return false;
    }

    return new URLSearchParams(window.location.search).get("mediaDebug") === "1";
  }, []);
  const mediaRecorderOptions = useMemo<MediaRecorderOptions | undefined>(
    () =>
      selectedRecordingMimeType
        ? {
            mimeType: selectedRecordingMimeType,
          }
        : undefined,
    [selectedRecordingMimeType]
  );
  const blobPropertyBag = useMemo<BlobPropertyBag>(() => ({}), []);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [playbackMessage, setPlaybackMessage] = useState<string>("");
  const logMediaDebug = (event: string, payload: Record<string, unknown>) => {
    if (!mediaDebugEnabled) {
      return;
    }

    console.info("[mediaDebug]", event, payload);
  };
  const {
    error: recorderError,
    status,
    startRecording,
    stopRecording,
    mediaBlobUrl,
    previewAudioStream,
    clearBlobUrl,
  } = useReactMediaRecorder({
    audio: true,
    video: false,
    mediaRecorderOptions,
    blobPropertyBag,
    onStop: (_blobUrl, blob) => {
      const actualMimeType = getActualRecordingMimeType(blob.type, [], selectedRecordingMimeType);
      const typedBlob =
        actualMimeType && blob.type !== actualMimeType ? new Blob([blob], { type: actualMimeType }) : blob;

      logMediaDebug("recording-stopped", {
        selectedMimeType: selectedRecordingMimeType || null,
        actualBlobMimeType: typedBlob.type || null,
        blobSize: typedBlob.size,
        extension: getAudioFileExtension(typedBlob.type),
      });
      setRecordingBlob(typedBlob);
    },
  });
  const [taskDone, setTaskDone] = useState<boolean>(false);
  const [soundUploading, setSoundUploading] = useState<boolean>(false);
  const [uploadFailed, setUploadFailed] = useState<boolean>(false);
  const [uploadMessage, setUploadMessage] = useState<string>("");
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [transcriptMode, setTranscriptMode] = useState<TranscriptMode>("same");
  const [literalTranscript, setLiteralTranscript] = useState<string>("");
  const clearBlobUrlRef = useRef(clearBlobUrl);
  const stopRecordingRef = useRef(stopRecording);
  const maxRecordingSeconds = getMaxRecordingSeconds();
  const apiUrl = import.meta.env.VITE_API_URL;

  useEffect(() => {
    clearBlobUrlRef.current = clearBlobUrl;
    stopRecordingRef.current = stopRecording;
  }, [clearBlobUrl, stopRecording]);

  useEffect(() => () => clearBlobUrlRef.current(), []);

  useEffect(() => {
    setTaskDone(false);
    setSoundUploading(false);
    setUploadFailed(false);
    setUploadMessage("");
    setElapsedSeconds(0);
    setTranscriptMode("same");
    setLiteralTranscript("");
    setRecordingBlob(null);
    setPlaybackMessage("");
    clearBlobUrlRef.current();
  }, [taskId]);

  useEffect(() => {
    if (status !== "recording") {
      return undefined;
    }

    const startedAt = Date.now();
    setElapsedSeconds(0);

    const intervalId = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setElapsedSeconds(Math.min(elapsed, maxRecordingSeconds));
    }, 250);

    const timeoutId = window.setTimeout(() => {
      stopRecordingRef.current();
    }, maxRecordingSeconds * 1000);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [maxRecordingSeconds, status]);

  useEffect(() => {
    if (status === "stopped" && mediaBlobUrl) {
      setElapsedSeconds(maxRecordingSeconds);
      setTranscriptMode("same");
      setLiteralTranscript("");
    }
  }, [maxRecordingSeconds, mediaBlobUrl, status]);

  const handleStartRecording = () => {
    clearBlobUrl();
    setRecordingBlob(null);
    setPlaybackMessage("");
    setTaskDone(false);
    setUploadFailed(false);
    setUploadMessage("");
    setElapsedSeconds(0);
    setTranscriptMode("same");
    setLiteralTranscript("");
    startRecording();
  };

  const buildUploadMetadata = () => {
    const trimmedTranscript = literalTranscript.trim();
    const userConfirmed = transcriptMode === "different" && Boolean(trimmedTranscript);
    const settings = previewAudioStream?.getAudioTracks()[0]?.getSettings();

    return {
      schema_version: "v1",
      literal_transcript: userConfirmed ? trimmedTranscript : null,
      label_source: userConfirmed ? "user_confirmed" : "prompt_assumed",
      technical: getAudioTrackTechnicalMetadata(settings),
    };
  };

  const uploadSound = async (): Promise<UploadSoundResult> => {
    if (!sessionToken) {
      throw new Error("A session token is required before uploading.");
    }

    if (!recordingBlob || recordingBlob.size === 0) {
      throw new Error("Record audio before uploading.");
    }

    const formData = new FormData();
    formData.append("sessionToken", sessionToken);
    formData.append("taskId", taskId);
    formData.append("metadata", JSON.stringify(buildUploadMetadata()));

    const file = buildRecordingUploadFile(recordingBlob, taskId);
    formData.append("file", file);

    const response = await fetch(`${apiUrl}/api/upload-sound`, {
      method: "POST",
      body: formData,
    });

    const data = (await response.json()) as UploadSoundResult;
    if (!data.success) {
      throw new Error(data.message || "Could not upload the recording.");
    }

    return data;
  };

  return (
    <section className="recorder-panel">
      <div className="recorder-preview">
        {mediaBlobUrl ? (
          <>
            <audio
              key={mediaBlobUrl}
              controls
              preload="metadata"
              onCanPlay={() => setPlaybackMessage("")}
              onLoadedMetadata={(event) => {
                setPlaybackMessage("");
                logMediaDebug("audio-loadedmetadata", {
                  blobMimeType: recordingBlob?.type || null,
                  canPlayType: recordingBlob?.type
                    ? event.currentTarget.canPlayType(recordingBlob.type)
                    : "",
                  duration: event.currentTarget.duration,
                });
              }}
              onStalled={() => {
                logMediaDebug("audio-stalled", {
                  blobMimeType: recordingBlob?.type || null,
                  blobSize: recordingBlob?.size ?? null,
                });
                setPlaybackMessage("Playback is still loading. If it does not start, try re-recording.");
              }}
              onError={(event) => {
                const audioError = event.currentTarget.error;
                logMediaDebug("audio-error", {
                  blobMimeType: recordingBlob?.type || null,
                  canPlayType: recordingBlob?.type
                    ? event.currentTarget.canPlayType(recordingBlob.type)
                    : "",
                  errorCode: audioError?.code ?? null,
                  errorMessage: audioError?.message || null,
                });
                setPlaybackMessage(
                  audioError
                    ? `Playback could not load on this device. Error code: ${audioError.code}.`
                    : "Playback could not load on this device. Try re-recording before upload."
                );
              }}
            >
              <source src={mediaBlobUrl} type={recordingBlob?.type || undefined} />
            </audio>
            {playbackMessage && (
              <p className="app-inline-message app-inline-message--error">{playbackMessage}</p>
            )}
            <div className="recorder-transcript">
              <span>What did you actually say?</span>
              <div className="recorder-transcript__options">
                <button
                  type="button"
                  className={
                    transcriptMode === "same"
                      ? "recorder-transcript__choice recorder-transcript__choice--selected"
                      : "recorder-transcript__choice"
                  }
                  onClick={() => {
                    setTranscriptMode("same");
                    setLiteralTranscript("");
                  }}
                >
                  Same as shown
                </button>
              </div>
              <label
                className="recorder-transcript__different"
                htmlFor={`literal-transcript-${taskId}`}
              >
                <span>I said it differently / in my local dialect</span>
                <input
                  id={`literal-transcript-${taskId}`}
                  type="text"
                  value={literalTranscript}
                  onFocus={() => setTranscriptMode("different")}
                  onChange={(event) => {
                    setTranscriptMode("different");
                    setLiteralTranscript(event.target.value);
                  }}
                  placeholder="Type what you actually said"
                  className="recorder-transcript__input"
                />
              </label>
              <span className="recorder-transcript__helper">
                Leave the field empty to submit this as "{promptedWord}".
              </span>
            </div>
          </>
        ) : (
          <p className="app-copy">
            Record a short answer. Recording stops automatically after {maxRecordingSeconds} seconds.
          </p>
        )}
      </div>

      <div className="recorder-actions">
        <button
          type="button"
          className="app-primary-button"
          onClick={handleStartRecording}
          disabled={status === "recording" || Boolean(mediaBlobUrl) || soundUploading}
        >
          Start recording
        </button>
        <button
          type="button"
          className="app-secondary-button"
          onClick={stopRecording}
          disabled={status !== "recording" || soundUploading}
        >
          Stop
        </button>
        <button
          type="button"
          className="app-secondary-button"
          onClick={handleStartRecording}
          disabled={!mediaBlobUrl || status === "recording" || soundUploading}
        >
          Re-record
        </button>
        <button
          type="button"
          className="app-secondary-button"
          onClick={async () => {
            try {
              setSoundUploading(true);
              setUploadFailed(false);
              setUploadMessage("");
              const result = await uploadSound();
              setTaskDone(Boolean(onNextTask) && result.sessionStatus !== "completed");
              setRecordingBlob(null);
              setPlaybackMessage("");
              clearBlobUrlRef.current();
              setUploadMessage("Recording saved.");
              await onUploadComplete(result);
            } catch (error) {
              setUploadFailed(true);
              setUploadMessage(
                error instanceof Error ? error.message : "Upload failed. Please try again."
              );
            } finally {
              setSoundUploading(false);
            }
          }}
          disabled={status !== "stopped" || !recordingBlob || recordingBlob.size === 0 || soundUploading}
        >
          {soundUploading ? "Uploading..." : "Upload"}
        </button>
        {onNextTask && (
          <button
            type="button"
            className="app-secondary-button"
            onClick={() => {
              setTaskDone(false);
              setUploadMessage("");
              void onNextTask();
            }}
            disabled={!taskDone}
          >
            {nextActionLabel}
          </button>
        )}
      </div>

      {status === "recording" && (
        <p className="app-inline-message">
          Recording... {elapsedSeconds} / {maxRecordingSeconds} seconds. Auto-stop in{" "}
          {Math.max(maxRecordingSeconds - elapsedSeconds, 0)} seconds.
        </p>
      )}
      {recorderError && (
        <p className="app-inline-message app-inline-message--error">
          Microphone error: {recorderError}
        </p>
      )}
      {uploadMessage && (
        <p className={uploadFailed ? "app-inline-message app-inline-message--error" : "app-inline-message"}>
          {uploadMessage}
        </p>
      )}
    </section>
  );
};

export default SoundRecorder;
