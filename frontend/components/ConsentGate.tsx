import { useState } from "react";

import { WelcomeInformationSummary } from "./ConsentInformation";

interface ConsentGateProps {
  message?: string;
  onAccepted: () => Promise<void> | void;
  onDeclined: () => void;
}

const ConsentGate = ({ message, onAccepted, onDeclined }: ConsentGateProps) => {
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const canContinue = ageConfirmed && consentConfirmed;

  return (
    <section className="app-panel app-panel--narrow consent-panel">
      <span className="app-eyebrow">Linnea Technologies Oy</span>
      <h1 className="app-title">
        Tervetuloa osallistumaan suomenkieliseen puheaineiston keruuseen
      </h1>
      <p className="consent-title-translation">Welcome to the Finnish speech collection</p>

      <WelcomeInformationSummary />

      {message && <p className="app-inline-message app-inline-message--error">{message}</p>}

      <div className="consent-checks">
        <label className="consent-check">
          <input
            type="checkbox"
            checked={ageConfirmed}
            onChange={(event) => setAgeConfirmed(event.target.checked)}
          />
          <span>
            <strong>Vahvistan, että olen täysi-ikäinen (18 vuotta tai vanhempi).</strong>
            <span>I confirm that I am 18 years or older.</span>
          </span>
        </label>

        <label className="consent-check">
          <input
            type="checkbox"
            checked={consentConfirmed}
            onChange={(event) => setConsentConfirmed(event.target.checked)}
          />
          <span>
            <strong>
              Olen lukenut osallistumista ja tietosuojaa koskevat tiedot, ja annan
              suostumukseni osallistua.
            </strong>
            <span>
              I have read the participation and privacy information, and I consent to
              participate.
            </span>
          </span>
        </label>
      </div>

      <div className="consent-actions">
        <button
          type="button"
          className="app-primary-button"
          disabled={!canContinue}
          onClick={() => void onAccepted()}
        >
          Jatka / Continue
        </button>
        <button type="button" className="app-secondary-button" onClick={onDeclined}>
          En osallistu / Decline
        </button>
      </div>
    </section>
  );
};

export default ConsentGate;
