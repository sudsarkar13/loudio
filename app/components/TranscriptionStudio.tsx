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
	deleteMicrophoneRecording,
	enterCompactWindowMode,
	exitCompactWindowMode,
	getPersistedSettings,
	getMicrophoneRecordingPlaybackUrl,
	getRuntimeProfiles,
	listMicrophoneRecordingHistory,
	listenRuntimeBootstrapProgress,
	listenTranscriptionProgress,
	moveCompactWindowToAnchor,
	persistCompactWindowPosition,
	runRuntimeBootstrap,
	savePersistedSettings,
	setupDesktopAppMenu,
	startCompactWindowDrag,
	startMicrophoneTranscription,
	type CompactWindowAnchor,
	startTranscription,
} from "@/app/lib/tauri";
import type {
	AppSettings,
	RecordingHistoryItem,
	RuntimeProfile,
	TranscriptionResponse,
} from "@/app/lib/types";

function normalizeTranscriptText(text: string): string {
	return text
		.replace(/\r?\n+/g, " ")
		.replace(/\s{2,}/g, " ")
		.trim();
}

function appendTranscriptText(existingText: string, nextSegment: string): string {
	const normalizedNextSegment = normalizeTranscriptText(nextSegment);
	if (!normalizedNextSegment) {
		return existingText;
	}

	if (!existingText.trim()) {
		return normalizedNextSegment;
	}

	return `${existingText}\n\n${normalizedNextSegment}`;
}

function mergeSettings(incoming: AppSettings | null): AppSettings {
	if (!incoming) return DEFAULT_SETTINGS;
	return {
		...DEFAULT_SETTINGS,
		...incoming,
	};
}

function resolvePreferredMicMimeType(): string {
	if (typeof window === "undefined" || typeof MediaRecorder === "undefined")
		return "";

	const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
	return (
		candidates.find((mimeType: string) =>
			MediaRecorder.isTypeSupported(mimeType),
		) ?? ""
	);
}

function flattenAudioChunks(chunks: Float32Array[]): Float32Array {
	const totalLength = chunks.reduce(
		(total: number, chunk: Float32Array) => total + chunk.length,
		0,
	);
	const flattened = new Float32Array(totalLength);

	let offset = 0;
	for (const chunk of chunks) {
		flattened.set(chunk, offset);
		offset += chunk.length;
	}

	return flattened;
}

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
	const samples = flattenAudioChunks(chunks);
	const bytesPerSample = 2;
	const dataLength = samples.length * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataLength);
	const view = new DataView(buffer);

	const writeString = (offset: number, value: string): void => {
		for (let index = 0; index < value.length; index += 1) {
			view.setUint8(offset + index, value.charCodeAt(index));
		}
	};

	writeString(0, "RIFF");
	view.setUint32(4, 36 + dataLength, true);
	writeString(8, "WAVE");
	writeString(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * bytesPerSample, true);
	view.setUint16(32, bytesPerSample, true);
	view.setUint16(34, 16, true);
	writeString(36, "data");
	view.setUint32(40, dataLength, true);

	let offset = 44;
	for (let index = 0; index < samples.length; index += 1) {
		const sample = Math.max(-1, Math.min(1, samples[index]));
		const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
		view.setInt16(offset, intSample, true);
		offset += 2;
	}

	return new Blob([buffer], { type: "audio/wav" });
}

const EULA_STORAGE_KEY = "loudio:eula:accepted:v1";
const COMPACT_MODE_STORAGE_KEY = "loudio:ui:compact-mode:v1";
const COMPACT_ANCHOR_STORAGE_KEY = "loudio:ui:compact-anchor:v1";
const MODEL_OPTIONS: string[] = ["small", "medium", "large"];

function formatRecordingSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRecordingDate(isoDate: string): string {
	const parsed = new Date(isoDate);
	if (Number.isNaN(parsed.getTime())) {
		return isoDate;
	}

	return parsed.toLocaleString();
}

function formatPlaybackTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
	const rounded = Math.floor(seconds);
	const mins = Math.floor(rounded / 60);
	const secs = rounded % 60;
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function TranscriptionStudio() {
	const [profiles, setProfiles] = useState<RuntimeProfile[]>(RUNTIME_PROFILES);
	const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
	const [audioPath, setAudioPath] = useState<string>("");
	const [micBlob, setMicBlob] = useState<Blob | null>(null);
	const [micMimeType, setMicMimeType] = useState<string>("");
	const [result, setResult] = useState<TranscriptionResponse | null>(null);
	const [transcriptDraft, setTranscriptDraft] = useState<string>("");
	const [livePreviewTranscript, setLivePreviewTranscript] =
		useState<string>("");
	const [status, setStatus] = useState<string>("Accept the EULA to continue.");
	const [runtimeBootstrapPercent, setRuntimeBootstrapPercent] =
		useState<number>(0);
	const [runtimeBootstrapMessage, setRuntimeBootstrapMessage] =
		useState<string>("Waiting for EULA acceptance…");
	const [isBootstrapping, setIsBootstrapping] = useState<boolean>(false);
	const [hasCompletedRuntimeSetup, setHasCompletedRuntimeSetup] =
		useState<boolean>(false);
	const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
	const [isMicTranscribing, setIsMicTranscribing] = useState<boolean>(false);
	const [isRecording, setIsRecording] = useState<boolean>(false);
	const [hasAcceptedEula, setHasAcceptedEula] = useState<boolean>(false);
	const [isCheckingEula, setIsCheckingEula] = useState<boolean>(true);
	const [isCompactMode, setIsCompactMode] = useState<boolean>(false);
	const [compactAnchor, setCompactAnchor] =
		useState<CompactWindowAnchor>("bottom");
	const [activeGeneralView, setActiveGeneralView] =
		useState<"activity" | "history">("activity");
	const [recordingHistory, setRecordingHistory] = useState<
		RecordingHistoryItem[]
	>([]);
	const [isLoadingRecordingHistory, setIsLoadingRecordingHistory] =
		useState<boolean>(false);
	const [deletingRecordingPath, setDeletingRecordingPath] = useState<string | null>(
		null,
	);
	const [selectedRecordingPaths, setSelectedRecordingPaths] = useState<string[]>(
		[],
	);
	const [isDeletingSelectedRecordings, setIsDeletingSelectedRecordings] =
		useState<boolean>(false);
	const [playingRecordingPath, setPlayingRecordingPath] = useState<string | null>(
		null,
	);
	const [isPlaybackPlaying, setIsPlaybackPlaying] = useState<boolean>(false);
	const [playbackCurrentSec, setPlaybackCurrentSec] = useState<number>(0);
	const [playbackDurationSec, setPlaybackDurationSec] = useState<number>(0);
	const [playbackRate, setPlaybackRate] = useState<number>(1);
	const [playbackReady, setPlaybackReady] = useState<boolean>(false);

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
	const transcriptionProgressUnlistenRef = useRef<(() => void) | null>(null);

	const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
	const audioPathRef = useRef<string>("");
	const isRecordingRef = useRef<boolean>(false);
	const transcriptDraftRef = useRef<string>("");
	const resultRef = useRef<TranscriptionResponse | null>(null);
	const previewAudioRef = useRef<HTMLAudioElement | null>(null);

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
		settingsRef.current = settings;
		audioPathRef.current = audioPath;
		isRecordingRef.current = isRecording;
		transcriptDraftRef.current = transcriptDraft;
		resultRef.current = result;
	}, [settings, audioPath, isRecording, transcriptDraft, result]);

	useEffect(() => {
		void savePersistedSettings(settings);
	}, [settings]);

	useEffect(() => {
		return () => {
			previewAudioRef.current?.pause();
			previewAudioRef.current = null;
			stopRecordingRef.current?.();
			stopRecordingRef.current = null;
			bootstrapProgressUnlistenRef.current?.();
			bootstrapProgressUnlistenRef.current = null;
			transcriptionProgressUnlistenRef.current?.();
			transcriptionProgressUnlistenRef.current = null;

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

	const transcriptWordCount = useMemo(() => {
		const normalized = transcriptDraft.trim();
		if (!normalized) return 0;
		return normalized.split(/\s+/).length;
	}, [transcriptDraft]);
	const transcriptCharacterCount = transcriptDraft.length;

	const selectedAudioLabel = useMemo(() => {
		if (!audioPath) return "No file selected";
		const parts = audioPath.split(/[\\/]/);
		return parts[parts.length - 1] || audioPath;
	}, [audioPath]);

	const allHistorySelected =
		recordingHistory.length > 0 &&
		recordingHistory.every((item) =>
			selectedRecordingPaths.includes(item.absolutePath),
		);
	const hasSelectedRecordings = selectedRecordingPaths.length > 0;
	const activePlaybackItem = useMemo(
		() =>
			recordingHistory.find(
				(item: RecordingHistoryItem) => item.absolutePath === playingRecordingPath,
			) ?? null,
		[recordingHistory, playingRecordingPath],
	);

	const busy =
		isBootstrapping ||
		isTranscribing ||
		isMicTranscribing ||
		isCheckingEula ||
		!hasAcceptedEula;

	function resetPlaybackState(): void {
		setPlayingRecordingPath(null);
		setIsPlaybackPlaying(false);
		setPlaybackCurrentSec(0);
		setPlaybackDurationSec(0);
		setPlaybackReady(false);
	}

	function stopPreviewPlayback(clearSource = false): void {
		const audio = previewAudioRef.current;
		if (!audio) {
			resetPlaybackState();
			return;
		}

		audio.pause();
		if (clearSource) {
			audio.removeAttribute("src");
			audio.load();
		}

		resetPlaybackState();
	}

	function ensurePreviewAudioElement(): HTMLAudioElement {
		if (previewAudioRef.current) return previewAudioRef.current;

		const audio = new Audio();
		audio.preload = "metadata";
		audio.onplay = () => setIsPlaybackPlaying(true);
		audio.onpause = () => setIsPlaybackPlaying(false);
		audio.ontimeupdate = () => setPlaybackCurrentSec(audio.currentTime || 0);
		audio.onloadedmetadata = () => {
			setPlaybackReady(true);
			setPlaybackDurationSec(Number.isFinite(audio.duration) ? audio.duration : 0);
			setPlaybackCurrentSec(audio.currentTime || 0);
		};
		audio.onratechange = () => setPlaybackRate(audio.playbackRate || 1);
		audio.onended = () => {
			setIsPlaybackPlaying(false);
			setPlaybackCurrentSec(Number.isFinite(audio.duration) ? audio.duration : 0);
		};
		audio.onerror = () => {
			setStatus("Audio playback failed.");
			setIsPlaybackPlaying(false);
		};

		previewAudioRef.current = audio;
		return audio;
	}

	async function loadRecordingHistory(options?: {
		silent?: boolean;
		statusMessage?: string;
	}) {
		const silent = options?.silent ?? false;
		const statusMessage = options?.statusMessage;

		if (!silent) {
			setIsLoadingRecordingHistory(true);
		}

		try {
			const items = await listMicrophoneRecordingHistory();
			setRecordingHistory(items);
			setSelectedRecordingPaths((prev: string[]) => {
				const available = new Set(items.map((item) => item.absolutePath));
				return prev.filter((path) => available.has(path));
			});

			if (statusMessage) {
				setStatus(statusMessage);
			}
		} catch (error) {
			setStatus(`Failed to load recording history: ${String(error)}`);
		} finally {
			if (!silent) {
				setIsLoadingRecordingHistory(false);
			}
		}
	}

	async function onDeleteRecording(path: string) {
		setDeletingRecordingPath(path);
		try {
			await deleteMicrophoneRecording(path);
			if (playingRecordingPath === path) {
				stopPreviewPlayback(true);
			}
			await loadRecordingHistory({
				silent: true,
				statusMessage: "Recording deleted.",
			});
		} catch (error) {
			setStatus(`Failed to delete recording: ${String(error)}`);
		} finally {
			setDeletingRecordingPath(null);
		}
	}

	function onToggleSelectRecording(path: string) {
		setSelectedRecordingPaths((prev: string[]) => {
			if (prev.includes(path)) {
				return prev.filter((value) => value !== path);
			}
			return [...prev, path];
		});
	}

	function onToggleSelectAllRecordings() {
		const allPaths = recordingHistory.map((item) => item.absolutePath);
		const allSelected =
			allPaths.length > 0 &&
			allPaths.every((path) => selectedRecordingPaths.includes(path));

		setSelectedRecordingPaths(allSelected ? [] : allPaths);
	}

	async function onDeleteSelectedRecordings() {
		if (!selectedRecordingPaths.length) {
			setStatus("Select one or more recordings first.");
			return;
		}

		setIsDeletingSelectedRecordings(true);
		try {
			const results = await Promise.allSettled(
				selectedRecordingPaths.map((path) => deleteMicrophoneRecording(path)),
			);
			const failed = results.filter((result) => result.status === "rejected").length;

			if (failed > 0) {
				setStatus(
					`Deleted ${selectedRecordingPaths.length - failed} recording(s). ${failed} failed.`,
				);
			} else {
				setStatus(`Deleted ${selectedRecordingPaths.length} recording(s).`);
			}

			stopPreviewPlayback(true);
			setSelectedRecordingPaths([]);
			await loadRecordingHistory({ silent: true });
		} catch (error) {
			setStatus(`Failed to delete selected recordings: ${String(error)}`);
		} finally {
			setIsDeletingSelectedRecordings(false);
		}
	}

	async function onDeleteAllRecordings() {
		if (!recordingHistory.length) {
			setStatus("No recordings found to delete.");
			return;
		}

		setIsDeletingSelectedRecordings(true);
		try {
			const paths = recordingHistory.map((item) => item.absolutePath);
			const results = await Promise.allSettled(
				paths.map((path) => deleteMicrophoneRecording(path)),
			);
			const failed = results.filter((result) => result.status === "rejected").length;

			if (failed > 0) {
				setStatus(`Deleted ${paths.length - failed} recording(s). ${failed} failed.`);
			} else {
				setStatus("All recordings deleted.");
			}

			stopPreviewPlayback(true);
			setSelectedRecordingPaths([]);
			await loadRecordingHistory({ silent: true });
		} catch (error) {
			setStatus(`Failed to delete all recordings: ${String(error)}`);
		} finally {
			setIsDeletingSelectedRecordings(false);
		}
	}

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

	async function onPlayRecording(item: RecordingHistoryItem) {
		const audio = ensurePreviewAudioElement();

		if (playingRecordingPath === item.absolutePath) {
			try {
				if (audio.paused) {
					await audio.play();
					setStatus(`Playing ${item.fileName}`);
				} else {
					audio.pause();
					setStatus("Playback paused.");
				}
			} catch (error) {
				setStatus(`Failed to play recording: ${String(error)}`);
			}
			return;
		}

		setPlaybackReady(false);
		setPlaybackCurrentSec(0);
		setPlaybackDurationSec(0);
		setPlayingRecordingPath(item.absolutePath);

		const convertedUrl = await getMicrophoneRecordingPlaybackUrl(item.absolutePath);
		const decodedConvertedUrl = (() => {
			try {
				return decodeURI(convertedUrl);
			} catch {
				return convertedUrl;
			}
		})();

		const candidates = Array.from(
			new Set([
				convertedUrl,
				decodedConvertedUrl,
				`file://${item.absolutePath}`,
				item.absolutePath,
			]),
		);

		let lastError: unknown = null;
		for (const candidate of candidates) {
			try {
				audio.pause();
				audio.src = candidate;
				audio.currentTime = 0;
				audio.playbackRate = playbackRate;
				audio.load();
				await audio.play();
				setStatus(`Playing ${item.fileName}`);
				return;
			} catch (error) {
				lastError = error;
			}
		}

		stopPreviewPlayback();
		setStatus(`Failed to play recording: ${String(lastError ?? "Unknown playback error")}`);
	}

	function onSeekPlayback(event: ChangeEvent<HTMLInputElement>): void {
		const audio = previewAudioRef.current;
		if (!audio) return;

		const nextSec = Number(event.target.value);
		audio.currentTime = nextSec;
		setPlaybackCurrentSec(nextSec);
	}

	function onStepPlayback(deltaSeconds: number): void {
		const audio = previewAudioRef.current;
		if (!audio) return;

		const duration = Number.isFinite(audio.duration)
			? audio.duration
			: playbackDurationSec;
		const bounded = Math.max(
			0,
			Math.min(duration || Number.MAX_SAFE_INTEGER, audio.currentTime + deltaSeconds),
		);

		audio.currentTime = bounded;
		setPlaybackCurrentSec(bounded);
	}

	function onSetPlaybackRate(nextRate: number): void {
		setPlaybackRate(nextRate);
		if (previewAudioRef.current) {
			previewAudioRef.current.playbackRate = nextRate;
		}
	}

	async function onToggleActivePlayback(): Promise<void> {
		const audio = previewAudioRef.current;
		if (!audio || !playingRecordingPath) return;

		try {
			if (audio.paused) {
				await audio.play();
				setStatus("Playback resumed.");
			} else {
				audio.pause();
				setStatus("Playback paused.");
			}
		} catch (error) {
			setStatus(`Failed to change playback state: ${String(error)}`);
		}
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

	async function onTranscribe() {
		if (!audioPath) {
			setStatus("Select an audio file first.");
			return;
		}

		setResult(null);
		setLivePreviewTranscript("");
		setIsTranscribing(true);
		setStatus("Transcription in progress…");

		transcriptionProgressUnlistenRef.current?.();
		transcriptionProgressUnlistenRef.current =
			await listenTranscriptionProgress((event) => {
				if (typeof event.partialText === "string") {
					setLivePreviewTranscript(normalizeTranscriptText(event.partialText));
				}
				setStatus(event.status);
			});

		try {
			const response = await startTranscription(audioPath, settings);
			const normalizedText = normalizeTranscriptText(response.text);
			const normalizedResponse = { ...response, text: normalizedText };
			const mergedTranscriptText = appendTranscriptText(
				transcriptDraftRef.current,
				normalizedText,
			);

			setTranscriptDraft(mergedTranscriptText);
			setResult(normalizedResponse);
			setLivePreviewTranscript("");
			setStatus(
				`Done in ${(response.elapsedMs / 1000).toFixed(2)}s using ${response.modelUsed}.`,
			);

			if (settings.autoCopy && mergedTranscriptText.trim()) {
				await copyToClipboard(mergedTranscriptText);
				setStatus(
					`Done and copied to clipboard in ${(response.elapsedMs / 1000).toFixed(2)}s.`,
				);
			}
		} catch (error) {
			setStatus(`Transcription failed: ${String(error)}`);
		} finally {
			transcriptionProgressUnlistenRef.current?.();
			transcriptionProgressUnlistenRef.current = null;
			setLivePreviewTranscript("");
			setIsTranscribing(false);
		}
	}

	async function transcribeMicrophoneBlob(blob: Blob): Promise<void> {
		setResult(null);
		setLivePreviewTranscript("");
		setIsMicTranscribing(true);
		setStatus("Microphone transcription in progress…");

		transcriptionProgressUnlistenRef.current?.();
		transcriptionProgressUnlistenRef.current =
			await listenTranscriptionProgress((event) => {
				if (typeof event.partialText === "string") {
					setLivePreviewTranscript(normalizeTranscriptText(event.partialText));
				}
				setStatus(event.status);
			});

		try {
			const response = await startMicrophoneTranscription(blob, settings);
			const normalizedText = normalizeTranscriptText(response.text);
			const normalizedResponse = { ...response, text: normalizedText };
			const mergedTranscriptText = appendTranscriptText(
				transcriptDraftRef.current,
				normalizedText,
			);

			setTranscriptDraft(mergedTranscriptText);
			setResult(normalizedResponse);
			setLivePreviewTranscript("");
			setStatus(
				`Done in ${(response.elapsedMs / 1000).toFixed(2)}s using ${response.modelUsed}.`,
			);

			if (settings.autoCopy && mergedTranscriptText.trim()) {
				await copyToClipboard(mergedTranscriptText);
				setStatus(
					`Done and copied to clipboard in ${(response.elapsedMs / 1000).toFixed(2)}s.`,
				);
			}
		} catch (error) {
			setStatus(`Microphone transcription failed: ${String(error)}`);
		} finally {
			transcriptionProgressUnlistenRef.current?.();
			transcriptionProgressUnlistenRef.current = null;
			setLivePreviewTranscript("");
			setIsMicTranscribing(false);
		}
	}

	function clearTranscriptView() {
		setResult(null);
		setLivePreviewTranscript("");
		setTranscriptDraft("");
		setStatus("Transcript view cleared.");
	}

	async function onCopy() {
		if (!transcriptDraft.trim()) return;
		await copyToClipboard(transcriptDraft);
		setStatus("Transcript copied to clipboard.");
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
