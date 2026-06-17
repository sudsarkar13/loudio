import { Move } from "lucide-react";
import type { CompactWindowAnchor } from "@/lib/tauri";

interface CompactTopbarProps {
	compactAnchor: CompactWindowAnchor;
	onStartCompactDrag: () => void;
	onMoveCompactAnchor: (anchor: CompactWindowAnchor) => void;
	onToggleCompactMode: () => void;
}

export function CompactTopbar({
	compactAnchor,
	onStartCompactDrag,
	onMoveCompactAnchor,
	onToggleCompactMode,
}: CompactTopbarProps) {
	return (
		<div className="compact-topbar">
			<div
				className="compact-drag-strip"
				onMouseDown={() => onStartCompactDrag()}
				title="Drag compact shell">
				<Move size={13} />
				<span>Compact</span>
			</div>

			<div className="compact-controls">
				<button
					className={
						compactAnchor === "top" ?
							"btn compact-btn compact-btn-active"
						:	"btn compact-btn"
					}
					onClick={() => onMoveCompactAnchor("top")}>
					Top
				</button>
				<button
					className={
						compactAnchor === "bottom" ?
							"btn compact-btn compact-btn-active"
						:	"btn compact-btn"
					}
					onClick={() => onMoveCompactAnchor("bottom")}>
					Bottom
				</button>
				<button
					className="btn compact-btn compact-btn-primary"
					onClick={() => onToggleCompactMode()}>
					General
				</button>
			</div>
		</div>
	);
}
