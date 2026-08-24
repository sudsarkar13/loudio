//! Domain-vocabulary biasing and learned-correction replay.
//!
//! Two mechanisms, deliberately layered, because neither is sufficient alone:
//!
//! * The initial prompt makes a term *likely* during decoding. It is
//!   probabilistic — it improves the odds, it does not guarantee the result.
//! * The correction pass rewrites what still came out wrong. It is exact, but
//!   only fixes spellings already seen and confirmed.
//!
//! Pure functions over strings, so the behaviour is testable without an engine.

use crate::models::LearnedTerm;

/// whisper.cpp caps the initial prompt at `n_text_ctx / 2` tokens — 224 for the
/// models Loudio ships. Budgeting in characters keeps a safe margin below that
/// without needing a tokenizer, since an unbounded dictionary would otherwise
/// silently truncate and drop terms.
const PROMPT_CHAR_BUDGET: usize = 600;

const PROMPT_LEAD: &str = "Technical vocabulary: ";

/// Terms to bias, most-confirmed first.
///
/// Learned corrections rank ahead of the manual list: a term the user has
/// actually corrected is proven to be misheard, whereas a manually listed one
/// may never have been a problem.
pub fn vocabulary_terms(custom: &str, learned: &[LearnedTerm]) -> Vec<String> {
    let mut ranked: Vec<&LearnedTerm> = learned.iter().collect();
    ranked.sort_by(|a, b| {
        b.hits
            .cmp(&a.hits)
            .then_with(|| a.intended.cmp(&b.intended))
    });

    let mut terms: Vec<String> = Vec::new();
    let push_unique = |value: &str, terms: &mut Vec<String>| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return;
        }
        if !terms
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(trimmed))
        {
            terms.push(trimmed.to_string());
        }
    };

    for term in ranked {
        push_unique(&term.intended, &mut terms);
    }

    // Manual list: newline- or comma-separated, whichever the user typed.
    for line in custom.split(['\n', ',']) {
        push_unique(line, &mut terms);
    }

    terms
}

/// The `--prompt` value, or `None` when there is no vocabulary to bias.
///
/// Terms are appended only while they fit the budget; ranking above decides
/// which survive, so the most-corrected terms are never the ones dropped.
pub fn build_initial_prompt(custom: &str, learned: &[LearnedTerm]) -> Option<String> {
    let terms = vocabulary_terms(custom, learned);
    if terms.is_empty() {
        return None;
    }

    let mut prompt = String::from(PROMPT_LEAD);
    let mut included = 0usize;

    for term in terms {
        let separator = if included == 0 { "" } else { ", " };
        if prompt.len() + separator.len() + term.len() + 1 > PROMPT_CHAR_BUDGET {
            break;
        }
        prompt.push_str(separator);
        prompt.push_str(&term);
        included += 1;
    }

    if included == 0 {
        return None;
    }

    prompt.push('.');
    Some(prompt)
}

/// Case-insensitively replaces whole-word occurrences of `heard` with
/// `intended`.
///
/// Word-bounded on purpose: a naive substring replace would rewrite "supabase"
/// inside "supabaseClient", and turn "base" into "Supabase" everywhere.
fn replace_whole_words(haystack: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() {
        return haystack.to_string();
    }

    let lower_haystack = haystack.to_lowercase();
    let lower_needle = needle.to_lowercase();
    let mut result = String::with_capacity(haystack.len());
    let mut cursor = 0usize;

    while let Some(found) = lower_haystack[cursor..].find(&lower_needle) {
        let start = cursor + found;
        let end = start + lower_needle.len();

        let before_ok = start == 0
            || !lower_haystack[..start]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric());
        let after_ok = end >= lower_haystack.len()
            || !lower_haystack[end..]
                .chars()
                .next()
                .is_some_and(|c| c.is_alphanumeric());

        result.push_str(&haystack[cursor..start]);
        if before_ok && after_ok {
            result.push_str(replacement);
        } else {
            result.push_str(&haystack[start..end]);
        }
        cursor = end;
    }

    result.push_str(&haystack[cursor..]);
    result
}

