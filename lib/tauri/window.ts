"use client";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";

import { invokeCommand, isTauriRuntime } from "@/lib/tauri/runtime";
import type {
	CompactWindowAnchor,
	StoredWindowPosition,
} from "@/lib/tauri/types";

const COMPACT_WINDOW_WIDTH = 360;
const COMPACT_WINDOW_HEIGHT = 200;
const GENERAL_WINDOW_WIDTH = 1000;
const GENERAL_WINDOW_HEIGHT = 550;
const COMPACT_WINDOW_MARGIN_BOTTOM = 18;
// v2: v1 stored *physical* pixels but restored them as *logical* ones, so on
// any HiDPI display every save/restore round trip multiplied the coordinates by
// the scale factor and eventually parked the window off-screen. The key is
// versioned so a v1 value is dropped rather than re-applied at the wrong scale.
const COMPACT_WINDOW_POSITION_KEY = "loudio:compact:window-position:v2";
const LEGACY_COMPACT_WINDOW_POSITION_KEY = "loudio:compact:window-position";

function getDefaultCompactWindowPosition(
	width: number,
	height: number,
): StoredWindowPosition | null {
	if (typeof window === "undefined") return null;

	const x = Math.max(0, Math.round((window.screen.availWidth - width) / 2));
	const y = Math.max(
		0,
		Math.round(
			window.screen.availHeight - height - COMPACT_WINDOW_MARGIN_BOTTOM,
		),
	);

	return { x, y };
}

function getDefaultGeneralWindowPosition(): StoredWindowPosition | null {
	if (typeof window === "undefined") return null;

	const x = Math.max(
		0,
		Math.round((window.screen.availWidth - GENERAL_WINDOW_WIDTH) / 2),
	);
	const y = Math.max(
		0,
		Math.round((window.screen.availHeight - GENERAL_WINDOW_HEIGHT) / 2),
	);

	return { x, y };
}

function getAnchoredCompactWindowPosition(
	anchor: CompactWindowAnchor,
): StoredWindowPosition | null {
	if (typeof window === "undefined") return null;

	const x = Math.max(
		0,
		Math.round((window.screen.availWidth - COMPACT_WINDOW_WIDTH) / 2),
	);
	const y =
		anchor === "top" ?
			COMPACT_WINDOW_MARGIN_BOTTOM
		:	Math.max(
				0,
				Math.round(
					window.screen.availHeight -
						COMPACT_WINDOW_HEIGHT -
						COMPACT_WINDOW_MARGIN_BOTTOM,
				),
			);

	return { x, y };
}

/**
 * Keeps a position far enough inside the screen that the window can always be
 * grabbed again.
 *
 * A stored position can be stale for reasons that have nothing to do with this
 * app — an external monitor that is no longer attached, a resolution change, a
 * display rearranged in System Settings. Without this, any of those strands the
 * compact window somewhere unreachable and the only way back is the menu bar.
 */
function clampToVisibleScreen(
	position: StoredWindowPosition,
	width: number,
	height: number,
): StoredWindowPosition {
	if (typeof window === "undefined") return position;

	// Leave a sliver of the window on screen rather than requiring all of it, so
	// a position that is only slightly off is nudged instead of recentred.
	const maxX = Math.max(0, window.screen.availWidth - width);
	const maxY = Math.max(0, window.screen.availHeight - height);

	return {
		x: Math.min(Math.max(0, Math.round(position.x)), maxX),
		y: Math.min(Math.max(0, Math.round(position.y)), maxY),
	};
}

