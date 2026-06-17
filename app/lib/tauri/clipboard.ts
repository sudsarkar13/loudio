"use client";

import { isTauriRuntime } from "@/app/lib/tauri/runtime";

export async function copyToClipboard(text: string): Promise<void> {
	if (!text.trim()) return;

	if (isTauriRuntime()) {
		const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
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
		const { save } = await import("@tauri-apps/plugin-dialog");
		const { writeTextFile } = await import("@tauri-apps/plugin-fs");

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
