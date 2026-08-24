"use client";

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { suggestCorrections } from "@/lib/tauri";
import type { AppSettings, CorrectionCandidate } from "@/lib/types";

interface LearnTermPromptProps {
	/** What the engine produced, before any editing. */
	engineTranscript: string;
	/** What the transcript says now. */
	transcriptDraft: string;
	settings: AppSettings;
	setSettings: Dispatch<SetStateAction<AppSettings>>;
}

/**
 * Offers to remember a correction the user just made.
 *
 * Nothing is learned automatically. A blind diff would absorb rephrasings and
 * typos as vocabulary, so the backend only proposes short, term-shaped changes
 * and the user still has to accept one.
 */
export function LearnTermPrompt({
	engineTranscript,
	transcriptDraft,
	settings,
	setSettings,
}: LearnTermPromptProps) {
	const [candidate, setCandidate] = useState<CorrectionCandidate | null>(null);
	const [dismissed, setDismissed] = useState<string>("");

	useEffect(() => {
		let cancelled = false;

		if (!engineTranscript.trim() || engineTranscript === transcriptDraft) {
			setCandidate(null);
			return;
		}

		// Debounced: this runs while the user is still typing.
		const timer = setTimeout(() => {
			void suggestCorrections(engineTranscript, transcriptDraft)
				.then((found) => {
					if (cancelled) return;
					setCandidate(found[0] ?? null);
				})
				.catch(() => {
					if (!cancelled) setCandidate(null);
				});
		}, 700);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [engineTranscript, transcriptDraft]);

	if (!candidate) return null;

	const key = `${candidate.heard}=>${candidate.intended}`;
	if (dismissed === key) return null;

	const alreadyKnown = (settings.learnedTerms ?? []).some(
		(term) =>
			term.heard.toLowerCase() === candidate.heard.toLowerCase() &&
			term.intended === candidate.intended,
	);
	if (alreadyKnown) return null;

	function remember() {
		setSettings((prev) => {
			const existing = prev.learnedTerms ?? [];
			const match = existing.findIndex(
				(term) =>
					term.heard.toLowerCase() === candidate!.heard.toLowerCase(),
			);

			// Re-confirming an existing term raises its rank rather than
			// duplicating it — rank decides what survives the prompt budget.
			if (match >= 0) {
				const next = [...existing];
				next[match] = {
					...next[match],
					intended: candidate!.intended,
					hits: next[match].hits + 1,
				};
				return { ...prev, learnedTerms: next };
			}

			return {
				...prev,
				learnedTerms: [
					...existing,
					{ heard: candidate!.heard, intended: candidate!.intended, hits: 1 },
				],
			};
		});
		setCandidate(null);
	}

	return (
		<div className="learn-term" role="status">
			<span className="learn-term-text">
				Remember <code>{candidate.heard}</code> &rarr;{" "}
				<code>{candidate.intended}</code>?
			</span>
			<button type="button" className="btn btn-primary" onClick={remember}>
				Remember it
			</button>
			<button
				type="button"
				className="btn btn-ghost"
				onClick={() => setDismissed(key)}>
				Not now
			</button>
		</div>
	);
}
