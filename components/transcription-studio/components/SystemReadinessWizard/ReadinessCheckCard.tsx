"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy, Terminal, X } from "lucide-react";

import type { ReadinessCheck, ReadinessProgressEvent } from "@/lib/tauri/types";

interface ReadinessCheckCardProps {
	check: ReadinessCheck;
	progress: ReadinessProgressEvent | undefined;
	isInstalling: boolean;
	onInstall: (id: string) => void;
	onSkip: (id: string) => void;
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

export function ReadinessCheckCard({
	check,
	progress,
	isInstalling,
	onInstall,
	onSkip,
}: ReadinessCheckCardProps) {
	const [showCommand, setShowCommand] = useState<boolean>(false);
	const [copied, setCopied] = useState<boolean>(false);

	const manualCommand = check.manualCommand ?? progress?.message ?? "";
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
			className={`readiness-card readiness-card-${check.state}`}
			data-id={check.id}
			aria-busy={isInstalling}>
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
					<span className="readiness-required">Required: {check.required}</span>
					{check.current ?
						<span className="readiness-current">Current: {check.current}</span>
					:	null}
				</div>
			</header>

			<p className="readiness-card-desc">{check.description}</p>

			{check.detail ?
				<p className="readiness-card-detail">{check.detail}</p>
			:	null}

			{isInstalling || (progress && progress.percent > 0 && !progress.done) ?
				<div className="readiness-progress" aria-live="polite">
					<div
						className="readiness-progress-bar"
						style={{ width: `${progress?.percent ?? 0}%` }}
					/>
					<span className="readiness-progress-text">
						{progress?.message ?? "Working…"}
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
							className="btn btn-primary"
							disabled={isInstalling}
							onClick={() => onInstall(check.id)}>
							{actionLabel(check.actionKind)}
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
						className="btn btn-ghost readiness-cmd-toggle"
						disabled={!manualCommand}
						onClick={() => setShowCommand((value) => !value)}>
						<Terminal size={14} />
						<span>Manual command</span>
						<ChevronDown
							size={14}
							style={{
								transform: showCommand ? "rotate(180deg)" : "none",
								transition: "transform 120ms ease",
							}}
						/>
					</button>
				</div>
			</footer>

			{showCommand && manualCommand ?
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
			:	null}

			{!check.platformSupported ?
				<div className="readiness-card-warning">
					<X size={14} />
					<span>
						Automatic install is not available on this platform. Use the manual
						command.
					</span>
				</div>
			:	null}
		</article>
	);
}
