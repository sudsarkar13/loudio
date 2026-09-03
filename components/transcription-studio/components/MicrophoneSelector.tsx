import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { Mic } from "lucide-react";
import type { AppSettings } from "@/lib/types";
import type { MicrophoneDevice } from "@/components/transcription-studio/hooks/useMicrophoneDevices";

export type MicrophoneSelectorVariant = "panel" | "compact";

interface MicrophoneSelectorProps {
	settings: AppSettings;
	setSettings: Dispatch<SetStateAction<AppSettings>>;
	microphoneDevices: MicrophoneDevice[];
	selectedMicrophoneDeviceId: string;
	hasMicrophonePermission: boolean;
	isEnumeratingMicrophones: boolean;
	microphoneErrorMessage: string;
	onRequestMicrophonePermission: () => Promise<boolean>;
	onRefreshMicrophoneDevices: () => Promise<void>;
	variant?: MicrophoneSelectorVariant;
}

export function MicrophoneSelector({
	settings,
	setSettings,
	microphoneDevices,
	selectedMicrophoneDeviceId,
	hasMicrophonePermission,
	isEnumeratingMicrophones,
	microphoneErrorMessage,
	onRequestMicrophonePermission,
	onRefreshMicrophoneDevices,
	variant = "panel",
}: MicrophoneSelectorProps) {
	const helperText =
		hasMicrophonePermission ?
			isEnumeratingMicrophones ? "Refreshing microphone list…"
			:	"Pick a microphone or use the system default."
		: microphoneDevices.length <= 1 ?
			"Allow microphone access to see device names."
		:	"Microphone labels hidden until permission is granted.";

	const showInlineHelper = variant === "panel";
	const isCompact = variant === "compact";

	return (
		<div
			className={
				isCompact ? "mic-selector mic-selector-compact" : "mic-selector"
			}>
			<div className="label">
				<span className="label-row">
					<Mic size={12} aria-hidden="true" />
					<span>Microphone</span>
				</span>
			</div>
			<select
				className="select"
				value={selectedMicrophoneDeviceId}
				onChange={(event: ChangeEvent<HTMLSelectElement>) =>
					setSettings((prev: AppSettings) => ({
						...prev,
						micDeviceId: event.target.value,
					}))
				}
				disabled={isEnumeratingMicrophones}
				aria-label="Select microphone input device">
				{microphoneDevices.map((device: MicrophoneDevice) => (
					<option
						key={device.deviceId || "__default__"}
						value={device.deviceId}>
						{device.label}
					</option>
				))}
			</select>
			{showInlineHelper ?
				<div className="helper">{helperText}</div>
			:	null}
			{/* Refresh is always available: a Bluetooth headset paired while the
			    app is running should be selectable without a restart. The
			    devicechange event covers most cases, but it is unreliable
			    across webviews, so the manual escape hatch stays. Granting, by
			    contrast, is only offered when there is something left to grant. */}
			<div className="mic-permission-row">
				{!hasMicrophonePermission ?
					<button
						type="button"
						className="btn mic-permission-btn"
						onClick={() => {
							void onRequestMicrophonePermission();
						}}>
						Grant microphone access
					</button>
				:	null}
				<button
					type="button"
					className="btn mic-permission-btn"
					onClick={() => {
						void onRefreshMicrophoneDevices();
					}}
					disabled={isEnumeratingMicrophones}
					title="Re-scan for microphones, including newly connected Bluetooth devices">
					{isEnumeratingMicrophones ? "Refreshing…" : "Refresh"}
				</button>
			</div>
			{microphoneErrorMessage ?
				<div className="helper helper-error" role="status">
					{microphoneErrorMessage}
				</div>
			:	null}
		</div>
	);
}
