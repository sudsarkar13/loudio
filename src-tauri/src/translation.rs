//! Translation into a language other than English.
//!
//! Whisper's own translate task has exactly one direction — any language into
//! English — so a second model is needed for anything else. NLLB-200 (distilled
//! 600M) runs on the torch already present in the Python fallback venv, covers
//! 200 languages in one checkpoint, and translates source→target directly
//! rather than pivoting through English, which matters because a pivot
//! compounds errors on every hop.

use anyhow::{anyhow, Context, Result};
use std::{fs, path::PathBuf};

use crate::{
    binaries::ensure_python_whisper_runtime,
    paths::runtime_dir,
    process::{emit_transcription_progress, run_command},
};

/// The checkpoint. Distilled 600M rather than the 1.3B/3.3B variants: it is the
/// largest that stays comfortable on a laptop CPU, which is the floor Loudio
/// targets.
const NLLB_MODEL_ID: &str = "facebook/nllb-200-distilled-600M";

/// Disk the checkpoint needs. The weights are ~2.5 GB; the rest is headroom for
/// the tokenizer and the cache's in-flight copies.
const NLLB_DOWNLOAD_BYTES: u64 = 3 * 1024 * 1024 * 1024;

/// Maps Loudio's ISO-639-1 codes onto the FLORES-200 codes NLLB expects.
///
/// NLLB identifies a language *and its script* — Hindi and Urdu share a
/// language family but not a script, and Bengali written in Latin is a
/// different token to NLLB than Bengali in its own script. A bare "hi" is
/// therefore not something NLLB can accept.
pub fn to_flores_code(iso: &str) -> Option<&'static str> {
    Some(match iso.trim().to_ascii_lowercase().as_str() {
        "en" => "eng_Latn",
        "hi" => "hin_Deva",
        "bn" => "ben_Beng",
        "es" => "spa_Latn",
        "fr" => "fra_Latn",
        "de" => "deu_Latn",
        "ja" => "jpn_Jpan",
        "or" => "ory_Orya",
        "ta" => "tam_Taml",
        "te" => "tel_Telu",
        "mr" => "mar_Deva",
        "gu" => "guj_Gujr",
        "pa" => "pan_Guru",
        "ur" => "urd_Arab",
        "zh" => "zho_Hans",
        "ar" => "arb_Arab",
        "pt" => "por_Latn",
        "ru" => "rus_Cyrl",
        "it" => "ita_Latn",
        "ko" => "kor_Hang",
        _ => return None,
    })
}

/// Whether a translate request needs the NLLB step at all.
///
/// An empty or "auto" target means English, which Whisper produces itself — so
/// the 2.4 GB model is never fetched for the default configuration.
pub fn needs_neural_translation(task: &str, target: &str) -> bool {
    if task != "translate" {
        return false;
    }
    let normalised = target.trim().to_ascii_lowercase();
    !(normalised.is_empty() || normalised == "auto" || normalised == "en")
}

fn translator_script_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(runtime_dir(app)?.join("translate_nllb.py"))
}

/// Written to disk rather than passed with `-c` so the source stays readable in
/// the runtime dir when a translation misbehaves, and so the argument list is
/// not at the mercy of shell quoting.
const TRANSLATOR_SOURCE: &str = r#"
import json
import re
import sys

# Read the job from stdin: the transcript can be long and can contain anything,
# which makes argv the wrong channel for it.
job = json.load(sys.stdin)

from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

model_id = job["model_id"]
tokenizer = AutoTokenizer.from_pretrained(model_id, src_lang=job["source"])
# use_safetensors pins the download to one weight format. The repo ships both
# safetensors and a pickled .bin of the same weights, and letting the library
# choose fetched *both* -- 2.4 GB of disk for a file that is then never loaded.
model = AutoModelForSeq2SeqLM.from_pretrained(model_id, use_safetensors=True)

target_id = tokenizer.convert_tokens_to_ids(job["target"])

# NLLB is a sentence-level model: hand it a whole transcript and it translates
# the opening and stops, silently discarding the rest. Splitting on sentence
# boundaries is what keeps the tail.
#
# The terminators include the Devanagari danda and double danda. Without them a
# Hindi transcript has no recognised boundary at all, arrives as one chunk, and
# loses everything after the first sentence -- which is exactly how this was
# found.
SENTENCE_END = re.compile(r"(?<=[.!?\u0964\u0965])\s+")

