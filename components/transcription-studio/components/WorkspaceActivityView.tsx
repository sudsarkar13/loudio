import type { AppSettings } from "@/lib/types";
import type { Dispatch, SetStateAction } from "react";
import { Mic } from "lucide-react";
import { CompactToolbar } from "@/components/transcription-studio/components/CompactToolbar";
import { TranscriptPanel } from "@/components/transcription-studio/components/TranscriptPanel";
import { LearnTermPrompt } from "@/components/transcription-studio/components/LearnTermPrompt";
import type { TranscriptionResponse } from "@/lib/types";

interface WorkspaceActivityViewProps {
	isRecording: boolean;
	busy: boolean;
	isTranscribing: boolean;
	audioPath: string;
	transcriptDraft: string;
	engineTranscript: string;
	settings: AppSettings;
	setSettings: Dispatch<SetStateAction<AppSettings>>;
	livePreviewTranscript: string;
	selectedAudioLabel: string;
	micBlob: Blob | null;
	selectedMicrophoneLabel: string;
	isBootstrapping: boolean;
	runtimeBootstrapPercent: number;
	runtimeBootstrapMessage: string;
	status: string;
	transcriptWordCount: number;
	transcriptCharacterCount: number;
	result: TranscriptionResponse | null;
	setTranscriptDraft:
		| Dispatch<SetStateAction<string>>
		| ((value: string) => void);
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
	engineTranscript,
	settings,
	setSettings,
	livePreviewTranscript,
	selectedAudioLabel,
	micBlob,
	selectedMicrophoneLabel,
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
				<span className="pill pill-soft">
					{isRecording ? "Recording" : "Idle"}
				</span>
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
						{micBlob ?
							`${(micBlob.size / 1024).toFixed(1)} KB`
						:	"No recording"}
					</p>
					<p className="helper" title="Currently selected microphone input">
						{selectedMicrophoneLabel}
					</p>
				</article>
			</div>

			{isBootstrapping ?
				<div className="runtime-progress">
					<div className="runtime-progress-head">
						<span className="runtime-progress-title">
							{/* A spinner alongside the bar: at 0% the bar alone is
							    indistinguishable from a stalled one. */}
							<span className="runtime-spinner" aria-hidden="true" />
							Preparing runtime
						</span>
						<span className="runtime-progress-value">
							{runtimeBootstrapPercent}%
						</span>
					</div>
					<div
						className="runtime-progress-track"
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={runtimeBootstrapPercent}
						aria-valuetext={runtimeBootstrapMessage}
						aria-label="Runtime preparation">
						<div
							className={
								runtimeBootstrapPercent > 0 ?
									"runtime-progress-fill"
								:	"runtime-progress-fill runtime-progress-fill-idle"
							}
							style={{ width: `${Math.max(runtimeBootstrapPercent, 2)}%` }}
						/>
					</div>
				</div>
			:	null}

			{/* While bootstrapping, the status line already carries the step
			    message — the progress panel showed the identical string directly
			    above it, so the same sentence appeared twice, stacked. The bar now
			    exposes it to assistive tech via aria-valuetext instead. */}
			<div
				className={
					isBootstrapping ? "status status-modern status-busy" : (
						"status status-modern"
					)
				}
				aria-live="polite">
				{status}
			</div>

			<LearnTermPrompt
				engineTranscript={engineTranscript}
				transcriptDraft={transcriptDraft}
				settings={settings}
				setSettings={setSettings}
			/>

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
