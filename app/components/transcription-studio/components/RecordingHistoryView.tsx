import { FolderOpen, Pause, Play } from "lucide-react";
import type { ChangeEvent } from "react";
import type { RecordingHistoryItem } from "@/app/lib/types";

interface RecordingHistoryViewProps {
  isLoadingRecordingHistory: boolean;
  deletingRecordingPath: string | null;
  isDeletingSelectedRecordings: boolean;
  recordingHistory: RecordingHistoryItem[];
  selectedRecordingPaths: string[];
  allHistorySelected: boolean;
  hasSelectedRecordings: boolean;
  activePlaybackItem: RecordingHistoryItem | null;
  playbackReady: boolean;
  isPlaybackPlaying: boolean;
  playbackRate: number;
  playbackCurrentSec: number;
  playbackDurationSec: number;
  playingRecordingPath: string | null;
  formatRecordingSize: (bytes: number) => string;
  formatRecordingDate: (isoDate: string) => string;
  formatPlaybackTime: (seconds: number) => string;
  loadRecordingHistory: (options?: { statusMessage?: string; silent?: boolean }) => Promise<void>;
  onToggleSelectAllRecordings: () => void;
  onDeleteSelectedRecordings: () => Promise<void>;
  onDeleteAllRecordings: () => Promise<void>;
  onStepPlayback: (deltaSeconds: number) => void;
  onToggleActivePlayback: () => Promise<void>;
  onSetPlaybackRate: (rate: number) => void;
  onSeekPlayback: (event: ChangeEvent<HTMLInputElement>) => void;
  onPlayRecording: (item: RecordingHistoryItem) => Promise<void>;
  onUseRecordingForTranscription: (item: RecordingHistoryItem) => void;
  onDeleteRecording: (path: string) => Promise<void>;
  onToggleSelectRecording: (path: string) => void;
}