# Kept well under the model's 512-token limit; characters are a cheap proxy that
# errs on the safe side for scripts that tokenize densely.
MAX_CHUNK_CHARS = 220


def split_line(line):
    """One chunk per sentence.

    Sentences are deliberately never merged back together, even when several
    would fit inside the limit. The limit guards the tokenizer; the split guards
    against the model translating the first sentence and stopping, and packing
    sentences back into one chunk to "save" a pass silently reintroduces exactly
    that. Only an over-long sentence is broken further, on whitespace, so the
    tokenizer never truncates the tail away.
    """
    pieces = []
    for part in SENTENCE_END.split(line):
        part = part.strip()
        if not part:
            continue
        if len(part) <= MAX_CHUNK_CHARS:
            pieces.append(part)
            continue

        buffer = ""
        for word in part.split():
            if buffer and len(buffer) + len(word) + 1 > MAX_CHUNK_CHARS:
                pieces.append(buffer)
                buffer = word
            else:
                buffer = f"{buffer} {word}".strip() if buffer else word
        if buffer:
            pieces.append(buffer)
    return pieces


def translate(chunk):
    encoded = tokenizer(chunk, return_tensors="pt", truncation=True, max_length=512)
    generated = model.generate(
        **encoded,
        forced_bos_token_id=target_id,
        max_length=512,
        num_beams=job.get("beams", 4),
    )
    return tokenizer.batch_decode(generated, skip_special_tokens=True)[0]


# Line structure is preserved: whisper's paragraph breaks carry meaning, so
# sentences are rejoined within their own line rather than flattened.
lines_out = []
for line in job["text"].split("\n"):
    if not line.strip():
        continue
    lines_out.append(" ".join(translate(c) for c in split_line(line.strip())))

sys.stdout.write(json.dumps({"text": "\n".join(lines_out)}))
"#;

/// Confirms torch is not just installed but actually loadable.
///
/// Presence on disk is not enough. On this project's own reference machine the
/// fallback venv holds an **x86_64** torch under an arm64 Python, so `import
/// torch` dies in `dlopen` — a failure that surfaces as a wall of linker output
/// with no hint of the real cause. Checking here turns that into a sentence the
/// user can act on.
async fn verify_torch_usable(python: &str) -> Result<()> {
    let probe = run_command(
        python,
        &["-c".into(), "import torch; print(torch.__version__)".into()],
    )
    .await;

    let Err(error) = probe else {
        return Ok(());
    };

    let detail = format!("{error:#}");
    if detail.contains("incompatible architecture") || detail.contains("mach-o file") {
        return Err(anyhow!(
            "The Python environment has a torch built for the wrong CPU architecture, so it \
             cannot be loaded. Reinstall the Python runtime from the readiness wizard (Help → \
             Run Runtime Bootstrap) to rebuild it for this machine."
        ));
    }

    Err(anyhow!(
        "Translation needs a working PyTorch in Loudio's Python environment, but importing it \
         failed: {detail}"
    ))
}

/// Installs the two packages NLLB needs on top of the existing environment.
///
/// torch is expected to already be there for the Whisper fallback, which is why
/// this engine was chosen; only the model wrapper and its tokenizer are missing.
async fn ensure_translation_packages(app: &tauri::AppHandle, python: &str) -> Result<()> {
    // Verified before the package probe so a broken torch is reported as a
    // broken torch, rather than as a confusing transformers import error.
    verify_torch_usable(python).await?;

    // Cheap probe next: this runs on the translation path, and re-running pip
    // on every request would put a network round trip in front of an offline
    // feature.
    let probe = run_command(
        python,
        &[
            "-c".into(),
            "import transformers, sentencepiece".into(),
        ],
    )
    .await;

    if probe.is_ok() {
        return Ok(());
    }

    emit_transcription_progress(
        app,
        None,
        "Installing the translation runtime (one-time)…",
        false,
        false,
    );

    run_command(
        python,
        &[
            "-m".into(),
            "pip".into(),
            "install".into(),
            "--quiet".into(),
            "transformers>=4.40".into(),
            "sentencepiece".into(),
        ],
    )
    .await
    .context("Failed to install the translation runtime (transformers, sentencepiece)")?;

    Ok(())
}