function readStoredCompactWindowPosition(): StoredWindowPosition | null {
	if (typeof window === "undefined") return null;

	// A v1 value is in physical pixels with no way to recover the scale factor
	// it was written at, so drop it and fall back to the anchored default.
	window.localStorage.removeItem(LEGACY_COMPACT_WINDOW_POSITION_KEY);

	const raw = window.localStorage.getItem(COMPACT_WINDOW_POSITION_KEY);
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as StoredWindowPosition;
		if (
			Number.isFinite(parsed.x) &&
			Number.isFinite(parsed.y)
		) {
			return clampToVisibleScreen(
				parsed,
				COMPACT_WINDOW_WIDTH,
				COMPACT_WINDOW_HEIGHT,
			);
		}
	} catch {
		return null;
	}

	return null;
}

function writeStoredCompactWindowPosition(
	position: StoredWindowPosition,
): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(
		COMPACT_WINDOW_POSITION_KEY,
		JSON.stringify(position),
	);
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function isMacOS(): boolean {
	if (typeof navigator === "undefined") return false;
	return /mac/i.test(navigator.userAgent);
}

export function isLinuxDesktop(): boolean {
	if (typeof navigator === "undefined") return false;
	return isTauriRuntime() && /linux/i.test(navigator.userAgent);
}

/**
 * Shows or hides the in-window menu bar.
 *
 * Linux and Windows draw the menu inside the window; macOS keeps it app-wide in
 * the system bar, where hiding it would strip the menu with nothing to replace
 * it. So this is a no-op off Linux.
 */
export async function setDesktopMenuBarVisible(
	visible: boolean,
): Promise<void> {
	if (!isLinuxDesktop()) return;

	try {
		await invokeCommand<void>("set_window_menu_visible", { visible });
	} catch {
		// Menu visibility is cosmetic; never block the UI on it.
	}
}

async function setWindowBackgroundColor(
	appWindow: any,
	color: [number, number, number, number],
): Promise<void> {
	const maybeWindow = appWindow as {
		setBackgroundColor?: (
			color: [number, number, number, number],
		) => Promise<void>;
	};

	try {
		if (maybeWindow.setBackgroundColor) {
			await maybeWindow.setBackgroundColor(color);
		}
	} catch {
		// Best effort only.
	}
}

export async function enterCompactWindowMode(): Promise<void> {
	if (!isTauriRuntime()) return;

	const appWindow = getCurrentWindow();

	await setWindowBackgroundColor(appWindow, [17, 25, 38, 255]);
	await appWindow.setDecorations(false);
	await appWindow.setResizable(false);
	await appWindow.setMinimizable(true);
	await appWindow.setAlwaysOnTop(true);
	await appWindow.setSize(
		new LogicalSize(COMPACT_WINDOW_WIDTH, COMPACT_WINDOW_HEIGHT),
	);

	const position =
		readStoredCompactWindowPosition() ??
		getDefaultCompactWindowPosition(
			COMPACT_WINDOW_WIDTH,
			COMPACT_WINDOW_HEIGHT,
		);

	if (position) {
		await appWindow.setPosition(new LogicalPosition(position.x, position.y));
	}
}

async function restoreGeneralWindowFrame(appWindow: any): Promise<void> {
	const maybeWindow = appWindow as {
		isFullscreen?: () => Promise<boolean>;
		setFullscreen?: (value: boolean) => Promise<void>;
		isMaximized?: () => Promise<boolean>;
		unmaximize?: () => Promise<void>;
		show?: () => Promise<void>;
		setFocus?: () => Promise<void>;
	};

	try {
		if (
			maybeWindow.isFullscreen &&
			maybeWindow.setFullscreen &&
			(await maybeWindow.isFullscreen())
		) {
			await maybeWindow.setFullscreen(false);
		}
	} catch {
		// Best effort only.
	}

	try {
		if (
			maybeWindow.isMaximized &&
			maybeWindow.unmaximize &&
			(await maybeWindow.isMaximized())
		) {
			await maybeWindow.unmaximize();
		}
	} catch {
		// Best effort only.
	}

	await appWindow.setAlwaysOnTop(false);
	await appWindow.setResizable(true);
	await appWindow.setMinimizable(true);
	await setWindowBackgroundColor(appWindow, [11, 17, 27, 255]);

	if (isMacOS()) {
		await appWindow.setDecorations(false);
		await wait(28);
	}

	await appWindow.setDecorations(true);

	if (isMacOS()) {
		await wait(40);
		await appWindow.setDecorations(true);
	}

	try {
		if (maybeWindow.show) {
			await maybeWindow.show();
		}
		if (maybeWindow.setFocus) {
			await maybeWindow.setFocus();
		}
	} catch {
		// Best effort only.
	}
}

