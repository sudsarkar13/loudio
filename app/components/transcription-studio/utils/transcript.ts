/**
 * Normalizes transcript text into single-line chunks for predictable append behavior.
 */
export function normalizeTranscriptText(text: string): string {
  return text.replace(/\r?\n+/g, " ").replace(/\s{2,}/g, " ").trim();
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
