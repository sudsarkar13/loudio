import type { AppSettings } from "@/app/lib/types";
import { DEFAULT_SETTINGS } from "@/app/lib/defaults";

/**
 * Normalizes transcript text into single-line chunks for predictable append behavior.
 */
export function normalizeTranscriptText(text: string): string {
  return text
    .replace(/\r?\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Appends a finalized transcript segment to an existing transcript draft.
 */
export function appendTranscriptText(existingText: string, nextSegment: string): string {
  const normalizedNextSegment: string = normalizeTranscriptText(nextSegment);
  if (!normalizedNextSegment) {
    return existingText;
  }

  if (!existingText.trim()) {
    return normalizedNextSegment;
  }

  return `${existingText}\n\n${normalizedNextSegment}`;
}

/**
 * Merges persisted settings with defaults to keep new fields backward compatible.
 */
export function mergeSettings(incoming: AppSettings | null): AppSettings {
  if (!incoming) {
    return DEFAULT_SETTINGS;
  }

  return {
    ...DEFAULT_SETTINGS,
    ...incoming,
  };
}

export function resolvePreferredMicMimeType(): string {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return "";
  }

  const candidates: string[] = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((mimeType: string) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

export function flattenAudioChunks(chunks: Float32Array[]): Float32Array {
  const totalLength: number = chunks.reduce(
    (total: number, chunk: Float32Array): number => total + chunk.length,
    0,
  );
  const flattened: Float32Array = new Float32Array(totalLength);

  let offset: number = 0;
  for (const chunk of chunks) {
    flattened.set(chunk, offset);
    offset += chunk.length;
  }

  return flattened;
}

export function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const samples: Float32Array = flattenAudioChunks(chunks);
  const bytesPerSample: number = 2;
  const dataLength: number = samples.length * bytesPerSample;
  const buffer: ArrayBuffer = new ArrayBuffer(44 + dataLength);
  const view: DataView = new DataView(buffer);

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

  let offset: number = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample: number = Math.max(-1, Math.min(1, samples[index]));
    const intSample: number = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function formatRecordingSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatRecordingDate(isoDate: string): string {
  const parsed: Date = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }

  return parsed.toLocaleString();
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const rounded: number = Math.floor(seconds);
  const mins: number = Math.floor(rounded / 60);
  const secs: number = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
