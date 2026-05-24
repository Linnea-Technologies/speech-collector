export type InferredOs = "iOS" | "Android" | "Windows" | "macOS" | "Linux" | "unknown";
export type InferredBrowser = "Chrome" | "Safari" | "Firefox" | "Edge" | "unknown";
export type InferredDeviceType = "mobile" | "tablet" | "desktop" | "unknown";

export interface BrowserTechnicalMetadata {
  user_agent: string | null;
  inferred_os: InferredOs;
  inferred_browser: InferredBrowser;
  inferred_device_type: InferredDeviceType;
}

type AudioTrackSettings = MediaTrackSettings & {
  sampleRate?: number;
  channelCount?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
};

function getUserAgent() {
  return typeof navigator !== "undefined" ? navigator.userAgent : "";
}

export function inferOs(userAgent = getUserAgent()): InferredOs {
  if (/iphone|ipad|ipod/i.test(userAgent)) {
    return "iOS";
  }

  if (/android/i.test(userAgent)) {
    return "Android";
  }

  if (/windows/i.test(userAgent)) {
    return "Windows";
  }

  if (/macintosh|mac os x/i.test(userAgent)) {
    return "macOS";
  }

  if (/linux/i.test(userAgent)) {
    return "Linux";
  }

  return "unknown";
}

export function inferBrowser(userAgent = getUserAgent()): InferredBrowser {
  if (/edg\//i.test(userAgent)) {
    return "Edge";
  }

  if (/firefox\//i.test(userAgent)) {
    return "Firefox";
  }

  if (/chrome|crios|chromium/i.test(userAgent) && !/edg\//i.test(userAgent)) {
    return "Chrome";
  }

  if (/safari/i.test(userAgent) && !/chrome|crios|chromium|android/i.test(userAgent)) {
    return "Safari";
  }

  return "unknown";
}

export function inferDeviceType(userAgent = getUserAgent()): InferredDeviceType {
  if (/ipad|tablet/i.test(userAgent)) {
    return "tablet";
  }

  if (/mobile|iphone|ipod|android/i.test(userAgent)) {
    return "mobile";
  }

  if (userAgent) {
    return "desktop";
  }

  return "unknown";
}

export function getBrowserTechnicalMetadata(): BrowserTechnicalMetadata {
  const userAgent = getUserAgent();

  return {
    user_agent: userAgent || null,
    inferred_os: inferOs(userAgent),
    inferred_browser: inferBrowser(userAgent),
    inferred_device_type: inferDeviceType(userAgent),
  };
}

export function getAudioTrackTechnicalMetadata(settings?: MediaTrackSettings) {
  const audioSettings = settings as AudioTrackSettings | undefined;

  return {
    sample_rate_hz: audioSettings?.sampleRate ?? null,
    channel_count: audioSettings?.channelCount ?? null,
    media_stream_settings: {
      echoCancellation: audioSettings?.echoCancellation ?? null,
      noiseSuppression: audioSettings?.noiseSuppression ?? null,
      autoGainControl: audioSettings?.autoGainControl ?? null,
    },
  };
}
