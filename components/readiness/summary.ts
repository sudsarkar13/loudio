import type { ReadinessCheck, ReadinessReport } from "@/lib/tauri/types";
import type { ReadinessTone } from "@/components/readiness/ReadinessStatusRing";

export interface ReadinessSummary {
	tone: ReadinessTone;
	/** 0–100, by satisfied *required* items. */
	percent: number;
	/** Centre of the ring, e.g. "4/5". */
	ringLabel: string;
	ringCaption: string;
	headline: string;
	subhead: string;
	/** Whether the user may proceed into the studio. */
	canContinue: boolean;
	satisfied: number;
	total: number;
	blocking: number;
}

/** Counted as done for the purposes of "can Loudio run". */
function isSatisfied(item: ReadinessCheck): boolean {
	return item.state === "installed" || item.state === "skipped";
}

/**
 * Only required items gate the app.
 *
 * A recommended package that is missing is worth showing, but it must not drag
 * the dial down or imply the app is unusable — that was a large part of why the
 * old screen read as alarming when nothing was actually wrong.
 */
export function summarize(
	report: ReadinessReport | null,
	isInstalling: boolean,
): ReadinessSummary {
	const required = (report?.items ?? []).filter(
		(item) => item.severity === "required",
	);
	const total = required.length;
	const satisfied = required.filter(isSatisfied).length;
	const blocking = required.filter(
		(item) =>
			item.state === "missing" ||
			item.state === "outdated" ||
			item.state === "failed",
	).length;

	// No report yet, or a platform with nothing to check.
	if (!report) {
		return {
			tone: "working",
			percent: 0,
			ringLabel: "—",
			ringCaption: "checking",
			headline: "Checking your system",
			subhead: "Looking for the components Loudio needs to run.",
			canContinue: false,
			satisfied: 0,
			total: 0,
			blocking: 0,
		};
	}

	if (total === 0) {
		return {
			tone: "ready",
			percent: 100,
			ringLabel: "✓",
			ringCaption: "ready",
			headline: "Nothing to install",
			subhead: "Loudio has everything it needs on this system.",
			canContinue: true,
			satisfied: 0,
			total: 0,
			blocking: 0,
		};
	}

	const percent = Math.round((satisfied / total) * 100);
	const ringLabel = `${satisfied}/${total}`;

	if (isInstalling) {
		return {
			tone: "working",
			percent,
			ringLabel,
			ringCaption: "installing",
			headline: "Setting up your system",
			subhead: "Installing the missing components. This can take a few minutes.",
			canContinue: false,
			satisfied,
			total,
			blocking,
		};
	}

	if (blocking === 0) {
		return {
			tone: "ready",
			percent: 100,
			ringLabel,
			ringCaption: "ready",
			headline: "Your system is ready",
			subhead: "Every required component is installed. You're good to go.",
			canContinue: true,
			satisfied,
			total,
			blocking,
		};
	}

	const failed = required.some((item) => item.state === "failed");
	return {
		tone: failed ? "blocked" : "attention",
		percent,
		ringLabel,
		ringCaption: "ready",
		headline:
			failed ? "Some components need attention" : (
				`${blocking} component${blocking === 1 ? "" : "s"} to install`
			),
		subhead:
			failed ?
				"An install did not finish. Retry it, or run the manual command below."
			:	"Loudio needs these before it can transcribe. Install them here, or run the manual commands.",
		canContinue: false,
		satisfied,
		total,
		blocking,
	};
}

/** Section order in the window: what blocks you first, then the rest. */
export const SEVERITY_ORDER: ReadinessCheck["severity"][] = [
	"required",
	"recommended",
	"optional",
];

export const SEVERITY_TITLES: Record<ReadinessCheck["severity"], string> = {
	required: "Required",
	recommended: "Recommended",
	optional: "Optional",
};

export const SEVERITY_BLURBS: Record<ReadinessCheck["severity"], string> = {
	required: "Loudio cannot transcribe without these.",
	recommended: "Not required, but they improve speed or accuracy.",
	optional: "Extras you can add whenever you like.",
};

/** Worst-first, so anything needing action sorts to the top of its section. */
const STATE_WEIGHT: Record<ReadinessCheck["state"], number> = {
	failed: 0,
	outdated: 1,
	missing: 2,
	unknown: 3,
	skipped: 4,
	installed: 5,
};

export function sortChecks(items: ReadinessCheck[]): ReadinessCheck[] {
	return [...items].sort(
		(a, b) => STATE_WEIGHT[a.state] - STATE_WEIGHT[b.state],
	);
}
