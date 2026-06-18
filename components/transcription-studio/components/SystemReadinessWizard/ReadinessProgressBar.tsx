"use client";

import { Check } from "lucide-react";

interface ReadinessProgressBarProps {
	stage: string;
	percent: number;
}

const STAGES: Array<{ id: string; label: string }> = [
	{ id: "detecting", label: "Detecting" },
	{ id: "review", label: "Review" },
	{ id: "installing", label: "Install" },
	{ id: "verifying", label: "Verify" },
	{ id: "ready", label: "Done" },
];

function stageIndex(stage: string): number {
	const idx = STAGES.findIndex((entry) => entry.id === stage);
	if (idx >= 0) return idx;
	if (stage === "skipped" || stage === "failed") return 1;
	return 0;
}

export function ReadinessProgressBar({
	stage,
	percent,
}: ReadinessProgressBarProps) {
	const current = stageIndex(stage);
	const clamped = Math.max(0, Math.min(100, percent));

	return (
		<div className="readiness-stepper-wrap" aria-label="Readiness progress">
			<ol
				className="readiness-stepper"
				role="list"
				style={{
					["--readiness-stepper-progress" as string]: `${clamped}%`,
					["--readiness-stepper-active" as string]: String(current),
				}}>
				<span className="readiness-stepper-rail" aria-hidden="true" />
				<span className="readiness-stepper-fill" aria-hidden="true" />
				<span className="readiness-stepper-shimmer" aria-hidden="true" />
				{STAGES.map((entry, index) => {
					const state =
						index < current ? "done"
						: index === current ? "active"
						: "pending";
					return (
						<li
							key={entry.id}
							className={`readiness-step readiness-step-${state}`}
							aria-current={state === "active" ? "step" : undefined}
							style={{
								["--readiness-step-index" as string]: String(index),
							}}>
							<span className="readiness-step-dot">
								{state === "done" ?
									<Check size={12} strokeWidth={3} />
								:	<span className="readiness-step-dot-inner" />}
							</span>
							<span className="readiness-step-label">{entry.label}</span>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
