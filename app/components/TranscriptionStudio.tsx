"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
	Copy,
	FolderOpen,
	Mic,
	Move,
	Pause,
	Play,
	Settings2,
	Sparkles,
	Trash2,
} from "lucide-react";
import {
	DEFAULT_SETTINGS,
	LANGUAGES,
	RUNTIME_PROFILES,
} from "@/app/lib/defaults";
import {
	chooseAudioFile,
	closeDesktopApp,
	copyToClipboard,
	enterCompactWindowMode,
	exitCompactWindowMode,
	getPersistedSettings,
	getRuntimeProfiles,
	listenRuntimeBootstrapProgress,
	moveCompactWindowToAnchor,
	persistCompactWindowPosition,
	runRuntimeBootstrap,
	savePersistedSettings,
	setupDesktopAppMenu,
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
	MODEL_OPTIONS,
} from "@/app/components/transcription-studio/constants";
import {
	encodeWav,
	formatPlaybackTime,
	formatRecordingDate,
	formatRecordingSize,
	mergeSettings,
	resolvePreferredMicMimeType,
} from "@/app/components/transcription-studio/utils";
import { useTranscriptionController } from "@/app/components/transcription-studio/useTranscriptionController";
import { useRecordingHistoryController } from "@/app/components/transcription-studio/useRecordingHistoryController";

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
	} = useTranscriptionController();
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
	const [activeGeneralView, setActiveGeneralView] =
		useState<"activity" | "history">("activity");
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
	} = useRecordingHistoryController({ setStatus });

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

	useEffect(() => {
		if (typeof window === "undefined") {
			setHasAcceptedEula(true);
			setIsCheckingEula(false);
			return;
		}

		const accepted = window.localStorage.getItem(EULA_STORAGE_KEY) === "true";
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

		document.documentElement.classList.toggle("loudio-compact-window", isCompactMode);
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

	const busy =
		isBootstrapping ||
		isTranscribing ||
		isMicTranscribing ||
		isCheckingEula ||
		!hasAcceptedEula;

	function onUseRecordingForTranscription(item: RecordingHistoryItem): void {
		if (isRecording || isBootstrapping || isMicTranscribing || isTranscribing) {
			setStatus("Please wait for the current recording/transcription task to finish.");
			return;
		}

		setAudioPath(item.absolutePath);
		setMicBlob(null);
		setMicMimeType("");
		setActiveGeneralView("activity");
		setStatus(`Selected ${item.fileName} for transcription. Adjust settings and click Transcribe.`);
	}


	async function onAcceptEula() {
		if (typeof window !== "undefined") {
			window.localStorage.setItem(EULA_STORAGE_KEY, "true");
		}

		setHasAcceptedEula(true);
		setStatus("EULA accepted. Preparing runtime dependencies…");
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
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

	useEffect(() => {
		void setupDesktopAppMenu({
			openAudioFile: onPickAudio,
			transcribeFile: onTranscribe,
			toggleMicRecording: onToggleMicRecording,
			toggleCompactMode: onToggleCompactMode,
			copyTranscript: async () => {
				if (!transcriptDraftRef.current.trim()) {
					setStatus("No transcript available to copy yet.");
					return;
				}

				await copyToClipboard(transcriptDraftRef.current);
				setStatus("Transcript copied to clipboard.");
			},
			clearTranscript: clearTranscriptView,
			toggleAutoCopy: () => {
				setSettings((prev: AppSettings) => ({
					...prev,
					autoCopy: !prev.autoCopy,
				}));
			},
			bootstrapRuntime: async () => {
				setStatus("Running runtime bootstrap…");
				const message = await runRuntimeBootstrap();
				setStatus(message);
			},
			isAutoCopyEnabled: settings.autoCopy,
			isCompactModeEnabled: isCompactMode,
		});
	}, [settings.autoCopy, isCompactMode]);

	return (
		<main
			className={
				isCompactMode ? "loudio-shell loudio-shell-compact" : "loudio-shell"
			}>
			{!isCheckingEula && !hasAcceptedEula ?
				<section
					className="card stack eula-card"
					role="dialog"
					aria-modal="true"
					aria-labelledby="eula-title">
					<h2 id="eula-title">End User License Agreement</h2>
					<p className="helper eula-copy">
						Loudio performs local transcription on your machine. By continuing,
						you agree to use the software at your own discretion and in
						compliance with applicable privacy and consent laws for recorded
						audio.
					</p>
					<div className="btn-row">
						<button className="btn btn-primary" onClick={onAcceptEula}>
							Accept & Continue
						</button>
						<button className="btn btn-danger" onClick={onDeclineEula}>
							Decline & Exit
						</button>
					</div>
				</section>
			:	null}

			{isCompactMode ?
				<section className="compact-shell">
					<div className="compact-topbar">
						<div
							className="compact-drag-strip"
							onMouseDown={() => void onStartCompactDrag()}
							title="Drag compact shell">
							<Move size={13} />
							<span>Compact</span>
						</div>

						<div className="compact-controls">
							<button
								className={
									compactAnchor === "top" ?
										"btn compact-btn compact-btn-active"
									:	"btn compact-btn"
								}
								onClick={() => void onMoveCompactAnchor("top")}>
								Top
							</button>
							<button
								className={
									compactAnchor === "bottom" ?
										"btn compact-btn compact-btn-active"
									:	"btn compact-btn"
								}
								onClick={() => void onMoveCompactAnchor("bottom")}>
								Bottom
							</button>
							<button
								className="btn compact-btn compact-btn-primary"
								onClick={() => void onToggleCompactMode()}>
								General
							</button>
						</div>
					</div>

					<div
						className="toolbar-icons compact-toolbar"
						role="toolbar"
						aria-label="Transcription actions">
						<button
							className="icon-btn"
							onClick={onPickAudio}
							disabled={busy || isRecording}
							title="Choose audio file"
							aria-label="Choose audio file">
							<FolderOpen size={16} />
						</button>
						<button
							className={isRecording ? "icon-btn icon-btn-danger" : "icon-btn"}
							onClick={onToggleMicRecording}
							disabled={busy}
							title={isRecording ? "Stop recording" : "Record microphone"}
							aria-label={isRecording ? "Stop recording" : "Record microphone"}>
							<Mic size={16} />
						</button>
						<button
							className="icon-btn icon-btn-primary"
							onClick={onTranscribe}
							disabled={busy || isRecording || !audioPath}
							title={
								isTranscribing ? "Transcribing file" : (
									"Transcribe selected file"
								)
							}
							aria-label="Transcribe selected file">
							<Sparkles size={16} />
						</button>
						<button
							className="icon-btn"
							onClick={onCopy}
							disabled={!transcriptDraft.trim()}
							title="Copy transcript"
							aria-label="Copy transcript">
							<Copy size={16} />
						</button>
						<button
							className="icon-btn"
							onClick={clearTranscriptView}
							disabled={!transcriptDraft.trim() && !livePreviewTranscript}
							title="Clear transcript"
							aria-label="Clear transcript">
							<Trash2 size={16} />
						</button>
					</div>

					<div className="status status-modern compact-status">{status}</div>

					<textarea
						className="textarea transcript-area compact-transcript"
						value={transcriptDraft}
						onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
							setTranscriptDraft(event.target.value)
						}
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
					: null}
				</section>
			:	<>
					<section className="top-strip" aria-label="App status">
						<span className="pill pill-soft">
							{activeProfile?.title ?? "Runtime profile"}
						</span>
						<div className="top-strip-actions">
							<span className="top-strip-state">
								{isBootstrapping ? "Preparing" : "Ready"}
							</span>
							<div className="general-view-switch" role="tablist" aria-label="General mode view switch">
								<button
									className={
										activeGeneralView === "activity" ?
											"btn compact-toggle-btn general-view-btn general-view-btn-active"
										:	"btn compact-toggle-btn general-view-btn"
									}
									role="tab"
									aria-selected={activeGeneralView === "activity"}
									onClick={() => setActiveGeneralView("activity")}>
									Activity
								</button>
								<button
									className={
										activeGeneralView === "history" ?
											"btn compact-toggle-btn general-view-btn general-view-btn-active"
										:	"btn compact-toggle-btn general-view-btn"
									}
									role="tab"
									aria-selected={activeGeneralView === "history"}
									onClick={() => setActiveGeneralView("history")}>
									History
								</button>
							</div>
							<button
								className="btn compact-toggle-btn"
								onClick={() => void onToggleCompactMode()}>
								Compact Mode
							</button>
						</div>
					</section>

					<section className="studio-layout">
						<aside className="card studio-settings">
							<div className="section-title">
								<Settings2 size={16} />
								<h2>Settings</h2>
							</div>

							<section className="settings-grid compact-grid">
								<div>
									<div className="label">Runtime</div>
									<select
										className="select"
										value={settings.profileId}
										onChange={(event: ChangeEvent<HTMLSelectElement>) =>
											setSettings((prev: AppSettings) => ({
												...prev,
												profileId: event.target.value,
											}))
										}>
										{profiles.map((profile: RuntimeProfile) => (
											<option key={profile.id} value={profile.id}>
												{profile.title}
											</option>
										))}
									</select>
								</div>

								<div>
									<div className="label">Model</div>
									<select
										className="select"
										value={(settings.customModel ?? "").trim()}
										onChange={(event: ChangeEvent<HTMLSelectElement>) =>
											setSettings((prev: AppSettings) => ({
												...prev,
												customModel: event.target.value,
											}))
										}>
										<option value="">
											Default ({activeProfile?.model ?? "small"})
										</option>
										{MODEL_OPTIONS.map((model: string) => (
											<option key={model} value={model}>
												{model}
											</option>
										))}
									</select>
								</div>

								<div>
									<div className="label">Language</div>
									<select
										className="select"
										value={settings.language}
										onChange={(event: ChangeEvent<HTMLSelectElement>) =>
											setSettings((prev: AppSettings) => ({
												...prev,
												language: event.target.value,
											}))
										}>
										{LANGUAGES.map((language) => (
											<option key={language.value} value={language.value}>
												{language.label}
											</option>
										))}
									</select>
								</div>

								<div>
									<div className="label">Task</div>
									<select
										className="select"
										value={settings.task}
										onChange={(event: ChangeEvent<HTMLSelectElement>) =>
											setSettings((prev: AppSettings) => ({
												...prev,
												task: event.target.value as AppSettings["task"],
											}))
										}>
										<option value="transcribe">Transcribe</option>
										<option value="translate">Translate</option>
									</select>
								</div>
							</section>

							<section className="stack compact-stack">
								<label className="toggle-row">
									<span className="toggle-title">Auto copy</span>
									<input
										type="checkbox"
										checked={settings.autoCopy}
										onChange={(event: ChangeEvent<HTMLInputElement>) =>
											setSettings((prev: AppSettings) => ({
												...prev,
												autoCopy: event.target.checked,
											}))
										}
									/>
								</label>


							</section>

							<details className="advanced-block">
								<summary>Advanced</summary>
								<div className="slider-grid">
									<div>
										<div className="label">Beam</div>
										<div className="range-head">
											<span>Search</span>
											<strong>{settings.beamSize}</strong>
										</div>
										<input
											className="field"
											type="range"
											min={1}
											max={10}
											step={1}
											value={settings.beamSize}
											onChange={(event: ChangeEvent<HTMLInputElement>) =>
												setSettings((prev: AppSettings) => ({
													...prev,
													beamSize: Number(event.target.value),
												}))
											}
										/>
									</div>

									<div>
										<div className="label">Temperature</div>
										<div className="range-head">
											<span>Creativity</span>
											<strong>{settings.temperature.toFixed(2)}</strong>
										</div>
										<input
											className="field"
											type="range"
											min={0}
											max={1}
											step={0.05}
											value={settings.temperature}
											onChange={(event: ChangeEvent<HTMLInputElement>) =>
												setSettings((prev: AppSettings) => ({
													...prev,
													temperature: Number(event.target.value),
												}))
											}
										/>
									</div>

									<div>
										<div className="label">Engine path</div>
										<input
											className="field code"
											value={settings.manualEnginePath ?? ""}
											onChange={(event: ChangeEvent<HTMLInputElement>) =>
												setSettings((prev: AppSettings) => ({
													...prev,
													manualEnginePath: event.target.value,
												}))
											}
											placeholder="/opt/homebrew/bin/whisper-cli"
										/>
									</div>
								</div>
							</details>
						</aside>

						<section
						className={
							activeGeneralView === "history" ?
								"card studio-workspace studio-workspace-history"
							:	"card studio-workspace"
						}>
							{activeGeneralView === "activity" ?
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

									<div
										className="toolbar-icons"
										role="toolbar"
										aria-label="Transcription actions">
										<button
											className="icon-btn"
											onClick={onPickAudio}
											disabled={busy || isRecording}
											title="Choose audio file"
											aria-label="Choose audio file">
											<FolderOpen size={18} />
										</button>
										<button
											className={
												isRecording ? "icon-btn icon-btn-danger" : "icon-btn"
											}
											onClick={onToggleMicRecording}
											disabled={busy}
											title={isRecording ? "Stop recording" : "Record microphone"}
											aria-label={
												isRecording ? "Stop recording" : "Record microphone"
											}>
											<Mic size={18} />
										</button>
										<button
											className="icon-btn icon-btn-primary"
											onClick={onTranscribe}
											disabled={busy || isRecording || !audioPath}
											title={
												isTranscribing ? "Transcribing file" : "Transcribe selected file"
											}
											aria-label="Transcribe selected file">
											<Sparkles size={18} />
										</button>
										<button
											className="icon-btn"
											onClick={onCopy}
											disabled={!transcriptDraft.trim()}
											title="Copy transcript"
											aria-label="Copy transcript">
											<Copy size={18} />
										</button>
										<button
											className="icon-btn"
											onClick={clearTranscriptView}
											disabled={!transcriptDraft.trim() && !livePreviewTranscript}
											title="Clear transcript"
											aria-label="Clear transcript">
											<Trash2 size={18} />
										</button>
									</div>

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

									{isBootstrapping ?
										<div
											className="runtime-progress"
											aria-live="polite"
											aria-label="Runtime bootstrap progress">
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
									: null}

									<div className="status status-modern">{status}</div>

									<section className="transcript-shell">
										<div className="transcript-head">
											<p className="helper">
												{transcriptWordCount}w · {transcriptCharacterCount}c
												{result?.languageDetected ? ` · ${result.languageDetected}` : ""}
											</p>
											<span className="pill pill-soft">{result?.modelUsed ?? "—"}</span>
										</div>

									<textarea
										className="textarea transcript-area"
										value={transcriptDraft}
										onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
											setTranscriptDraft(event.target.value)
										}
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
									: null}
									</section>

								</>
							: 	<>
									<div className="section-title section-title-space">
										<div className="section-title-left">
											<FolderOpen size={16} />
											<h2>Recording History</h2>
										</div>
										<div className="history-header-actions">
											<button
												className="btn compact-toggle-btn"
												onClick={() => void loadRecordingHistory({ statusMessage: "Recording history refreshed." })}
												disabled={isLoadingRecordingHistory || deletingRecordingPath !== null}>
												Refresh
											</button>
										</div>
									</div>

									<div className="history-bulk-bar">
										<button
											className="btn compact-toggle-btn"
											onClick={onToggleSelectAllRecordings}
											disabled={!recordingHistory.length || isDeletingSelectedRecordings}>
											{allHistorySelected ? "Unselect all" : "Select all"}
										</button>
										<button
											className="btn btn-danger compact-toggle-btn"
											onClick={() => void onDeleteSelectedRecordings()}
											disabled={
												!hasSelectedRecordings ||
												isDeletingSelectedRecordings ||
												deletingRecordingPath !== null
											}>
											{isDeletingSelectedRecordings ? "Deleting…" : "Delete selected"}
										</button>
										<button
											className="btn btn-danger compact-toggle-btn"
											onClick={() => void onDeleteAllRecordings()}
											disabled={
												!recordingHistory.length ||
												isDeletingSelectedRecordings ||
												deletingRecordingPath !== null
											}>
											Delete all
										</button>
										<span className="history-selection-count">
											{hasSelectedRecordings ? `${selectedRecordingPaths.length} selected` : "No selection"}
										</span>
									</div>

									{activePlaybackItem ?
										<div className="history-player" aria-live="polite">
											<div className="history-player-main">
												<p className="history-player-title" title={activePlaybackItem.fileName}>
													Now playing: {activePlaybackItem.fileName}
												</p>
												<div className="history-player-controls">
													<button
														className="btn compact-toggle-btn"
														onClick={() => onStepPlayback(-5)}
														disabled={!playbackReady || isDeletingSelectedRecordings || deletingRecordingPath !== null}>
														-5s
													</button>
													<button
														className="btn compact-toggle-btn"
														onClick={() => void onToggleActivePlayback()}
														disabled={isDeletingSelectedRecordings || deletingRecordingPath !== null}>
														{isPlaybackPlaying ? (
															<>
																<Pause size={14} /> Pause
															</>
														) : (
															<>
																<Play size={14} /> Play
															</>
														)}
													</button>
													<button
														className="btn compact-toggle-btn"
														onClick={() => onStepPlayback(5)}
														disabled={!playbackReady || isDeletingSelectedRecordings || deletingRecordingPath !== null}>
														+5s
													</button>
													<div className="history-rate-group" role="group" aria-label="Playback speed">
														{[1, 1.5, 2].map((rate) => (
															<button
																key={rate}
																className={
																	playbackRate === rate
																		? "btn compact-toggle-btn history-rate-btn history-rate-btn-active"
																		: "btn compact-toggle-btn history-rate-btn"
																}
																onClick={() => onSetPlaybackRate(rate)}
																disabled={isDeletingSelectedRecordings || deletingRecordingPath !== null}>
																{rate}x
															</button>
														))}
													</div>
												</div>
											</div>
											<div className="history-player-timeline">
												<span className="history-time">{formatPlaybackTime(playbackCurrentSec)}</span>
												<input
													type="range"
													min={0}
													max={playbackDurationSec > 0 ? playbackDurationSec : 0}
													step={0.1}
													value={Math.min(playbackCurrentSec, playbackDurationSec || 0)}
													onChange={onSeekPlayback}
													disabled={!playbackReady || playbackDurationSec <= 0 || isDeletingSelectedRecordings || deletingRecordingPath !== null}
												/>
												<span className="history-time">{formatPlaybackTime(playbackDurationSec)}</span>
											</div>
										</div>
									: null}

									{isLoadingRecordingHistory ?
										<div className="history-empty">Fetching recordings…</div>
									: recordingHistory.length === 0 ?
										<div className="history-empty">No microphone recordings found yet.</div>
									: <div className="history-list" role="list" aria-label="Microphone recording history">
											{recordingHistory.map((item: RecordingHistoryItem) => {
												const deleting = deletingRecordingPath === item.absolutePath;
												const selected = selectedRecordingPaths.includes(item.absolutePath);
												const playing = playingRecordingPath === item.absolutePath;

												return (
													<article className="history-item" key={item.id} role="listitem">
														<label className="history-select-wrap" title={selected ? "Unselect recording" : "Select recording"}>
															<input
																type="checkbox"
																checked={selected}
																onChange={() => onToggleSelectRecording(item.absolutePath)}
																disabled={isDeletingSelectedRecordings || deletingRecordingPath !== null}
															/>
														</label>

														<div className="history-item-main">
															<p className="history-file-name" title={item.fileName}>
																{item.fileName}
															</p>
															<p className="history-meta">
																{formatRecordingSize(item.sizeBytes)} · {item.extension.toUpperCase()} · {formatRecordingDate(item.createdAtIso)}
															</p>
														</div>

														<div className="history-item-actions">
															<button
																className="icon-btn history-play-btn"
																onClick={() => void onPlayRecording(item)}
																disabled={isDeletingSelectedRecordings || deletingRecordingPath !== null}
																title={playing && isPlaybackPlaying ? "Pause playback" : "Play recording"}
																aria-label={playing && isPlaybackPlaying ? "Pause playback" : "Play recording"}>
																{playing && isPlaybackPlaying ? <Pause size={15} /> : <Play size={15} />}
															</button>
									<button
										className="btn compact-toggle-btn"
										onClick={() => onUseRecordingForTranscription(item)}
										disabled={isDeletingSelectedRecordings || deletingRecordingPath !== null}
										title="Use this recording as the selected transcription file">
										Use
									</button>
									<button
										className="btn btn-danger history-delete-btn"
										onClick={() => void onDeleteRecording(item.absolutePath)}
										disabled={deleting || deletingRecordingPath !== null || isDeletingSelectedRecordings}>
										{deleting ? "Deleting…" : "Delete"}
									</button>
														</div>
													</article>
												);
											})}
										</div>
									}
								</>
							}
						</section>
					</section>
				</>
			}
		</main>
	);
}
