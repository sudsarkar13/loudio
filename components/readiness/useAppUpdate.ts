"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import { getInstallInfo, isTauriRuntime } from "@/lib/tauri";
import { describeError, logDiagnostic } from "@/lib/diagnostics";
import type { InstallInfo } from "@/lib/tauri/types";

export type UpdateStage =
	| "idle"
	| "checking"
	| "up-to-date"
	| "available"
	| "downloading"
	| "installed"
	| "unsupported"
	| "error";

export interface UseAppUpdateResult {
	stage: UpdateStage;
	/** Version currently running. */
	currentVersion: string;
	/** Version on offer, when one is. */
	availableVersion: string;
	/** Release notes for the available version, when the manifest carries them. */
	releaseNotes: string;
	/** 0–100 while downloading; -1 when the total size is unknown. */
	downloadPercent: number;
	errorMessage: string;
	installInfo: InstallInfo | null;
	/** True when this install may update itself at all. */
	canSelfUpdate: boolean;
	checkForUpdate: () => Promise<void>;
	downloadAndInstall: () => Promise<void>;
	restartNow: () => Promise<void>;
}

/**
 * The in-app update flow.
 *
 * Deliberately never auto-installs. Checking on open is fine — it is cheap and
 * the user opened a window whose job is to report on the system — but replacing
 * the running application is an action the user takes, not one that happens to
 * them while they are mid-transcription.
 */
export function useAppUpdate(): UseAppUpdateResult {
	const [stage, setStage] = useState<UpdateStage>("idle");
	const [currentVersion, setCurrentVersion] = useState<string>("");
	const [availableVersion, setAvailableVersion] = useState<string>("");
	const [releaseNotes, setReleaseNotes] = useState<string>("");
	const [downloadPercent, setDownloadPercent] = useState<number>(0);
	const [errorMessage, setErrorMessage] = useState<string>("");
	const [installInfo, setInstallInfo] = useState<InstallInfo | null>(null);

	// The pending Update handle. Held in a ref rather than state because it is
	// not renderable and must survive re-renders during the download.
	const updateRef = useRef<Update | null>(null);
	const mountedRef = useRef<boolean>(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	// A Snap or Flatpak lives on a read-only mount that its own process cannot
	// replace; those stores own the update. Reporting the version is still
	// useful, so only the *controls* are withheld.
	const canSelfUpdate =
		installInfo !== null && installInfo.flavor === "native" && isTauriRuntime();

	useEffect(() => {
		if (!isTauriRuntime()) return;
		void getVersion()
			.then((version) => {
				if (mountedRef.current) setCurrentVersion(version);
			})
			.catch(() => {
				// A missing version string is cosmetic; never block the window.
			});
		void getInstallInfo()
			.then((info) => {
				if (mountedRef.current) setInstallInfo(info);
			})
			.catch(() => {
				if (mountedRef.current) setInstallInfo(null);
			});
	}, []);

	const checkForUpdate = useCallback(async (): Promise<void> => {
		if (!isTauriRuntime()) {
			setStage("unsupported");
			return;
		}

		const info = installInfo ?? (await getInstallInfo().catch(() => null));
		if (info && info.flavor !== "native") {
			setInstallInfo(info);
			setStage("unsupported");
			return;
		}

		setStage("checking");
		setErrorMessage("");
		try {
			const update = await check();
			if (!mountedRef.current) return;

			if (!update) {
				updateRef.current = null;
				setStage("up-to-date");
				logDiagnostic("info", "update", "No update available");
				return;
			}

			updateRef.current = update;
			setAvailableVersion(update.version);
			setReleaseNotes(update.body ?? "");
			setStage("available");
			logDiagnostic("info", "update", "Update available", {
				version: update.version,
			});
		} catch (error) {
			if (!mountedRef.current) return;
			updateRef.current = null;
			setStage("error");
			setErrorMessage(
				error instanceof Error ? error.message : String(error),
			);
			logDiagnostic("warn", "update", "Update check failed", {
				...describeError(error),
			});
		}
	}, [installInfo]);

	const downloadAndInstall = useCallback(async (): Promise<void> => {
		const update = updateRef.current;
		if (!update) return;

		setStage("downloading");
		setDownloadPercent(0);
		setErrorMessage("");

		// The event stream reports chunk sizes, not a running total, so the
		// total is accumulated here. `contentLength` is absent on some servers;
		// -1 tells the UI to show an indeterminate bar rather than a wrong one.
		let downloaded = 0;
		let total = 0;

		try {
			await update.downloadAndInstall((event) => {
				if (!mountedRef.current) return;
				switch (event.event) {
					case "Started":
						total = event.data.contentLength ?? 0;
						setDownloadPercent(total > 0 ? 0 : -1);
						break;
					case "Progress":
						downloaded += event.data.chunkLength;
						if (total > 0) {
							setDownloadPercent(
								Math.min(100, Math.round((downloaded / total) * 100)),
							);
						}
						break;
					case "Finished":
						setDownloadPercent(100);
						break;
					default:
						break;
				}
			});

			if (!mountedRef.current) return;
			setStage("installed");
			logDiagnostic("info", "update", "Update installed", {
				version: update.version,
			});
		} catch (error) {
			if (!mountedRef.current) return;
			setStage("error");
			setErrorMessage(
				error instanceof Error ? error.message : String(error),
			);
			logDiagnostic("error", "update", "Update install failed", {
				...describeError(error),
			});
		}
	}, []);

	const restartNow = useCallback(async (): Promise<void> => {
		logDiagnostic("info", "update", "Relaunching after update");
		await relaunch();
	}, []);

	return {
		stage,
		currentVersion,
		availableVersion,
		releaseNotes,
		downloadPercent,
		errorMessage,
		installInfo,
		canSelfUpdate,
		checkForUpdate,
		downloadAndInstall,
		restartNow,
	};
}
