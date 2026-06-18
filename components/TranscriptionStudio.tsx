"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MODEL_OPTIONS } from "@/components/transcription-studio/constants";
import {
	formatPlaybackTime,
	formatRecordingDate,
	formatRecordingSize,
} from "@/components/transcription-studio/utils/format";
import { LANGUAGES } from "@/lib/defaults";
import { chooseAudioFile } from "@/lib/tauri";
import type { RecordingHistoryItem, RuntimeProfile } from "@/lib/types";
import { useCompactWindowMode } from "@/components/transcription-studio/hooks/useCompactWindowMode";
import { useMicrophoneRecorder } from "@/components/transcription-studio/hooks/useMicrophoneRecorder";
import { useRecordingHistory } from "@/components/transcription-studio/hooks/useRecordingHistory";
import { useRuntimeBootstrap } from "@/components/transcription-studio/hooks/useRuntimeBootstrap";
import { useSystemReadinessWizard } from "@/components/transcription-studio/hooks/useSystemReadinessWizard";
import { useTranscriptWorkflow } from "@/components/transcription-studio/hooks/useTranscriptWorkflow";
import { useDesktopMenuBindings } from "@/components/transcription-studio/hooks/useDesktopMenuBindings";
import { useMicrophoneDevices } from "@/components/transcription-studio/hooks/useMicrophoneDevices";
import { CompactShell } from "@/components/transcription-studio/components/CompactShell";
import { GeneralTopStrip } from "@/components/transcription-studio/components/GeneralTopStrip";
import { RecordingHistoryView } from "@/components/transcription-studio/components/RecordingHistoryView";
import { SettingsPanel } from "@/components/transcription-studio/components/SettingsPanel";
import { SystemReadinessWizard } from "@/components/transcription-studio/components/SystemReadinessWizard/SystemReadinessWizard";
import { ReadinessDriftBanner } from "@/components/transcription-studio/components/SystemReadinessWizard/ReadinessDriftBanner";
import { WorkspaceActivityView } from "@/components/transcription-studio/components/WorkspaceActivityView";
import { AboutPanel } from "@/components/transcription-studio/components/AboutPanel";

