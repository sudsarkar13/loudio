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
