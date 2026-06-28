"use client";

import { Image } from "@tauri-apps/api/image";
import { CheckMenuItem, Menu, Submenu } from "@tauri-apps/api/menu";

import { isTauriRuntime, minimizeDesktopAppWindow } from "@/lib/tauri";

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

export async function setupDesktopAppMenu(
	actions: DesktopMenuActions,
): Promise<void> {
	if (!isTauriRuntime()) return;

	let aboutIcon: InstanceType<typeof Image> | undefined;
	try {
		const iconResponse = await fetch("/loudio-logo.png");
		if (iconResponse.ok) {
			const iconBytes = new Uint8Array(await iconResponse.arrayBuffer());
			aboutIcon = await Image.fromBytes(iconBytes);
		}
	} catch {
		aboutIcon = undefined;
	}

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
						version: "0.1.0",
						shortVersion: "0.1.0",
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

	const menu = await Menu.new({
		items: [fileSubmenu, editSubmenu, viewSubmenu, windowSubmenu, helpSubmenu],
	});

	await menu.setAsAppMenu();
}
