"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
	DEFAULT_SETTINGS,
	LANGUAGES,
	RUNTIME_PROFILES,
} from "@/app/lib/defaults";
import {
	chooseAudioFile,
	closeDesktopApp,
	enterCompactWindowMode,
	exitCompactWindowMode,
	getPersistedSettings,
	getRuntimeProfiles,
	listenRuntimeBootstrapProgress,
	moveCompactWindowToAnchor,
	persistCompactWindowPosition,
	runRuntimeBootstrap,
	savePersistedSettings,
	startCompactWindowDrag,
	type CompactWindowAnchor,
} from "@/app/lib/tauri";
import type {
	AppSettings,
	RecordingHistoryItem,
	RuntimeProfile,
} from "@/app/lib/types";
import {
	COMPACT_ANCHOR_STORAGE_KEY,
	COMPACT_MODE_STORAGE_KEY,
	EULA_STORAGE_KEY,
	EULA_VERSION,
	LEGACY_EULA_STORAGE_KEY,
	MODEL_OPTIONS,
} from "@/app/components/transcription-studio/constants";
import {
	resolvePreferredMicMimeType,
	encodeWav,
} from "@/app/components/transcription-studio/utils/audio";
import {
	formatPlaybackTime,
	formatRecordingDate,
	formatRecordingSize,
} from "@/app/components/transcription-studio/utils/format";
import { mergeSettings } from "@/app/components/transcription-studio/utils/settings";
import { useTranscriptWorkflow } from "@/app/components/transcription-studio/hooks/useTranscriptWorkflow";
import { useRecordingHistory } from "@/app/components/transcription-studio/hooks/useRecordingHistory";
import { useDesktopMenuBindings } from "@/app/components/transcription-studio/hooks/useDesktopMenuBindings";
import { useMicrophoneDevices } from "@/app/components/transcription-studio/hooks/useMicrophoneDevices";
import { CompactShell } from "@/app/components/transcription-studio/components/CompactShell";
import { EulaGate } from "@/app/components/transcription-studio/components/EulaGate";
import { GeneralTopStrip } from "@/app/components/transcription-studio/components/GeneralTopStrip";
import { RecordingHistoryView } from "@/app/components/transcription-studio/components/RecordingHistoryView";
import { SettingsPanel } from "@/app/components/transcription-studio/components/SettingsPanel";
import { WorkspaceActivityView } from "@/app/components/transcription-studio/components/WorkspaceActivityView";

interface EulaAcceptanceRecord {
	version: string;
	acceptedAt: string;
}

