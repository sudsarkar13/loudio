import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { Settings2 } from "lucide-react";
import type { AppSettings, RuntimeProfile } from "@/app/lib/types";

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
}

export function SettingsPanel({
  profiles,
  settings,
  activeProfileModel,
  modelOptions,
  languages,
  setSettings,
}: SettingsPanelProps) {
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
            }
          >
            {profiles.map((profile: RuntimeProfile) => (
              <option key={profile.id} value={profile.id}>
                {profile.title}
              </option>
            ))}
          </select>
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
            }
          >
            <option value="">Default ({activeProfileModel ?? "small"})</option>
            {modelOptions.map((model: string) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="label">Language</div>
          <select
            className="select"
            value={settings.language}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setSettings((prev: AppSettings) => ({
                ...prev,
                language: event.target.value,
              }))
            }
          >
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
            }
          >
            <option value="transcribe">Transcribe</option>
            <option value="translate">Translate</option>
          </select>
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
              placeholder="/opt/homebrew/bin/whisper-cli"
            />
          </div>
        </div>
      </details>
    </aside>
  );
}
