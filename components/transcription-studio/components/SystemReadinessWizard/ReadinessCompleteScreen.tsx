"use client";

import { CheckCircle2, RefreshCcw } from "lucide-react";

interface ReadinessCompleteScreenProps {
	osLabel: string;
	archLabel: string;
	generatedAt: string;
	onEnter: () => void;
	onRecheck: () => void;
}

function formatRelative(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "just now";
	return date.toLocaleString();
}

export function ReadinessCompleteScreen({
	osLabel,
	archLabel,
	generatedAt,
	onEnter,
	onRecheck,
}: ReadinessCompleteScreenProps) {
	return (
		<section
			className="card readiness-complete"
			role="status"
			aria-live="polite">
			<div className="readiness-complete-icon">
				<CheckCircle2 size={48} />
			</div>
			<h2>Your system is ready</h2>
			<p className="helper">
				Detected {osLabel} · {archLabel}. Last checked{" "}
				{formatRelative(generatedAt)}.
			</p>
			<div className="readiness-complete-actions">
				<button type="button" className="btn btn-primary" onClick={onEnter}>
					Enter Loudio
				</button>
				<button type="button" className="btn btn-ghost" onClick={onRecheck}>
					<RefreshCcw size={14} /> Re-check
				</button>
			</div>
		</section>
	);
}