export async function exitCompactWindowMode(): Promise<void> {
	if (!isTauriRuntime()) return;

	const appWindow = getCurrentWindow();
	const centeredGeneralPosition = getDefaultGeneralWindowPosition();

	await restoreGeneralWindowFrame(appWindow);
	await appWindow.setSize(
		new LogicalSize(GENERAL_WINDOW_WIDTH, GENERAL_WINDOW_HEIGHT),
	);

	if (centeredGeneralPosition) {
		await appWindow.setPosition(
			new LogicalPosition(centeredGeneralPosition.x, centeredGeneralPosition.y),
		);
	}
}

/**
 * Records where the compact window currently sits, in logical pixels.
 *
 * `outerPosition()` reports *physical* pixels while `setPosition` is given a
 * `LogicalPosition`, so the scale factor has to be divided out here. Storing the
 * raw physical value instead made every save/restore round trip multiply the
 * coordinates — on a 2x display a window near the bottom of the screen came back
 * at twice the offset, i.e. off-screen entirely, which looked like the window
 * vanishing on reload.
 */
export async function persistCompactWindowPosition(): Promise<void> {
	if (!isTauriRuntime()) return;

	const appWindow = getCurrentWindow();
	const physical = await appWindow.outerPosition();
	const logical = physical.toLogical(await appWindow.scaleFactor());

	writeStoredCompactWindowPosition(
		clampToVisibleScreen(
			{ x: logical.x, y: logical.y },
			COMPACT_WINDOW_WIDTH,
			COMPACT_WINDOW_HEIGHT,
		),
	);
}

export async function moveCompactWindowToAnchor(
	anchor: CompactWindowAnchor,
): Promise<void> {
	if (!isTauriRuntime()) return;

	const appWindow = getCurrentWindow();
	const position = getAnchoredCompactWindowPosition(anchor);

	if (!position) return;

	await appWindow.setPosition(new LogicalPosition(position.x, position.y));
	writeStoredCompactWindowPosition(position);
}

export async function startCompactWindowDrag(): Promise<void> {
	if (!isTauriRuntime()) return;

	// `startDragging` resolves as soon as the drag *begins*, so reading the
	// position straight after it returns records where the window was before the
	// user moved it. The window's own move event is what tells us the drag
	// actually went somewhere; persisting on that also covers a drag ended by
	// releasing the pointer outside the window, where no mouseup reaches us.
	const appWindow = getCurrentWindow();
	let unlisten: (() => void) | null = null;
	let persistTimer: ReturnType<typeof setTimeout> | null = null;

	const settle = (): void => {
		if (persistTimer) clearTimeout(persistTimer);
		// Debounced: a drag emits a move event per frame, and only the resting
		// place is worth storing.
		persistTimer = setTimeout(() => {
			unlisten?.();
			unlisten = null;
			void persistCompactWindowPosition();
		}, 220);
	};

	try {
		unlisten = await appWindow.onMoved(settle);
		await appWindow.startDragging();
		settle();
	} catch {
		unlisten?.();
		unlisten = null;
		// Dragging is best-effort; never interrupt the UI for it.
	}
}

export async function minimizeDesktopAppWindow(): Promise<void> {
	if (!isTauriRuntime()) return;
	await getCurrentWindow().minimize();
}

export async function closeDesktopApp(): Promise<void> {
	if (!isTauriRuntime()) return;
	await getCurrentWindow().close();
}
