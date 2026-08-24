"use client";

import { defaultWindowIcon } from "@tauri-apps/api/app";
import { Image } from "@tauri-apps/api/image";
import { CheckMenuItem, Menu, Submenu } from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";

import {
	isLinuxDesktop,
	isTauriRuntime,
	minimizeDesktopAppWindow,
	setDesktopMenuBarVisible,
} from "@/lib/tauri";

const TRAY_ICON_ID = "loudio-main-tray";

let trayIconPromise: Promise<TrayIcon | null> | null = null;
let menuSetupQueue: Promise<void> = Promise.resolve();

export interface DesktopMenuActions {
	openAudioFile: () => Promise<void>;
	transcribeFile: () => Promise<void>;
	toggleMicRecording: () => Promise<void>;
	toggleCompactMode: () => Promise<void>;
	copyTranscript: () => Promise<void>;
	clearTranscript: () => void;
	toggleAutoCopy: () => void;
	bootstrapRuntime: () => Promise<void>;
	isAutoCopyEnabled: boolean;
	isCompactModeEnabled: boolean;
}

type MenuIcon = InstanceType<typeof Image> | undefined;

async function loadIcon(path: string): Promise<MenuIcon> {
	try {
		const iconResponse = await fetch(path);
		if (iconResponse.ok) {
			const iconBytes = new Uint8Array(await iconResponse.arrayBuffer());
			return await Image.fromBytes(iconBytes);
		}
	} catch {
		// Fall through to the packaged window icon below.
	}

	try {
		return (await defaultWindowIcon()) ?? undefined;
	} catch {
		return undefined;
	}
}

/** Full-resolution mark, sized for the About dialog. */
function loadBrandIcon(): Promise<MenuIcon> {
	return loadIcon("/loudio-logo.png");
}

/**
 * Panel-sized mark for the tray.
 *
 * The full logo is 283KB of 512px artwork for a slot the panel renders at
 * roughly 22px, and tray-icon writes a copy of it into the runtime dir on every
 * launch. 64px keeps that under 8KB.
 */
function loadTrayIcon(): Promise<MenuIcon> {
	return loadIcon("/loudio-tray.png");
}

/**
 * Builds a fresh set of submenus.
 *
 * Menu items are native resources owned by whichever menu they are attached to,
 * so the window menu bar and the tray each need their own instances rather than
 * a shared one.
 */
async function buildMenu(
	actions: DesktopMenuActions,
	aboutIcon: MenuIcon,
): Promise<Menu> {
	const autoCopyMenuItem = await CheckMenuItem.new({
		id: "view_toggle_auto_copy",
		text: "Auto Copy to Clipboard",
		checked: actions.isAutoCopyEnabled,
		action: () => {
			actions.toggleAutoCopy();
		},
	});

	const compactModeMenuItem = await CheckMenuItem.new({
		id: "window_toggle_compact_mode",
		text: "Compact Mode",
		checked: actions.isCompactModeEnabled,
		action: () => {
			void actions.toggleCompactMode();
		},
	});

	const fileSubmenu = await Submenu.new({
		id: "file",
		text: "File",
		items: [
			{
				id: "file_open_audio",
				text: "Choose Audio…",
				accelerator: "CmdOrCtrl+O",
				action: () => {
					void actions.openAudioFile();
				},
			},
			{
				id: "file_transcribe",
				text: "Transcribe File",
				accelerator: "CmdOrCtrl+Enter",
				action: () => {
					void actions.transcribeFile();
				},
			},
			{
				id: "file_record_mic",
				text: "Record / Stop Microphone",
				accelerator: "CmdOrCtrl+Shift+M",
				action: () => {
					void actions.toggleMicRecording();
				},
			},
			{
				item: "Separator",
			},
			{
				item: "Quit",
			},
		],
	});

	const editSubmenu = await Submenu.new({
		id: "edit",
		text: "Edit",
		items: [
			{ item: "Undo" },
			{ item: "Redo" },
			{ item: "Separator" },
			{ item: "Cut" },
			{ item: "Copy" },
			{ item: "Paste" },
			{ item: "SelectAll" },
			{ item: "Separator" },
			{
				id: "edit_copy_transcript",
				text: "Copy Transcript",
				accelerator: "CmdOrCtrl+Shift+C",
				action: () => {
					void actions.copyTranscript();
				},
			},
			{
				id: "edit_clear_transcript",
				text: "Clear Transcript",
				accelerator: "CmdOrCtrl+K",
				action: () => {
					actions.clearTranscript();
				},
			},
		],
	});

	const viewSubmenu = await Submenu.new({
		id: "view",
		text: "View",
		items: [
			autoCopyMenuItem,
			{ item: "Separator" },
			{
				id: "view_reload",
				text: "Reload",
				accelerator: "CmdOrCtrl+R",
				action: () => {
					window.location.reload();
				},
			},
		],
	});

	const windowSubmenu = await Submenu.new({
		id: "window",
		text: "Window",
		items: [
			{
				id: "window_minimize",
				text: "Minimize",
				accelerator: "CmdOrCtrl+M",
				action: () => {
					void minimizeDesktopAppWindow();
				},
			},
			{ item: "Maximize" },
			{ item: "Fullscreen" },
			{ item: "Separator" },
			compactModeMenuItem,
			{ item: "Separator" },
			{ item: "CloseWindow" },
		],
	});

	const helpSubmenu = await Submenu.new({
		id: "help",
		text: "Help",
		items: [
			{
				text: "About Loudio",
				item: {
					About: {
						name: "Loudio",
						version: "1.0.3",
						shortVersion: "1.0.3",
						copyright: "© Sudeepta Sarkar",
						credits: "Developed by Sudeepta Sarkar",
						icon: aboutIcon,
					},
				},
			},
			{ item: "Separator" },
			{
				id: "help_bootstrap_runtime",
				text: "Run Runtime Bootstrap",
				action: () => {
					void actions.bootstrapRuntime();
				},
			},
		],
	});

	return Menu.new({
		items: [fileSubmenu, editSubmenu, viewSubmenu, windowSubmenu, helpSubmenu],
	});
}

