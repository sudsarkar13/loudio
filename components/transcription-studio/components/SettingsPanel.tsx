import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { Settings2 } from "lucide-react";
import type { AppSettings, RuntimeProfile } from "@/lib/types";
import type { MicrophoneDevice } from "@/components/transcription-studio/hooks/useMicrophoneDevices";
import { MicrophoneSelector } from "@/components/transcription-studio/components/MicrophoneSelector";

interface LanguageOption {
	label: string;
	value: string;
}

interface SettingsPanelProps {
	profiles: RuntimeProfile[];
	settings: AppSettings;
	activeProfileModel?: string;
	modelOptions: string[];
	languages: LanguageOption[];
	setSettings: Dispatch<SetStateAction<AppSettings>>;
	microphoneDevices: MicrophoneDevice[];
	selectedMicrophoneDeviceId: string;
	hasMicrophonePermission: boolean;
	isEnumeratingMicrophones: boolean;
	microphoneErrorMessage: string;
	onRequestMicrophonePermission: () => Promise<boolean>;
	onRefreshMicrophoneDevices: () => Promise<void>;
}

/**
 * Hint the engine path for the platform actually running.
 *
 * The Homebrew prefix only exists on macOS, so showing it to a Linux user
 * points them at a path that can never resolve.
 */
function getEnginePathPlaceholder(): string {
	if (typeof navigator === "undefined") return "/usr/local/bin/whisper-cli";
	const agent = navigator.userAgent.toLowerCase();
	if (agent.includes("mac")) return "/opt/homebrew/bin/whisper-cli";
	if (agent.includes("win")) return "C:\\Program Files\\whisper\\whisper-cli.exe";
	return "/snap/bin/whisper-cpp.whisper-cli";
}

