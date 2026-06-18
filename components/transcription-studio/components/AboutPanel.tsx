"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { readFullLicense } from "@/lib/tauri";

interface AboutPanelProps {
	open: boolean;
	onClose: () => void;
}

export function AboutPanel({ open, onClose }: AboutPanelProps) {
	const [licenseText, setLicenseText] = useState<string>("");
	const [loading, setLoading] = useState<boolean>(false);

	useEffect(() => {
		if (!open) return;
		setLoading(true);
		void readFullLicense()
			.then((text) => setLicenseText(text))
			.catch((error) => {
				console.error("Failed to load license", error);
				setLicenseText(
					"License text could not be loaded. See LICENSE bundled with the app.",
				);
			})
			.finally(() => setLoading(false));
	}, [open]);

	if (!open) return null;

	return (
		<div
			className="about-panel-overlay"
			role="dialog"
			aria-modal="true"
			aria-labelledby="about-title">
			<div className="card about-panel">
				<header className="about-panel-head">
					<div>
						<h2 id="about-title">About Loudio</h2>
						<p className="helper">
							Offline transcription studio for macOS, Linux, and Windows.
						</p>
					</div>
					<button
						type="button"
						className="btn btn-ghost about-panel-close"
						aria-label="Close"
						onClick={onClose}>
						<X size={16} />
					</button>
				</header>

				<dl className="about-panel-meta">
					<div>
						<dt>Version</dt>
						<dd>0.1.0</dd>
					</div>
					<div>
						<dt>License</dt>
						<dd>MIT</dd>
					</div>
					<div>
						<dt>Copyright</dt>
						<dd>© Sudeepta Sarkar</dd>
					</div>
				</dl>

				<section className="about-panel-license">
					<h3>License</h3>
					{loading ?
						<p className="helper">Loading license…</p>
					:	<pre className="about-panel-license-text">{licenseText}</pre>}
				</section>

				<section className="about-panel-privacy">
					<h3>Privacy &amp; Recording Responsibility</h3>
					<p>
						Loudio performs all transcription locally on your machine. You are
						solely responsible for obtaining consent before recording audio and
						for the lawful handling of any transcript content generated through
						this application.
					</p>
				</section>
			</div>
		</div>
	);
}
