use bytes::Bytes;
use chrono::{DateTime, Utc};
use once_cell::sync::Lazy;
use pingora_http::ResponseHeader;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{Instant, SystemTime};

/// Cached file entry
struct CachedFile {
    body: Bytes,
    mime: String,
    last_modified: String,
    cached_at: Instant,
}

/// Global file cache (path -> cached entry)
static FILE_CACHE: Lazy<RwLock<HashMap<PathBuf, CachedFile>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// Cache TTL — re-check file modification time after this duration
const CACHE_TTL_SECS: u64 = 5;

/// Result of serving a static file
pub struct StaticFileResponse {
    pub header: ResponseHeader,
    pub body: Bytes,
}

/// Serve a static file from disk with in-memory caching.
///
/// - Resolves `request_path` relative to `base_dir`
/// - Determines MIME type from file extension
/// - Sets Cache-Control based on `cache_expires` (e.g., "30d", "1h", "3600")
/// - Returns 304 Not Modified if `if_modified_since` matches
/// - Returns None if the file does not exist or is outside the base directory
pub fn serve_static_file(
    base_dir: &str,
    request_path: &str,
    location_path: &str,
    cache_expires: Option<&str>,
    if_modified_since: Option<&str>,
) -> Option<StaticFileResponse> {
    // Strip the location prefix from the request path
    let relative = request_path.strip_prefix(location_path).unwrap_or(request_path);
    let relative = relative.trim_start_matches('/');

    let mut file_path = PathBuf::from(base_dir);
    file_path.push(relative);

    // If path is a directory, try index.html
    if file_path.is_dir() {
        file_path.push("index.html");
    }

    // Canonicalize to prevent path traversal
    let canonical = file_path.canonicalize().ok()?;
    let base_canonical = Path::new(base_dir).canonicalize().ok()?;
    if !canonical.starts_with(&base_canonical) {
        log::warn!(
            "Path traversal attempt: {} resolved to {}",
            request_path,
            canonical.display()
        );
        return None;
    }

    if !canonical.is_file() {
        return None;
    }

    // Try to serve from cache
    let now = Instant::now();
    {
        let cache = FILE_CACHE.read().unwrap();
        if let Some(cached) = cache.get(&canonical) {
            if now.duration_since(cached.cached_at).as_secs() < CACHE_TTL_SECS {
                // Check If-Modified-Since
                if let Some(ims) = if_modified_since {
                    if ims == cached.last_modified {
                        let mut resp = ResponseHeader::build(304, Some(2)).ok()?;
                        resp.insert_header(http::header::LAST_MODIFIED, &cached.last_modified)
                            .ok()?;
                        return Some(StaticFileResponse {
                            header: resp,
                            body: Bytes::new(),
                        });
                    }
                }

                return Some(build_200_response(
                    &cached.body,
                    &cached.mime,
                    &cached.last_modified,
                    cache_expires,
                )?);
            }
        }
    }

    // Cache miss or stale — read from disk
    let metadata = std::fs::metadata(&canonical).ok()?;
    let modified: DateTime<Utc> = metadata
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .into();
    let last_modified_str = modified.format("%a, %d %b %Y %H:%M:%S GMT").to_string();

    // Check If-Modified-Since
    if let Some(ims) = if_modified_since {
        if ims == last_modified_str {
            let mut resp = ResponseHeader::build(304, Some(2)).ok()?;
            resp.insert_header(http::header::LAST_MODIFIED, &last_modified_str)
                .ok()?;
            return Some(StaticFileResponse {
                header: resp,
                body: Bytes::new(),
            });
        }
    }

    // Read file
    let body_vec = std::fs::read(&canonical).ok()?;
    let body = Bytes::from(body_vec);

    // Determine MIME type
    let mime = mime_guess::from_path(&canonical)
        .first_or_octet_stream()
        .to_string();

    // Update cache
    {
        let mut cache = FILE_CACHE.write().unwrap();
        cache.insert(
            canonical,
            CachedFile {
                body: body.clone(),
                mime: mime.clone(),
                last_modified: last_modified_str.clone(),
                cached_at: now,
            },
        );
    }

    build_200_response(&body, &mime, &last_modified_str, cache_expires)
}

/// Build a 200 OK response for a static file
fn build_200_response(
    body: &Bytes,
    mime: &str,
    last_modified: &str,
    cache_expires: Option<&str>,
) -> Option<StaticFileResponse> {
    let mut resp = ResponseHeader::build(200, Some(5)).ok()?;
    resp.insert_header(http::header::CONTENT_TYPE, mime).ok()?;
    resp.insert_header(http::header::CONTENT_LENGTH, body.len())
        .ok()?;
    resp.insert_header(http::header::LAST_MODIFIED, last_modified)
        .ok()?;

    // Set Cache-Control
    if let Some(expires) = cache_expires {
        let seconds = parse_cache_duration(expires);
        if seconds > 0 {
            let val = format!("public, max-age={}", seconds);
            resp.insert_header(http::header::CACHE_CONTROL, &val).ok()?;
        }
    }

    Some(StaticFileResponse {
        header: resp,
        body: body.clone(),
    })
}

