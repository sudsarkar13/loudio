"use client";

import {
	AlertTriangle,
	ArrowUpCircle,
	CheckCircle2,
	Download,
	Package,
	RefreshCw,
	RotateCw,
} from "lucide-react";

import type { UseAppUpdateResult } from "@/components/readiness/useAppUpdate";

/**
 * The indeterminate "working" mark.
 *
 * A lemniscate traced by a moving dash rather than a spinning ring: a spinner
 * reads as "blocked, wait", while a continuous circuit reads as "something is
 * running". Drawn as one SVG path so it costs no dependency and scales cleanly.
 */
function UpdatePulse({ active }: { active: boolean }) {
	return (
		<span
			className={active ? "upd-pulse upd-pulse-active" : "upd-pulse"}
			aria-hidden="true">
			<svg viewBox="0 0 100 52" width="58" height="30">
				<path
					className="upd-pulse-track"
					d="M50 26 C50 8, 76 8, 76 26 C76 44, 50 44, 50 26 C50 8, 24 8, 24 26 C24 44, 50 44, 50 26 Z"
					fill="none"
					strokeWidth="4"
				/>
				<path
					className="upd-pulse-run"
					d="M50 26 C50 8, 76 8, 76 26 C76 44, 50 44, 50 26 C50 8, 24 8, 24 26 C24 44, 50 44, 50 26 Z"
					fill="none"
					strokeWidth="4"
					strokeLinecap="round"
				/>
			</svg>
		</span>
	);
}

export function AppUpdateCard(update: UseAppUpdateResult) {
	const {
		stage,
		currentVersion,
		availableVersion,
		releaseNotes,
		downloadPercent,
		installInfo,
		canSelfUpdate,
		checkForUpdate,
		downloadAndInstall,
		restartNow,
	} = update;

	const isBusy = stage === "checking" || stage === "downloading";
	// A failed *check* is not a problem with the user's system — the release
	// server was unreachable, or no manifest is published yet. Painting that red
	// next to a green "your system is ready" ring reads as though something
	// broke. Only states the user can act on get an accent.
	const tone =
		stage === "available" || stage === "installed" ? "attention" : "neutral";

	function headline(): string {
		switch (stage) {
			case "checking":
				return "Checking for updates…";
			case "available":
				return `Loudio ${availableVersion} is available`;
			case "downloading":
				return `Downloading Loudio ${availableVersion}…`;
			case "installed":
				return "Update ready — restart to finish";
			case "up-to-date":
				return "Loudio is up to date";
			case "unsupported":
				return `Updates are managed by ${installInfo?.label ?? "your package manager"}`;
			case "error":
				return "Update check unavailable";
			case "idle":
			default:
				return "Application updates";
		}
	}

	function detail(): string {
		switch (stage) {
			case "checking":
				return "Asking the release server what the newest version is.";
			case "available":
				return "Download and install it here. Loudio restarts when it is done.";
			case "downloading":
				return "Leave this window open until the download finishes.";
			case "installed":
				return "The new version is staged and applies on the next launch.";
			case "up-to-date":
				return "You are running the newest release.";
			case "unsupported":
				return `${installInfo?.label ?? "This package"} installs Loudio updates for you, so there is nothing to do here.`;
			case "error":
				return (
					"Could not reach the release server. This does not affect " +
					"transcription — try again later."
				);
			case "idle":
			default:
				return "Check whether a newer release of Loudio is available.";
		}
	}

	return (
		<section className={`upd-card upd-card-${tone}`} aria-live="polite">
			<div className="upd-mark">
				{isBusy ?
					<UpdatePulse active />
				:	<span className={`upd-glyph upd-glyph-${tone}`}>
						{stage === "installed" ?
							<RotateCw size={20} />
						: stage === "available" ?
							<ArrowUpCircle size={20} />
						: stage === "up-to-date" ?
							<CheckCircle2 size={20} />
						: stage === "error" ?
							<AlertTriangle size={20} />
						:	<Package size={20} />}
					</span>
				}
			</div>

			<div className="upd-body">
				<div className="upd-head">
					<h3>{headline()}</h3>
					{currentVersion ?
						<span className="upd-version">v{currentVersion}</span>
					:	null}
				</div>
				<p className="upd-detail">{detail()}</p>

				{stage === "available" && releaseNotes ?
					<details className="upd-notes">
						<summary>What&apos;s new</summary>
						<pre>{releaseNotes}</pre>
					</details>
				:	null}

				{stage === "downloading" ?
					<div
						className="upd-progress"
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={downloadPercent >= 0 ? downloadPercent : undefined}
						aria-label="Update download">
						<div
							className={
								downloadPercent < 0 ?
									"upd-progress-fill upd-progress-fill-indeterminate"
								:	"upd-progress-fill"
							}
							style={
								downloadPercent >= 0 ?
									{ width: `${Math.max(downloadPercent, 2)}%` }
								:	undefined
							}
						/>
					</div>
				:	null}
			</div>

			<div className="upd-actions">
				{stage === "installed" ?
					<button
						type="button"
						className="btn btn-primary"
						onClick={() => {
							void restartNow();
						}}>
						Restart now
					</button>
				: stage === "available" ?
					<button
						type="button"
						className="btn btn-primary"
						onClick={() => {
							void downloadAndInstall();
						}}>
						<Download size={14} aria-hidden="true" />
						<span>Update</span>
					</button>
				: canSelfUpdate ?
					<button
						type="button"
						className="btn btn-ghost"
						onClick={() => {
							void checkForUpdate();
						}}
						disabled={isBusy}>
						<RefreshCw
							size={14}
							className={isBusy ? "rw-spin" : undefined}
							aria-hidden="true"
						/>
						<span>{isBusy ? "Checking…" : "Check now"}</span>
					</button>
				:	null}
			</div>
		</section>
	);
}
