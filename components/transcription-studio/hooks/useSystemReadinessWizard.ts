"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	checkSystemReadiness,
	installReadinessItem,
	updateReadinessItem,
	isTauriRuntime,
	listenReadinessProgress,
	resetReadinessSkips,
	skipReadinessItem,
} from "@/lib/tauri";
import type {
	ReadinessCheck,
	ReadinessProgressEvent,
	ReadinessReport,
} from "@/lib/tauri/types";

export type WizardStage =
	| "idle"
	| "detecting"
	| "review"
	| "installing"
	| "verifying"
	| "ready"
	| "skipped"
	| "failed";

export interface UseSystemReadinessWizardResult {
	report: ReadinessReport | null;
	stage: WizardStage;
	overallPercent: number;
	progressById: Record<string, ReadinessProgressEvent>;
	installingId: string | null;
	driftIds: string[];
	hasBlockingItems: boolean;
	needsWizard: boolean;
	isInitialCheckComplete: boolean;
	check: (forceFull?: boolean) => Promise<ReadinessReport | null>;
	install: (id: string) => Promise<ReadinessCheck | null>;
	update: (id: string) => Promise<ReadinessCheck | null>;
	skip: (id: string) => Promise<void>;
	resetSkips: () => Promise<void>;
	enterApp: () => void;
	/**
	 * Re-reads the acknowledgement flag from storage.
	 *
	 * Readiness now runs in its own window, and the flag it writes is shared
	 * storage rather than shared React state. Without this the main window
	 * would keep its stale `hasAcknowledged` from mount, decide readiness is
	 * still outstanding, and re-open the window the user just dismissed.
	 */
	refreshAcknowledgement: () => void;
}

const READINESS_COMPLETED_KEY = "loudio:readiness:completed:v1";

function readCompletedFlag(): boolean {
	if (typeof window === "undefined") return false;
	return window.localStorage.getItem(READINESS_COMPLETED_KEY) === "true";
}

function writeCompletedFlag(value: boolean): void {
	if (typeof window === "undefined") return;
	if (value) {
		window.localStorage.setItem(READINESS_COMPLETED_KEY, "true");
	} else {
		window.localStorage.removeItem(READINESS_COMPLETED_KEY);
	}
}

function requiredItemsPass(report: ReadinessReport | null): boolean {
	if (!report) return false;
	return report.items
		.filter((item) => item.severity === "required")
		.every((item) => item.state === "installed" || item.state === "skipped");
}

