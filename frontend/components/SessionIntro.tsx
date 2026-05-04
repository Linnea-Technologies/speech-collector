interface SessionIntroProps {
  title: string;
  summary: string;
  details: string[];
  actionLabel: string;
  onContinue: () => void;
}

const SessionIntro = ({
  title,
  summary,
  details,
  actionLabel,
  onContinue,
}: SessionIntroProps) => {
  return (
    <section className="app-panel app-panel--narrow">
      <span className="app-eyebrow">Speech Collector</span>
      <h1 className="app-title">{title}</h1>
      <p className="app-copy">{summary}</p>
      <ul className="app-list">
        {details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
      <button type="button" className="app-primary-button" onClick={onContinue}>
        {actionLabel}
      </button>
    </section>
  );
};

export default SessionIntro;
