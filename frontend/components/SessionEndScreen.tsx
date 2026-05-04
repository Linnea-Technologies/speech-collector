interface SessionEndScreenProps {
  title: string;
  message: string;
  actionLabel: string;
  onRestart: () => void;
}

const SessionEndScreen = ({
  title,
  message,
  actionLabel,
  onRestart,
}: SessionEndScreenProps) => {
  return (
    <section className="app-panel app-panel--narrow">
      <span className="app-eyebrow">Speech Collector</span>
      <h1 className="app-title">{title}</h1>
      <p className="app-copy">{message}</p>
      <button type="button" className="app-primary-button" onClick={onRestart}>
        {actionLabel}
      </button>
    </section>
  );
};

export default SessionEndScreen;
