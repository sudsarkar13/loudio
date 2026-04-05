import { useEffect, useMemo, useRef, useState } from "react";
import {
  copyToClipboard,
  listenTranscriptionProgress,
  startMicrophoneTranscription,
  startTranscription,
} from "@/app/lib/tauri";
import type { AppSettings, TranscriptionResponse } from "@/app/lib/types";
import {
  appendTranscriptText,
  normalizeTranscriptText,
} from "@/app/components/transcription-studio/utils/transcript";

interface UseTranscriptionControllerReturn {
  result: TranscriptionResponse | null;
  transcriptDraft: string;
  livePreviewTranscript: string;
  status: string;
  isTranscribing: boolean;
  isMicTranscribing: boolean;
  transcriptDraftRef: React.MutableRefObject<string>;
  setStatus: (value: string) => void;
  setTranscriptDraft: (value: string) => void;
  onTranscribe: (audioPath: string, settings: AppSettings) => Promise<void>;
  transcribeMicrophoneBlob: (blob: Blob, settings: AppSettings) => Promise<void>;
  clearTranscriptView: () => void;
  onCopy: () => Promise<void>;
  transcriptWordCount: number;
  transcriptCharacterCount: number;
}

export function useTranscriptionController(): UseTranscriptionControllerReturn {
  const [result, setResult] = useState<TranscriptionResponse | null>(null);
  const [transcriptDraft, setTranscriptDraft] = useState<string>("");
  const [livePreviewTranscript, setLivePreviewTranscript] = useState<string>("");
  const [status, setStatus] = useState<string>("Accept the EULA to continue.");
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [isMicTranscribing, setIsMicTranscribing] = useState<boolean>(false);

  const transcriptionProgressUnlistenRef = useRef<(() => void) | null>(null);
  const transcriptDraftRef = useRef<string>("");

  useEffect(() => {
    transcriptDraftRef.current = transcriptDraft;
  }, [transcriptDraft]);

  useEffect(() => {
    return () => {
      transcriptionProgressUnlistenRef.current?.();
      transcriptionProgressUnlistenRef.current = null;
    };
  }, []);

  const transcriptWordCount = useMemo(() => {
    const normalized: string = transcriptDraft.trim();
    if (!normalized) return 0;
    return normalized.split(/\s+/).length;
  }, [transcriptDraft]);

  const transcriptCharacterCount = transcriptDraft.length;

  async function onTranscribe(audioPath: string, settings: AppSettings): Promise<void> {
    if (!audioPath) {
      setStatus("Select an audio file first.");
      return;
    }

    setResult(null);
    setLivePreviewTranscript("");
    setIsTranscribing(true);
    setStatus("Transcription in progress…");

    transcriptionProgressUnlistenRef.current?.();
    transcriptionProgressUnlistenRef.current = await listenTranscriptionProgress((event) => {
      if (typeof event.partialText === "string") {
        setLivePreviewTranscript(normalizeTranscriptText(event.partialText));
      }
      setStatus(event.status);
    });

    try {
      const response: TranscriptionResponse = await startTranscription(audioPath, settings);
      const normalizedText: string = normalizeTranscriptText(response.text);
      const normalizedResponse: TranscriptionResponse = { ...response, text: normalizedText };
      const mergedTranscriptText: string = appendTranscriptText(
        transcriptDraftRef.current,
        normalizedText,
      );

      setTranscriptDraft(mergedTranscriptText);
      setResult(normalizedResponse);
      setLivePreviewTranscript("");
      setStatus(`Done in ${(response.elapsedMs / 1000).toFixed(2)}s using ${response.modelUsed}.`);

      if (settings.autoCopy && mergedTranscriptText.trim()) {
        await copyToClipboard(mergedTranscriptText);
        setStatus(`Done and copied to clipboard in ${(response.elapsedMs / 1000).toFixed(2)}s.`);
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

  async function transcribeMicrophoneBlob(blob: Blob, settings: AppSettings): Promise<void> {
    setResult(null);
    setLivePreviewTranscript("");
    setIsMicTranscribing(true);
    setStatus("Microphone transcription in progress…");

    transcriptionProgressUnlistenRef.current?.();
    transcriptionProgressUnlistenRef.current = await listenTranscriptionProgress((event) => {
      if (typeof event.partialText === "string") {
        setLivePreviewTranscript(normalizeTranscriptText(event.partialText));
      }
      setStatus(event.status);
    });

    try {
      const response: TranscriptionResponse = await startMicrophoneTranscription(blob, settings);
      const normalizedText: string = normalizeTranscriptText(response.text);
      const normalizedResponse: TranscriptionResponse = { ...response, text: normalizedText };
      const mergedTranscriptText: string = appendTranscriptText(
        transcriptDraftRef.current,
        normalizedText,
      );

      setTranscriptDraft(mergedTranscriptText);
      setResult(normalizedResponse);
      setLivePreviewTranscript("");
      setStatus(`Done in ${(response.elapsedMs / 1000).toFixed(2)}s using ${response.modelUsed}.`);

      if (settings.autoCopy && mergedTranscriptText.trim()) {
        await copyToClipboard(mergedTranscriptText);
        setStatus(`Done and copied to clipboard in ${(response.elapsedMs / 1000).toFixed(2)}s.`);
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

  function clearTranscriptView(): void {
    setResult(null);
    setLivePreviewTranscript("");
    setTranscriptDraft("");
    setStatus("Transcript view cleared.");
  }

  async function onCopy(): Promise<void> {
    if (!transcriptDraft.trim()) return;
    await copyToClipboard(transcriptDraft);
    setStatus("Transcript copied to clipboard.");
  }

  return {
    result,
    transcriptDraft,
    livePreviewTranscript,
    status,
    isTranscribing,
    isMicTranscribing,
    transcriptDraftRef,
    setStatus,
    setTranscriptDraft,
    onTranscribe,
    transcribeMicrophoneBlob,
    clearTranscriptView,
    onCopy,
    transcriptWordCount,
    transcriptCharacterCount,
  };
}
