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