export function useSystemReadinessWizard(): UseSystemReadinessWizardResult {
	const [report, setReport] = useState<ReadinessReport | null>(null);
	const [stage, setStage] = useState<WizardStage>("idle");
	const [overallPercent, setOverallPercent] = useState<number>(0);
	const [progressById, setProgressById] = useState<
		Record<string, ReadinessProgressEvent>
	>({});
	const [installingId, setInstallingId] = useState<string | null>(null);
	const [isInitialCheckComplete, setIsInitialCheckComplete] =
		useState<boolean>(false);
	const unlistenRef = useRef<(() => void) | null>(null);
	const mountedRef = useRef<boolean>(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			unlistenRef.current?.();
			unlistenRef.current = null;
		};
	}, []);

	const handleProgress = useCallback((event: ReadinessProgressEvent) => {
		if (!mountedRef.current) return;
		setProgressById((prev) => ({
			...prev,
			[event.id]: event,
		}));
		if (event.id) {
			setOverallPercent((prev) => {
				if (event.done) return event.percent;
				return Math.max(prev, event.percent);
			});
		}
	}, []);

	const wireListener = useCallback(async () => {
		if (unlistenRef.current) return;
		unlistenRef.current = await listenReadinessProgress(handleProgress);
	}, [handleProgress]);

	const check = useCallback(
		async (forceFull = false): Promise<ReadinessReport | null> => {
			// In a web preview there is no native runtime to bootstrap, so the
			// readiness wizard must never gate the UI. Skip the Tauri command
			// and leave the hook in an "already ready" state so `needsWizard`
			// stays false.
			if (!isTauriRuntime()) {
				const webPreviewReport: ReadinessReport = {
					generatedAt: new Date().toISOString(),
					os: "web",
					arch: "unknown",
					items: [],
					drift: [],
				};
				setReport(webPreviewReport);
				setIsInitialCheckComplete(true);
				setOverallPercent(100);
				setStage("ready");
				return webPreviewReport;
			}

			setStage((current) => (current === "installing" ? current : "detecting"));
			setOverallPercent(0);
			await wireListener();
			try {
				const next = await checkSystemReadiness(forceFull);
				if (!mountedRef.current) return next;
				setReport(next);
				setIsInitialCheckComplete(true);
				setOverallPercent(100);

				const passes = requiredItemsPass(next);
				if (passes) {
					// Read from storage, never from captured state: the readiness
					// window may have written this flag moments ago, in a
					// different webview.
					setStage(readCompletedFlag() ? "ready" : "review");
				} else if (next.items.some((i) => i.state === "skipped")) {
					setStage("skipped");
				} else {
					setStage("review");
				}
				return next;
			} catch (error) {
				if (!mountedRef.current) return null;
				setStage("failed");
				setReport(
					(prev) =>
						prev ?? {
							generatedAt: new Date().toISOString(),
							os: "unknown",
							arch: "unknown",
							items: [],
							drift: [],
						},
				);
				console.error("checkSystemReadiness failed", error);
				return null;
			}
		},
		[wireListener],
	);

	useEffect(() => {
		void check(false);
	}, [check]);

	const runReadinessAction = useCallback(
		async (
			id: string,
			invoke: (id: string) => Promise<ReadinessCheck>,
			doneMessage: string,
		): Promise<ReadinessCheck | null> => {
			await wireListener();
			setInstallingId(id);
			setStage("installing");
			setProgressById((prev) => ({
				...prev,
				[id]: {
					id,
					percent: 5,
					message: "Starting…",
					done: false,
					error: false,
				},
			}));
			setOverallPercent(5);
			try {
				const result = await invoke(id);
				if (!mountedRef.current) return result;
				setReport((prev) => {
					if (!prev) return prev;
					return {
						...prev,
						items: prev.items.map((item) => (item.id === id ? result : item)),
					};
				});
				setProgressById((prev) => ({
					...prev,
					[id]: {
						id,
						percent: 100,
						message: doneMessage,
						done: true,
						error: false,
					},
				}));
				setOverallPercent(100);

				const refreshed = await checkSystemReadiness(true);
				if (!mountedRef.current) return result;
				setReport(refreshed);
				const passes = requiredItemsPass(refreshed);
				if (passes) {
					// Read from storage, never from captured state: the readiness
					// window may have written this flag moments ago, in a
					// different webview.
					setStage(readCompletedFlag() ? "ready" : "review");
				} else {
					setStage("review");
				}
				return result;
			} catch (error) {
				if (!mountedRef.current) return null;
				setProgressById((prev) => ({
					...prev,
					[id]: {
						id,
						percent: 100,
						message: error instanceof Error ? error.message : String(error),
						done: true,
						error: true,
					},
				}));
				setStage("failed");
				return null;
			} finally {
				if (mountedRef.current) setInstallingId(null);
			}
		},
		[wireListener],
	);

	const install = useCallback(
		(id: string): Promise<ReadinessCheck | null> =>
			runReadinessAction(id, installReadinessItem, "Installed."),
		[runReadinessAction],
	);

	// Only ever called from the Update button's confirmation, never from a scan.
	const update = useCallback(
		(id: string): Promise<ReadinessCheck | null> =>
			runReadinessAction(id, updateReadinessItem, "Updated."),
		[runReadinessAction],
	);

	const skip = useCallback(
		async (id: string): Promise<void> => {
			await skipReadinessItem(id);
			if (!mountedRef.current) return;
			setReport((prev) => {
				if (!prev) return prev;
				return {
					...prev,
					items: prev.items.map((item) =>
						item.id === id ?
							{
								...item,
								state: "skipped",
								actionKind: "none",
							}
						:	item,
					),
				};
			});
			const passes = requiredItemsPass(
				report ?
					{
						...report,
						items: report.items.map((item) =>
							item.id === id ?
								{ ...item, state: "skipped", actionKind: "none" }
							:	item,
						),
					}
				:	null,
			);
			if (passes) {
				setStage("ready");
			} else {
				setStage("skipped");
			}
		},
		[report],
	);

	const resetSkips = useCallback(async (): Promise<void> => {
		await resetReadinessSkips();
		if (!mountedRef.current) return;
		await check(true);
	}, [check]);

	const enterApp = useCallback(() => {
		writeCompletedFlag(true);
		setStage("ready");
	}, []);

	const refreshAcknowledgement = useCallback(() => {
		if (!readCompletedFlag()) return;
		setStage((current) => (current === "review" ? "ready" : current));
	}, []);

	const driftIds = useMemo(() => report?.drift ?? [], [report]);

	const hasBlockingItems = useMemo(() => {
		if (!report) return false;
		return report.items.some(
			(item) =>
				item.severity === "required" &&
				(item.state === "missing" ||
					item.state === "outdated" ||
					item.state === "failed"),
		);
	}, [report]);

	const needsWizard = useMemo(() => {
		if (!isInitialCheckComplete || !report) return false;
		if (stage === "ready") return false;
		return hasBlockingItems || stage === "review" || stage === "skipped";
	}, [hasBlockingItems, isInitialCheckComplete, report, stage]);

	return {
		report,
		stage,
		overallPercent,
		progressById,
		installingId,
		driftIds,
		hasBlockingItems,
		needsWizard,
		isInitialCheckComplete,
		check,
		install,
		update,
		skip,
		resetSkips,
		enterApp,
		refreshAcknowledgement,
	};
}