export function RecordingHistoryView({
  isLoadingRecordingHistory,
  deletingRecordingPath,
  isDeletingSelectedRecordings,
  recordingHistory,
  selectedRecordingPaths,
  allHistorySelected,
  hasSelectedRecordings,
  activePlaybackItem,
  playbackReady,
  isPlaybackPlaying,
  playbackRate,
  playbackCurrentSec,
  playbackDurationSec,
  playingRecordingPath,
  formatRecordingSize,
  formatRecordingDate,
  formatPlaybackTime,
  loadRecordingHistory,
  onToggleSelectAllRecordings,
  onDeleteSelectedRecordings,
  onDeleteAllRecordings,
  onStepPlayback,
  onToggleActivePlayback,
  onSetPlaybackRate,
  onSeekPlayback,
  onPlayRecording,
  onUseRecordingForTranscription,
  onDeleteRecording,
  onToggleSelectRecording,
}: RecordingHistoryViewProps) {
  return (
    <>
      <div className="section-title section-title-space">
        <div className="section-title-left">
          <FolderOpen size={16} />
          <h2>Recording History</h2>
        </div>
        <div className="history-header-actions">
          <button
            className="btn compact-toggle-btn"
            onClick={() => void loadRecordingHistory({ statusMessage: "Recording history refreshed." })}
            disabled={isLoadingRecordingHistory || deletingRecordingPath !== null}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="history-bulk-bar">
        <button
          className="btn compact-toggle-btn"
          onClick={onToggleSelectAllRecordings}
          disabled={!recordingHistory.length || isDeletingSelectedRecordings}
        >
          {allHistorySelected ? "Unselect all" : "Select all"}
        </button>
        <button
          className="btn btn-danger compact-toggle-btn"
          onClick={() => void onDeleteSelectedRecordings()}
          disabled={
            !hasSelectedRecordings ||
            isDeletingSelectedRecordings ||
            deletingRecordingPath !== null
          }
        >
          {isDeletingSelectedRecordings ? "Deleting…" : "Delete selected"}
        </button>
        <button
          className="btn btn-danger compact-toggle-btn"
          onClick={() => void onDeleteAllRecordings()}
          disabled={
            !recordingHistory.length ||
            isDeletingSelectedRecordings ||
            deletingRecordingPath !== null
          }
        >
          Delete all
        </button>
        <span className="history-selection-count">
          {hasSelectedRecordings ? `${selectedRecordingPaths.length} selected` : "No selection"}
        </span>
      </div>

      {activePlaybackItem ? (
        <div className="history-player" aria-live="polite">
          <div className="history-player-main">
            <p className="history-player-title" title={activePlaybackItem.fileName}>
              Now playing: {activePlaybackItem.fileName}
            </p>
            <div className="history-player-controls">
              <button
                className="btn compact-toggle-btn"
                onClick={() => onStepPlayback(-5)}
                disabled={!playbackReady || isDeletingSelectedRecordings || deletingRecordingPath !== null}
              >
                -5s
              </button>
              <button
                className="btn compact-toggle-btn"
                onClick={() => void onToggleActivePlayback()}
                disabled={isDeletingSelectedRecordings || deletingRecordingPath !== null}
              >
                {isPlaybackPlaying ? (
                  <>
                    <Pause size={14} /> Pause
                  </>
                ) : (
                  <>
                    <Play size={14} /> Play
                  </>
                )}
              </button>
              <button
                className="btn compact-toggle-btn"
                onClick={() => onStepPlayback(5)}
                disabled={!playbackReady || isDeletingSelectedRecordings || deletingRecordingPath !== null}
              >
                +5s
              </button>
              <div className="history-rate-group" role="group" aria-label="Playback speed">
                {[1, 1.5, 2].map((rate: number) => (
                  <button
                    key={rate}
                    className={
                      playbackRate === rate
                        ? "btn compact-toggle-btn history-rate-btn history-rate-btn-active"
                        : "btn compact-toggle-btn history-rate-btn"
                    }
                    onClick={() => onSetPlaybackRate(rate)}
                    disabled={isDeletingSelectedRecordings || deletingRecordingPath !== null}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="history-player-timeline">
            <span className="history-time">{formatPlaybackTime(playbackCurrentSec)}</span>
            <input
              type="range"
              min={0}
              max={playbackDurationSec > 0 ? playbackDurationSec : 0}
              step={0.1}
              value={Math.min(playbackCurrentSec, playbackDurationSec || 0)}
              onChange={onSeekPlayback}
              disabled={!playbackReady || playbackDurationSec <= 0 || isDeletingSelectedRecordings || deletingRecordingPath !== null}
            />
            <span className="history-time">{formatPlaybackTime(playbackDurationSec)}</span>
          </div>
        </div>
      ) : null}

      {isLoadingRecordingHistory ? (
        <div className="history-empty">Fetching recordings…</div>
      ) : recordingHistory.length === 0 ? (
        <div className="history-empty">No microphone recordings found yet.</div>
      ) : (
        <div className="history-list" role="list" aria-label="Microphone recording history">
          {recordingHistory.map((item: RecordingHistoryItem) => {
            const deleting: boolean = deletingRecordingPath === item.absolutePath;
            const selected: boolean = selectedRecordingPaths.includes(item.absolutePath);
            const playing: boolean = playingRecordingPath === item.absolutePath;

            return (
              <article className="history-item" key={item.id} role="listitem">
                <label
                  className="history-select-wrap"
                  title={selected ? "Unselect recording" : "Select recording"}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleSelectRecording(item.absolutePath)}
                    disabled={isDeletingSelectedRecordings || deletingRecordingPath !== null}
                  />
                </label>

                <div className="history-item-main">
                  <p className="history-file-name" title={item.fileName}>
                    {item.fileName}
                  </p>
                  <p className="history-meta">
                    {formatRecordingSize(item.sizeBytes)} · {item.extension.toUpperCase()} · {formatRecordingDate(item.createdAtIso)}
                  </p>
                </div>

                <div className="history-item-actions">
                  <button
                    className="icon-btn history-play-btn"
                    onClick={() => void onPlayRecording(item)}
                    disabled={isDeletingSelectedRecordings || deletingRecordingPath !== null}
                    title={playing && isPlaybackPlaying ? "Pause playback" : "Play recording"}
                    aria-label={playing && isPlaybackPlaying ? "Pause playback" : "Play recording"}
                  >
                    {playing && isPlaybackPlaying ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <button
                    className="btn compact-toggle-btn"
                    onClick={() => onUseRecordingForTranscription(item)}
                    disabled={isDeletingSelectedRecordings || deletingRecordingPath !== null}
                    title="Use this recording as the selected transcription file"
                  >
                    Use
                  </button>
                  <button
                    className="btn btn-danger history-delete-btn"
                    onClick={() => void onDeleteRecording(item.absolutePath)}
                    disabled={deleting || deletingRecordingPath !== null || isDeletingSelectedRecordings}
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
