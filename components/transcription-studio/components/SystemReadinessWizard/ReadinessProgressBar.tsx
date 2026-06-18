"use client";

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
	return (
		<ol
			className="readiness-stepper"
			aria-label="Readiness progress"
			role="list">
			{STAGES.map((entry, index) => {
				const state =
					index < current ? "done"
					: index === current ? "active"
					: "pending";
				return (
					<li
						key={entry.id}
						className={`readiness-step readiness-step-${state}`}
						aria-current={state === "active" ? "step" : undefined}>
						<span className="readiness-step-dot" />
						<span className="readiness-step-label">{entry.label}</span>
					</li>
				);
			})}
			<div
				className="readiness-stepper-bar"
				style={{
					["--readiness-stepper-progress" as string]: `${Math.max(0, Math.min(100, percent))}%`,
				}}
				aria-hidden="true"
			/>
		</ol>
	);
}
