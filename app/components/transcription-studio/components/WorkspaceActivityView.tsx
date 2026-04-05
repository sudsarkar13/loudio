import type { Dispatch, SetStateAction } from "react";
import { Mic } from "lucide-react";
import { CompactToolbar } from "@/app/components/transcription-studio/components/CompactToolbar";
import { TranscriptPanel } from "@/app/components/transcription-studio/components/TranscriptPanel";
import type { TranscriptionResponse } from "@/app/lib/types";

interface WorkspaceActivityViewProps {
  isRecording: boolean;
  busy: boolean;
  isTranscribing: boolean;
  audioPath: string;
  transcriptDraft: string;
  livePreviewTranscript: string;
  selectedAudioLabel: string;
  micBlob: Blob | null;
  isBootstrapping: boolean;
  runtimeBootstrapPercent: number;
  runtimeBootstrapMessage: string;
  status: string;
  transcriptWordCount: number;
  transcriptCharacterCount: number;
  result: TranscriptionResponse | null;
  setTranscriptDraft: Dispatch<SetStateAction<string>> | ((value: string) => void);
  onPickAudio: () => void;
  onToggleMicRecording: () => void;
  onTranscribe: () => void;
  onCopy: () => void;
  onClearTranscript: () => void;
}

export function WorkspaceActivityView({
  isRecording,
  busy,
  isTranscribing,
  audioPath,
  transcriptDraft,
  livePreviewTranscript,
  selectedAudioLabel,
  micBlob,
  isBootstrapping,
  runtimeBootstrapPercent,
  runtimeBootstrapMessage,
  status,
  transcriptWordCount,
  transcriptCharacterCount,
  result,
  setTranscriptDraft,
  onPickAudio,
  onToggleMicRecording,
  onTranscribe,
  onCopy,
  onClearTranscript,
}: WorkspaceActivityViewProps) {
  return (
    <>
      <div className="section-title section-title-space">
        <div className="section-title-left">
          <Mic size={16} />
          <h2>Workspace</h2>
        </div>
        <span className="pill pill-soft">{isRecording ? "Recording" : "Idle"}</span>
      </div>

      <CompactToolbar
        iconSize={18}
        busy={busy}
        isRecording={isRecording}
        isTranscribing={isTranscribing}
        audioPath={audioPath}
        transcriptDraft={transcriptDraft}
        livePreviewTranscript={livePreviewTranscript}
        onPickAudio={onPickAudio}
        onToggleMicRecording={onToggleMicRecording}
        onTranscribe={onTranscribe}
        onCopy={onCopy}
        onClearTranscript={onClearTranscript}
      />

      <p className="toolbar-hint">Hover icons to view actions.</p>

      <div className="source-grid">
        <article className="source-card">
          <p className="label">File</p>
          <p className="source-title">{selectedAudioLabel}</p>
        </article>
        <article className="source-card">
          <p className="label">Mic</p>
          <p className="source-title">
            {micBlob ? `${(micBlob.size / 1024).toFixed(1)} KB` : "No recording"}
          </p>
        </article>
      </div>

      {isBootstrapping ? (
        <div
          className="runtime-progress"
          aria-live="polite"
          aria-label="Runtime bootstrap progress"
        >
          <div className="runtime-progress-head">
            <span>Runtime preparation</span>
            <span>{runtimeBootstrapPercent}%</span>
          </div>
          <div className="runtime-progress-track">
            <div
              className="runtime-progress-fill"
              style={{ width: `${runtimeBootstrapPercent}%` }}
            />
          </div>
          <div className="helper">{runtimeBootstrapMessage}</div>
        </div>
      ) : null}

      <div className="status status-modern">{status}</div>

      <TranscriptPanel
        transcriptDraft={transcriptDraft}
        livePreviewTranscript={livePreviewTranscript}
        onTranscriptChange={setTranscriptDraft}
        showMeta
        wordCount={transcriptWordCount}
        characterCount={transcriptCharacterCount}
        result={result}
      />
    </>
  );
}