/**
 * Mirrors the menu into the Linux system tray.
 *
 * GNOME has no global menu bar, so an AppIndicator in the top panel is the
 * closest equivalent to the macOS menu bar — and the only one that stays
 * reachable once compact mode hides the in-window menu. It renders only where
 * an AppIndicator host is present (Ubuntu ships one by default), which is why
 * the in-window menu bar remains the fallback in general mode.
 */
async function resolveTrayIcon(
	menu: Menu,
	trayIcon: MenuIcon,
): Promise<TrayIcon | null> {
	// A webview reload resets this module but leaves the native tray alive, so
	// always adopt an existing one before creating a second.
	const existingTray = await TrayIcon.getById(TRAY_ICON_ID);
	if (existingTray) return existingTray;

	return TrayIcon.new({
		id: TRAY_ICON_ID,
		icon: trayIcon,
		tooltip: "Loudio",
		menu,
		showMenuOnLeftClick: true,
	});
}

async function syncLinuxTrayMenu(
	menu: Menu,
	trayIcon: MenuIcon,
): Promise<void> {
	if (!isLinuxDesktop()) return;

	try {
		// Cache the promise, not the resolved icon: overlapping callers must all
		// await the same creation. Racing them spawns duplicate trays, and each
		// one dropped takes the shared icon PNG with it, leaving a blank panel
		// entry pointing at a deleted file.
		if (!trayIconPromise) {
			trayIconPromise = resolveTrayIcon(menu, trayIcon);
		}

		const tray = await trayIconPromise;
		if (tray) await tray.setMenu(menu);
	} catch {
		// No AppIndicator host available; the in-window menu bar still works.
		trayIconPromise = null;
	}
}

async function applyDesktopAppMenu(actions: DesktopMenuActions): Promise<void> {
	const brandIcon = await loadBrandIcon();

	const appMenu = await buildMenu(actions, brandIcon);
	await appMenu.setAsAppMenu();

	const trayMenu = await buildMenu(actions, brandIcon);
	await syncLinuxTrayMenu(trayMenu, await loadTrayIcon());

	// Compact mode is 200px tall; the menu bar costs ~14% of that for entries
	// the compact toolbar already covers. The tray keeps them reachable.
	// Runs after setAsAppMenu, which re-shows the bar on every rebuild.
	await setDesktopMenuBarVisible(!actions.isCompactModeEnabled);
}

export async function setupDesktopAppMenu(
	actions: DesktopMenuActions,
): Promise<void> {
	if (!isTauriRuntime()) return;

	// React re-runs this effect on every settings change; serialising keeps
	// concurrent rebuilds from interleaving their native menu mutations.
	const pending = menuSetupQueue.then(
		() => applyDesktopAppMenu(actions),
		() => applyDesktopAppMenu(actions),
	);
	menuSetupQueue = pending.catch(() => {});

	return pending;
}
