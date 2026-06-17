interface GeneralTopStripProps {
	activeProfileTitle: string;
	isBootstrapping: boolean;
	activeView: "activity" | "history";
	onSelectView: (view: "activity" | "history") => void;
	onToggleCompactMode: () => void;
}

export function GeneralTopStrip({
	activeProfileTitle,
	isBootstrapping,
	activeView,
	onSelectView,
	onToggleCompactMode,
}: GeneralTopStripProps) {
	return (
		<section className="top-strip" aria-label="App status">
			<span className="pill pill-soft">
				{activeProfileTitle || "Runtime profile"}
			</span>
			<div className="top-strip-actions">
				<span className="top-strip-state">
					{isBootstrapping ? "Preparing" : "Ready"}
				</span>
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
