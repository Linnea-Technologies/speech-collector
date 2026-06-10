type MediaRecorderConstructorLike = {
  isTypeSupported?: (mimeType: string) => boolean;
};

type NavigatorLike = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
};

const MP4_AUDIO_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"];
const WEBM_AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm"];
const FALLBACK_AUDIO_TYPES = ["audio/ogg;codecs=opus", "audio/ogg", "audio/wav"];
const UNKNOWN_AUDIO_UPLOAD_MIME_TYPE = "application/octet-stream";

function getNavigatorLike(): NavigatorLike | undefined {
  return typeof navigator === "undefined" ? undefined : navigator;
}

export function shouldPreferMp4Recording(navigatorLike: NavigatorLike | undefined = getNavigatorLike()) {
  const userAgent = navigatorLike?.userAgent || "";
  const platform = navigatorLike?.platform || "";
  const maxTouchPoints = navigatorLike?.maxTouchPoints || 0;
  const isiOS =
    /iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  const isSafari = /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|FxiOS|Edg/i.test(userAgent);

  return isiOS || isSafari;
}

export function getRecordingMimeTypeCandidates(
  navigatorLike: NavigatorLike | undefined = getNavigatorLike()
) {
  return shouldPreferMp4Recording(navigatorLike)
    ? [...MP4_AUDIO_TYPES, ...WEBM_AUDIO_TYPES, ...FALLBACK_AUDIO_TYPES]
    : [...WEBM_AUDIO_TYPES, ...FALLBACK_AUDIO_TYPES, ...MP4_AUDIO_TYPES];
}

export function selectRecordingMimeType(
  mediaRecorderConstructor: MediaRecorderConstructorLike | undefined =
    typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
  navigatorLike: NavigatorLike | undefined = getNavigatorLike()
) {
  if (!mediaRecorderConstructor?.isTypeSupported) {
    return undefined;
  }

  return getRecordingMimeTypeCandidates(navigatorLike).find((mimeType) =>
    mediaRecorderConstructor.isTypeSupported?.(mimeType)
  );
}

export function getActualRecordingMimeType(
  recorderMimeType: string | undefined,
  chunks: Blob[],
  fallbackMimeType: string | undefined
) {
  return (
    recorderMimeType ||
    chunks.find((chunk) => chunk.type)?.type ||
    fallbackMimeType ||
    ""
  );
}

export function getAudioFileExtension(mimeType: string | undefined) {
  const containerType = (mimeType || "").split(";")[0].trim().toLowerCase();

  switch (containerType) {
    case "audio/mp4":
    case "video/mp4":
      return "m4a";
    case "audio/webm":
    case "video/webm":
      return "webm";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    case "audio/aac":
      return "aac";
    case "audio/mpeg":
      return "mp3";
    default:
      return "bin";
  }
}

export function buildRecordingUploadFile(recordingBlob: Blob, taskId: string) {
  return new File([recordingBlob], `${taskId}.${getAudioFileExtension(recordingBlob.type)}`, {
    type: recordingBlob.type || UNKNOWN_AUDIO_UPLOAD_MIME_TYPE,
  });
}
