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
	// "auto" and English are produced by Whisper itself, so neither downloads a
	// translation model.
	const translateTarget = (settings.translateTargetLanguage ?? "auto").trim();
	const needsTranslationModel =
		translateTarget !== "auto" && translateTarget !== "en" && translateTarget !== "";

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
							"Auto keeps Whisper's own output, which is always English. Any other target adds a second pass with a local NLLB-200 model, downloaded once on first use."
						:	"Keeps the language you speak. Auto Detect identifies it per recording."}
					</div>
				</div>

				{isTranslating ?
					<div>
						<div className="label">Translate into</div>
						<select
							className="select"
							value={settings.translateTargetLanguage}
							onChange={(event: ChangeEvent<HTMLSelectElement>) =>
								setSettings((prev: AppSettings) => ({
									...prev,
									translateTargetLanguage: event.target.value,
								}))
							}>
							{/*
							  * "Auto" is English rather than a detected language:
							  * a translation target cannot be inferred from the
							  * audio, and English is the one direction Whisper
							  * can produce without a second model.
							  */}
							<option value="auto">Auto (English)</option>
							{languages
								.filter((language: LanguageOption) => language.value !== "auto")
								.map((language: LanguageOption) => (
									<option key={language.value} value={language.value}>
										{language.label}
									</option>
								))}
						</select>
					</div>
				:	null}

				{/*
				  * Shown only once a non-English target is chosen, because that
				  * is the only configuration that downloads a model at all.
				  * Offering the choice earlier would imply a cost the default
				  * path never pays.
				  */}
				{isTranslating && needsTranslationModel ?
					<div>
						<div className="label">Translation model</div>
						<select
							className="select"
							value={settings.translationModelSize}
							onChange={(event: ChangeEvent<HTMLSelectElement>) =>
								setSettings((prev: AppSettings) => ({
									...prev,
									translationModelSize: event.target
										.value as AppSettings["translationModelSize"],
								}))
							}>
							<option value="small">Small — 2.5 GB, faster</option>
							<option value="large">Large — 5.5 GB, more accurate</option>
						</select>
						<div className="helper">
							{settings.translationModelSize === "large" ?
								"Downloaded once, on first use. Better on long or idiomatic passages, but noticeably slower per sentence on CPU."
							:	"Downloaded once, on first use. Covers all 200 languages and runs comfortably on a laptop CPU."}
						</div>
					</div>
				:	null}
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
