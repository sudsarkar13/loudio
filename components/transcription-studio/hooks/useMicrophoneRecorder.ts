import { useCallback, useEffect, useRef, useState } from "react";
import {
	encodeWav,
	resolvePreferredMicMimeType,
} from "@/components/transcription-studio/utils/audio";
import { isTauriRuntime } from "@/lib/tauri/runtime";

function shouldUseMediaRecorder(): boolean {
	if (typeof MediaRecorder === "undefined") return false;

	const userAgent = navigator.userAgent.toLowerCase();
	return !(isTauriRuntime() && userAgent.includes("linux"));
}

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

/**
 * Everything one capture owns.
 *
 * Each session carries its own stream, chunk buffer and teardown, so a recorder
 * that outlives its session — a leaked one, or a stop that raced a start — can
 * neither contaminate the next capture's audio nor stop the wrong stream. The
 * previous shape kept these in refs shared across captures, which is how two
 * overlapping recorders ended up appending both of their WebM streams into one
 * blob: the resulting file decoded as the same speech twice.
 */
interface RecordingSession {
	id: number;
	stream: MediaStream;
	stop: () => void;
}

export function useMicrophoneRecorder({
	selectedDeviceId,
	setStatus,
	onMicBlobReady,
}: UseMicrophoneRecorderOptions): UseMicrophoneRecorderResult {
	const [isRecording, setIsRecording] = useState<boolean>(false);
	const [micBlob, setMicBlob] = useState<Blob | null>(null);
	const [micMimeType, setMicMimeType] = useState<string>("");

	const sessionRef = useRef<RecordingSession | null>(null);
	const sessionSeqRef = useRef<number>(0);

	/**
	 * True from the moment a start is requested until the recorder is actually
	 * running.
	 *
	 * `isRecording` is React state, so it is still `false` throughout the `await`
	 * on `getUserMedia` — long enough for a double-click, or a click landing on
	 * top of the Cmd+Shift+M accelerator, to start a second capture on top of the
	 * first. This ref closes that window because it updates synchronously.
	 */
	const isStartingRef = useRef<boolean>(false);

	const audioContextRef = useRef<AudioContext | null>(null);

	const onMicBlobReadyRef = useRef(onMicBlobReady);
	onMicBlobReadyRef.current = onMicBlobReady;

	const stopStream = useCallback((stream: MediaStream): void => {
		stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
	}, []);

	const clearMicCapture = useCallback((): void => {
		setMicBlob(null);
		setMicMimeType("");
	}, []);

	const finishSession = useCallback(
		(session: RecordingSession, blob: Blob, mimeType: string): void => {
			// A session that is no longer the active one lost a race; its audio is
			// a duplicate of what the winner captured, so drop it rather than
			// transcribing the same speech a second time.
			if (sessionRef.current?.id !== session.id) return;

			sessionRef.current = null;
			setIsRecording(false);

			if (!blob.size) {
				setStatus("Microphone recording is empty. Please try again.");
				return;
			}

			setMicBlob(blob);
			setMicMimeType(mimeType);
			setStatus("Microphone recording captured. Starting transcription…");
			onMicBlobReadyRef.current(blob, mimeType);
		},
		[setStatus],
	);

	/**
	 * Opens the microphone, falling back to the system default when the saved
	 * device is gone.
	 *
	 * `deviceId: { exact }` is what makes an explicit choice stick, but it also
	 * makes the request fail outright once that device is unplugged or a
	 * Bluetooth headset disconnects — which is what "the mic just stops working
	 * sometimes" looks like from the outside.
	 */
	const openMicrophoneStream = useCallback(
		async (deviceId: string): Promise<MediaStream> => {
			// Explicit audio constraints help the underlying webview (notably
			// WebKitGTK on Linux/Ubuntu) request microphone-only access from
			// the xdg-desktop-portal. Without them, the portal sometimes
			// surfaces a camera permission prompt even though no video is
			// requested.
			const baseConstraints: MediaTrackConstraints = {
				echoCancellation: { ideal: true },
				noiseSuppression: { ideal: true },
				autoGainControl: { ideal: true },
			};

			if (!deviceId) {
				return navigator.mediaDevices.getUserMedia({
					audio: baseConstraints,
					video: false,
				});
			}

			try {
				return await navigator.mediaDevices.getUserMedia({
					audio: { ...baseConstraints, deviceId: { exact: deviceId } },
					video: false,
				});
			} catch (error) {
				const isMissingDevice =
					error instanceof DOMException &&
					(error.name === "OverconstrainedError" ||
						error.name === "NotFoundError");

				if (!isMissingDevice) throw error;

				setStatus(
					"Selected microphone is unavailable. Recording with the system default instead.",
				);
				return navigator.mediaDevices.getUserMedia({
					audio: baseConstraints,
					video: false,
				});
			}
		},
		[setStatus],
	);

	const onToggleMicRecording = useCallback(async (): Promise<void> => {
		const active = sessionRef.current;
		if (active) {
			active.stop();
			setStatus("Stopping microphone recording…");
			return;
		}

		// Re-entrancy guard: see `isStartingRef`.
		if (isStartingRef.current) return;
		isStartingRef.current = true;

		if (
			typeof navigator === "undefined" ||
			!navigator.mediaDevices?.getUserMedia
		) {
			isStartingRef.current = false;
			setStatus("Microphone input is not available in this environment.");
			return;
		}

		const sessionId = ++sessionSeqRef.current;
		let stream: MediaStream | null = null;

		try {
			stream = await openMicrophoneStream(selectedDeviceId.trim());

			// A stop requested while getUserMedia was still in flight, or a newer
			// start that superseded this one: release the device instead of
			// leaving a live stream holding the microphone open.
			if (sessionSeqRef.current !== sessionId) {
				stopStream(stream);
				return;
			}

			setMicBlob(null);
			setMicMimeType("");

			if (shouldUseMediaRecorder()) {
				const preferredMimeType = resolvePreferredMicMimeType();
				const recorder =
					preferredMimeType ?
						new MediaRecorder(stream, { mimeType: preferredMimeType })
					:	new MediaRecorder(stream);

				const capturedStream = stream;
				const chunks: BlobPart[] = [];
				const mimeType =
					recorder.mimeType || preferredMimeType || "audio/webm";

				const session: RecordingSession = {
					id: sessionId,
					stream: capturedStream,
					stop: () => {
						if (recorder.state !== "inactive") recorder.stop();
					},
				};

				setMicMimeType(mimeType);

				recorder.ondataavailable = (event: BlobEvent) => {
					// Bound to this session's own array, so a recorder that somehow
					// outlives its session writes into a buffer nobody reads.
					if (event.data.size > 0) chunks.push(event.data);
				};

				recorder.onerror = () => {
					recorder.ondataavailable = null;
					stopStream(capturedStream);
					if (sessionRef.current?.id === session.id) {
						sessionRef.current = null;
						setIsRecording(false);
					}
					setStatus("Microphone recording failed.");
				};

				recorder.onstop = () => {
					recorder.ondataavailable = null;
					stopStream(capturedStream);
					finishSession(
						session,
						new Blob(chunks, { type: mimeType }),
						mimeType,
					);
				};

				sessionRef.current = session;
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
				stopStream(stream);
				setStatus(
					"Microphone recording requires MediaRecorder or AudioContext support.",
				);
				return;
			}

			const audioContext = new AudioContextCtor();
			audioContextRef.current = audioContext;

			// The context is constructed after `await getUserMedia`, so the user
			// gesture that opened the mic no longer counts as one and the context
			// can start suspended. A suspended context never fires
			// `onaudioprocess`, which yields a zero-length wav and the misleading
			// "recording is empty" message.
			if (audioContext.state === "suspended") {
				await audioContext.resume();
			}

			// `resume` is another await, so re-check for the same reason as above.
			if (sessionSeqRef.current !== sessionId) {
				void audioContext.close();
				audioContextRef.current = null;
				stopStream(stream);
				return;
			}

			const capturedStream = stream;
			const source = audioContext.createMediaStreamSource(capturedStream);
			const processor = audioContext.createScriptProcessor(4096, 1, 1);
			const silentGain = audioContext.createGain();
			silentGain.gain.value = 0;

			const wavChunks: Float32Array[] = [];
			const sampleRate = audioContext.sampleRate;

			processor.onaudioprocess = (event: AudioProcessingEvent) => {
				const channelData = event.inputBuffer.getChannelData(0);
				wavChunks.push(new Float32Array(channelData));
			};

			source.connect(processor);
			processor.connect(silentGain);
			silentGain.connect(audioContext.destination);

			let hasStopped = false;
			const session: RecordingSession = {
				id: sessionId,
				stream: capturedStream,
				stop: () => {
					if (hasStopped) return;
					hasStopped = true;

					processor.onaudioprocess = null;
					processor.disconnect();
					source.disconnect();
					silentGain.disconnect();

					void audioContext.close();
					if (audioContextRef.current === audioContext) {
						audioContextRef.current = null;
					}

					stopStream(capturedStream);
					finishSession(
						session,
						encodeWav(wavChunks, sampleRate),
						"audio/wav",
					);
				},
			};

			sessionRef.current = session;
			setMicMimeType("audio/wav");
			setIsRecording(true);
			setStatus(
				"Recording from microphone (AudioContext fallback)… click Stop Recording when done.",
			);
		} catch (error) {
			if (stream) stopStream(stream);
			if (sessionRef.current?.id === sessionId) sessionRef.current = null;
			setIsRecording(false);
			setStatus(`Microphone access failed: ${String(error)}`);
		} finally {
			isStartingRef.current = false;
		}
	}, [
		finishSession,
		openMicrophoneStream,
		selectedDeviceId,
		setStatus,
		stopStream,
	]);

	useEffect(() => {
		return () => {
			// Bump the sequence so an in-flight start releases its stream instead of
			// installing itself into a hook that no longer exists.
			sessionSeqRef.current += 1;

			const active = sessionRef.current;
			sessionRef.current = null;
			if (active) {
				active.stop();
				stopStream(active.stream);
			}

			if (audioContextRef.current) {
				void audioContextRef.current.close();
				audioContextRef.current = null;
			}
		};
	}, [stopStream]);

	return {
		isRecording,
		micBlob,
		micMimeType,
		onToggleMicRecording,
		clearMicCapture,
	};
}
