interface EulaGateProps {
  eulaVersion: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function EulaGate({ eulaVersion, onAccept, onDecline }: EulaGateProps) {
  return (
    <section
      className="card stack eula-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eula-title"
    >
      <h2 id="eula-title">End User License Agreement</h2>
      <p className="helper eula-copy">
        Please review and accept the Loudio license terms (version {eulaVersion}) before
        continuing. Loudio performs transcription locally on your machine, and you are
        responsible for complying with privacy, consent, and recording laws applicable
        in your jurisdiction.
      </p>

      <div className="eula-terms" role="document" aria-label="License summary">
        <p>
          Loudio is distributed under the MIT License. It is provided "as is", without
          warranty of any kind, express or implied, including merchantability and fitness
          for a particular purpose.
        </p>
        <p>
          You are solely responsible for obtaining consent before recording audio and for
          lawful handling of any transcript content generated through this application.
        </p>
      </div>

      <div className="btn-row">
        <button className="btn btn-primary" onClick={onAccept}>
          Accept Terms & Continue
        </button>
        <button className="btn btn-danger" onClick={onDecline}>
          Decline & Exit
        </button>
      </div>
    </section>
  );
}