/// Applies every learned correction to a finished transcript.
///
/// Longest `heard` first, so a multi-word correction wins over a single-word
/// one that overlaps it — otherwise "super" would fire before "super base"
/// ever matched.
pub fn apply_learned_terms(text: &str, learned: &[LearnedTerm]) -> String {
    let mut ordered: Vec<&LearnedTerm> = learned
        .iter()
        .filter(|term| !term.heard.trim().is_empty() && !term.intended.trim().is_empty())
        .collect();
    ordered.sort_by_key(|term| std::cmp::Reverse(term.heard.len()));

    ordered.iter().fold(text.to_string(), |acc, term| {
        replace_whole_words(&acc, term.heard.trim(), term.intended.trim())
    })
}

/// A correction the user might want to keep, derived from their edit.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionCandidate {
    pub heard: String,
    pub intended: String,
}

/// Longest word runs that differ between the engine output and the user's edit.
///
/// Suggestions only — nothing is learned without confirmation. Blind diffing
/// would absorb rephrasings and typos as vocabulary and poison the dictionary,
/// so candidates are deliberately narrow:
///
/// * bounded length, because a rewritten sentence is editing, not a term
/// * both sides non-empty, so pure insertions and deletions are ignored
/// * unchanged when the two sides differ only in case or punctuation
pub fn correction_candidates(original: &str, edited: &str) -> Vec<CorrectionCandidate> {
    /// A term is a few words at most; anything longer is a rewrite.
    const MAX_RUN_WORDS: usize = 4;

    let old_words: Vec<&str> = original.split_whitespace().collect();
    let new_words: Vec<&str> = edited.split_whitespace().collect();

    // Common prefix and suffix, so only the changed middle is considered.
    let mut start = 0usize;
    while start < old_words.len()
        && start < new_words.len()
        && normalize(old_words[start]) == normalize(new_words[start])
    {
        start += 1;
    }

    let mut old_end = old_words.len();
    let mut new_end = new_words.len();
    while old_end > start
        && new_end > start
        && normalize(old_words[old_end - 1]) == normalize(new_words[new_end - 1])
    {
        old_end -= 1;
        new_end -= 1;
    }

    let heard = old_words[start..old_end].join(" ");
    let intended = new_words[start..new_end].join(" ");

    if heard.trim().is_empty() || intended.trim().is_empty() {
        return Vec::new();
    }
    if old_end - start > MAX_RUN_WORDS || new_end - start > MAX_RUN_WORDS {
        return Vec::new();
    }
    if normalize(&heard) == normalize(&intended) {
        return Vec::new();
    }

    vec![CorrectionCandidate { heard, intended }]
}