export function SettingsPanel({
	profiles,
	settings,
	activeProfileModel,
	modelOptions,
	languages,
	setSettings,
	microphoneDevices,
	selectedMicrophoneDeviceId,
	hasMicrophonePermission,
	isEnumeratingMicrophones,
	microphoneErrorMessage,
	onRequestMicrophonePermission,
	onRefreshMicrophoneDevices,
}: SettingsPanelProps) {
	const enginePathPlaceholder = getEnginePathPlaceholder();
	const isTranslating = settings.task === "translate";

	return (
		<aside className="card studio-settings">
			<div className="section-title">
				<Settings2 size={16} />
				<h2>Settings</h2>
			</div>

			<section className="settings-grid compact-grid">
				<div>
					<div className="label">Runtime</div>
					<select
						className="select"
						value={settings.profileId}
						onChange={(event: ChangeEvent<HTMLSelectElement>) =>
							setSettings((prev: AppSettings) => ({
								...prev,
								profileId: event.target.value,
							}))
						}>
						{profiles.map((profile: RuntimeProfile) => (
							<option key={profile.id} value={profile.id}>
								{profile.title}
							</option>
						))}
					</select>
				</div>

				<div>
					<MicrophoneSelector
						settings={settings}
						setSettings={setSettings}
						microphoneDevices={microphoneDevices}
						selectedMicrophoneDeviceId={selectedMicrophoneDeviceId}
						hasMicrophonePermission={hasMicrophonePermission}
						isEnumeratingMicrophones={isEnumeratingMicrophones}
						microphoneErrorMessage={microphoneErrorMessage}
						onRequestMicrophonePermission={onRequestMicrophonePermission}
						onRefreshMicrophoneDevices={onRefreshMicrophoneDevices}
						variant="panel"
					/>
				</div>

				<div>
					<div className="label">Model</div>
					<select
						className="select"
						value={(settings.customModel ?? "").trim()}
						onChange={(event: ChangeEvent<HTMLSelectElement>) =>
							setSettings((prev: AppSettings) => ({
								...prev,
								customModel: event.target.value,
							}))
						}>
						<option value="">Default ({activeProfileModel ?? "small"})</option>
						{modelOptions.map((model: string) => (
							<option key={model} value={model}>
								{model}
							</option>
						))}
					</select>
				</div>

				<div>
					{/*
					  * This selector always names the *spoken* language, in both
					  * tasks — Whisper has no notion of an output language. The
					  * label says so under Translate, where "Language" alone
					  * reads like a translation target.
					  */}
					<div className="label">
						{isTranslating ? "Spoken language" : "Language"}
					</div>
					<select
						className="select"
						value={settings.language}
						onChange={(event: ChangeEvent<HTMLSelectElement>) =>
							setSettings((prev: AppSettings) => ({
								...prev,
								language: event.target.value,
							}))
						}>
						{languages.map((language: LanguageOption) => (
							<option key={language.value} value={language.value}>
								{language.label}
							</option>
						))}
					</select>
				</div>

				<div>
					<div className="label">Task</div>
					<select
						className="select"
						value={settings.task}
						onChange={(event: ChangeEvent<HTMLSelectElement>) =>
							setSettings((prev: AppSettings) => ({
								...prev,
								task: event.target.value as AppSettings["task"],
							}))
						}>
						<option value="transcribe">Transcribe (keep spoken language)</option>
						<option value="translate">Translate to English</option>
					</select>
					<div className="helper">
						{isTranslating ?
							"Whisper only translates into English; it has no other translation direction. Choose Transcribe to keep the spoken language."
						:	"Keeps the language you speak. Auto Detect identifies it per recording."}
					</div>
				</div>
			</section>

			<section className="stack compact-stack">
				<label className="toggle-row">
					<span className="toggle-title">Auto copy</span>
					<input
						type="checkbox"
						checked={settings.autoCopy}
						onChange={(event: ChangeEvent<HTMLInputElement>) =>
							setSettings((prev: AppSettings) => ({
								...prev,
								autoCopy: event.target.checked,
							}))
						}
					/>
				</label>
			</section>

			<details className="advanced-block">
				<summary>Advanced</summary>
				<div className="slider-grid">
					<div>
						<div className="label">Beam</div>
						<div className="range-head">
							<span>Search</span>
							<strong>{settings.beamSize}</strong>
						</div>
						<input
							className="field"
							type="range"
							min={1}
							max={10}
							step={1}
							value={settings.beamSize}
							onChange={(event: ChangeEvent<HTMLInputElement>) =>
								setSettings((prev: AppSettings) => ({
									...prev,
									beamSize: Number(event.target.value),
								}))
							}
						/>
					</div>

					<div>
						<div className="label">Temperature</div>
						<div className="range-head">
							<span>Creativity</span>
							<strong>{settings.temperature.toFixed(2)}</strong>
						</div>
						<input
							className="field"
							type="range"
							min={0}
							max={1}
							step={0.05}
							value={settings.temperature}
							onChange={(event: ChangeEvent<HTMLInputElement>) =>
								setSettings((prev: AppSettings) => ({
									...prev,
									temperature: Number(event.target.value),
								}))
							}
						/>
					</div>

					<div>
						<div className="label">Vocabulary</div>
						<textarea
							className="textarea field"
							rows={3}
							value={settings.customVocabulary ?? ""}
							onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
								setSettings((prev: AppSettings) => ({
									...prev,
									customVocabulary: event.target.value,
								}))
							}
							placeholder={"Supabase\nFlatpak\nCI/CD"}
						/>
						<p className="hint">
							Names and jargon to bias, one per line. Whisper favours these
							while decoding, so &ldquo;Supabase&rdquo; wins over &ldquo;super
							base&rdquo;.
						</p>
					</div>

					<div>
						<div className="label">Engine path</div>
						<input
							className="field code"
							value={settings.manualEnginePath ?? ""}
							onChange={(event: ChangeEvent<HTMLInputElement>) =>
								setSettings((prev: AppSettings) => ({
									...prev,
									manualEnginePath: event.target.value,
								}))
							}
							placeholder={enginePathPlaceholder}
						/>
					</div>
				</div>
			</details>
		</aside>
	);
}
