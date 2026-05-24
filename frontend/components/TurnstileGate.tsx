import { useEffect, useRef, useState } from "react";

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script";
const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
    }
  ) => string | undefined;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface TurnstileGateProps {
  siteKey: string;
  message?: string;
  onVerified: (token: string) => Promise<void> | void;
}

function ensureTurnstileScript() {
  const existingScript = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
  if (existingScript) {
    return existingScript;
  }

  const script = document.createElement("script");
  script.id = TURNSTILE_SCRIPT_ID;
  script.src = TURNSTILE_SCRIPT_SRC;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
  return script;
}

const TurnstileGate = ({ siteKey, message, onVerified }: TurnstileGateProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | undefined>();
  const [statusMessage, setStatusMessage] = useState(message || "Complete the quick check to begin.");

  useEffect(() => {
    setStatusMessage(message || "Complete the quick check to begin.");
  }, [message]);

  useEffect(() => {
    const script = ensureTurnstileScript();
    let cancelled = false;

    const renderTurnstile = () => {
      if (cancelled || !containerRef.current || !window.turnstile || widgetIdRef.current) {
        return;
      }

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => {
          setStatusMessage("Verification complete. Preparing your session.");
          void onVerified(token);
        },
        "error-callback": () => {
          setStatusMessage("Verification failed. Please try again.");
          window.turnstile?.reset(widgetIdRef.current);
        },
        "expired-callback": () => {
          setStatusMessage("Verification expired. Please try again.");
          window.turnstile?.reset(widgetIdRef.current);
        },
      });
    };

    if (window.turnstile) {
      renderTurnstile();
    } else {
      script.addEventListener("load", renderTurnstile, { once: true });
    }

    return () => {
      cancelled = true;
      script.removeEventListener("load", renderTurnstile);
    };
  }, [onVerified, siteKey]);

  return (
    <section className="app-panel app-panel--narrow">
      <span className="app-eyebrow">Speech Collector</span>
      <h1 className="app-title">Human verification</h1>
      <p className="app-copy">{statusMessage}</p>
      <div className="app-turnstile" ref={containerRef} />
    </section>
  );
};

export default TurnstileGate;
