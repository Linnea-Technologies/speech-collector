import { useEffect, useRef, useState } from "react";
import { useReactMediaRecorder } from "react-media-recorder";

import { getAudioTrackTechnicalMetadata } from "../utils/technicalMetadata";
import "./SoundRecorder.css";

interface SoundRecorderProps {
  sessionToken: string | null;
  taskId: string;
  promptedWord: string;
  onUploadComplete: (result: any) => void;
  onNextTask: () => Promise<void> | void;
}

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
}: SoundRecorderProps) => {
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
  });
  const [taskDone, setTaskDone] = useState<boolean>(false);
  const [soundUploading, setSoundUploading] = useState<boolean>(false);
  const [uploadFailed, setUploadFailed] = useState<boolean>(false);
  const [uploadMessage, setUploadMessage] = useState<string>("");
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [literalTranscript, setLiteralTranscript] = useState<string>(promptedWord);
  const clearBlobUrlRef = useRef(clearBlobUrl);
  const stopRecordingRef = useRef(stopRecording);
  const maxRecordingSeconds = getMaxRecordingSeconds();
  const apiUrl = import.meta.env.VITE_API_URL;

  useEffect(() => {
    clearBlobUrlRef.current = clearBlobUrl;
    stopRecordingRef.current = stopRecording;
  }, [clearBlobUrl, stopRecording]);

  useEffect(() => {
    setTaskDone(false);
    setSoundUploading(false);
    setUploadFailed(false);
    setUploadMessage("");
    setElapsedSeconds(0);
    setLiteralTranscript(promptedWord);
    clearBlobUrlRef.current();
  }, [promptedWord, taskId]);

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
      setLiteralTranscript(promptedWord);
    }
  }, [maxRecordingSeconds, mediaBlobUrl, promptedWord, status]);

  const handleStartRecording = () => {
    clearBlobUrl();
    setTaskDone(false);
    setUploadFailed(false);
    setUploadMessage("");
    setElapsedSeconds(0);
    setLiteralTranscript(promptedWord);
    startRecording();
  };

  const buildUploadMetadata = () => {
    const trimmedTranscript = literalTranscript.trim();
    const trimmedPrompt = promptedWord.trim();
    const userConfirmed = Boolean(trimmedTranscript) && trimmedTranscript !== trimmedPrompt;
    const settings = previewAudioStream?.getAudioTracks()[0]?.getSettings();

    return {
      schema_version: "v1",
      literal_transcript: userConfirmed ? trimmedTranscript : null,
      label_source: userConfirmed ? "user_confirmed" : "prompt_assumed",
      technical: getAudioTrackTechnicalMetadata(settings),
    };
  };

  const uploadSound = async () => {
    if (!sessionToken) {
      throw new Error("A session token is required before uploading.");
    }

    if (!mediaBlobUrl) {
      throw new Error("Record audio before uploading.");
    }

    const formData = new FormData();
    formData.append("sessionToken", sessionToken);
    formData.append("taskId", taskId);
    formData.append("metadata", JSON.stringify(buildUploadMetadata()));

    const blob = await fetch(mediaBlobUrl).then((response) => response.blob());
    const file = new File([blob], `${taskId}.wav`, { type: "audio/wav" });
    formData.append("file", file);

    const response = await fetch(`${apiUrl}/api/upload-sound`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
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
            <audio src={mediaBlobUrl} controls />
            <label className="recorder-transcript" htmlFor={`literal-transcript-${taskId}`}>
              <span>What did you actually say? (optional)</span>
              <span className="recorder-transcript__helper">
                Leave this as shown if you followed the prompt. If you said a shorter or dialect
                form, you can write it here, for example <code>kyl</code> instead of{" "}
                <code>kyllä</code>.
              </span>
              <input
                id={`literal-transcript-${taskId}`}
                type="text"
                value={literalTranscript}
                onChange={(event) => setLiteralTranscript(event.target.value)}
                className="recorder-transcript__input"
              />
            </label>
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
              setTaskDone(result.sessionStatus !== "completed");
              setUploadMessage("Recording saved.");
              onUploadComplete(result);
            } catch (error) {
              setUploadFailed(true);
              setUploadMessage(
                error instanceof Error ? error.message : "Upload failed. Please try again."
              );
            } finally {
              setSoundUploading(false);
            }
          }}
          disabled={status !== "stopped" || !mediaBlobUrl || soundUploading}
        >
          {soundUploading ? "Uploading..." : "Upload"}
        </button>
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
          Next prompt
        </button>
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
