import { ShieldAlert, ShieldCheck } from "lucide-react";

interface GeneralTopStripProps {
	activeProfileTitle: string;
	isBootstrapping: boolean;
	activeView: "activity" | "history";
	onSelectView: (view: "activity" | "history") => void;
	onToggleCompactMode: () => void;
	/** True when a required component is missing, outdated or failed. */
	hasReadinessIssues: boolean;
	onOpenReadiness: () => void;
}

export function GeneralTopStrip({
	activeProfileTitle,
	isBootstrapping,
	activeView,
	onSelectView,
	onToggleCompactMode,
	hasReadinessIssues,
	onOpenReadiness,
}: GeneralTopStripProps) {
	return (
		<section className="top-strip" aria-label="App status">
			<span className="pill pill-soft">
				{activeProfileTitle || "Runtime profile"}
			</span>
			<div className="top-strip-actions">
				{/* The status readout doubles as the way in. Readiness has no other
				    entry point now that it is a separate window, and a user who
				    wants to check on their system reaches for the thing already
				    telling them whether it is healthy. */}
				<button
					type="button"
					className={
						hasReadinessIssues ?
							"btn top-strip-readiness top-strip-readiness-alert"
						:	"btn top-strip-readiness"
					}
					onClick={onOpenReadiness}
					title="Open System Readiness">
					{hasReadinessIssues ?
						<ShieldAlert size={13} aria-hidden="true" />
					:	<ShieldCheck size={13} aria-hidden="true" />}
					<span>
						{isBootstrapping ? "Preparing"
						: hasReadinessIssues ? "Action needed"
						: "Ready"}
					</span>
				</button>
				<div
					className="general-view-switch"
					role="tablist"
					aria-label="General mode view switch">
					<button
						className={
							activeView === "activity" ?
								"btn compact-toggle-btn general-view-btn general-view-btn-active"
							:	"btn compact-toggle-btn general-view-btn"
						}
						role="tab"
						aria-selected={activeView === "activity"}
						onClick={() => onSelectView("activity")}>
						Activity
					</button>
					<button
						className={
							activeView === "history" ?
								"btn compact-toggle-btn general-view-btn general-view-btn-active"
							:	"btn compact-toggle-btn general-view-btn"
						}
						role="tab"
						aria-selected={activeView === "history"}
						onClick={() => onSelectView("history")}>
						History
					</button>
				</div>
				<button
					className="btn compact-toggle-btn"
					onClick={() => onToggleCompactMode()}>
					Compact Mode
				</button>
			</div>
		</section>
	);
}
