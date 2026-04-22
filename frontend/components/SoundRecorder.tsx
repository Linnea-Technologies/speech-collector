import { useEffect, useState } from "react";
import { useReactMediaRecorder } from "react-media-recorder";

import "./SoundRecorder.css";

interface SoundRecorderProps {
  sessionToken: string | null;
  taskId: string;
  onUploadComplete: (result: any) => void;
  onNextTask: () => Promise<void> | void;
}

const SoundRecorder = ({
  sessionToken,
  taskId,
  onUploadComplete,
  onNextTask,
}: SoundRecorderProps) => {
  const { status, startRecording, stopRecording, mediaBlobUrl } = useReactMediaRecorder({
    video: false,
  });
  const [taskDone, setTaskDone] = useState<boolean>(false);
  const [soundUploading, setSoundUploading] = useState<boolean>(false);
  const [uploadFailed, setUploadFailed] = useState<boolean>(false);
  const [uploadMessage, setUploadMessage] = useState<string>("");
  const apiUrl = import.meta.env.VITE_API_URL;

  useEffect(() => {
    setTaskDone(false);
    setSoundUploading(false);
    setUploadFailed(false);
    setUploadMessage("");
  }, [taskId]);

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
          <audio src={mediaBlobUrl} controls />
        ) : (
          <p className="app-copy">Record a short answer, review it, then upload it.</p>
        )}
      </div>

      <div className="recorder-actions">
        <button
          type="button"
          className="app-primary-button"
          onClick={startRecording}
          disabled={status === "recording" || soundUploading}
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
          disabled={status !== "stopped" || soundUploading}
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

      {status === "recording" && <p className="app-inline-message">Recording in progress.</p>}
      {uploadMessage && (
        <p className={uploadFailed ? "app-inline-message app-inline-message--error" : "app-inline-message"}>
          {uploadMessage}
        </p>
      )}
    </section>
  );
};

export default SoundRecorder;
