"use client";

export type ReadinessTone = "ready" | "attention" | "blocked" | "working";

interface ReadinessStatusRingProps {
	/** 0–100. */
	percent: number;
	tone: ReadinessTone;
	/** Large value in the middle of the ring, e.g. "4/5". */
	label: string;
	/** Small caption under the label. */
	caption: string;
}

const SIZE = 104;
const STROKE = 9;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Overall readiness as a single glanceable dial.
 *
 * A ring rather than a bar: this is a state to be read at a glance on arrival,
 * not a duration to be endured, and the per-item bars below already carry the
 * "how far along" story.
 *
 * Drawn as inline SVG so it needs no chart dependency and inherits the theme
 * through currentColor.
 */
export function ReadinessStatusRing({
	percent,
	tone,
	label,
	caption,
}: ReadinessStatusRingProps) {
	const safePercent = Math.max(0, Math.min(100, percent));
	const dash = (safePercent / 100) * CIRCUMFERENCE;

	return (
		<div
			className={`readiness-ring readiness-ring-${tone}`}
			role="img"
			aria-label={`${label} — ${caption}`}>
			<svg
				width={SIZE}
				height={SIZE}
				viewBox={`0 0 ${SIZE} ${SIZE}`}
				aria-hidden="true">
				{/* Rotated so the arc starts at 12 o'clock rather than 3. */}
				<g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
					<circle
						className="readiness-ring-track"
						cx={SIZE / 2}
						cy={SIZE / 2}
						r={RADIUS}
						fill="none"
						strokeWidth={STROKE}
					/>
					<circle
						className="readiness-ring-value"
						cx={SIZE / 2}
						cy={SIZE / 2}
						r={RADIUS}
						fill="none"
						strokeWidth={STROKE}
						strokeLinecap="round"
						strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
					/>
				</g>
			</svg>
			<div className="readiness-ring-inner">
				<span className="readiness-ring-label">{label}</span>
				<span className="readiness-ring-caption">{caption}</span>
			</div>
		</div>
	);
}
