"use client";

import { useCallback, useEffect, useMemo } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

import { useSystemReadinessWizard } from "@/components/transcription-studio/hooks/useSystemReadinessWizard";
import type { ReadinessCheck, ReadinessReport } from "@/lib/tauri/types";
import { ReadinessCheckCard } from "./ReadinessCheckCard";
import { ReadinessCompleteScreen } from "./ReadinessCompleteScreen";
import { ReadinessProgressBar } from "./ReadinessProgressBar";

function osLabel(os: string): string {
	switch (os) {
		case "macos":
			return "macOS";
		case "linux":
			return "Linux";
		case "windows":
			return "Windows";
		case "web":
			return "Web preview";
		default:
			return os || "this system";
	}
}

export function SystemReadinessWizard() {
	const {
		report,
		stage,
		overallPercent,
		progressById,
		installingId,
		driftIds,
		hasBlockingItems,
		needsWizard,
		isInitialCheckComplete,
		check,
		install,
		skip,
		resetSkips,
		enterApp,
	} = useSystemReadinessWizard();

	const onInstall = useCallback(
		async (id: string) => {
			await install(id);
		},
		[install],
	);

	const onSkip = useCallback(
		async (id: string) => {
			await skip(id);
		},
		[skip],
	);

	const onRecheck = useCallback(() => {
		void check(true);
	}, [check]);

	const onEnter = useCallback(() => {
		enterApp();
	}, [enterApp]);

	const onResetSkips = useCallback(() => {
		void resetSkips();
	}, [resetSkips]);

	const stageLabel = useMemo(() => {
		switch (stage) {
			case "idle":
			case "detecting":
				return "Detecting your system…";
			case "review":
				return "Review prerequisites";
			case "installing":
				return "Installing missing dependencies…";
			case "verifying":
				return "Verifying installation…";
			case "ready":
				return "All systems ready";
			case "skipped":
				return "Some prerequisites were skipped";
			case "failed":
				return "Some steps need attention";
			default:
				return "System readiness";
		}
	}, [stage]);

	const itemsToShow: ReadinessCheck[] = useMemo(() => {
		if (!report) return [];
		return [...report.items].sort((a, b) => {
			const order: Record<string, number> = {
				failed: 0,
				outdated: 1,
				missing: 2,
				skipped: 3,
				installed: 4,
				unknown: 5,
			};
			const aRank = order[a.state] ?? 99;
			const bRank = order[b.state] ?? 99;
			if (aRank !== bRank) return aRank - bRank;
			const aReq = a.severity === "required" ? 0 : 1;
			const bReq = b.severity === "required" ? 0 : 1;
			if (aReq !== bReq) return aReq - bReq;
			return a.name.localeCompare(b.name);
		});
	}, [report]);

	useEffect(() => {
		// no-op: reserved for future telemetry
	}, [driftIds]);

	if (!isInitialCheckComplete || !report) {
		return (
			<section
				className="card readiness-wizard"
				role="dialog"
				aria-modal="true"
				aria-labelledby="readiness-title">
				<header className="readiness-header">
					<div>
						<h2 id="readiness-title">Preparing Loudio</h2>
						<p className="helper">
							We're checking your system for the tools Loudio needs to
							transcribe locally.
						</p>
					</div>
				</header>
				<ReadinessProgressBar
					stage={stage === "idle" ? "detecting" : stage}
					percent={overallPercent}
				/>
			</section>
		);
	}

	const isReady = stage === "ready";

	return (
		<section
			className="card readiness-wizard"
			role="dialog"
			aria-modal={needsWizard ? "true" : undefined}
			aria-labelledby="readiness-title">
			<header className="readiness-header">
				<div>
					<div className="readiness-header-row">
						<ShieldCheck size={18} />
						<h2 id="readiness-title">System readiness</h2>
					</div>
					<p className="helper">{stageLabel}</p>
				</div>
				<button type="button" className="btn btn-ghost" onClick={onRecheck}>
					Re-check
				</button>
			</header>

			<ReadinessProgressBar stage={stage} percent={overallPercent} />

			{stage === "failed" && hasBlockingItems ?
				<div className="readiness-banner readiness-banner-warning">
					<AlertTriangle size={16} />
					<span>
						One or more required steps need your attention. Use the manual
						command in each card if automatic install is not available on your
						system.
					</span>
				</div>
			:	null}

			{stage === "skipped" ?
				<div className="readiness-banner readiness-banner-muted">
					<span>
						You skipped some optional prerequisites. Loudio will continue to
						work with the engines that are installed.
					</span>
					<button
						type="button"
						className="btn btn-ghost"
						onClick={onResetSkips}>
						Reset skipped
					</button>
				</div>
			:	null}

			{isReady ?
				<ReadinessCompleteScreen
					osLabel={osLabel(report.os)}
					archLabel={report.arch}
					generatedAt={report.generatedAt}
					onEnter={onEnter}
					onRecheck={onRecheck}
				/>
			:	<div className="readiness-card-list">
					{itemsToShow.map((check) => (
						<ReadinessCheckCard
							key={check.id}
							check={check}
							progress={progressById[check.id]}
							isInstalling={installingId === check.id}
							onInstall={(id) => {
								void onInstall(id);
							}}
							onSkip={(id) => {
								void onSkip(id);
							}}
						/>
					))}
				</div>
			}

			{!isReady && hasBlockingItems === false ?
				<footer className="readiness-footer">
					<button type="button" className="btn btn-primary" onClick={onEnter}>
						Enter Loudio
					</button>
				</footer>
			:	null}
		</section>
	);
}
