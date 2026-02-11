use bytes::Bytes;
use pingora_http::ResponseHeader;
use std::path::PathBuf;

/// Result of rendering an error page
pub struct ErrorPageResponse {
    pub header: ResponseHeader,
    pub body: Bytes,
}

/// Resolve and serve an error page with cascading lookup:
///   1. host-{host_id}/{code}.html
///   2. group-{group_id}/{code}.html (if group_id is Some)
///   3. global/{code}.html
///   4. Built-in fallback
pub fn serve_error_page(
    error_pages_dir: &str,
    status_code: u16,
    host_id: Option<u64>,
    group_id: Option<u64>,
) -> ErrorPageResponse {
    let code_str = status_code.to_string();

    // Try host-specific error page
    if let Some(hid) = host_id {
        let path = PathBuf::from(error_pages_dir)
            .join(format!("host-{}", hid))
            .join(format!("{}.html", code_str));
        if let Some(resp) = try_serve_error_file(&path, status_code) {
            return resp;
        }
    }

    // Try group-specific error page
    if let Some(gid) = group_id {
        let path = PathBuf::from(error_pages_dir)
            .join(format!("group-{}", gid))
            .join(format!("{}.html", code_str));
        if let Some(resp) = try_serve_error_file(&path, status_code) {
            return resp;
        }
    }

    // Try global error page
    let global_path = PathBuf::from(error_pages_dir)
        .join("global")
        .join(format!("{}.html", code_str));
    if let Some(resp) = try_serve_error_file(&global_path, status_code) {
        return resp;
    }

    // Built-in fallback
    builtin_error_page(status_code)
}

/// Try to read an error page file from disk and build a response
fn try_serve_error_file(path: &PathBuf, status_code: u16) -> Option<ErrorPageResponse> {
    if !path.is_file() {
        return None;
    }

    let body = std::fs::read(path).ok()?;
    let mut resp = ResponseHeader::build(status_code, Some(3)).ok()?;
    resp.insert_header(http::header::CONTENT_TYPE, "text/html; charset=utf-8")
        .ok()?;
    resp.insert_header(http::header::CONTENT_LENGTH, body.len())
        .ok()?;

    Some(ErrorPageResponse {
        header: resp,
        body: Bytes::from(body),
    })
}

/// Generate a minimal built-in error page
fn builtin_error_page(status_code: u16) -> ErrorPageResponse {
    let reason = status_reason(status_code);
    let body = format!(
        "<!DOCTYPE html>\n<html><head><title>{} {}</title></head>\n<body>\n<center><h1>{} {}</h1></center>\n<hr><center>pingora-manager</center>\n</body></html>\n",
        status_code, reason, status_code, reason
    );

    let mut resp = ResponseHeader::build(status_code, Some(3)).unwrap();
    let _ = resp.insert_header(http::header::CONTENT_TYPE, "text/html; charset=utf-8");
    let _ = resp.insert_header(http::header::CONTENT_LENGTH, body.len());

    ErrorPageResponse {
        header: resp,
        body: Bytes::from(body),
    }
}

/// Get a human-readable reason for common HTTP status codes
fn status_reason(code: u16) -> &'static str {
    match code {
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Error",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_reason_known_codes() {
        assert_eq!(status_reason(404), "Not Found");
        assert_eq!(status_reason(502), "Bad Gateway");
        assert_eq!(status_reason(500), "Internal Server Error");
    }

    #[test]
    fn test_status_reason_unknown() {
        assert_eq!(status_reason(418), "Error");
    }

    #[test]
    fn test_builtin_page_contains_code() {
        let resp = builtin_error_page(404);
        let body = String::from_utf8(resp.body.to_vec()).unwrap();
        assert!(body.contains("404"));
        assert!(body.contains("Not Found"));
    }

    #[test]
    fn test_builtin_page_status_code() {
        let resp = builtin_error_page(503);
        assert_eq!(resp.header.status.as_u16(), 503);
    }

    #[test]
    fn test_builtin_page_content_type() {
        let resp = builtin_error_page(500);
        let ct = resp.header.headers.get("content-type").unwrap();
        assert_eq!(ct.to_str().unwrap(), "text/html; charset=utf-8");
    }

    // ─── Security: error page edge cases ────────────────────

    #[test]
    fn test_builtin_page_no_xss_in_status_code() {
        // Status code is numeric so no XSS risk, but verify the body
        // uses the numeric code, not any user-supplied string
        let resp = builtin_error_page(404);
        let body = String::from_utf8(resp.body.to_vec()).unwrap();
        assert!(body.contains("404"));
        assert!(!body.contains("<script>"));
    }

    #[test]
    fn test_builtin_page_all_standard_codes() {
        // Every standard error code produces valid HTML
        for code in [400, 401, 403, 404, 405, 408, 413, 429, 500, 502, 503, 504] {
            let resp = builtin_error_page(code);
            assert_eq!(resp.header.status.as_u16(), code);
            let body = String::from_utf8(resp.body.to_vec()).unwrap();
            assert!(body.starts_with("<!DOCTYPE html>"));
            assert!(body.contains(&code.to_string()));
        }
    }

    #[test]
    fn test_builtin_page_nonstandard_code() {
        // Unusual status codes still produce valid output
        let resp = builtin_error_page(999);
        assert_eq!(resp.header.status.as_u16(), 999);
        let body = String::from_utf8(resp.body.to_vec()).unwrap();
        assert!(body.contains("999"));
        assert!(body.contains("Error"));
    }

    #[test]
    #[should_panic(expected = "invalid status")]
    fn test_builtin_page_zero_status_panics() {
        // Status 0 is not a valid HTTP status — Pingora rejects it
        builtin_error_page(0);
    }

    #[test]
    fn test_builtin_page_content_length_matches_body() {
        let resp = builtin_error_page(502);
        let cl = resp.header.headers.get("content-length").unwrap();
        let cl_val: usize = cl.to_str().unwrap().parse().unwrap();
        assert_eq!(cl_val, resp.body.len());
    }

    #[test]
    fn test_builtin_page_valid_html_structure() {
        let resp = builtin_error_page(403);
        let body = String::from_utf8(resp.body.to_vec()).unwrap();
        assert!(body.contains("<html>"));
        assert!(body.contains("</html>"));
        assert!(body.contains("<title>"));
        assert!(body.contains("</title>"));
        assert!(body.contains("pingora-manager")); // server signature
    }

    #[test]
    fn test_serve_error_page_fallback_to_builtin() {
        // Non-existent error pages dir → falls through to builtin
        let resp = serve_error_page("/tmp/nonexistent-error-pages-dir", 404, Some(1), Some(1));
        assert_eq!(resp.header.status.as_u16(), 404);
        let body = String::from_utf8(resp.body.to_vec()).unwrap();
        assert!(body.contains("404"));
    }
}
