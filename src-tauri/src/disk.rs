//! Free-space checks for the app's large downloads.
//!
//! Loudio pulls multi-gigabyte assets — whisper model weights, a PyTorch
//! install, and the NLLB translation checkpoint. Each is fetched by a tool that
//! happily writes until the filesystem is full, and a full disk is a far worse
//! outcome for the user than a refused download: it breaks unrelated software
//! and takes manual cleanup to undo. Every such fetch checks first.

use anyhow::{anyhow, Result};
use std::path::Path;

/// Headroom kept free on top of whatever a download needs.
///
/// A download that exactly fills the disk still leaves the machine unusable, and
/// the sizes callers pass are estimates — archives get extracted, caches keep
/// temporary copies. This is the margin that keeps "the download fit" from
/// meaning "and nothing else can run".
pub const RESERVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Bytes available to this user on the filesystem holding `path`.
///
/// Uses `statvfs`'s "available" rather than "free": on most filesystems part of
/// the free space is reserved for root, and counting it would let a check pass
/// on space the app cannot actually use.
pub fn available_bytes(path: &Path) -> Result<u64> {
    // The path itself may not exist yet (a model directory created on demand),
    // so walk up to the nearest existing ancestor.
    let mut probe = path;
    loop {
        if probe.exists() {
            break;
        }
        probe = probe
            .parent()
            .ok_or_else(|| anyhow!("No existing parent directory for {}", path.display()))?;
    }

    let c_path = std::ffi::CString::new(probe.as_os_str().as_encoded_bytes())
        .map_err(|_| anyhow!("Path contains an interior NUL: {}", probe.display()))?;

    // SAFETY: `stat` is written only by statvfs, and is read only when the call
    // reports success.
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };
    if rc != 0 {
        return Err(anyhow!(
            "Could not read free space for {}: {}",
            probe.display(),
            std::io::Error::last_os_error()
        ));
    }

    // f_frsize is the fragment size the block counts are expressed in; f_bsize
    // is the preferred I/O size and is not always the same number.
    Ok(stat.f_bavail as u64 * stat.f_frsize as u64)
}

/// Renders a byte count the way a user would say it.
pub fn format_bytes(bytes: u64) -> String {
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MB: f64 = 1024.0 * 1024.0;

    let value = bytes as f64;
    if value >= GB {
        format!("{:.1} GB", value / GB)
    } else {
        format!("{:.0} MB", value / MB)
    }
}

/// Whether `available` leaves room for a `needed`-byte download plus headroom.
pub fn has_room_for(available: u64, needed: u64) -> bool {
    match needed.checked_add(RESERVE_BYTES) {
        Some(required) => available >= required,
        // Saturating here would be wrong in the dangerous direction: the total
        // would clamp to u64::MAX and then compare as satisfied. A need that
        // large cannot be met by any real filesystem, so refuse it.
        None => false,
    }
}

/// Fails before a download starts if it would leave the disk critically full.
///
/// `label` names the thing being fetched so the message says what to free space
/// for, rather than reporting a bare number.
pub fn ensure_room_for(path: &Path, needed: u64, label: &str) -> Result<()> {
    let available = available_bytes(path)?;
    if has_room_for(available, needed) {
        return Ok(());
    }

    Err(anyhow!(
        "Not enough disk space for {label}. It needs about {}, and {} is free — Loudio keeps {} \
         spare so a download cannot fill the disk. Free some space and try again.",
        format_bytes(needed),
        format_bytes(available),
        format_bytes(RESERVE_BYTES),
    ))
}

#[cfg(test)]
mod tests {
    use super::{available_bytes, format_bytes, has_room_for, RESERVE_BYTES};
    use std::path::Path;

    #[test]
    fn a_download_must_fit_alongside_the_reserve() {
        let one_gb = 1024 * 1024 * 1024;
        assert!(has_room_for(RESERVE_BYTES + one_gb, one_gb));
        // Exactly enough for the file but nothing left over is a refusal: that
        // is the case that leaves the machine unusable.
        assert!(!has_room_for(one_gb, one_gb));
        assert!(!has_room_for(RESERVE_BYTES + one_gb - 1, one_gb));
    }

    #[test]
    fn a_zero_byte_need_still_respects_the_reserve() {
        assert!(!has_room_for(RESERVE_BYTES - 1, 0));
        assert!(has_room_for(RESERVE_BYTES, 0));
    }

    /// Saturating arithmetic: an absurd size must refuse rather than wrap around
    /// into "plenty of room".
    #[test]
    fn an_overflowing_need_is_refused() {
        assert!(!has_room_for(u64::MAX, u64::MAX));
    }

    #[test]
    fn formats_sizes_the_way_a_user_would_read_them() {
        assert_eq!(format_bytes(2 * 1024 * 1024 * 1024), "2.0 GB");
        assert_eq!(format_bytes(512 * 1024 * 1024), "512 MB");
    }

    /// A path that does not exist yet still resolves, via its nearest existing
    /// ancestor — model directories are created on demand.
    #[test]
    fn resolves_free_space_through_a_missing_leaf() {
        let probe = std::env::temp_dir().join("loudio-does-not-exist").join("nested");
        assert!(available_bytes(&probe).is_ok());
    }
}
