import type { ChangeEvent } from "react";
import type { TranscriptionResponse } from "@/app/lib/types";

interface TranscriptPanelProps {
  transcriptDraft: string;
  livePreviewTranscript: string;
  onTranscriptChange: (value: string) => void;
  showMeta?: boolean;
  wordCount?: number;
  characterCount?: number;
  result?: TranscriptionResponse | null;
  textareaClassName?: string;
}

export function TranscriptPanel({
  transcriptDraft,
  livePreviewTranscript,
  onTranscriptChange,
  showMeta = false,
  wordCount = 0,
  characterCount = 0,
  result = null,
  textareaClassName = "textarea transcript-area",
}: TranscriptPanelProps) {
  return (
    <section className="transcript-shell">
      {showMeta ? (
        <div className="transcript-head">
          <p className="helper">
            {wordCount}w · {characterCount}c
            {result?.languageDetected ? ` · ${result.languageDetected}` : ""}
          </p>
          <span className="pill pill-soft">{result?.modelUsed ?? "—"}</span>
        </div>
      ) : null}

      <textarea
        className={textareaClassName}
        value={transcriptDraft}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
          onTranscriptChange(event.target.value)
        }
        placeholder="Transcript will appear here…"
        spellCheck
        autoCorrect="on"
        autoCapitalize="sentences"
      />

      {livePreviewTranscript ? (
        <div className="transcript-live-preview" aria-live="polite">
          <p className="transcript-live-label">Live preview</p>
          <p className="transcript-live-text">{livePreviewTranscript}</p>
        </div>
      ) : null}
    </section>
  );
}
