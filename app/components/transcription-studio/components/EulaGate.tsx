interface EulaGateProps {
  onAccept: () => void;
  onDecline: () => void;
}

export function EulaGate({ onAccept, onDecline }: EulaGateProps) {
  return (
    <section
      className="card stack eula-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eula-title"
    >
      <h2 id="eula-title">End User License Agreement</h2>
      <p className="helper eula-copy">
        Loudio performs local transcription on your machine. By continuing, you
        agree to use the software at your own discretion and in compliance with
        applicable privacy and consent laws for recorded audio.
      </p>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={onAccept}>
          Accept & Continue
        </button>
        <button className="btn btn-danger" onClick={onDecline}>
          Decline & Exit
        </button>
      </div>
    </section>
  );
}
