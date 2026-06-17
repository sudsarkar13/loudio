import type { ReactNode } from "react";
import { Copy, FolderOpen, Mic, Sparkles, Trash2 } from "lucide-react";

interface CompactToolbarProps {
	busy: boolean;
	isRecording: boolean;
	isTranscribing: boolean;
	audioPath: string;
	transcriptDraft: string;
	livePreviewTranscript: string;
	iconSize?: number;
	className?: string;
	onPickAudio: () => void;
	onToggleMicRecording: () => void;
	onTranscribe: () => void;
	onCopy: () => void;
	onClearTranscript: () => void;
	/**
	 * Optional slot rendered at the end of the toolbar (e.g. a compact
	 * microphone selector). The slot is rendered after the trash button so it
	 * can fill the remaining horizontal space inside the toolbar row.
	 */
	trailing?: ReactNode;
}

/**
 * Shared toolbar for compact/general activity views.
 */
export function CompactToolbar({
	busy,
	isRecording,
	isTranscribing,
	audioPath,
	transcriptDraft,
	livePreviewTranscript,
	iconSize = 16,
	className,
	onPickAudio,
	onToggleMicRecording,
	onTranscribe,
	onCopy,
	onClearTranscript,
	trailing,
}: CompactToolbarProps) {
	return (
		<div
			className={className ?? "toolbar-icons"}
			role="toolbar"
			aria-label="Transcription actions">
			<button
				className="icon-btn"
				onClick={onPickAudio}
				disabled={busy || isRecording}
				title="Choose audio file"
				aria-label="Choose audio file">
				<FolderOpen size={iconSize} />
			</button>
			<button
				className={isRecording ? "icon-btn icon-btn-danger" : "icon-btn"}
				onClick={onToggleMicRecording}
				disabled={busy}
				title={isRecording ? "Stop recording" : "Record microphone"}
				aria-label={isRecording ? "Stop recording" : "Record microphone"}>
				<Mic size={iconSize} />
			</button>
			<button
				className="icon-btn icon-btn-primary"
				onClick={onTranscribe}
				disabled={busy || isRecording || !audioPath}
				title={
					isTranscribing ? "Transcribing file" : "Transcribe selected file"
				}
				aria-label="Transcribe selected file">
				<Sparkles size={iconSize} />
			</button>
			<button
				className="icon-btn"
				onClick={onCopy}
				disabled={!transcriptDraft.trim()}
				title="Copy transcript"
				aria-label="Copy transcript">
				<Copy size={iconSize} />
			</button>
			<button
				className="icon-btn"
				onClick={onClearTranscript}
				disabled={!transcriptDraft.trim() && !livePreviewTranscript}
				title="Clear transcript"
				aria-label="Clear transcript">
				<Trash2 size={iconSize} />
			</button>
			{trailing ?
				<div className="toolbar-trailing-slot">{trailing}</div>
			:	null}
		</div>
	);
}
