import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";

export interface UseAudioPreviewPlayerOptions {
	setStatus: (value: string) => void;
}

export interface UseAudioPreviewPlayerResult {
	playingPath: string | null;
	isPlaying: boolean;
	currentSec: number;
	durationSec: number;
	rate: number;
	ready: boolean;
	audioRef: React.MutableRefObject<HTMLAudioElement | null>;
	ensureAudioElement: () => HTMLAudioElement;
	stopPlayback: (clearSource?: boolean) => void;
	resetState: () => void;
	setPlayingPath: (path: string | null) => void;
	setReady: (ready: boolean) => void;
	resetProgress: () => void;
	onSeek: (event: ChangeEvent<HTMLInputElement>) => void;
	onStep: (deltaSeconds: number) => void;
	onSetRate: (nextRate: number) => void;
	onToggleActive: () => Promise<void>;
}

export function useAudioPreviewPlayer({
	setStatus,
}: UseAudioPreviewPlayerOptions): UseAudioPreviewPlayerResult {
	const [playingPath, setPlayingPath] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState<boolean>(false);
	const [currentSec, setCurrentSec] = useState<number>(0);
	const [durationSec, setDurationSec] = useState<number>(0);
	const [rate, setRate] = useState<number>(1);
	const [ready, setReady] = useState<boolean>(false);

	const audioRef = useRef<HTMLAudioElement | null>(null);

	const resetState = useCallback((): void => {
		setPlayingPath(null);
		setIsPlaying(false);
		setCurrentSec(0);
		setDurationSec(0);
		setReady(false);
	}, []);

	const stopPlayback = useCallback(
		(clearSource: boolean = false): void => {
			const audio: HTMLAudioElement | null = audioRef.current;
			if (!audio) {
				resetState();
				return;
			}

			audio.pause();
			if (clearSource) {
				audio.removeAttribute("src");
				audio.load();
			}

			resetState();
		},
		[resetState],
	);

	const ensureAudioElement = useCallback((): HTMLAudioElement => {
		if (audioRef.current) {
			return audioRef.current;
		}

		const audio: HTMLAudioElement = new Audio();
		audio.preload = "metadata";
		audio.onplay = () => setIsPlaying(true);
		audio.onpause = () => setIsPlaying(false);
		audio.ontimeupdate = () => setCurrentSec(audio.currentTime || 0);
		audio.onloadedmetadata = () => {
			setReady(true);
			setDurationSec(Number.isFinite(audio.duration) ? audio.duration : 0);
			setCurrentSec(audio.currentTime || 0);
		};
		audio.onratechange = () => setRate(audio.playbackRate || 1);
		audio.onended = () => {
			setIsPlaying(false);
			setCurrentSec(Number.isFinite(audio.duration) ? audio.duration : 0);
		};
		audio.onerror = () => {
			setStatus("Audio playback failed.");
			setIsPlaying(false);
		};

		audioRef.current = audio;
		return audio;
	}, [setStatus]);

	const resetProgress = useCallback((): void => {
		setReady(false);
		setCurrentSec(0);
		setDurationSec(0);
	}, []);

	const onSeek = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
		const audio: HTMLAudioElement | null = audioRef.current;
		if (!audio) return;

		const nextSec: number = Number(event.target.value);
		audio.currentTime = nextSec;
		setCurrentSec(nextSec);
	}, []);

	const onStep = useCallback(
		(deltaSeconds: number): void => {
			const audio: HTMLAudioElement | null = audioRef.current;
			if (!audio) return;

			const duration: number =
				Number.isFinite(audio.duration) ? audio.duration : durationSec;

			const bounded: number = Math.max(
				0,
				Math.min(
					duration || Number.MAX_SAFE_INTEGER,
					audio.currentTime + deltaSeconds,
				),
			);

			audio.currentTime = bounded;
			setCurrentSec(bounded);
		},
		[durationSec],
	);

	const onSetRate = useCallback((nextRate: number): void => {
		setRate(nextRate);
		if (audioRef.current) {
			audioRef.current.playbackRate = nextRate;
		}
	}, []);

	const onToggleActive = useCallback(async (): Promise<void> => {
		const audio: HTMLAudioElement | null = audioRef.current;
		if (!audio || !playingPath) return;

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
	}, [playingPath, setStatus]);

	useEffect(() => {
		return () => {
			audioRef.current?.pause();
			audioRef.current = null;
		};
	}, []);

	return {
		playingPath,
		isPlaying,
		currentSec,
		durationSec,
		rate,
		ready,
		audioRef,
		ensureAudioElement,
		stopPlayback,
		resetState,
		setPlayingPath,
		setReady,
		resetProgress,
		onSeek,
		onStep,
		onSetRate,
		onToggleActive,
	};
}
