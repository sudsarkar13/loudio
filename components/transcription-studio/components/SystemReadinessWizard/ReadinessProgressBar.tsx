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

/**
 * Maps a coarse `percent` (which only describes progress within the current
 * stage) to a fill value that reaches the active step dot. With 5 evenly
 * spaced dots, the centre of dot N is at `((N - 1) / 4) * 100` percent of the
 * rail. We use the active step index as the ceiling for the fill so the rail
 * visually lands on whichever dot is currently highlighted.
 */
function fillPercent(stage: string, percent: number): number {
	const idx = stageIndex(stage);
	const stageCeiling = (idx / (STAGES.length - 1)) * 100;
	const clamped = Math.max(0, Math.min(100, percent));
	if (clamped >= 100) return stageCeiling;
	// For an N-stage pipeline, distribute `clamped` across the span of dots
	// between 0 and the active step.
	const previousCeiling =
		idx === 0 ? 0 : ((idx - 1) / (STAGES.length - 1)) * 100;
	const span = Math.max(1, stageCeiling - previousCeiling);
	return Math.min(stageCeiling, previousCeiling + (clamped / 100) * span);
}

export function ReadinessProgressBar({
	stage,
	percent,
}: ReadinessProgressBarProps) {
	const current = stageIndex(stage);
	const clamped = fillPercent(stage, percent);

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