export function TranscriptionStudio() {
	const [profiles, setProfiles] = useState<RuntimeProfile[]>(RUNTIME_PROFILES);
	const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
	const [audioPath, setAudioPath] = useState<string>("");
	const [micBlob, setMicBlob] = useState<Blob | null>(null);
	const [micMimeType, setMicMimeType] = useState<string>("");
	const {
		result,
		transcriptDraft,
		livePreviewTranscript,
		status,
		isTranscribing,
		isMicTranscribing,
		transcriptDraftRef,
		setStatus,
		setTranscriptDraft,
		onTranscribe: runTranscription,
		transcribeMicrophoneBlob: runMicrophoneTranscription,
		clearTranscriptView: clearTranscriptDraft,
		onCopy: copyTranscriptDraft,
		transcriptWordCount,
		transcriptCharacterCount,
	} = useTranscriptWorkflow();
	const [runtimeBootstrapPercent, setRuntimeBootstrapPercent] =
		useState<number>(0);
	const [runtimeBootstrapMessage, setRuntimeBootstrapMessage] =
		useState<string>("Waiting for EULA acceptance…");
	const [isBootstrapping, setIsBootstrapping] = useState<boolean>(false);
	const [hasCompletedRuntimeSetup, setHasCompletedRuntimeSetup] =
		useState<boolean>(false);
	const [isRecording, setIsRecording] = useState<boolean>(false);
	const [hasAcceptedEula, setHasAcceptedEula] = useState<boolean>(false);
	const [isCheckingEula, setIsCheckingEula] = useState<boolean>(true);
	const [isCompactMode, setIsCompactMode] = useState<boolean>(false);
	const [compactAnchor, setCompactAnchor] =
		useState<CompactWindowAnchor>("bottom");
	const [activeGeneralView, setActiveGeneralView] = useState<
		"activity" | "history"
	>("activity");
	const {
		recordingHistory,
		isLoadingRecordingHistory,
		deletingRecordingPath,
		selectedRecordingPaths,
		isDeletingSelectedRecordings,
		playingRecordingPath,
		isPlaybackPlaying,
		playbackCurrentSec,
		playbackDurationSec,
		playbackRate,
		playbackReady,
		allHistorySelected,
		hasSelectedRecordings,
		activePlaybackItem,
		loadRecordingHistory,
		onDeleteRecording,
		onToggleSelectRecording,
		onToggleSelectAllRecordings,
		onDeleteSelectedRecordings,
		onDeleteAllRecordings,
		onPlayRecording,
		onSeekPlayback,
		onStepPlayback,
		onSetPlaybackRate,
		onToggleActivePlayback,
	} = useRecordingHistory({ setStatus });

	const {
		devices: microphoneDevices,
		hasPermission: hasMicrophonePermission,
		isEnumerating: isEnumeratingMicrophones,
		errorMessage: microphoneErrorMessage,
		requestPermission: requestMicrophonePermission,
		refresh: refreshMicrophoneDevices,
	} = useMicrophoneDevices();

	// If a previously selected microphone is no longer present (unplugged, BT
	// disconnected, etc.), fall back to the system default so the next recording
	// attempt does not fail with an OverconstrainedError.
	useEffect(() => {
		const selectedDeviceId = (settings.micDeviceId ?? "").trim();
		if (!selectedDeviceId) return;
		if (isEnumeratingMicrophones) return;

		const stillAvailable = microphoneDevices.some(
			(device) => device.deviceId === selectedDeviceId,
		);

		if (!stillAvailable) {
			setSettings((prev) => ({ ...prev, micDeviceId: "" }));
			setStatus(
				"Selected microphone is no longer available. Falling back to the system default.",
			);
		}
	}, [
		isEnumeratingMicrophones,
		microphoneDevices,
		settings.micDeviceId,
		setSettings,
		setStatus,
	]);

	useDesktopMenuBindings({
		onPickAudio,
		onTranscribe,
		onToggleMicRecording,
		onToggleCompactMode,
		clearTranscriptView,
		transcriptDraftRef,
		setStatus,
		setSettings,
		settings,
		isCompactMode,
	});

	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const mediaStreamRef = useRef<MediaStream | null>(null);
	const micChunksRef = useRef<BlobPart[]>([]);

	const audioContextRef = useRef<AudioContext | null>(null);
	const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
	const silentGainRef = useRef<GainNode | null>(null);
	const wavChunksRef = useRef<Float32Array[]>([]);
	const sampleRateRef = useRef<number>(44100);

	const stopRecordingRef = useRef<(() => void) | null>(null);
	const bootstrapProgressUnlistenRef = useRef<(() => void) | null>(null);

	function hasAcceptedCurrentEulaVersion(): boolean {
		if (typeof window === "undefined") return true;

		const raw = window.localStorage.getItem(EULA_STORAGE_KEY);
		if (!raw) return false;

		try {
			const parsed = JSON.parse(raw) as EulaAcceptanceRecord;
			return parsed.version === EULA_VERSION;
		} catch {
			return false;
		}
	}

	function persistCurrentEulaAcceptance(): void {
		if (typeof window === "undefined") return;

		const acceptance: EulaAcceptanceRecord = {
			version: EULA_VERSION,
			acceptedAt: new Date().toISOString(),
		};

		window.localStorage.setItem(EULA_STORAGE_KEY, JSON.stringify(acceptance));
		window.localStorage.removeItem(LEGACY_EULA_STORAGE_KEY);
	}

	useEffect(() => {
		if (typeof window === "undefined") {
			setHasAcceptedEula(true);
			setIsCheckingEula(false);
			return;
		}

		const acceptedCurrentEula = hasAcceptedCurrentEulaVersion();
		const acceptedLegacyEula =
			window.localStorage.getItem(LEGACY_EULA_STORAGE_KEY) === "true";
		const accepted = acceptedCurrentEula || acceptedLegacyEula;

		if (!acceptedCurrentEula && acceptedLegacyEula) {
			persistCurrentEulaAcceptance();
		}

		const storedCompactMode =
			window.localStorage.getItem(COMPACT_MODE_STORAGE_KEY) === "true";
		const storedAnchor = window.localStorage.getItem(
			COMPACT_ANCHOR_STORAGE_KEY,
		);

		if (storedAnchor === "top" || storedAnchor === "bottom") {
			setCompactAnchor(storedAnchor);
		}

		setHasAcceptedEula(accepted);
		setIsCompactMode(storedCompactMode);
		setIsCheckingEula(false);
	}, []);

	useEffect(() => {
		if (isCheckingEula || !hasAcceptedEula || hasCompletedRuntimeSetup) {
			return;
		}

		let mounted = true;
		setIsBootstrapping(true);
		setRuntimeBootstrapPercent(0);
		setRuntimeBootstrapMessage("Preparing runtime…");
		setStatus("Preparing runtime…");

		async function init() {
			try {
				bootstrapProgressUnlistenRef.current =
					await listenRuntimeBootstrapProgress((event) => {
						if (!mounted) return;
						setRuntimeBootstrapPercent(event.percent);
						setRuntimeBootstrapMessage(event.message);
						setStatus(event.message);
					});

				const [saved, runtimeProfiles, runtimeMessage] = await Promise.all([
					getPersistedSettings(),
					getRuntimeProfiles().catch(() => RUNTIME_PROFILES),
					runRuntimeBootstrap(),
				]);

				if (!mounted) return;

				setSettings(mergeSettings(saved));
				setProfiles(runtimeProfiles);
				setRuntimeBootstrapPercent(100);
				setRuntimeBootstrapMessage(runtimeMessage);
				setStatus(runtimeMessage);
			} catch (error) {
				if (!mounted) return;
				const message = `Runtime setup failed: ${String(error)}`;
				setRuntimeBootstrapMessage(message);
				setStatus(message);
			} finally {
				bootstrapProgressUnlistenRef.current?.();
				bootstrapProgressUnlistenRef.current = null;
				if (mounted) {
					setIsBootstrapping(false);
					setHasCompletedRuntimeSetup(true);
				}
			}
		}

		void init();

		return () => {
			mounted = false;
			bootstrapProgressUnlistenRef.current?.();
			bootstrapProgressUnlistenRef.current = null;
		};
	}, [hasAcceptedEula, hasCompletedRuntimeSetup, isCheckingEula]);

	useEffect(() => {
		void savePersistedSettings(settings);
	}, [settings]);

	useEffect(() => {
		return () => {
			stopRecordingRef.current?.();
			stopRecordingRef.current = null;
			bootstrapProgressUnlistenRef.current?.();
			bootstrapProgressUnlistenRef.current = null;

			mediaStreamRef.current
				?.getTracks()
				.forEach((track: MediaStreamTrack) => track.stop());
			mediaStreamRef.current = null;
			mediaRecorderRef.current = null;

			scriptProcessorRef.current?.disconnect();
			mediaSourceRef.current?.disconnect();
			silentGainRef.current?.disconnect();
			scriptProcessorRef.current = null;
			mediaSourceRef.current = null;
			silentGainRef.current = null;

			if (audioContextRef.current) {
				void audioContextRef.current.close();
				audioContextRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(
			COMPACT_MODE_STORAGE_KEY,
			isCompactMode ? "true" : "false",
		);
	}, [isCompactMode]);

	useEffect(() => {
		if (typeof document === "undefined") return;

		document.documentElement.classList.toggle(
			"loudio-compact-window",
			isCompactMode,
		);
		document.body.classList.toggle("loudio-compact-window", isCompactMode);

		return () => {
			document.documentElement.classList.remove("loudio-compact-window");
			document.body.classList.remove("loudio-compact-window");
		};
	}, [isCompactMode]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(COMPACT_ANCHOR_STORAGE_KEY, compactAnchor);
	}, [compactAnchor]);

	useEffect(() => {
		if (isCheckingEula || !hasAcceptedEula) return;

		if (isCompactMode) {
			void enterCompactWindowMode();
			return;
		}

		void exitCompactWindowMode();
	}, [hasAcceptedEula, isCheckingEula, isCompactMode]);

	const activeProfile = useMemo(
		() =>
			profiles.find(
				(profile: RuntimeProfile) => profile.id === settings.profileId,
			) ?? profiles[0],
		[profiles, settings.profileId],
	);

	const selectedAudioLabel = useMemo(() => {
		if (!audioPath) return "No file selected";
		const parts = audioPath.split(/[\\/]/);
		return parts[parts.length - 1] || audioPath;
	}, [audioPath]);

	const selectedMicrophoneLabel = useMemo(() => {
		const selectedDeviceId = (settings.micDeviceId ?? "").trim();
		const match = microphoneDevices.find(
			(device) => device.deviceId === selectedDeviceId,
		);
		if (match) return `Input: ${match.label}`;
		return "Input: System default microphone";
	}, [microphoneDevices, settings.micDeviceId]);

	const busy =
		isBootstrapping ||
		isTranscribing ||
		isMicTranscribing ||
		isCheckingEula ||
		!hasAcceptedEula;

	function onUseRecordingForTranscription(item: RecordingHistoryItem): void {
		if (isRecording || isBootstrapping || isMicTranscribing || isTranscribing) {
			setStatus(
				"Please wait for the current recording/transcription task to finish.",
			);
			return;
		}

		setAudioPath(item.absolutePath);
		setMicBlob(null);
		setMicMimeType("");
		setActiveGeneralView("activity");
		setStatus(
			`Selected ${item.fileName} for transcription. Adjust settings and click Transcribe.`,
		);
	}

	async function onAcceptEula() {
		persistCurrentEulaAcceptance();

		setHasAcceptedEula(true);
		setStatus(
			`License terms (${EULA_VERSION}) accepted. Preparing runtime dependencies…`,
		);
	}

	async function onDeclineEula() {
		setStatus("EULA declined. Closing Loudio.");
		await closeDesktopApp();
	}

	async function onPickAudio() {
		const picked = await chooseAudioFile();
		if (picked) {
			setAudioPath(picked);
			setMicBlob(null);
			setMicMimeType("");
			setStatus("Audio file selected. Ready to transcribe.");
		} else {
			setStatus("No file selected.");
		}
	}

	async function onToggleMicRecording() {
		if (isRecording) {
			stopRecordingRef.current?.();
			stopRecordingRef.current = null;
			setStatus("Stopping microphone recording…");
			return;
		}

		if (
			typeof navigator === "undefined" ||
			!navigator.mediaDevices?.getUserMedia
		) {
			setStatus("Microphone input is not available in this environment.");
			return;
		}

		try {
			const selectedDeviceId = (settings.micDeviceId ?? "").trim();
			const audioConstraints: MediaTrackConstraints =
				selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {};
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: audioConstraints,
			});
			mediaStreamRef.current = stream;
			setAudioPath("");
			setMicBlob(null);

			if (typeof MediaRecorder !== "undefined") {
				const preferredMimeType = resolvePreferredMicMimeType();
				const recorder =
					preferredMimeType ?
						new MediaRecorder(stream, { mimeType: preferredMimeType })
					:	new MediaRecorder(stream);

				mediaRecorderRef.current = recorder;
				micChunksRef.current = [];

				setMicMimeType(recorder.mimeType || preferredMimeType || "audio/webm");

				recorder.ondataavailable = (event: BlobEvent) => {
					if (event.data.size > 0) {
						micChunksRef.current.push(event.data);
					}
				};

				recorder.onerror = () => {
					setIsRecording(false);
					setStatus("Microphone recording failed.");
					mediaStreamRef.current
						?.getTracks()
						.forEach((track: MediaStreamTrack) => track.stop());
					mediaStreamRef.current = null;
					mediaRecorderRef.current = null;
					stopRecordingRef.current = null;
				};

				recorder.onstop = () => {
					const mimeType =
						recorder.mimeType || preferredMimeType || "audio/webm";
					const blob = new Blob(micChunksRef.current, { type: mimeType });

					setIsRecording(false);
					mediaStreamRef.current
						?.getTracks()
						.forEach((track: MediaStreamTrack) => track.stop());
					mediaStreamRef.current = null;
					mediaRecorderRef.current = null;
					stopRecordingRef.current = null;

					if (!blob.size) {
						setStatus("Microphone recording is empty. Please try again.");
						return;
					}

					setMicBlob(blob);
					setMicMimeType(mimeType);
					setStatus("Microphone recording captured. Starting transcription…");
					void transcribeMicrophoneBlob(blob);
				};

				stopRecordingRef.current = () => {
					if (recorder.state !== "inactive") {
						recorder.stop();
					}
				};

				recorder.start(250);
				setIsRecording(true);
				setStatus("Recording from microphone… click Stop Recording when done.");
				return;
			}

			const AudioContextCtor =
				window.AudioContext ||
				(window as Window & { webkitAudioContext?: typeof AudioContext })
					.webkitAudioContext;

			if (!AudioContextCtor) {
				stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
				mediaStreamRef.current = null;
				setStatus(
					"Microphone recording requires MediaRecorder or AudioContext support.",
				);
				return;
			}

			const audioContext = new AudioContextCtor();
			const source = audioContext.createMediaStreamSource(stream);
			const processor = audioContext.createScriptProcessor(4096, 1, 1);
			const silentGain = audioContext.createGain();
			silentGain.gain.value = 0;

			audioContextRef.current = audioContext;
			mediaSourceRef.current = source;
			scriptProcessorRef.current = processor;
			silentGainRef.current = silentGain;

			wavChunksRef.current = [];
			sampleRateRef.current = audioContext.sampleRate;
			setMicMimeType("audio/wav");

			processor.onaudioprocess = (event: AudioProcessingEvent) => {
				const channelData = event.inputBuffer.getChannelData(0);
				wavChunksRef.current.push(new Float32Array(channelData));
			};

			source.connect(processor);
			processor.connect(silentGain);
			silentGain.connect(audioContext.destination);

			stopRecordingRef.current = () => {
				processor.disconnect();
				source.disconnect();
				silentGain.disconnect();
				processor.onaudioprocess = null;

				void audioContext.close();

				scriptProcessorRef.current = null;
				mediaSourceRef.current = null;
				silentGainRef.current = null;
				audioContextRef.current = null;

				mediaStreamRef.current
					?.getTracks()
					.forEach((track: MediaStreamTrack) => track.stop());
				mediaStreamRef.current = null;
				stopRecordingRef.current = null;
				setIsRecording(false);

				const blob = encodeWav(wavChunksRef.current, sampleRateRef.current);
				wavChunksRef.current = [];

				if (!blob.size) {
					setStatus("Microphone recording is empty. Please try again.");
					return;
				}

				setMicBlob(blob);
				setMicMimeType("audio/wav");
				setStatus("Microphone recording captured. Starting transcription…");
				void transcribeMicrophoneBlob(blob);
			};

			setIsRecording(true);
			setStatus(
				"Recording from microphone (AudioContext fallback)… click Stop Recording when done.",
			);
		} catch (error) {
			setIsRecording(false);
			setStatus(`Microphone access failed: ${String(error)}`);
			mediaStreamRef.current
				?.getTracks()
				.forEach((track: MediaStreamTrack) => track.stop());
			mediaStreamRef.current = null;
			stopRecordingRef.current = null;
		}
	}

	async function onTranscribe(): Promise<void> {
		await runTranscription(audioPath, settings);
	}

	async function transcribeMicrophoneBlob(blob: Blob): Promise<void> {
		await runMicrophoneTranscription(blob, settings);
	}

	function clearTranscriptView(): void {
		clearTranscriptDraft();
	}

	async function onCopy(): Promise<void> {
		await copyTranscriptDraft();
	}

	async function onToggleCompactMode() {
		const nextMode = !isCompactMode;

		try {
			if (nextMode) {
				await enterCompactWindowMode();
				await moveCompactWindowToAnchor(compactAnchor);
				setStatus("Compact mode enabled.");
			} else {
				await persistCompactWindowPosition();
				await exitCompactWindowMode();
				setStatus("General mode restored.");
			}

			setIsCompactMode(nextMode);
		} catch (error) {
			setStatus(`Failed to switch window mode: ${String(error)}`);
		}
	}

	async function onMoveCompactAnchor(anchor: CompactWindowAnchor) {
		setCompactAnchor(anchor);

		if (!isCompactMode) return;

		try {
			await moveCompactWindowToAnchor(anchor);
			setStatus(
				anchor === "top" ?
					"Compact shell moved to top center."
				:	"Compact shell moved to bottom center.",
			);
		} catch (error) {
			setStatus(`Failed to move compact shell: ${String(error)}`);
		}
	}

	async function onStartCompactDrag() {
		if (!isCompactMode) return;

		try {
			await startCompactWindowDrag();
			await persistCompactWindowPosition();
		} catch {
			// Dragging is best-effort; no UI interruption needed.
		}
	}

	useEffect(() => {
		if (isCompactMode) return;
		if (activeGeneralView !== "history") return;
		if (isCheckingEula || !hasAcceptedEula) return;

		void loadRecordingHistory();
	}, [activeGeneralView, hasAcceptedEula, isCheckingEula, isCompactMode]);

	return (
		<main
			className={
				isCompactMode ? "loudio-shell loudio-shell-compact" : "loudio-shell"
			}>
			{!isCheckingEula && !hasAcceptedEula ?
				<EulaGate
					eulaVersion={EULA_VERSION}
					onAccept={onAcceptEula}
					onDecline={onDeclineEula}
				/>
			:	null}

			{isCompactMode ?
				<CompactShell
					compactAnchor={compactAnchor}
					onStartCompactDrag={onStartCompactDrag}
					onMoveCompactAnchor={onMoveCompactAnchor}
					onToggleCompactMode={onToggleCompactMode}
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
					onClearTranscript={clearTranscriptView}
					microphoneDevices={microphoneDevices}
					selectedMicrophoneDeviceId={(settings.micDeviceId ?? "").trim()}
					hasMicrophonePermission={hasMicrophonePermission}
					isEnumeratingMicrophones={isEnumeratingMicrophones}
					setSettings={setSettings}
					status={status}
					setTranscriptDraft={setTranscriptDraft}
					requestMicrophonePermission={() => {
						void requestMicrophonePermission();
					}}
				/>
			:	<>
					<GeneralTopStrip
						activeProfileTitle={activeProfile?.title ?? ""}
						isBootstrapping={isBootstrapping}
						activeView={activeGeneralView}
						onSelectView={setActiveGeneralView}
						onToggleCompactMode={onToggleCompactMode}
					/>

					<section className="studio-layout">
						<SettingsPanel
							profiles={profiles}
							settings={settings}
							activeProfileModel={activeProfile?.model}
							modelOptions={MODEL_OPTIONS}
							languages={LANGUAGES}
							setSettings={setSettings}
							microphoneDevices={microphoneDevices}
							selectedMicrophoneDeviceId={(settings.micDeviceId ?? "").trim()}
							hasMicrophonePermission={hasMicrophonePermission}
							isEnumeratingMicrophones={isEnumeratingMicrophones}
							microphoneErrorMessage={microphoneErrorMessage}
							onRequestMicrophonePermission={requestMicrophonePermission}
							onRefreshMicrophoneDevices={refreshMicrophoneDevices}
						/>

						<section
							className={
								activeGeneralView === "history" ?
									"card studio-workspace studio-workspace-history"
								:	"card studio-workspace"
							}>
							{activeGeneralView === "activity" ?
								<WorkspaceActivityView
									isRecording={isRecording}
									busy={busy}
									isTranscribing={isTranscribing}
									audioPath={audioPath}
									transcriptDraft={transcriptDraft}
									livePreviewTranscript={livePreviewTranscript}
									selectedAudioLabel={selectedAudioLabel}
									micBlob={micBlob}
									selectedMicrophoneLabel={selectedMicrophoneLabel}
									isBootstrapping={isBootstrapping}
									runtimeBootstrapPercent={runtimeBootstrapPercent}
									runtimeBootstrapMessage={runtimeBootstrapMessage}
									status={status}
									transcriptWordCount={transcriptWordCount}
									transcriptCharacterCount={transcriptCharacterCount}
									result={result}
									setTranscriptDraft={setTranscriptDraft}
									onPickAudio={onPickAudio}
									onToggleMicRecording={onToggleMicRecording}
									onTranscribe={onTranscribe}
									onCopy={onCopy}
									onClearTranscript={clearTranscriptView}
								/>
							:	<RecordingHistoryView
									isLoadingRecordingHistory={isLoadingRecordingHistory}
									deletingRecordingPath={deletingRecordingPath}
									isDeletingSelectedRecordings={isDeletingSelectedRecordings}
									recordingHistory={recordingHistory}
									selectedRecordingPaths={selectedRecordingPaths}
									allHistorySelected={allHistorySelected}
									hasSelectedRecordings={hasSelectedRecordings}
									activePlaybackItem={activePlaybackItem}
									playbackReady={playbackReady}
									isPlaybackPlaying={isPlaybackPlaying}
									playbackRate={playbackRate}
									playbackCurrentSec={playbackCurrentSec}
									playbackDurationSec={playbackDurationSec}
									playingRecordingPath={playingRecordingPath}
									formatRecordingSize={formatRecordingSize}
									formatRecordingDate={formatRecordingDate}
									formatPlaybackTime={formatPlaybackTime}
									loadRecordingHistory={loadRecordingHistory}
									onToggleSelectAllRecordings={onToggleSelectAllRecordings}
									onDeleteSelectedRecordings={onDeleteSelectedRecordings}
									onDeleteAllRecordings={onDeleteAllRecordings}
									onStepPlayback={onStepPlayback}
									onToggleActivePlayback={onToggleActivePlayback}
									onSetPlaybackRate={onSetPlaybackRate}
									onSeekPlayback={onSeekPlayback}
									onPlayRecording={onPlayRecording}
									onUseRecordingForTranscription={
										onUseRecordingForTranscription
									}
									onDeleteRecording={onDeleteRecording}
									onToggleSelectRecording={onToggleSelectRecording}
								/>
							}
						</section>
					</section>
				</>
			}
		</main>
	);
}
