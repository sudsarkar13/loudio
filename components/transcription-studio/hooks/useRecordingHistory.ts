import { useRecordingHistoryController } from "@/components/transcription-studio/useRecordingHistoryController";

interface UseRecordingHistoryOptions {
  setStatus: (value: string) => void;
}

export function useRecordingHistory(options: UseRecordingHistoryOptions) {
  return useRecordingHistoryController(options);
}
