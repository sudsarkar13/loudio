import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import {
	deleteMicrophoneRecording,
	getMicrophoneRecordingPlaybackUrl,
	listMicrophoneRecordingHistory,
} from "@/app/lib/tauri";
import type { RecordingHistoryItem } from "@/app/lib/types";
import { useAudioPreviewPlayer } from "@/app/components/transcription-studio/hooks/useAudioPreviewPlayer";

interface LoadRecordingHistoryOptions {
	silent?: boolean;
	statusMessage?: string;
}

interface UseRecordingHistoryControllerOptions {
	setStatus: (value: string) => void;
}

interface UseRecordingHistoryControllerReturn {
	recordingHistory: RecordingHistoryItem[];
	isLoadingRecordingHistory: boolean;
	deletingRecordingPath: string | null;
	selectedRecordingPaths: string[];
	isDeletingSelectedRecordings: boolean;
	playingRecordingPath: string | null;
	isPlaybackPlaying: boolean;
	playbackCurrentSec: number;
	playbackDurationSec: number;
	playbackRate: number;
	playbackReady: boolean;
	allHistorySelected: boolean;
	hasSelectedRecordings: boolean;
	activePlaybackItem: RecordingHistoryItem | null;
	loadRecordingHistory: (
		options?: LoadRecordingHistoryOptions,
	) => Promise<void>;
	onDeleteRecording: (path: string) => Promise<void>;
	onToggleSelectRecording: (path: string) => void;
	onToggleSelectAllRecordings: () => void;
	onDeleteSelectedRecordings: () => Promise<void>;
	onDeleteAllRecordings: () => Promise<void>;
	onPlayRecording: (item: RecordingHistoryItem) => Promise<void>;
	onSeekPlayback: (event: ChangeEvent<HTMLInputElement>) => void;
	onStepPlayback: (deltaSeconds: number) => void;
	onSetPlaybackRate: (nextRate: number) => void;
	onToggleActivePlayback: () => Promise<void>;
}

export function useRecordingHistoryController({
	setStatus,
}: UseRecordingHistoryControllerOptions): UseRecordingHistoryControllerReturn {
	const [recordingHistory, setRecordingHistory] = useState<
		RecordingHistoryItem[]
	>([]);
	const [isLoadingRecordingHistory, setIsLoadingRecordingHistory] =
		useState<boolean>(false);
	const [deletingRecordingPath, setDeletingRecordingPath] = useState<
		string | null
	>(null);
	const [selectedRecordingPaths, setSelectedRecordingPaths] = useState<
		string[]
	>([]);
	const [isDeletingSelectedRecordings, setIsDeletingSelectedRecordings] =
		useState<boolean>(false);

	const player = useAudioPreviewPlayer({ setStatus });
	const {
		playingPath: playingRecordingPath,
		isPlaying: isPlaybackPlaying,
		currentSec: playbackCurrentSec,
		durationSec: playbackDurationSec,
		rate: playbackRate,
		ready: playbackReady,
		ensureAudioElement: ensurePreviewAudioElement,
		stopPlayback: stopPreviewPlayback,
		setPlayingPath: setPlayingRecordingPath,
		resetProgress,
		onSeek: onSeekPlayback,
		onStep: onStepPlayback,
		onSetRate: onSetPlaybackRate,
		onToggleActive: onToggleActivePlayback,
	} = player;

	const allHistorySelected: boolean =
		recordingHistory.length > 0 &&
		recordingHistory.every((item: RecordingHistoryItem) =>
			selectedRecordingPaths.includes(item.absolutePath),
		);

	const hasSelectedRecordings: boolean = selectedRecordingPaths.length > 0;

	const activePlaybackItem = useMemo(
		() =>
			recordingHistory.find(
				(item: RecordingHistoryItem) =>
					item.absolutePath === playingRecordingPath,
			) ?? null,
		[recordingHistory, playingRecordingPath],
	);

	async function loadRecordingHistory(
		options?: LoadRecordingHistoryOptions,
	): Promise<void> {
		const silent: boolean = options?.silent ?? false;
		const statusMessage: string | undefined = options?.statusMessage;

		if (!silent) {
			setIsLoadingRecordingHistory(true);
		}

		try {
			const items: RecordingHistoryItem[] =
				await listMicrophoneRecordingHistory();
			setRecordingHistory(items);
			setSelectedRecordingPaths((prev: string[]) => {
				const available: Set<string> = new Set(
					items.map((item) => item.absolutePath),
				);
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

	async function onDeleteRecording(path: string): Promise<void> {
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

	function onToggleSelectRecording(path: string): void {
		setSelectedRecordingPaths((prev: string[]) => {
			if (prev.includes(path)) {
				return prev.filter((value) => value !== path);
			}
			return [...prev, path];
		});
	}

	function onToggleSelectAllRecordings(): void {
		const allPaths: string[] = recordingHistory.map(
			(item) => item.absolutePath,
		);
		const allSelected: boolean =
			allPaths.length > 0 &&
			allPaths.every((path) => selectedRecordingPaths.includes(path));

		setSelectedRecordingPaths(allSelected ? [] : allPaths);
	}

	async function onDeleteSelectedRecordings(): Promise<void> {
		if (!selectedRecordingPaths.length) {
			setStatus("Select one or more recordings first.");
			return;
		}

		setIsDeletingSelectedRecordings(true);

		try {
			const results: PromiseSettledResult<void>[] = await Promise.allSettled(
				selectedRecordingPaths.map((path) => deleteMicrophoneRecording(path)),
			);
			const failed: number = results.filter(
				(result) => result.status === "rejected",
			).length;

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

	async function onDeleteAllRecordings(): Promise<void> {
		if (!recordingHistory.length) {
			setStatus("No recordings found to delete.");
			return;
		}

		setIsDeletingSelectedRecordings(true);

		try {
			const paths: string[] = recordingHistory.map((item) => item.absolutePath);
			const results: PromiseSettledResult<void>[] = await Promise.allSettled(
				paths.map((path) => deleteMicrophoneRecording(path)),
			);
			const failed: number = results.filter(
				(result) => result.status === "rejected",
			).length;

			if (failed > 0) {
				setStatus(
					`Deleted ${paths.length - failed} recording(s). ${failed} failed.`,
				);
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

	async function onPlayRecording(item: RecordingHistoryItem): Promise<void> {
		const audio: HTMLAudioElement = ensurePreviewAudioElement();

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

		resetProgress();
		setPlayingRecordingPath(item.absolutePath);

		const convertedUrl: string = await getMicrophoneRecordingPlaybackUrl(
			item.absolutePath,
		);
		const decodedConvertedUrl: string = (() => {
			try {
				return decodeURI(convertedUrl);
			} catch {
				return convertedUrl;
			}
		})();

		const candidates: string[] = Array.from(
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
		setStatus(
			`Failed to play recording: ${String(lastError ?? "Unknown playback error")}`,
		);
	}

	return {
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
	};
}
