import { useCallback, useEffect, useRef, useState } from "react";
import {
	encodeWav,
	resolvePreferredMicMimeType,
} from "@/components/transcription-studio/utils/audio";
import { isTauriRuntime } from "@/lib/tauri/runtime";
import { describeError, logDiagnostic } from "@/lib/diagnostics";

/**
 * Reports what a live track is actually doing.
 *
 * `muted` is the one that matters: WebKit sets it when it interrupts capture
 * (the page stops being visible, another app takes the device, the system
 * suspends input). A muted track keeps producing frames of silence rather than
 * erroring, so from the UI it looks exactly like a microphone that recorded
 * nothing.
 */
function describeTrack(stream: MediaStream): Record<string, unknown> {
	const track = stream.getAudioTracks()[0];
	if (!track) return { trackCount: 0 };

	const settings = track.getSettings?.() ?? {};
	return {
		trackCount: stream.getAudioTracks().length,
		trackLabel: track.label,
		trackReadyState: track.readyState,
		trackMuted: track.muted,
		trackEnabled: track.enabled,
		settingsDeviceId: settings.deviceId,
		settingsSampleRate: settings.sampleRate,
		settingsChannelCount: settings.channelCount,
	};
}

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

				logDiagnostic("warn", "mic", "Saved device rejected; retrying default", {
					requestedDeviceId: deviceId,
					...describeError(error),
				});

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
			logDiagnostic("info", "mic", "Stop requested", {
				sessionId: active.id,
				...describeTrack(active.stream),
			});
			active.stop();
			setStatus("Stopping microphone recording…");
			return;
		}

		// Re-entrancy guard: see `isStartingRef`.
		if (isStartingRef.current) {
			// Worth a line of its own: this is the double-start that used to
			// produce two recorders writing into one blob, i.e. every word
			// transcribed twice.
			logDiagnostic("warn", "mic", "Start ignored; another start is in flight");
			return;
		}
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
		const startedAt = Date.now();

		try {
			logDiagnostic("info", "mic", "Opening microphone", {
				sessionId,
				requestedDeviceId: selectedDeviceId.trim() || "(system default)",
				usesMediaRecorder: shouldUseMediaRecorder(),
			});

			stream = await openMicrophoneStream(selectedDeviceId.trim());

			logDiagnostic("info", "mic", "Microphone opened", {
				sessionId,
				openMs: Date.now() - startedAt,
				...describeTrack(stream),
			});

			// A track that mutes or ends mid-recording is the signature of an
			// interrupted capture, and nothing else in the pipeline reports it.
			const audioTrack = stream.getAudioTracks()[0];
			if (audioTrack) {
				audioTrack.onmute = () =>
					logDiagnostic("warn", "mic", "Capture track muted mid-session", {
						sessionId,
					});
				audioTrack.onunmute = () =>
					logDiagnostic("info", "mic", "Capture track unmuted", { sessionId });
				audioTrack.onended = () =>
					logDiagnostic("warn", "mic", "Capture track ended unexpectedly", {
						sessionId,
					});
			}

			// A stop requested while getUserMedia was still in flight, or a newer
			// start that superseded this one: release the device instead of
			// leaving a live stream holding the microphone open.
			if (sessionSeqRef.current !== sessionId) {
				logDiagnostic("warn", "mic", "Session superseded before start", {
					sessionId,
					currentSession: sessionSeqRef.current,
				});
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

				let capturedBytes = 0;
				let emptyChunks = 0;

				recorder.ondataavailable = (event: BlobEvent) => {
					// Bound to this session's own array, so a recorder that somehow
					// outlives its session writes into a buffer nobody reads.
					if (event.data.size > 0) {
						capturedBytes += event.data.size;
						chunks.push(event.data);
						return;
					}
					// A run of these with a live track is what a silently
					// interrupted capture looks like from here.
					emptyChunks += 1;
				};

				recorder.onerror = (event: Event) => {
					logDiagnostic("error", "mic", "MediaRecorder error", {
						sessionId,
						recorderState: recorder.state,
						...describeError((event as unknown as { error?: unknown }).error),
						...describeTrack(capturedStream),
					});
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
					const blob = new Blob(chunks, { type: mimeType });

					logDiagnostic(
						blob.size > 0 ? "info" : "error",
						"mic",
						blob.size > 0 ? "Capture finished" : "Capture produced no audio",
						{
							sessionId,
							elapsedMs: Date.now() - startedAt,
							blobBytes: blob.size,
							chunkCount: chunks.length,
							capturedBytes,
							emptyChunks,
							mimeType,
							...describeTrack(capturedStream),
						},
					);

					stopStream(capturedStream);
					finishSession(session, blob, mimeType);
				};

				sessionRef.current = session;
				recorder.start(250);
				logDiagnostic("info", "mic", "Recording started", {
					sessionId,
					mimeType,
					recorderState: recorder.state,
				});
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
				logDiagnostic("warn", "mic", "AudioContext started suspended; resuming", {
					sessionId,
				});
				await audioContext.resume();
			}

			logDiagnostic("info", "mic", "AudioContext ready", {
				sessionId,
				audioContextState: audioContext.state,
				sampleRate: audioContext.sampleRate,
			});

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

					// Read before closing: the whole point of logging this is to
					// show whether the context was still running when the capture
					// ended, and `close()` would overwrite that with "closed".
					const contextStateAtStop = audioContext.state;

					void audioContext.close();
					if (audioContextRef.current === audioContext) {
						audioContextRef.current = null;
					}

					const wav = encodeWav(wavChunks, sampleRate);
					logDiagnostic(
						wav.size > 0 ? "info" : "error",
						"mic",
						wav.size > 0 ? "Capture finished" : "Capture produced no audio",
						{
							sessionId,
							elapsedMs: Date.now() - startedAt,
							blobBytes: wav.size,
							bufferCount: wavChunks.length,
							audioContextState: contextStateAtStop,
							sampleRate,
							...describeTrack(capturedStream),
						},
					);

					stopStream(capturedStream);
					finishSession(session, wav, "audio/wav");
				},
			};

			sessionRef.current = session;
			setMicMimeType("audio/wav");
			setIsRecording(true);
			setStatus(
				"Recording from microphone (AudioContext fallback)… click Stop Recording when done.",
			);
		} catch (error) {
			logDiagnostic("error", "mic", "Microphone access failed", {
				sessionId,
				elapsedMs: Date.now() - startedAt,
				requestedDeviceId: selectedDeviceId.trim() || "(system default)",
				...describeError(error),
			});
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
		if (typeof document === "undefined") return;

		const onVisibilityChange = (): void => {
			const active = sessionRef.current;
			if (!active) return;

			// Only interesting during a capture: this is the signal WebKit acts on
			// when it decides to interrupt the microphone.
			logDiagnostic("warn", "mic", "Page visibility changed while recording", {
				sessionId: active.id,
				...describeTrack(active.stream),
			});
		};

		document.addEventListener("visibilitychange", onVisibilityChange);
		return () =>
			document.removeEventListener("visibilitychange", onVisibilityChange);
	}, []);

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
