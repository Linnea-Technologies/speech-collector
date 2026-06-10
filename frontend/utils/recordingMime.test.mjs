import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecordingUploadFile,
  getActualRecordingMimeType,
  getAudioFileExtension,
  selectRecordingMimeType,
} from "./recordingMime.ts";

function mediaRecorderWithSupport(supportedTypes) {
  const supported = new Set(supportedTypes);
  return {
    isTypeSupported: (mimeType) => supported.has(mimeType),
  };
}

test("iPhone/WebKit capability set selects MP4/AAC first", () => {
  const navigatorLike = {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    platform: "iPhone",
    maxTouchPoints: 5,
  };

  assert.equal(
    selectRecordingMimeType(
      mediaRecorderWithSupport(["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus"]),
      navigatorLike
    ),
    "audio/mp4;codecs=mp4a.40.2"
  );
});

test("Android/Chrome capability set selects WebM/Opus first", () => {
  const navigatorLike = {
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
    platform: "Linux armv8l",
    maxTouchPoints: 5,
  };

  assert.equal(
    selectRecordingMimeType(
      mediaRecorderWithSupport(["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus"]),
      navigatorLike
    ),
    "audio/webm;codecs=opus"
  );
});

test("MP4 is selected when WebM is unsupported", () => {
  assert.equal(
    selectRecordingMimeType(mediaRecorderWithSupport(["audio/mp4"]), {
      userAgent: "Mozilla/5.0 Chrome/126.0 Safari/537.36",
      platform: "Win32",
      maxTouchPoints: 0,
    }),
    "audio/mp4"
  );
});

test("unsupported candidates and unavailable MediaRecorder fall back to browser default", () => {
  assert.equal(selectRecordingMimeType(mediaRecorderWithSupport([])), undefined);
  assert.equal(selectRecordingMimeType(undefined), undefined);
});

test("actual recorder or chunk MIME type is preferred over fallback", () => {
  assert.equal(
    getActualRecordingMimeType("audio/webm;codecs=opus", [], "audio/mp4"),
    "audio/webm;codecs=opus"
  );
  assert.equal(
    getActualRecordingMimeType("", [new Blob(["x"], { type: "audio/ogg;codecs=opus" })], "audio/mp4"),
    "audio/ogg;codecs=opus"
  );
  assert.equal(getActualRecordingMimeType("", [], "audio/mp4"), "audio/mp4");
});

test("known MIME types map to matching upload extensions", () => {
  assert.equal(getAudioFileExtension("audio/webm;codecs=opus"), "webm");
  assert.equal(getAudioFileExtension("audio/webm"), "webm");
  assert.equal(getAudioFileExtension("audio/mp4;codecs=mp4a.40.2"), "m4a");
  assert.equal(getAudioFileExtension("audio/mp4"), "m4a");
  assert.equal(getAudioFileExtension("audio/ogg;codecs=opus"), "ogg");
  assert.equal(getAudioFileExtension("audio/wav"), "wav");
});

test("unknown and empty MIME types use a neutral fallback, not fake WAV", () => {
  assert.equal(getAudioFileExtension(""), "bin");
  assert.equal(getAudioFileExtension(undefined), "bin");
  assert.equal(getAudioFileExtension("application/octet-stream"), "bin");
});

test("upload file uses original blob bytes, MIME, and matching extension", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const blob = new Blob([bytes], { type: "audio/webm;codecs=opus" });
  const file = buildRecordingUploadFile(blob, "task-123");

  assert.equal(file.name, "task-123.webm");
  assert.equal(file.type, "audio/webm;codecs=opus");
  assert.equal(file.size, blob.size);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
});

test("upload file does not unconditionally use WAV for unknown blob types", () => {
  const file = buildRecordingUploadFile(new Blob(["opaque-bytes"]), "task-123");

  assert.equal(file.name, "task-123.bin");
  assert.equal(file.type, "application/octet-stream");
});
