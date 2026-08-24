# Stage 4 — Local structuring model

> **Status:** planned, not started. Scheduled to begin after the v1.0.3 release.
> **Decision taken:** `gemma-3-270m-it`, quantized, **bundled** with the app.

## Why there is a stage 4 at all

Stages 1–3 shipped in v1.0.3 and are entirely deterministic — vocabulary
biasing through the engine's initial prompt, whole-word replacement of learned
corrections, and a confirm-to-learn loop that turns your edits into future
corrections. They fix *which words come out*.

They cannot fix *how the words are arranged*. Turning a flat wall of dictation
into bullets, ordered lists and paragraph breaks is a judgment task: it requires
deciding that three spoken clauses were meant as list items, and that a fourth
was not. No lookup table does that. That is the entire scope of stage 4.

## The model

| | |
| :-- | :-- |
| Model | `google/gemma-3-270m-it` |
| Parameters | 270M |
| Quantization | Q4_K_M (confirm against Q8_0 during benchmarking) |
| Size on disk | ~253 MB at Q4_K_M |
| Runtime | `llama.cpp` — the same ggml family as the `whisper.cpp` already in use |
| Distribution | bundled in the application package |

Chosen for size. It was the smallest of four candidates evaluated
(`gemma-3-270m-it` 253 MB, `SmolLM2-360M-Instruct` 271 MB, `Qwen3-0.6B` 397 MB,
`Llama-3.2-1B-Instruct` 808 MB), and small enough that bundling stays plausible.

### Two risks to resolve before writing code

**1. Quality is unproven at this size.** 270M is the smallest of the candidates
considered and the least likely to follow structuring instructions reliably. The
failure mode that matters is not "formats badly" — it is **rewriting or dropping
the user's words** while reformatting them. A transcription tool that silently
edits what you said is worse than one that returns a flat paragraph. The
benchmark below exists specifically to catch this, and the fallback is documented
below.

**2. Licensing.** Gemma is distributed under the **Gemma Terms of Use**, not a
standard OSI licence. Redistribution is permitted, but bundling it means Loudio
must ship those terms alongside its own MIT licence and pass the use restrictions
downstream. Before any model file lands in the repo:

- [ ] Read the current Gemma Terms of Use and the Prohibited Use Policy in full
- [ ] Confirm redistribution inside a packaged desktop application is permitted
- [ ] Add the Gemma terms to the package (`debian/copyright`, the `.dmg`, and the
      in-app About dialog)
- [ ] Verify the AppStream metadata still declares Loudio's own licence correctly
      when a non-MIT component is bundled

This is a genuine blocker for bundling, not paperwork. If the terms turn out to
prohibit the packaging model, the fallback is download-on-first-use with consent
— the same pattern already used for the engine updates in v1.0.3.

## Packaging consequence

The Linux `.deb` is currently ~6 MB. Bundling a 253 MB model takes it to roughly
**260 MB**, a ~43× increase, and the `.dmg` similarly. This is the cost the
bundling decision buys: the app works offline on first launch with no download
step, which matches Loudio's offline-first premise.

Alternative if size becomes unacceptable: ship without the model and download it
on first use behind a consent prompt. Loudio already has this machinery from the
stable-update work. Keep it as the documented fallback.

## Benchmark — the gate before any implementation

Nothing gets built until this passes. Run against **real transcripts from actual
recordings**, not synthetic samples.

1. Collect a corpus from existing recordings: at minimum some prose dictation,
   some obviously list-shaped dictation, and some mixed.
2. Establish ground truth — manually structure each one the way it should look.
3. Run `gemma-3-270m-it` at Q4_K_M and Q8_0 over each transcript.
4. Measure:
   - **Fidelity (pass/fail gate).** Are all original words preserved? Any
     rewriting, dropping or hallucination is a hard fail regardless of formatting
     quality.
   - **Structure accuracy.** Does it find the lists that exist, and leave prose
     as prose?
   - **Latency** on the target hardware, measured separately for Apple Silicon
     and for x86_64 Linux.
   - **Memory ceiling** during inference.
5. Compare against `SmolLM2-360M-Instruct` (271 MB) as the control. If 270M fails
   fidelity and 360M passes, the extra 18 MB is bought cheaply.

**Gate:** proceed only if fidelity is clean across the corpus. Formatting that
is merely mediocre can be improved with prompting; a model that edits the user's
words cannot be fixed by prompting.

## Implementation sketch (only after the gate passes)

- Add `llama.cpp` as a sibling to the existing `whisper.cpp` invocation in
  [`transcription.rs`](../src-tauri/src/transcription.rs). Same process-spawn
  shape, same stderr draining, same kill-on-drop.
- Structuring runs **after** transcription and after `apply_learned_terms`, as a
  distinct pass over finished text — never inline with decoding.
- **Off by default**, behind a Settings toggle. Users who want a verbatim
  transcript must keep getting exactly that.
- **Always keep the unstructured original.** Store both, and let the UI toggle
  between them. This makes a bad structuring pass an annoyance rather than data
  loss, and it is what makes shipping a 270M model defensible at all.
- Constrain output with a GBNF grammar if free-form prompting proves unreliable —
  `whisper.cpp` already exposes `--grammar`, and `llama.cpp` supports the same.

## Fine-tuning — deferred

Training on Loudio-specific data was raised and is worth revisiting, but only
after a stock model is measured. Fine-tuning to fix a problem that has not been
quantified would be guesswork, and it needs a labelled corpus that does not exist
yet. The learned-corrections store from stage 3 is a plausible future source of
that corpus.

## Open questions

- Which quantization — Q4_K_M (253 MB) or Q8_0 (larger, more faithful)?
- Does structuring run automatically, or on an explicit "Format this" action?
- How is a structured transcript stored in history — replacing the original,
  or alongside it?