/// Lowercased with surrounding punctuation stripped, so "Supabase," and
/// "supabase" compare equal.
fn normalize(word: &str) -> String {
    word.trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn term(heard: &str, intended: &str, hits: u32) -> LearnedTerm {
        LearnedTerm {
            heard: heard.into(),
            intended: intended.into(),
            hits,
        }
    }

    #[test]
    fn builds_a_prompt_from_both_sources() {
        let prompt =
            build_initial_prompt("Tauri\nAppStream", &[term("super base", "Supabase", 3)]).unwrap();
        assert!(prompt.starts_with("Technical vocabulary: "));
        assert!(prompt.contains("Supabase"));
        assert!(prompt.contains("Tauri"));
        assert!(prompt.ends_with('.'));
    }

    #[test]
    fn no_vocabulary_means_no_prompt_flag() {
        assert!(build_initial_prompt("", &[]).is_none());
        assert!(build_initial_prompt("   \n  ,  ", &[]).is_none());
    }

    #[test]
    fn ranks_most_corrected_terms_first() {
        let learned = vec![
            term("see eye see dee", "CI/CD", 9),
            term("flat pack", "Flatpak", 2),
        ];
        let terms = vocabulary_terms("Zzz", &learned);
        assert_eq!(terms[0], "CI/CD", "most-confirmed term must rank first");
        assert_eq!(terms[1], "Flatpak");
        assert_eq!(
            terms[2], "Zzz",
            "manual entries rank after proven corrections"
        );
    }

    #[test]
    fn drops_lowest_ranked_terms_when_over_budget() {
        let learned: Vec<LearnedTerm> = (0..200)
            .map(|i| term(&format!("h{i}"), &format!("Term{i:03}"), 500 - i))
            .collect();
        let prompt = build_initial_prompt("", &learned).unwrap();
        assert!(
            prompt.len() <= PROMPT_CHAR_BUDGET,
            "prompt exceeded the budget"
        );
        // Highest-hit term survives; the tail is what gets cut.
        assert!(prompt.contains("Term000"));
        assert!(!prompt.contains("Term199"));
    }

    #[test]
    fn deduplicates_case_insensitively() {
        let terms = vocabulary_terms("supabase\nSUPABASE", &[term("x", "Supabase", 1)]);
        assert_eq!(
            terms
                .iter()
                .filter(|t| t.eq_ignore_ascii_case("supabase"))
                .count(),
            1
        );
    }

    #[test]
    fn corrects_whole_words_only() {
        let learned = vec![term("super base", "Supabase", 1)];
        assert_eq!(
            apply_learned_terms("I use super base for auth", &learned),
            "I use Supabase for auth"
        );
        // Case-insensitive match, canonical replacement.
        assert_eq!(
            apply_learned_terms("Super Base rocks", &learned),
            "Supabase rocks"
        );
    }

    #[test]
    fn never_rewrites_inside_a_larger_word() {
        let learned = vec![term("base", "Supabase", 1)];
        assert_eq!(
            apply_learned_terms("the codebase and database", &learned),
            "the codebase and database",
            "substring matches must not fire"
        );
        assert_eq!(
            apply_learned_terms("the base layer", &learned),
            "the Supabase layer"
        );
    }

    #[test]
    fn longer_corrections_win_over_overlapping_shorter_ones() {
        let learned = vec![term("super", "Super", 1), term("super base", "Supabase", 1)];
        assert_eq!(
            apply_learned_terms("super base is up", &learned),
            "Supabase is up"
        );
    }

    #[test]
    fn suggests_the_term_the_user_actually_fixed() {
        let got = correction_candidates(
            "I will use super base for the backend",
            "I will use Supabase for the backend",
        );
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].heard, "super base");
        assert_eq!(got[0].intended, "Supabase");
    }

    #[test]
    fn suggests_nothing_for_a_rewrite() {
        // A reworded sentence is editing, not a vocabulary correction.
        let got = correction_candidates(
            "the release details are not written anywhere at all",
            "I could not find any release notes on the published page",
        );
        assert!(got.is_empty(), "a rewrite must not become vocabulary");
    }

    #[test]
    fn ignores_pure_insertions_and_deletions() {
        assert!(correction_candidates("run the pipeline", "run the pipeline now").is_empty());
        assert!(correction_candidates("run the whole pipeline", "run the pipeline").is_empty());
    }

    #[test]
    fn ignores_punctuation_and_case_only_edits() {
        assert!(correction_candidates("we use supabase", "we use Supabase.").is_empty());
    }

    #[test]
    fn handles_identical_text() {
        assert!(correction_candidates("nothing changed", "nothing changed").is_empty());
    }

    #[test]
    fn finds_the_real_misrecognitions_from_the_recorded_sample() {
        // Both taken from an actual Loudio transcript of the maintainer's voice.
        let flatpak = correction_candidates(
            "the snap store or any flat pack that I have opened",
            "the snap store or any Flatpak that I have opened",
        );
        assert_eq!(flatpak[0].intended, "Flatpak");

        let cicd = correction_candidates(
            "published the package yet from the CACD pipeline",
            "published the package yet from the CI/CD pipeline",
        );
        assert_eq!(cicd[0].heard, "CACD");
        assert_eq!(cicd[0].intended, "CI/CD");
    }

    #[test]
    fn leaves_text_untouched_without_learned_terms() {
        assert_eq!(
            apply_learned_terms("nothing to do here", &[]),
            "nothing to do here"
        );
    }
}
