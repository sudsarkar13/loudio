"use client";

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

import { isTauriRuntime } from "@/lib/tauri/runtime";

export async function copyToClipboard(text: string): Promise<void> {
	if (!text.trim()) return;

	if (isTauriRuntime()) {
		await writeText(text);
		return;
	}

	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
	}
}

export async function exportTextFile(
	defaultName: string,
	content: string,
): Promise<boolean> {
	if (!content.trim()) return false;

	if (isTauriRuntime()) {
		const path = await save({
			defaultPath: defaultName,
			filters: [{ name: "Text", extensions: ["txt"] }],
		});

		if (!path) return false;
		await writeTextFile(path, content);
		return true;
	}

	const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = defaultName;
	anchor.click();
	URL.revokeObjectURL(url);
	return true;
}
