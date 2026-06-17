import { useCallback, useEffect, useRef, useState } from "react";
import {
	encodeWav,
	resolvePreferredMicMimeType,
} from "@/app/components/transcription-studio/utils/audio";

export interface UseMicrophoneRecorderResult {
	isRecording: boolean;
	micBlob: Blob | null;
	micMimeType: string;
	onToggleMicRecording: () => Promise<void>;
	clearMicCapture: () => void;
}

interface UseMicrophoneRecorderOptions {
	selectedDeviceId: string;
	setStatus: (value: string) => void;
	onMicBlobReady: (blob: Blob, mimeType: string) => void;
}

export function useMicrophoneRecorder({
	selectedDeviceId,
	setStatus,
	onMicBlobReady,
}: UseMicrophoneRecorderOptions): UseMicrophoneRecorderResult {
	const [isRecording, setIsRecording] = useState<boolean>(false);
	const [micBlob, setMicBlob] = useState<Blob | null>(null);
	const [micMimeType, setMicMimeType] = useState<string>("");

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
	const onMicBlobReadyRef = useRef(onMicBlobReady);
	onMicBlobReadyRef.current = onMicBlobReady;

	const stopAllMedia = useCallback((): void => {
		mediaStreamRef.current
			?.getTracks()
			.forEach((track: MediaStreamTrack) => track.stop());
		mediaStreamRef.current = null;
		mediaRecorderRef.current = null;
	}, []);

	const disconnectAudioGraph = useCallback((): void => {
		scriptProcessorRef.current?.disconnect();
		mediaSourceRef.current?.disconnect();
		silentGainRef.current?.disconnect();
		scriptProcessorRef.current = null;
		mediaSourceRef.current = null;
		silentGainRef.current = null;
	}, []);

	const clearMicCapture = useCallback((): void => {
		setMicBlob(null);
		setMicMimeType("");
	}, []);

	const onToggleMicRecording = useCallback(async (): Promise<void> => {
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
			const trimmedDeviceId = selectedDeviceId.trim();
			const audioConstraints: MediaTrackConstraints =
				trimmedDeviceId ? { deviceId: { exact: trimmedDeviceId } } : {};
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: audioConstraints,
			});
			mediaStreamRef.current = stream;
			setMicBlob(null);
			setMicMimeType("");

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
					stopAllMedia();
					stopRecordingRef.current = null;
				};

				recorder.onstop = () => {
					const mimeType =
						recorder.mimeType || preferredMimeType || "audio/webm";
					const blob = new Blob(micChunksRef.current, { type: mimeType });

					setIsRecording(false);
					stopAllMedia();
					stopRecordingRef.current = null;

					if (!blob.size) {
						setStatus("Microphone recording is empty. Please try again.");
						return;
					}

					setMicBlob(blob);
					setMicMimeType(mimeType);
					setStatus("Microphone recording captured. Starting transcription…");
					onMicBlobReadyRef.current(blob, mimeType);
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

				stopAllMedia();
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
				onMicBlobReadyRef.current(blob, "audio/wav");
			};

			setIsRecording(true);
			setStatus(
				"Recording from microphone (AudioContext fallback)… click Stop Recording when done.",
			);
		} catch (error) {
			setIsRecording(false);
			setStatus(`Microphone access failed: ${String(error)}`);
			stopAllMedia();
			stopRecordingRef.current = null;
		}
	}, [isRecording, selectedDeviceId, setStatus, stopAllMedia]);

	useEffect(() => {
		return () => {
			stopRecordingRef.current?.();
			stopRecordingRef.current = null;
			stopAllMedia();
			disconnectAudioGraph();
			if (audioContextRef.current) {
				void audioContextRef.current.close();
				audioContextRef.current = null;
			}
		};
	}, [stopAllMedia, disconnectAudioGraph]);

	return {
		isRecording,
		micBlob,
		micMimeType,
		onToggleMicRecording,
		clearMicCapture,
	};
}
