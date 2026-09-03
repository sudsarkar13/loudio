import { useEffect, useRef, useState } from "react";
import {
	enterCompactWindowMode,
	exitCompactWindowMode,
	moveCompactWindowToAnchor,
	persistCompactWindowPosition,
	startCompactWindowDrag,
	type CompactWindowAnchor,
} from "@/lib/tauri";
import {
	COMPACT_ANCHOR_STORAGE_KEY,
	COMPACT_MODE_STORAGE_KEY,
} from "@/components/transcription-studio/constants";
import { logDiagnostic } from "@/lib/diagnostics";

export interface UseCompactWindowModeResult {
	isCompactMode: boolean;
	compactAnchor: CompactWindowAnchor;
	onToggleCompactMode: () => Promise<void>;
	onMoveCompactAnchor: (anchor: CompactWindowAnchor) => void;
	onStartCompactDrag: () => Promise<void>;
}

interface UseCompactWindowModeOptions {
	hasAcceptedEula: boolean;
	isCheckingEula: boolean;
	setStatus: (value: string) => void;
}

function readStoredCompactMode(): boolean {
	if (typeof window === "undefined") return false;
	return window.localStorage.getItem(COMPACT_MODE_STORAGE_KEY) === "true";
}

function readStoredCompactAnchor(): CompactWindowAnchor {
	if (typeof window === "undefined") return "bottom";
	const stored = window.localStorage.getItem(COMPACT_ANCHOR_STORAGE_KEY);
	return stored === "top" || stored === "bottom" ? stored : "bottom";
}

function persistCompactMode(isCompactMode: boolean): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(
		COMPACT_MODE_STORAGE_KEY,
		isCompactMode ? "true" : "false",
	);
}

function persistCompactAnchor(anchor: CompactWindowAnchor): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(COMPACT_ANCHOR_STORAGE_KEY, anchor);
}

export function useCompactWindowMode({
	hasAcceptedEula,
	isCheckingEula,
	setStatus,
}: UseCompactWindowModeOptions): UseCompactWindowModeResult {
	const [isCompactMode, setIsCompactMode] = useState<boolean>(false);
	const [compactAnchor, setCompactAnchor] =
		useState<CompactWindowAnchor>("bottom");

	/**
	 * Whether the stored preferences have been read yet.
	 *
	 * State starts at the non-compact defaults and the persist effects below fire
	 * on mount, so without this the first commit writes `false` over a stored
	 * `true` — losing compact mode for anyone whose app is closed in the window
	 * between mount and hydration.
	 */
	const hasHydratedRef = useRef<boolean>(false);

	useEffect(() => {
		setIsCompactMode(readStoredCompactMode());
		setCompactAnchor(readStoredCompactAnchor());
		hasHydratedRef.current = true;
	}, []);

	useEffect(() => {
		if (!hasHydratedRef.current) return;
		persistCompactMode(isCompactMode);
	}, [isCompactMode]);

	useEffect(() => {
		if (typeof document === "undefined") return;

		document.documentElement.classList.toggle(
			"loudio-compact-window",
			isCompactMode,
		);
		document.body.classList.toggle("loudio-compact-window", isCompactMode);

		return () => {
			document.documentElement.classList.remove("loudio-compact-window");
			document.body.classList.remove("loudio-compact-window");
		};
	}, [isCompactMode]);

	useEffect(() => {
		if (!hasHydratedRef.current) return;
		persistCompactAnchor(compactAnchor);
	}, [compactAnchor]);

	useEffect(() => {
		if (isCheckingEula || !hasAcceptedEula) return;

		// Stamped into the log so a microphone failure can be lined up against
		// the window transition that preceded it.
		logDiagnostic("info", "window", "Applying window mode", {
			mode: isCompactMode ? "compact" : "general",
		});

		if (isCompactMode) {
			void enterCompactWindowMode();
			return;
		}

		void exitCompactWindowMode();
	}, [hasAcceptedEula, isCheckingEula, isCompactMode]);

	async function onToggleCompactMode(): Promise<void> {
		const nextMode = !isCompactMode;

		try {
			if (nextMode) {
				await enterCompactWindowMode();
				await moveCompactWindowToAnchor(compactAnchor);
				setStatus("Compact mode enabled.");
			} else {
				await persistCompactWindowPosition();
				await exitCompactWindowMode();
				setStatus("General mode restored.");
			}

			setIsCompactMode(nextMode);
		} catch (error) {
			setStatus(`Failed to switch window mode: ${String(error)}`);
		}
	}

	async function onMoveCompactAnchor(
		anchor: CompactWindowAnchor,
	): Promise<void> {
		setCompactAnchor(anchor);

		if (!isCompactMode) return;

		try {
			await moveCompactWindowToAnchor(anchor);
			setStatus(
				anchor === "top" ?
					"Compact shell moved to top center."
				:	"Compact shell moved to bottom center.",
			);
		} catch (error) {
			setStatus(`Failed to move compact shell: ${String(error)}`);
		}
	}

	async function onStartCompactDrag(): Promise<void> {
		if (!isCompactMode) return;

		try {
			await startCompactWindowDrag();
			await persistCompactWindowPosition();
		} catch {
			// Dragging is best-effort; no UI interruption needed.
		}
	}

	return {
		isCompactMode,
		compactAnchor,
		onToggleCompactMode,
		onMoveCompactAnchor,
		onStartCompactDrag,
	};
}
