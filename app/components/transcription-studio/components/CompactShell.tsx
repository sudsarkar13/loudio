import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { Mic } from "lucide-react";
import { CompactToolbar } from "@/app/components/transcription-studio/components/CompactToolbar";
import { CompactTopbar } from "@/app/components/transcription-studio/components/CompactTopbar";
import type { AppSettings } from "@/app/lib/types";
import type { CompactWindowAnchor } from "@/app/lib/tauri";
import type { MicrophoneDevice } from "@/app/components/transcription-studio/hooks/useMicrophoneDevices";

interface CompactShellProps {
	compactAnchor: CompactWindowAnchor;
	onStartCompactDrag: () => void;
	onMoveCompactAnchor: (anchor: CompactWindowAnchor) => void;
	onToggleCompactMode: () => void;

	// Toolbar props
	busy: boolean;
	isRecording: boolean;
	isTranscribing: boolean;
	audioPath: string;
	transcriptDraft: string;
	livePreviewTranscript: string;
	onPickAudio: () => void;
	onToggleMicRecording: () => void;
	onTranscribe: () => void;
	onCopy: () => void;
	onClearTranscript: () => void;

	// Microphone selector
	microphoneDevices: MicrophoneDevice[];
	selectedMicrophoneDeviceId: string;
	hasMicrophonePermission: boolean;
	isEnumeratingMicrophones: boolean;
	setSettings: Dispatch<SetStateAction<AppSettings>>;

	// Status / transcript
	status: string;
	setTranscriptDraft: (value: string) => void;
	requestMicrophonePermission: () => void;
}

export function CompactShell({
	compactAnchor,
	onStartCompactDrag,
	onMoveCompactAnchor,
	onToggleCompactMode,
	busy,
	isRecording,
	isTranscribing,
	audioPath,
	transcriptDraft,
	livePreviewTranscript,
	onPickAudio,
	onToggleMicRecording,
	onTranscribe,
	onCopy,
	onClearTranscript,
	microphoneDevices,
	selectedMicrophoneDeviceId,
	hasMicrophonePermission,
	isEnumeratingMicrophones,
	setSettings,
	status,
	setTranscriptDraft,
	requestMicrophonePermission,
}: CompactShellProps) {
	const microphoneSelect = (
		<div
			className="compact-mic-select"
			title={
				hasMicrophonePermission ? "Select microphone" : (
					"Allow microphone access to see device names"
				)
			}>
			<Mic size={12} aria-hidden="true" className="compact-mic-select-icon" />
			<select
				className="select compact-mic-select-input"
				value={selectedMicrophoneDeviceId}
				onChange={(event: ChangeEvent<HTMLSelectElement>) =>
					setSettings((prev) => ({
						...prev,
						micDeviceId: event.target.value,
					}))
				}
				disabled={isEnumeratingMicrophones}
				aria-label="Select microphone input device">
				{microphoneDevices.map((device) => (
					<option
						key={device.deviceId || "__default__"}
						value={device.deviceId}>
						{device.label}
					</option>
				))}
			</select>
			{!hasMicrophonePermission ?
				<button
					type="button"
					className="compact-mic-permission-btn"
					onClick={() => requestMicrophonePermission()}
					title="Grant microphone access">
					Grant
				</button>
			:	null}
		</div>
	);

	return (
		<section className="compact-shell">
			<CompactTopbar
				compactAnchor={compactAnchor}
				onStartCompactDrag={onStartCompactDrag}
				onMoveCompactAnchor={onMoveCompactAnchor}
				onToggleCompactMode={onToggleCompactMode}
			/>

			<CompactToolbar
				className="toolbar-icons compact-toolbar"
				iconSize={16}
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
				trailing={microphoneSelect}
			/>

			<div className="status status-modern compact-status">{status}</div>

			<textarea
				className="textarea transcript-area compact-transcript"
				value={transcriptDraft}
				onChange={(event) => setTranscriptDraft(event.target.value)}
				placeholder="Transcript will appear here…"
				spellCheck
				autoCorrect="on"
				autoCapitalize="sentences"
			/>
			{livePreviewTranscript ?
				<div className="transcript-live-preview" aria-live="polite">
					<p className="transcript-live-label">Live preview</p>
					<p className="transcript-live-text">{livePreviewTranscript}</p>
				</div>
			:	null}
		</section>
	);
}
