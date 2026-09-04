"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cpu, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";

import { useSystemReadinessWizard } from "@/components/transcription-studio/hooks/useSystemReadinessWizard";
import { ReadinessCheckCard } from "@/components/readiness/ReadinessCheckCard";
import { ReadinessStatusRing } from "@/components/readiness/ReadinessStatusRing";
import {
	SEVERITY_BLURBS,
	SEVERITY_ORDER,
	SEVERITY_TITLES,
	sortChecks,
	summarize,
} from "@/components/readiness/summary";
import {
	closeReadinessWindow,
	isTauriRuntime,
	notifyReadinessChanged,
} from "@/lib/tauri";
import type { ReadinessCheck } from "@/lib/tauri/types";

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
			return os || "Unknown system";
	}
}

/**
 * "Just now" / "4 minutes ago" — the absolute timestamp is noise here. What the
 * reader wants to know is whether the report in front of them is stale.
 */
function relativeTime(iso: string): string {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "";
	const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
	if (seconds < 45) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	const days = Math.round(hours / 24);
	return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function ReadinessWindow() {
	const {
		report,
		stage,
		progressById,
		installingId,
		isInitialCheckComplete,
		check,
		install,
		update,
		skip,
		resetSkips,
		enterApp,
	} = useSystemReadinessWizard();

	const isInstalling = installingId !== null || stage === "installing";
	const summary = useMemo(
		() => summarize(isInitialCheckComplete ? report : null, isInstalling),
		[isInitialCheckComplete, isInstalling, report],
	);

	// Re-renders the "checked N minutes ago" caption without a full re-check.
	const [, setClockTick] = useState<number>(0);
	useEffect(() => {
		const timer = window.setInterval(() => setClockTick((n) => n + 1), 30_000);
		return () => window.clearInterval(timer);
	}, []);

	// `isTauriRuntime()` is false during the static export and true once the
	// page is running inside the app, so reading it during render would make
	// the server and client markup disagree. Resolve it after mount instead.
	const [isDesktop, setIsDesktop] = useState<boolean>(true);
	useEffect(() => {
		setIsDesktop(isTauriRuntime());
	}, []);

	const anySkipped = useMemo(
		() => (report?.items ?? []).some((item) => item.state === "skipped"),
		[report],
	);

	const grouped = useMemo(() => {
		const items = report?.items ?? [];
		return SEVERITY_ORDER.map((severity) => ({
			severity,
			items: sortChecks(items.filter((item) => item.severity === severity)),
		})).filter((group) => group.items.length > 0);
	}, [report]);

	// Every mutation is announced, so the main window re-gates itself instead of
	// polling. Announcing after the action (not before) means listeners always
	// re-check against settled state.
	const announce = useCallback(async () => {
		try {
			await notifyReadinessChanged();
		} catch {
			// A missing listener must never fail the install that just succeeded.
		}
	}, []);

	const onInstall = useCallback(
		async (id: string) => {
			await install(id);
			await announce();
		},
		[announce, install],
	);

	const onUpdate = useCallback(
		async (id: string) => {
			await update(id);
			await announce();
		},
		[announce, update],
	);

	const onSkip = useCallback(
		async (id: string) => {
			await skip(id);
			await announce();
		},
		[announce, skip],
	);

	const onRecheck = useCallback(() => {
		void check(true);
	}, [check]);

	const onResetSkips = useCallback(() => {
		void resetSkips().then(announce);
	}, [announce, resetSkips]);

	const onContinue = useCallback(() => {
		// Order matters: record the acknowledgement, tell the main window, and
		// only then close. Closing first would race the announcement against
		// this webview being torn down.
		enterApp();
		void announce().then(() => closeReadinessWindow());
	}, [announce, enterApp]);

	const isDetecting = !isInitialCheckComplete;

	return (
		<div className="rw-root">
			<header className="rw-header">
				<div className="rw-header-title">
					<span className="rw-header-glyph" aria-hidden="true">
						<ShieldCheck size={18} />
					</span>
					<div>
						<h1>System Readiness</h1>
						<p className="rw-header-sub">
							<Cpu size={12} aria-hidden="true" />
							<span>
								{osLabel(report?.os ?? "")}
								{report?.arch ? ` · ${report.arch}` : ""}
							</span>
							{report?.generatedAt ?
								<>
									<span className="rw-dot" aria-hidden="true" />
									<span>Checked {relativeTime(report.generatedAt)}</span>
								</>
							:	null}
						</p>
					</div>
				</div>

				<button
					type="button"
					className="btn btn-ghost rw-recheck"
					onClick={onRecheck}
					disabled={isInstalling || isDetecting}>
					<RefreshCw
						size={14}
						className={isDetecting ? "rw-spin" : undefined}
						aria-hidden="true"
					/>
					<span>{isDetecting ? "Checking…" : "Re-check"}</span>
				</button>
			</header>

			<div className="rw-body">
				<section className={`rw-hero rw-hero-${summary.tone}`}>
					<ReadinessStatusRing
						percent={summary.percent}
						tone={summary.tone}
						label={summary.ringLabel}
						caption={summary.ringCaption}
					/>
					<div className="rw-hero-copy">
						<h2>{summary.headline}</h2>
						<p>{summary.subhead}</p>
					</div>
				</section>

				{isDetecting ?
					<div className="rw-skeleton-list" aria-hidden="true">
						{[0, 1, 2].map((index) => (
							<div className="rw-skeleton" key={index} />
						))}
					</div>
				:	grouped.map((group) => (
						<section className="rw-group" key={group.severity}>
							<div className="rw-group-head">
								<h3>{SEVERITY_TITLES[group.severity]}</h3>
								<span className="rw-group-count">{group.items.length}</span>
								<p>{SEVERITY_BLURBS[group.severity]}</p>
							</div>
							<div className="rw-group-items">
								{group.items.map((item: ReadinessCheck, index: number) => (
									<ReadinessCheckCard
										key={item.id}
										check={item}
										index={index}
										progress={progressById[item.id]}
										isInstalling={installingId === item.id}
										onInstall={(id) => {
											void onInstall(id);
										}}
										onUpdate={(id) => {
											void onUpdate(id);
										}}
										onSkip={(id) => {
											void onSkip(id);
										}}
									/>
								))}
							</div>
						</section>
					))
				}
			</div>

			<footer className="rw-footer">
				<div className="rw-footer-left">
					{anySkipped ?
						<button
							type="button"
							className="btn btn-ghost"
							onClick={onResetSkips}
							disabled={isInstalling}>
							<RotateCcw size={14} aria-hidden="true" />
							<span>Reset skipped</span>
						</button>
					:	null}
				</div>

				<div className="rw-footer-right">
					<span className="rw-footer-status">
						{summary.canContinue ?
							"All required components are installed."
						: summary.blocking > 0 ?
							`${summary.blocking} required item${summary.blocking === 1 ? "" : "s"} outstanding.`
						:	""}
					</span>
					<button
						type="button"
						// Continuing past outstanding requirements stays possible —
						// it always was — but it stops looking like the happy path.
						className={
							summary.canContinue ?
								"btn btn-primary rw-continue"
							:	"btn btn-ghost rw-continue"
						}
						onClick={onContinue}
						disabled={isInstalling || isDetecting}>
						{summary.canContinue ? "Continue to Loudio" : "Continue anyway"}
					</button>
				</div>
			</footer>

			{!isDesktop ?
				<p className="rw-web-note">
					Preview mode — system checks run only in the desktop app.
				</p>
			:	null}
		</div>
	);
}