export function TranscriptionStudio() {
	const {
		result,
		transcriptDraft,
		livePreviewTranscript,
		status,
		isTranscribing,
		isMicTranscribing,
		transcriptDraftRef,
		setStatus,
		setTranscriptDraft,
		onTranscribe: runTranscription,
		transcribeMicrophoneBlob: runMicrophoneTranscription,
		clearTranscriptView: clearTranscriptDraft,
		onCopy: copyTranscriptDraft,
		transcriptWordCount,
		transcriptCharacterCount,
	} = useTranscriptWorkflow();

	const [audioPath, setAudioPath] = useState<string>("");

	const {
		report: readinessReport,
		needsWizard,
		driftIds,
		check: recheckReadiness,
	} = useSystemReadinessWizard();

	const hasAcceptedEula = !needsWizard;
	const isCheckingEula = !readinessReport;

	const {
		profiles,
		settings,
		setSettings,
		isBootstrapping,
		runtimeBootstrapPercent,
		runtimeBootstrapMessage,
	} = useRuntimeBootstrap({
		hasAcceptedEula,
		isCheckingEula,
		setStatus,
	});

	const {
		isCompactMode,
		compactAnchor,
		onToggleCompactMode,
		onMoveCompactAnchor,
		onStartCompactDrag,
	} = useCompactWindowMode({
		hasAcceptedEula,
		isCheckingEula,
		setStatus,
	});

	const [forceWizard, setForceWizard] = useState<boolean>(false);
	const showWizard = needsWizard || forceWizard;
	const onReviewDrift = useCallback(() => {
		setForceWizard(true);
		void recheckReadiness(true);
	}, [recheckReadiness]);

	const [isAboutOpen, setIsAboutOpen] = useState<boolean>(false);
	const onOpenAbout = useCallback(() => setIsAboutOpen(true), []);
	const onCloseAbout = useCallback(() => setIsAboutOpen(false), []);

	const {
		devices: microphoneDevices,
		hasPermission: hasMicrophonePermission,
		isEnumerating: isEnumeratingMicrophones,
		errorMessage: microphoneErrorMessage,
		requestPermission: requestMicrophonePermission,
		refresh: refreshMicrophoneDevices,
	} = useMicrophoneDevices();

	const onMicBlobReady = useCallback(
		(blob: Blob, _mimeType: string) => {
			void runMicrophoneTranscription(blob, settings);
		},
		[runMicrophoneTranscription, settings],
	);

	const {
		isRecording,
		micBlob,
		micMimeType,
		onToggleMicRecording,
		clearMicCapture,
	} = useMicrophoneRecorder({
		selectedDeviceId: settings.micDeviceId ?? "",
		setStatus,
		onMicBlobReady,
	});

	const [activeGeneralView, setActiveGeneralView] = useState<
		"activity" | "history"
	>("activity");

	const {
		recordingHistory,
		isLoadingRecordingHistory,
		deletingRecordingPath,
		selectedRecordingPaths,
		isDeletingSelectedRecordings,
		playingRecordingPath,
		isPlaybackPlaying,
		playbackCurrentSec,
		playbackDurationSec,
		playbackRate,
		playbackReady,
		allHistorySelected,
		hasSelectedRecordings,
		activePlaybackItem,
		loadRecordingHistory,
		onDeleteRecording,
		onToggleSelectRecording,
		onToggleSelectAllRecordings,
		onDeleteSelectedRecordings,
		onDeleteAllRecordings,
		onPlayRecording,
		onSeekPlayback,
		onStepPlayback,
		onSetPlaybackRate,
		onToggleActivePlayback,
		recordingsDiskUsageBytes,
		legacyDirs,
		legacyDiskUsageBytes,
		isMigratingLegacyRecordings,
		currentRecordingsOutputDir,
		migrateLegacyRecordingDirs,
		revealRecordingsOutputDirInFinder,
	} = useRecordingHistory({ setStatus });

	// If a previously selected microphone is no longer present (unplugged, BT
	// disconnected, etc.), fall back to the system default so the next recording
	// attempt does not fail with an OverconstrainedError.
	useEffect(() => {
		const selectedDeviceId = (settings.micDeviceId ?? "").trim();
		if (!selectedDeviceId) return;
		if (isEnumeratingMicrophones) return;

		const stillAvailable = microphoneDevices.some(
			(device) => device.deviceId === selectedDeviceId,
		);

		if (!stillAvailable) {
			setSettings((prev) => ({ ...prev, micDeviceId: "" }));
			setStatus(
				"Selected microphone is no longer available. Falling back to the system default.",
			);
		}
	}, [
		isEnumeratingMicrophones,
		microphoneDevices,
		settings.micDeviceId,
		setSettings,
		setStatus,
	]);

	const onPickAudio = useCallback(async () => {
		const picked = await chooseAudioFile();
		if (picked) {
			setAudioPath(picked);
			clearMicCapture();
			setStatus("Audio file selected. Ready to transcribe.");
		} else {
			setStatus("No file selected.");
		}
	}, [clearMicCapture, setStatus]);

	const onTranscribe = useCallback(async (): Promise<void> => {
		await runTranscription(audioPath, settings);
	}, [runTranscription, audioPath, settings]);

	const onCopy = useCallback(async (): Promise<void> => {
		await copyTranscriptDraft();
	}, [copyTranscriptDraft]);

	const clearTranscriptView = useCallback((): void => {
		clearTranscriptDraft();
	}, [clearTranscriptDraft]);

	useDesktopMenuBindings({
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
	});

	const activeProfile = useMemo(
		() =>
			profiles.find(
				(profile: RuntimeProfile) => profile.id === settings.profileId,
			) ?? profiles[0],
		[profiles, settings.profileId],
	);

	const selectedAudioLabel = useMemo(() => {
		if (!audioPath) return "No file selected";
		const parts = audioPath.split(/[\\/]/);
		return parts[parts.length - 1] || audioPath;
	}, [audioPath]);

	const selectedMicrophoneLabel = useMemo(() => {
		const selectedDeviceId = (settings.micDeviceId ?? "").trim();
		const match = microphoneDevices.find(
			(device) => device.deviceId === selectedDeviceId,
		);
		if (match) return `Input: ${match.label}`;
		return "Input: System default microphone";
	}, [microphoneDevices, settings.micDeviceId]);

	const busy =
		isBootstrapping ||
		isTranscribing ||
		isMicTranscribing ||
		isCheckingEula ||
		!hasAcceptedEula;

	function onUseRecordingForTranscription(item: RecordingHistoryItem): void {
		if (isRecording || isBootstrapping || isMicTranscribing || isTranscribing) {
			setStatus(
				"Please wait for the current recording/transcription task to finish.",
			);
			return;
		}

		setAudioPath(item.absolutePath);
		clearMicCapture();
		setActiveGeneralView("activity");
		setStatus(
			`Selected ${item.fileName} for transcription. Adjust settings and click Transcribe.`,
		);
	}

	useEffect(() => {
		if (isCompactMode) return;
		if (activeGeneralView !== "history") return;
		if (isCheckingEula || !hasAcceptedEula) return;

		void loadRecordingHistory();
	}, [
		activeGeneralView,
		hasAcceptedEula,
		isCheckingEula,
		isCompactMode,
		loadRecordingHistory,
	]);

	return (
		<main
			className={
				isCompactMode ? "loudio-shell loudio-shell-compact" : "loudio-shell"
			}>
			<SystemReadinessWizard open={!isCheckingEula && !hasAcceptedEula} />

			{isCompactMode ?
				<CompactShell
					compactAnchor={compactAnchor}
					onStartCompactDrag={onStartCompactDrag}
					onMoveCompactAnchor={onMoveCompactAnchor}
					onToggleCompactMode={onToggleCompactMode}
					busy={busy}
					isRecording={isRecording}
					isTranscribing={isTranscribing}
					audioPath={audioPath}
					transcriptDraft={transcriptDraft}
					livePreviewTranscript={livePreviewTranscript}
					onPickAudio={() => {
						void onPickAudio();
					}}
					onToggleMicRecording={() => {
						void onToggleMicRecording();
					}}
					onTranscribe={() => {
						void onTranscribe();
					}}
					onCopy={() => {
						void onCopy();
					}}
					onClearTranscript={clearTranscriptView}
					microphoneDevices={microphoneDevices}
					selectedMicrophoneDeviceId={(settings.micDeviceId ?? "").trim()}
					hasMicrophonePermission={hasMicrophonePermission}
					isEnumeratingMicrophones={isEnumeratingMicrophones}
					setSettings={setSettings}
					status={status}
					setTranscriptDraft={setTranscriptDraft}
					requestMicrophonePermission={() => {
						void requestMicrophonePermission();
					}}
				/>
			:	<>
					<GeneralTopStrip
						activeProfileTitle={activeProfile?.title ?? ""}
						isBootstrapping={isBootstrapping}
						activeView={activeGeneralView}
						onSelectView={setActiveGeneralView}
						onToggleCompactMode={onToggleCompactMode}
						onOpenAbout={onOpenAbout}
					/>

					<ReadinessDriftBanner driftIds={driftIds} onReview={onReviewDrift} />

					<section className="studio-layout">
						<SettingsPanel
							profiles={profiles}
							settings={settings}
							activeProfileModel={activeProfile?.model}
							modelOptions={MODEL_OPTIONS}
							languages={LANGUAGES}
							setSettings={setSettings}
							microphoneDevices={microphoneDevices}
							selectedMicrophoneDeviceId={(settings.micDeviceId ?? "").trim()}
							hasMicrophonePermission={hasMicrophonePermission}
							isEnumeratingMicrophones={isEnumeratingMicrophones}
							microphoneErrorMessage={microphoneErrorMessage}
							onRequestMicrophonePermission={requestMicrophonePermission}
							onRefreshMicrophoneDevices={refreshMicrophoneDevices}
						/>

						<section
							className={
								activeGeneralView === "history" ?
									"card studio-workspace studio-workspace-history"
								:	"card studio-workspace"
							}>
							{activeGeneralView === "activity" ?
								<WorkspaceActivityView
									isRecording={isRecording}
									busy={busy}
									isTranscribing={isTranscribing}
									audioPath={audioPath}
									transcriptDraft={transcriptDraft}
									livePreviewTranscript={livePreviewTranscript}
									selectedAudioLabel={selectedAudioLabel}
									micBlob={micBlob}
									selectedMicrophoneLabel={selectedMicrophoneLabel}
									isBootstrapping={isBootstrapping}
									runtimeBootstrapPercent={runtimeBootstrapPercent}
									runtimeBootstrapMessage={runtimeBootstrapMessage}
									status={status}
									transcriptWordCount={transcriptWordCount}
									transcriptCharacterCount={transcriptCharacterCount}
									result={result}
									setTranscriptDraft={setTranscriptDraft}
									onPickAudio={() => {
										void onPickAudio();
									}}
									onToggleMicRecording={() => {
										void onToggleMicRecording();
									}}
									onTranscribe={() => {
										void onTranscribe();
									}}
									onCopy={() => {
										void onCopy();
									}}
									onClearTranscript={clearTranscriptView}
								/>
							:	<RecordingHistoryView
									isLoadingRecordingHistory={isLoadingRecordingHistory}
									deletingRecordingPath={deletingRecordingPath}
									isDeletingSelectedRecordings={isDeletingSelectedRecordings}
									recordingHistory={recordingHistory}
									selectedRecordingPaths={selectedRecordingPaths}
									allHistorySelected={allHistorySelected}
									hasSelectedRecordings={hasSelectedRecordings}
									activePlaybackItem={activePlaybackItem}
									playbackReady={playbackReady}
									isPlaybackPlaying={isPlaybackPlaying}
									playbackRate={playbackRate}
									playbackCurrentSec={playbackCurrentSec}
									playbackDurationSec={playbackDurationSec}
									playingRecordingPath={playingRecordingPath}
									formatRecordingSize={formatRecordingSize}
									formatRecordingDate={formatRecordingDate}
									formatPlaybackTime={formatPlaybackTime}
									loadRecordingHistory={loadRecordingHistory}
									onToggleSelectAllRecordings={onToggleSelectAllRecordings}
									onDeleteSelectedRecordings={onDeleteSelectedRecordings}
									onDeleteAllRecordings={onDeleteAllRecordings}
									onStepPlayback={onStepPlayback}
									onToggleActivePlayback={onToggleActivePlayback}
									onSetPlaybackRate={onSetPlaybackRate}
									onSeekPlayback={onSeekPlayback}
									onPlayRecording={onPlayRecording}
									onUseRecordingForTranscription={
										onUseRecordingForTranscription
									}
									onDeleteRecording={onDeleteRecording}
									onToggleSelectRecording={onToggleSelectRecording}
									recordingsDiskUsageBytes={recordingsDiskUsageBytes}
									legacyDirs={legacyDirs}
									legacyDiskUsageBytes={legacyDiskUsageBytes}
									isMigratingLegacyRecordings={isMigratingLegacyRecordings}
									currentRecordingsOutputDir={currentRecordingsOutputDir}
									revealRecordingsOutputDir={revealRecordingsOutputDirInFinder}
									onMigrateLegacyRecordings={migrateLegacyRecordingDirs}
								/>
							}
						</section>
					</section>
				</>
			}
			<AboutPanel open={isAboutOpen} onClose={onCloseAbout} />
		</main>
	);
}
