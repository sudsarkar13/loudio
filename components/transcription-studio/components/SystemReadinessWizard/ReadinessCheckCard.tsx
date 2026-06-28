"use client";

import { useState } from "react";
import {
	AlertCircle,
	Check,
	CheckCircle2,
	ChevronDown,
	Copy,
	Download,
	Loader2,
	MinusCircle,
	Terminal,
	X,
	XCircle,
} from "lucide-react";

import type { ReadinessCheck, ReadinessProgressEvent } from "@/lib/tauri/types";

interface ReadinessCheckCardProps {
	check: ReadinessCheck;
	progress: ReadinessProgressEvent | undefined;
	isInstalling: boolean;
	onInstall: (id: string) => void;
	onSkip: (id: string) => void;
	index?: number;
}

const stateLabel: Record<ReadinessCheck["state"], string> = {
	missing: "Missing",
	installed: "Installed",
	outdated: "Outdated",
	failed: "Failed",
	skipped: "Skipped",
	unknown: "Unknown",
};

function stateClassName(state: ReadinessCheck["state"]): string {
	switch (state) {
		case "installed":
			return "pill pill-success";
		case "outdated":
			return "pill pill-warning";
		case "failed":
			return "pill pill-danger";
		case "skipped":
			return "pill pill-muted";
		case "missing":
		case "unknown":
		default:
			return "pill pill-soft";
	}
}

function actionLabel(kind: ReadinessCheck["actionKind"]): string {
	switch (kind) {
		case "install":
			return "Install";
		case "reinstall":
			return "Reinstall";
		case "update":
			return "Update";
		case "none":
		default:
			return "Done";
	}
}

function StatusIcon({
	check,
	isInstalling,
}: {
	check: ReadinessCheck;
	isInstalling: boolean;
}) {
	if (isInstalling) {
		return (
			<span className="readiness-card-icon readiness-card-icon-loading">
				<Loader2 size={20} />
			</span>
		);
	}
	switch (check.state) {
		case "installed":
			return (
				<span className="readiness-card-icon readiness-card-icon-success">
					<CheckCircle2 size={20} />
				</span>
			);
		case "failed":
			return (
				<span className="readiness-card-icon readiness-card-icon-failed">
					<XCircle size={20} />
				</span>
			);
		case "outdated":
			return (
				<span className="readiness-card-icon readiness-card-icon-warning">
					<AlertCircle size={20} />
				</span>
			);
		case "skipped":
			return (
				<span className="readiness-card-icon readiness-card-icon-muted">
					<MinusCircle size={20} />
				</span>
			);
		case "missing":
		case "unknown":
		default:
			return (
				<span className="readiness-card-icon readiness-card-icon-missing">
					<Download size={20} />
				</span>
			);
	}
}

export function ReadinessCheckCard({
	check,
	progress,
	isInstalling,
	onInstall,
	onSkip,
	index = 0,
}: ReadinessCheckCardProps) {
	const [showCommand, setShowCommand] = useState<boolean>(false);
	const [copied, setCopied] = useState<boolean>(false);

	const manualCommand =
		check.manualCommand ?? (isInstalling ? (progress?.message ?? "") : "");
	const showAction =
		!isInstalling &&
		(check.state === "missing" ||
			check.state === "outdated" ||
			check.state === "failed");

	const onCopyCommand = async (): Promise<void> => {
		if (!manualCommand) return;
		try {
			if (typeof navigator !== "undefined" && navigator.clipboard) {
				await navigator.clipboard.writeText(manualCommand);
			} else if (typeof document !== "undefined") {
				const textarea = document.createElement("textarea");
				textarea.value = manualCommand;
				document.body.appendChild(textarea);
				textarea.select();
				document.execCommand("copy");
				document.body.removeChild(textarea);
			}
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch (error) {
			console.error("Copy failed", error);
		}
	};

	return (
		<article
			className={`readiness-card readiness-card-${check.state}${isInstalling ? " readiness-card-installing" : ""}`}
			data-id={check.id}
			data-index={index}
			style={{ ["--readiness-card-index" as string]: String(index) }}
			aria-busy={isInstalling}>
			<aside className="readiness-card-aside">
				<StatusIcon check={check} isInstalling={isInstalling} />
			</aside>
			<div className="readiness-card-body">
				<header className="readiness-card-head">
					<div className="readiness-card-title">
						<h3>{check.name}</h3>
						<span className={stateClassName(check.state)}>
							{stateLabel[check.state]}
						</span>
						{check.severity !== "required" ?
							<span className="pill pill-muted">{check.severity}</span>
						:	null}
					</div>
					<div className="readiness-card-meta">
						<span className="readiness-required">
							Required: {check.required}
						</span>
						{check.current ?
							<span className="readiness-current">
								Current: {check.current}
							</span>
						:	null}
					</div>
				</header>

				<p className="readiness-card-desc">{check.description}</p>

				{check.detail ?
					<p className="readiness-card-detail">{check.detail}</p>
				:	null}

				{isInstalling || (progress && progress.percent > 0 && !progress.done) ?
					<div className="readiness-progress" aria-live="polite">
						<div className="readiness-progress-track">
							<div
								className="readiness-progress-bar"
								style={{ width: `${progress?.percent ?? 0}%` }}
							/>
							<span className="readiness-progress-shimmer" aria-hidden="true" />
						</div>
						<span className="readiness-progress-text">
							<span className="readiness-progress-percent">
								{progress?.percent ?? 0}%
							</span>
							<span className="readiness-progress-message">
								{progress?.message ?? "Working…"}
							</span>
						</span>
					</div>
				:	null}

				{progress?.error ?
					<p className="readiness-card-error">{progress.message}</p>
				:	null}

				<footer className="readiness-card-foot">
					<div className="readiness-card-actions">
						{showAction ?
							<button
								type="button"
								className="btn btn-primary readiness-action-primary"
								disabled={isInstalling}
								onClick={() => onInstall(check.id)}>
								<span className="readiness-action-shine" aria-hidden="true" />
								<span className="readiness-action-label">
									{actionLabel(check.actionKind)}
								</span>
							</button>
						:	null}

						{check.state === "missing" && check.severity !== "required" ?
							<button
								type="button"
								className="btn btn-ghost"
								disabled={isInstalling}
								onClick={() => onSkip(check.id)}>
								Skip
							</button>
						:	null}

						<button
							type="button"
							className={`btn btn-ghost readiness-cmd-toggle${showCommand ? " readiness-cmd-toggle-open" : ""}`}
							disabled={!manualCommand}
							onClick={() => setShowCommand((value) => !value)}
							aria-expanded={showCommand}>
							<Terminal size={14} />
							<span>Manual command</span>
							<ChevronDown size={14} className="readiness-chevron" />
						</button>
					</div>
				</footer>

				<div
					className={`readiness-cmd-collapse${showCommand && manualCommand ? " readiness-cmd-collapse-open" : ""}`}
					aria-hidden={!showCommand}>
					<div className="readiness-cmd-block">
						<pre className="readiness-cmd-pre">{manualCommand}</pre>
						<button
							type="button"
							className="btn btn-ghost readiness-cmd-copy"
							onClick={() => {
								void onCopyCommand();
							}}>
							{copied ?
								<>
									<Check size={14} /> Copied
								</>
							:	<>
									<Copy size={14} /> Copy
								</>
							}
						</button>
					</div>
				</div>

				{!check.platformSupported ?
					<div className="readiness-card-warning">
						<X size={14} />
						<span>
							Automatic install is not available on this platform. Use the
							manual command.
						</span>
					</div>
				:	null}
			</div>
		</article>
	);
}
