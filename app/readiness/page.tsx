import type { Metadata } from "next";

import { ReadinessWindow } from "@/components/readiness/ReadinessWindow";

export const metadata: Metadata = {
	title: "System Readiness | Loudio",
	description:
		"Check and install the components Loudio needs to transcribe on this system.",
};

/**
 * Route behind the System Readiness window.
 *
 * Its own route rather than a modal in the main window: installing system
 * packages can take minutes, and the studio should stay usable — and legible —
 * throughout. `next.config.mjs` sets `trailingSlash: true`, so this exports to
 * `out/readiness/index.html`, which is what `WebviewUrl::App("readiness/")`
 * resolves to in a packaged build.
 */
export default function ReadinessPage() {
	return <ReadinessWindow />;
}