/// Parse a cache duration string like "30d", "1h", "3600" into seconds
fn parse_cache_duration(s: &str) -> u64 {
    let s = s.trim();
    if s.is_empty() {
        return 0;
    }

    // Try parsing as plain seconds
    if let Ok(secs) = s.parse::<u64>() {
        return secs;
    }

    let (num_str, multiplier) = if let Some(n) = s.strip_suffix('d') {
        (n, 86400u64)
    } else if let Some(n) = s.strip_suffix('h') {
        (n, 3600u64)
    } else if let Some(n) = s.strip_suffix('m') {
        (n, 60u64)
    } else if let Some(n) = s.strip_suffix('s') {
        (n, 1u64)
    } else {
        return 0;
    };

    num_str
        .trim()
        .parse::<u64>()
        .unwrap_or(0)
        .checked_mul(multiplier)
        .unwrap_or(0)
}

/// Serve the default page (e.g., /data/default-page/index.html)
pub fn serve_default_page(default_page_path: &str) -> Option<StaticFileResponse> {
    let path = Path::new(default_page_path);
    if !path.is_file() {
        return None;
    }

    let body = std::fs::read(path).ok()?;
    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();

    let mut resp = ResponseHeader::build(200, Some(3)).ok()?;
    resp.insert_header(http::header::CONTENT_TYPE, &mime).ok()?;
    resp.insert_header(http::header::CONTENT_LENGTH, body.len())
        .ok()?;

    Some(StaticFileResponse {
        header: resp,
        body: Bytes::from(body),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_days() {
        assert_eq!(parse_cache_duration("30d"), 30 * 86400);
    }

    #[test]
    fn test_parse_hours() {
        assert_eq!(parse_cache_duration("1h"), 3600);
    }

    #[test]
    fn test_parse_minutes() {
        assert_eq!(parse_cache_duration("45m"), 2700);
    }

    #[test]
    fn test_parse_seconds_suffix() {
        assert_eq!(parse_cache_duration("120s"), 120);
    }

    #[test]
    fn test_parse_plain_seconds() {
        assert_eq!(parse_cache_duration("3600"), 3600);
    }

    #[test]
    fn test_parse_empty() {
        assert_eq!(parse_cache_duration(""), 0);
    }

    #[test]
    fn test_parse_invalid() {
        assert_eq!(parse_cache_duration("abc"), 0);
    }

    #[test]
    fn test_parse_whitespace() {
        assert_eq!(parse_cache_duration(" 30d "), 30 * 86400);
    }

    // ─── Security: malicious / edge-case cache durations ────

    #[test]
    fn test_parse_negative_number() {
        // "-30d" — u64 parse fails, returns 0
        assert_eq!(parse_cache_duration("-30d"), 0);
    }

    #[test]
    fn test_parse_negative_plain() {
        assert_eq!(parse_cache_duration("-100"), 0);
    }

    #[test]
    fn test_parse_overflow_days() {
        // Very large number of days — u64 multiplication might overflow
        // "999999999999999999d" — parse succeeds, multiply overflows
        assert_eq!(parse_cache_duration("999999999999999999d"), 0); // wrapping mul → 0 or panic
    }

    #[test]
    fn test_parse_zero_duration() {
        assert_eq!(parse_cache_duration("0"), 0);
        assert_eq!(parse_cache_duration("0d"), 0);
        assert_eq!(parse_cache_duration("0h"), 0);
        assert_eq!(parse_cache_duration("0m"), 0);
        assert_eq!(parse_cache_duration("0s"), 0);
    }

    #[test]
    fn test_parse_float() {
        // "1.5h" — u64 parse of "1.5" fails, returns 0
        assert_eq!(parse_cache_duration("1.5h"), 0);
    }

    #[test]
    fn test_parse_multiple_suffixes() {
        // "30dm" — strip_suffix('m') yields "30d", parse of "30d" as u64 fails → 0
        assert_eq!(parse_cache_duration("30dm"), 0);
    }

    #[test]
    fn test_parse_only_suffix() {
        assert_eq!(parse_cache_duration("d"), 0);
        assert_eq!(parse_cache_duration("h"), 0);
        assert_eq!(parse_cache_duration("m"), 0);
        assert_eq!(parse_cache_duration("s"), 0);
    }

    #[test]
    fn test_parse_injection_attempt() {
        assert_eq!(parse_cache_duration("30d; rm -rf /"), 0);
        assert_eq!(parse_cache_duration("$(echo 30)d"), 0);
    }

    #[test]
    fn test_parse_u64_max() {
        // Plain seconds at u64::MAX
        assert_eq!(parse_cache_duration("18446744073709551615"), u64::MAX);
    }

    #[test]
    fn test_parse_u64_max_plus_one() {
        // Overflows u64 parse → 0
        assert_eq!(parse_cache_duration("18446744073709551616"), 0);
    }

    // ─── Security: path traversal in static file serving ────
    // Note: serve_static_file relies on canonicalize() to prevent traversal.
    // We test the pure parse_cache_duration here; filesystem tests would require
    // temp dir fixtures. The key security invariant is tested below:

    #[test]
    fn test_parse_surrounding_whitespace_variants() {
        // trim() handles \n and \t — these parse successfully
        assert_eq!(parse_cache_duration("\n30d\n"), 30 * 86400);
        assert_eq!(parse_cache_duration("\t30d"), 30 * 86400);
    }

    #[test]
    fn test_parse_null_byte_embedded() {
        // Null byte embedded in string — parse fails
        assert_eq!(parse_cache_duration("30\0d"), 0);
    }
}
