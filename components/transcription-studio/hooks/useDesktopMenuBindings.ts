import { useEffect } from "react";
import {
  closeDesktopApp,
  copyToClipboard,
  isLinuxDesktop,
  minimizeDesktopAppWindow,
  runRuntimeBootstrap,
  setupDesktopAppMenu,
} from "@/lib/tauri";
import type { AppSettings } from "@/lib/types";

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

  // Menu accelerators are owned by the GTK menu bar on Linux, so hiding that bar
  // for compact mode takes every shortcut with it — Ctrl+O, Ctrl+Enter, Ctrl+K
  // and the rest all stop responding while compact. macOS is unaffected: its
  // menu lives in the global bar, which compact mode never touches.
  //
  // This listener stands in for them, and only while the bar is actually
  // hidden. Installing it unconditionally would double-fire every shortcut in
  // general mode, where the native accelerators still work.
  useEffect(() => {
    if (!isLinuxDesktop() || !isCompactMode) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;

      // Match on `code` rather than `key`: with Shift held, `key` reports the
      // shifted character ("M" not "m"), which makes the two-modifier
      // shortcuts miss.
      const run = (action: () => void): void => {
        event.preventDefault();
        action();
      };

      if (event.shiftKey) {
        switch (event.code) {
          case "KeyM":
            return run(() => void onToggleMicRecording());
          case "KeyC":
            return run(() => {
              if (!transcriptDraftRef.current.trim()) {
                setStatus("No transcript available to copy yet.");
                return;
              }
              void copyToClipboard(transcriptDraftRef.current).then(() => {
                setStatus("Transcript copied to clipboard.");
              });
            });
          default:
            return;
        }
      }

      switch (event.code) {
        case "KeyO":
          return run(() => void onPickAudio());
        case "Enter":
          return run(() => void onTranscribe());
        case "KeyK":
          return run(clearTranscriptView);
        case "KeyM":
          return run(() => void minimizeDesktopAppWindow());
        case "KeyQ":
          return run(() => void closeDesktopApp());
        case "KeyR":
          return run(() => window.location.reload());
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    clearTranscriptView,
    isCompactMode,
    onPickAudio,
    onToggleMicRecording,
    onTranscribe,
    setStatus,
    transcriptDraftRef,
  ]);
}
