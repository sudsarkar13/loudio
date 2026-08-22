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
const COMPACT_WINDOW_POSITION_KEY = "loudio:compact:window-position";

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

function readStoredCompactWindowPosition(): StoredWindowPosition | null {
	if (typeof window === "undefined") return null;

	const raw = window.localStorage.getItem(COMPACT_WINDOW_POSITION_KEY);
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as StoredWindowPosition;
		if (typeof parsed.x === "number" && typeof parsed.y === "number") {
			return parsed;
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

export async function persistCompactWindowPosition(): Promise<void> {
	if (!isTauriRuntime()) return;

	const position = await getCurrentWindow().outerPosition();

	writeStoredCompactWindowPosition({ x: position.x, y: position.y });
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
	await getCurrentWindow().startDragging();
}

export async function minimizeDesktopAppWindow(): Promise<void> {
	if (!isTauriRuntime()) return;
	await getCurrentWindow().minimize();
}

export async function closeDesktopApp(): Promise<void> {
	if (!isTauriRuntime()) return;
	await getCurrentWindow().close();
}
