"use client";

import { useState } from "react";
import { AlertCircle, X } from "lucide-react";

interface ReadinessDriftBannerProps {
	driftIds: string[];
	onReview: () => void;
}

const DISMISS_KEY = "loudio:readiness:drift:dismissed:v1";

export function ReadinessDriftBanner({
	driftIds,
	onReview,
}: ReadinessDriftBannerProps) {
	const [dismissed, setDismissed] = useState<boolean>(() => {
		if (typeof window === "undefined") return false;
		return window.sessionStorage.getItem(DISMISS_KEY) === "true";
	});

	if (driftIds.length === 0 || dismissed) return null;

	const onDismiss = (): void => {
		setDismissed(true);
		if (typeof window !== "undefined") {
			window.sessionStorage.setItem(DISMISS_KEY, "true");
		}
	};

	const count = driftIds.length;

	return (
		<div className="readiness-drift-banner" role="status" aria-live="polite">
			<div className="readiness-drift-content">
				<AlertCircle size={16} />
				<span>
					{count === 1 ?
						"1 system update is available."
					:	`${count} system updates are available.`}
				</span>
			</div>
			<div className="readiness-drift-actions">
				<button
					type="button"
					className="btn btn-primary readiness-drift-btn"
					onClick={onReview}>
					Review
				</button>
				<button
					type="button"
					className="btn btn-ghost readiness-drift-dismiss"
					aria-label="Dismiss for this session"
					onClick={onDismiss}>
					<X size={14} />
				</button>
			</div>
		</div>
	);
}