/// Translates `text` from `source_iso` into `target_iso`.
///
/// Both codes are Loudio's ISO-639-1 values; the FLORES mapping happens here so
/// callers never have to know about NLLB's naming.
pub async fn translate_text(
    app: &tauri::AppHandle,
    text: &str,
    source_iso: &str,
    target_iso: &str,
) -> Result<String> {
    if text.trim().is_empty() {
        return Ok(text.to_string());
    }

    let source = to_flores_code(source_iso).ok_or_else(|| {
        anyhow!("Translation source language '{source_iso}' is not supported by the NLLB model.")
    })?;
    let target = to_flores_code(target_iso).ok_or_else(|| {
        anyhow!("Translation target language '{target_iso}' is not supported by the NLLB model.")
    })?;

    if source == target {
        return Ok(text.to_string());
    }

    // The checkpoint plus the Hugging Face cache's working copies. Checked
    // before anything is fetched, because `from_pretrained` streams straight to
    // disk with no size ceiling of its own.
    crate::disk::ensure_room_for(
        &runtime_dir(app)?,
        NLLB_DOWNLOAD_BYTES,
        "the NLLB-200 translation model",
    )?;

    let python = ensure_python_whisper_runtime(app)
        .await
        .context("The translation runtime needs the Python environment Loudio also uses for the Whisper fallback")?;

    ensure_translation_packages(app, &python).await?;

    let script_path = translator_script_path(app)?;
    fs::write(&script_path, TRANSLATOR_SOURCE)
        .with_context(|| format!("Failed to write the translator script to {}", script_path.display()))?;

    emit_transcription_progress(
        app,
        None,
        format!("Translating into {target_iso} with NLLB-200…"),
        false,
        false,
    );

    let job = serde_json::json!({
        "model_id": NLLB_MODEL_ID,
        "source": source,
        "target": target,
        "text": text,
    })
    .to_string();

    let output = run_python_with_stdin(&python, &script_path, &job).await?;

    let parsed: serde_json::Value = serde_json::from_str(&output)
        .with_context(|| format!("Translator returned output that is not JSON: {output}"))?;

    parsed
        .get("text")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .ok_or_else(|| anyhow!("Translator returned no text"))
}

/// Runs the translator with the job on stdin.
///
/// `run_command` has no stdin channel, and the transcript is too large and too
/// arbitrary to pass as an argument.
async fn run_python_with_stdin(python: &str, script: &PathBuf, job: &str) -> Result<String> {
    use tokio::io::AsyncWriteExt;

    let mut child = tokio::process::Command::new(python)
        .arg(script)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // The first run downloads ~2.4 GB of weights; do not leave that running
        // after the window closes.
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("Failed to launch the translator with {python}"))?;

    child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("Failed to open the translator's stdin"))?
        .write_all(job.as_bytes())
        .await
        .context("Failed to send the translation job")?;

    let output = child
        .wait_with_output()
        .await
        .context("Failed waiting for the translator")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("no error output captured");
        return Err(anyhow!("Translation failed: {detail}"));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::{needs_neural_translation, to_flores_code};

    /// NLLB needs a script as well as a language, so the mapping cannot be a
    /// passthrough of Loudio's ISO codes.
    #[test]
    fn maps_iso_codes_to_flores_codes() {
        assert_eq!(to_flores_code("hi"), Some("hin_Deva"));
        assert_eq!(to_flores_code("bn"), Some("ben_Beng"));
        assert_eq!(to_flores_code("en"), Some("eng_Latn"));
        assert_eq!(to_flores_code("ja"), Some("jpn_Jpan"));
    }

    #[test]
    fn mapping_ignores_case_and_padding() {
        assert_eq!(to_flores_code("  HI "), Some("hin_Deva"));
    }

    #[test]
    fn unknown_codes_are_rejected_rather_than_guessed() {
        assert_eq!(to_flores_code("auto"), None);
        assert_eq!(to_flores_code(""), None);
        assert_eq!(to_flores_code("klingon"), None);
    }

    /// The default configuration must never pull the 2.4 GB checkpoint: Whisper
    /// produces English itself.
    #[test]
    fn english_and_auto_targets_skip_the_neural_step() {
        assert!(!needs_neural_translation("translate", "auto"));
        assert!(!needs_neural_translation("translate", "en"));
        assert!(!needs_neural_translation("translate", ""));
        assert!(!needs_neural_translation("translate", "  AUTO  "));
    }

    #[test]
    fn transcribe_never_triggers_translation() {
        assert!(!needs_neural_translation("transcribe", "hi"));
    }

    #[test]
    fn a_non_english_target_triggers_translation() {
        assert!(needs_neural_translation("translate", "hi"));
        assert!(needs_neural_translation("translate", "fr"));
    }
}
