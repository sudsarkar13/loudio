"use client";

import { defaultWindowIcon } from "@tauri-apps/api/app";
import { Image } from "@tauri-apps/api/image";
import { CheckMenuItem, Menu, Submenu } from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";

import {
	closeDesktopApp,
	isLinuxDesktop,
	isTauriRuntime,
	minimizeDesktopAppWindow,
	setDesktopMenuBarVisible,
} from "@/lib/tauri";
import { revealDiagnosticsLogs } from "@/lib/diagnostics";

const TRAY_ICON_ID = "loudio-main-tray";

let trayIconPromise: Promise<TrayIcon | null> | null = null;
let menuSetupQueue: Promise<void> = Promise.resolve();

/**
 * The actions the currently installed menu dispatches through.
 *
 * Menu item handlers are attached to native items once and never rebuilt, so
 * they must not capture an `actions` object directly — React hands us a new one
 * whenever a callback identity changes. Reading through this binding keeps the
 * installed menu wired to the latest callbacks without touching native state.
 */
let currentActions: DesktopMenuActions | null = null;

/** A menu plus the two items whose checked state tracks app state. */
interface BuiltMenu {
	menu: Menu;
	autoCopyItem: CheckMenuItem;
	compactModeItem: CheckMenuItem;
}

let installedMenus: { app: BuiltMenu; tray: BuiltMenu } | null = null;

/**
 * Last menu bar visibility we asked the window for, so we only pay for the IPC
 * when it actually changes. `null` means we have not applied one yet — the case
 * after a webview reload, where module state resets but the native bar does not.
 */
let appliedMenuBarVisible: boolean | null = null;

/** Checked states currently shown by the installed items, to skip no-op IPC. */
let appliedAutoCopy: boolean | null = null;
let appliedCompactMode: boolean | null = null;

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
async function buildMenu(aboutIcon: MenuIcon): Promise<BuiltMenu> {
	const autoCopyMenuItem = await CheckMenuItem.new({
		id: "view_toggle_auto_copy",
		text: "Auto Copy to Clipboard",
		checked: currentActions?.isAutoCopyEnabled ?? false,
		action: () => {
			currentActions?.toggleAutoCopy();
		},
	});

	const compactModeMenuItem = await CheckMenuItem.new({
		id: "window_toggle_compact_mode",
		text: "Compact Mode",
		checked: currentActions?.isCompactModeEnabled ?? false,
		action: () => {
			void currentActions?.toggleCompactMode();
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
					void currentActions?.openAudioFile();
				},
			},
			{
				id: "file_transcribe",
				text: "Transcribe File",
				accelerator: "CmdOrCtrl+Enter",
				action: () => {
					void currentActions?.transcribeFile();
				},
			},
			{
				id: "file_record_mic",
				text: "Record / Stop Microphone",
				accelerator: "CmdOrCtrl+Shift+M",
				action: () => {
					void currentActions?.toggleMicRecording();
				},
			},
			{
				item: "Separator",
			},
			// The predefined Quit item takes no accelerator — the type only
			// accepts `text` and `item` — and muda gives it none on Linux, so
			// Ctrl+Q did nothing there while Cmd+Q worked on macOS, where the
			// system supplies it. A custom item is the only way to bind it.
			isLinuxDesktop()
				? {
						id: "file_quit",
						text: "Quit",
						accelerator: "CmdOrCtrl+Q",
						action: () => {
							void closeDesktopApp();
						},
					}
				: { item: "Quit" as const },
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
					void currentActions?.copyTranscript();
				},
			},
			{
				id: "edit_clear_transcript",
				text: "Clear Transcript",
				accelerator: "CmdOrCtrl+K",
				action: () => {
					currentActions?.clearTranscript();
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
						version: "1.0.4",
						shortVersion: "1.0.4",
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
					void currentActions?.bootstrapRuntime();
				},
			},
			{
				id: "help_open_logs",
				text: "Open Diagnostic Logs…",
				action: () => {
					void revealDiagnosticsLogs();
				},
			},
		],
	});

	const menu = await Menu.new({
		items: [fileSubmenu, editSubmenu, viewSubmenu, windowSubmenu, helpSubmenu],
	});

	return {
		menu,
		autoCopyItem: autoCopyMenuItem,
		compactModeItem: compactModeMenuItem,
	};
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
	// Point the already-installed handlers at the newest callbacks first, so an
	// early return below still leaves the menu wired to current state.
	currentActions = actions;

	if (!installedMenus) {
		const brandIcon = await loadBrandIcon();

		const app = await buildMenu(brandIcon);
		await app.menu.setAsAppMenu();

		// Menu items are native resources owned by whichever menu they are
		// attached to, so the tray needs its own instances rather than a shared
		// set.
		const tray = await buildMenu(brandIcon);
		await syncLinuxTrayMenu(tray.menu, await loadTrayIcon());

		installedMenus = { app, tray };
	} else {
		// Updating the two check marks in place is what keeps compact mode from
		// flickering. `setAsAppMenu` re-shows the GTK menu bar on Linux, so
		// rebuilding on every state change made the bar flash into view and
		// straight back out — most visibly when starting or stopping a
		// recording, which changes the toggle callback's identity and so
		// re-ran this effect. Nothing here touches the window's menu bar.
		const updates: Promise<void>[] = [];
		for (const built of [installedMenus.app, installedMenus.tray]) {
			if (appliedAutoCopy !== actions.isAutoCopyEnabled) {
				updates.push(built.autoCopyItem.setChecked(actions.isAutoCopyEnabled));
			}
			if (appliedCompactMode !== actions.isCompactModeEnabled) {
				updates.push(
					built.compactModeItem.setChecked(actions.isCompactModeEnabled),
				);
			}
		}
		await Promise.all(updates);
	}

	appliedAutoCopy = actions.isAutoCopyEnabled;
	appliedCompactMode = actions.isCompactModeEnabled;

	// Compact mode is 200px tall; the menu bar costs ~14% of that for entries
	// the compact toolbar already covers. The tray keeps them reachable.
	const menuBarVisible = !actions.isCompactModeEnabled;
	if (appliedMenuBarVisible !== menuBarVisible) {
		await setDesktopMenuBarVisible(menuBarVisible);
		appliedMenuBarVisible = menuBarVisible;
	}
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
