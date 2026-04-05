import { useEffect } from "react";
import { copyToClipboard, runRuntimeBootstrap, setupDesktopAppMenu } from "@/app/lib/tauri";
import type { AppSettings } from "@/app/lib/types";

interface UseDesktopMenuBindingsOptions {
  onPickAudio: () => Promise<void>;
  onTranscribe: () => Promise<void>;
  onToggleMicRecording: () => Promise<void>;
  onToggleCompactMode: () => Promise<void>;
  clearTranscriptView: () => void;
  transcriptDraftRef: React.MutableRefObject<string>;
  setStatus: (value: string) => void;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  settings: AppSettings;
  isCompactMode: boolean;
}

export function useDesktopMenuBindings({
  onPickAudio,
  onTranscribe,
  onToggleMicRecording,
  onToggleCompactMode,
  clearTranscriptView,
  transcriptDraftRef,
  setStatus,
  setSettings,
  settings,
  isCompactMode,
}: UseDesktopMenuBindingsOptions): void {
  useEffect(() => {
    void setupDesktopAppMenu({
      openAudioFile: onPickAudio,
      transcribeFile: onTranscribe,
      toggleMicRecording: onToggleMicRecording,
      toggleCompactMode: onToggleCompactMode,
      copyTranscript: async () => {
        if (!transcriptDraftRef.current.trim()) {
          setStatus("No transcript available to copy yet.");
          return;
        }

        await copyToClipboard(transcriptDraftRef.current);
        setStatus("Transcript copied to clipboard.");
      },
      clearTranscript: clearTranscriptView,
      toggleAutoCopy: () => {
        setSettings((prev: AppSettings) => ({
          ...prev,
          autoCopy: !prev.autoCopy,
        }));
      },
      bootstrapRuntime: async () => {
        setStatus("Running runtime bootstrap…");
        const message: string = await runRuntimeBootstrap();
        setStatus(message);
      },
      isAutoCopyEnabled: settings.autoCopy,
      isCompactModeEnabled: isCompactMode,
    });
  }, [
    clearTranscriptView,
    isCompactMode,
    onPickAudio,
    onToggleCompactMode,
    onToggleMicRecording,
    onTranscribe,
    setSettings,
    setStatus,
    settings.autoCopy,
    transcriptDraftRef,
  ]);
}
