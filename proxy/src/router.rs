use crate::config::{HostConfig, LocationConfig, RedirectConfig};
use regex::Regex;
use std::collections::HashMap;
use std::sync::Arc;

/// Compiled location matcher for efficient routing
#[derive(Debug)]
pub struct CompiledLocation {
    pub index: usize,
    pub match_type: MatchType,
}

#[derive(Debug)]
pub enum MatchType {
    Prefix(String),
    Exact(String),
    Regex(Regex),
}

/// Router resolves domain names to host configs and matches request paths to locations
pub struct Router {
    /// Domain -> HostConfig mapping
    hosts: HashMap<String, Arc<HostConfig>>,
    /// Domain -> RedirectConfig mapping
    redirects: HashMap<String, Arc<RedirectConfig>>,
    /// Host ID -> compiled location matchers
    locations: HashMap<u64, Vec<CompiledLocation>>,
}

impl Router {
    /// Build a new router from host and redirect configs
    pub fn build(hosts: &[HostConfig], redirects: &[RedirectConfig]) -> Self {
        let mut host_map: HashMap<String, Arc<HostConfig>> = HashMap::new();
        let mut location_map: HashMap<u64, Vec<CompiledLocation>> = HashMap::new();

        for host in hosts {
            if !host.enabled {
                continue;
            }
            let host_arc = Arc::new(host.clone());
            for domain in &host.domains {
                let domain_lower = domain.to_lowercase();
                host_map.insert(domain_lower, host_arc.clone());
            }

            // Compile locations for this host
            let mut compiled = Vec::new();
            for (i, loc) in host.locations.iter().enumerate() {
                let match_type = match loc.match_type.as_str() {
                    "exact" => MatchType::Exact(loc.path.clone()),
                    "regex" => match Regex::new(&loc.path) {
                        Ok(re) => MatchType::Regex(re),
                        Err(e) => {
                            log::error!(
                                "Invalid regex '{}' for host {}: {}",
                                loc.path,
                                host.id,
                                e
                            );
                            continue;
                        }
                    },
                    _ => MatchType::Prefix(loc.path.clone()),
                };
                compiled.push(CompiledLocation {
                    index: i,
                    match_type,
                });
            }
            location_map.insert(host.id, compiled);
        }

        let mut redirect_map: HashMap<String, Arc<RedirectConfig>> = HashMap::new();
        for redirect in redirects {
            if !redirect.enabled {
                continue;
            }
            let redirect_arc = Arc::new(redirect.clone());
            for domain in &redirect.domains {
                let domain_lower = domain.to_lowercase();
                redirect_map.insert(domain_lower, redirect_arc.clone());
            }
        }

        Router {
            hosts: host_map,
            redirects: redirect_map,
            locations: location_map,
        }
    }

    /// Resolve a request to a host config and optionally a matched location.
    /// Uses a stack-allocated buffer to avoid heap allocation for lowercase host.
    pub fn resolve<'a>(
        &'a self,
        host: &str,
        path: &str,
    ) -> Option<(&'a HostConfig, Option<&'a LocationConfig>)> {
        let host_name = Self::normalize_host(host);
        let host_config = self.hosts.get(host_name.as_ref())?;
        let location = self.match_location(host_config, path);
        Some((host_config, location))
    }

    /// Look up a redirect config for a given domain
    pub fn resolve_redirect(&self, host: &str) -> Option<&RedirectConfig> {
        let host_name = Self::normalize_host(host);
        self.redirects.get(host_name.as_ref()).map(|arc| arc.as_ref())
    }

    /// Normalize host header: strip port, lowercase.
    /// Returns Cow to avoid allocation when host is already lowercase ASCII.
    fn normalize_host(host: &str) -> std::borrow::Cow<'_, str> {
        let h = host.split(':').next().unwrap_or(host);
        if h.bytes().all(|b| b.is_ascii_lowercase() || !b.is_ascii_alphabetic()) {
            std::borrow::Cow::Borrowed(h)
        } else {
            std::borrow::Cow::Owned(h.to_ascii_lowercase())
        }
    }

    /// Match a path against the compiled locations for a host
    fn match_location<'a>(
        &'a self,
        host_config: &'a HostConfig,
        path: &str,
    ) -> Option<&'a LocationConfig> {
        let compiled = self.locations.get(&host_config.id)?;

        for cl in compiled {
            let matched = match &cl.match_type {
                MatchType::Exact(p) => path == p,
                MatchType::Prefix(p) => path.starts_with(p),
                MatchType::Regex(re) => re.is_match(path),
            };
            if matched {
                return host_config.locations.get(cl.index);
            }
        }

        None
    }

    /// Check if a host has any entry (host or redirect)
    pub fn has_domain(&self, host: &str) -> bool {
        let host_name = Self::normalize_host(host);
        self.hosts.contains_key(host_name.as_ref()) || self.redirects.contains_key(host_name.as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::*;

    fn make_host(id: u64, domains: &[&str], locations: Vec<LocationConfig>, enabled: bool) -> HostConfig {
        HostConfig {
            id,
            domains: domains.iter().map(|s| s.to_string()).collect(),
            group_id: None,
            ssl: None,
            upstreams: vec![UpstreamConfig { server: "127.0.0.1".into(), port: 8080, weight: 1 }],
            balance_method: "round_robin".into(),
            locations,
            hsts: false,
            http2: false,
            enabled,
            access_list_id: None,
        }
    }

    fn make_location(path: &str, match_type: &str) -> LocationConfig {
        LocationConfig {
            path: path.to_string(),
            match_type: match_type.to_string(),
            location_type: Some("proxy".to_string()),
            upstreams: vec![],
            static_dir: None,
            cache_expires: None,
            access_list_id: None,
            balance_method: None,
        }
    }

    fn make_redirect(id: u64, domains: &[&str], enabled: bool) -> RedirectConfig {
        RedirectConfig {
            id,
            domains: domains.iter().map(|s| s.to_string()).collect(),
            forward_scheme: "https".into(),
            forward_domain: "new.example.com".into(),
            forward_path: "/".into(),
            preserve_path: true,
            status_code: 301,
            enabled,
        }
    }

    #[test]
    fn test_resolve_known_domain() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts, &[]);
        let result = router.resolve("example.com", "/");
        assert!(result.is_some());
        assert_eq!(result.unwrap().0.id, 1);
    }

    #[test]
    fn test_resolve_unknown_domain() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts, &[]);
        assert!(router.resolve("unknown.com", "/").is_none());
    }

    #[test]
    fn test_resolve_case_insensitive() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts, &[]);
        assert!(router.resolve("Example.COM", "/").is_some());
    }

    #[test]
    fn test_resolve_strips_port() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts, &[]);
        assert!(router.resolve("example.com:8080", "/").is_some());
    }

    #[test]
    fn test_disabled_host_skipped() {
        let hosts = vec![make_host(1, &["example.com"], vec![], false)];
        let router = Router::build(&hosts, &[]);
        assert!(router.resolve("example.com", "/").is_none());
    }

    #[test]
    fn test_prefix_match() {
        let locs = vec![make_location("/api", "prefix")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts, &[]);
        let (_, loc) = router.resolve("example.com", "/api/users").unwrap();
        assert!(loc.is_some());
        assert_eq!(loc.unwrap().path, "/api");
    }

    #[test]
    fn test_prefix_no_match() {
        let locs = vec![make_location("/api", "prefix")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts, &[]);
        let (_, loc) = router.resolve("example.com", "/other").unwrap();
        assert!(loc.is_none());
    }

    #[test]
    fn test_exact_match() {
        let locs = vec![make_location("/health", "exact")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts, &[]);

        let (_, loc) = router.resolve("example.com", "/health").unwrap();
        assert!(loc.is_some());

        let (_, loc) = router.resolve("example.com", "/health/check").unwrap();
        assert!(loc.is_none());
    }

    #[test]
    fn test_regex_match() {
        let locs = vec![make_location(r"^/files/.*\.pdf$", "regex")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts, &[]);
        let (_, loc) = router.resolve("example.com", "/files/report.pdf").unwrap();
        assert!(loc.is_some());
    }

    #[test]
    fn test_redirect_resolve() {
        let redirects = vec![
            make_redirect(1, &["old.com"], true),
            make_redirect(2, &["disabled.com"], false),
        ];
        let router = Router::build(&[], &redirects);
        assert!(router.resolve_redirect("old.com").is_some());
        assert!(router.resolve_redirect("disabled.com").is_none());
    }

    // ─── Security: host header injection / malformed domains ─

    #[test]
    fn test_empty_host_header() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts, &[]);
        assert!(router.resolve("", "/").is_none());
    }

    #[test]
    fn test_host_with_null_byte() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts, &[]);
        assert!(router.resolve("example.com\0.evil.com", "/").is_none());
    }

    #[test]
    fn test_host_with_path_injection() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts, &[]);
        // Attacker tries to sneak path into Host header
        assert!(router.resolve("example.com/admin", "/").is_none());
    }

    #[test]
    fn test_host_with_at_sign_injection() {
        // e.g. "attacker@example.com" — should not resolve
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts, &[]);
        assert!(router.resolve("attacker@example.com", "/").is_none());
    }

    #[test]
    fn test_host_with_unicode_homoglyph() {
        // Cyrillic 'а' != ASCII 'a' — should not match "example.com"
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts, &[]);
        assert!(router.resolve("exаmple.com", "/").is_none()); // 'а' is U+0430
    }

    #[test]
    fn test_host_only_port() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts, &[]);
        // ":8080" — split(':').next() yields "" which won't match
        assert!(router.resolve(":8080", "/").is_none());
    }

    #[test]
    fn test_host_multiple_colons() {
        // "example.com:80:extra" — split(':').next() yields "example.com"
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts, &[]);
        assert!(router.resolve("example.com:80:extra", "/").is_some());
    }

    // ─── Security: path traversal / malicious paths ─────────

    #[test]
    fn test_path_traversal_in_prefix_match() {
        let locs = vec![make_location("/api", "prefix")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts, &[]);
        // "/api/../admin" starts with "/api" so prefix matches — the upstream
        // must handle path normalization, but the router matches correctly
        let (_, loc) = router.resolve("example.com", "/api/../admin").unwrap();
        assert!(loc.is_some()); // Prefix "/api" matches, as expected
    }

    #[test]
    fn test_exact_match_rejects_traversal() {
        let locs = vec![make_location("/health", "exact")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts, &[]);
        let (_, loc) = router.resolve("example.com", "/health/../secret").unwrap();
        assert!(loc.is_none()); // Exact match requires exact path
    }

    #[test]
    fn test_regex_catastrophic_backtracking_resilience() {
        // Even with a complex path, a well-formed regex should complete fast
        let locs = vec![make_location(r"^/files/\d+$", "regex")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts, &[]);
        let long_path = format!("/files/{}", "1".repeat(10000));
        let (_, loc) = router.resolve("example.com", &long_path).unwrap();
        assert!(loc.is_some());
    }

    #[test]
    fn test_invalid_regex_is_skipped() {
        // Invalid regex should not panic — the location is skipped
        let locs = vec![make_location("[invalid", "regex")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts, &[]);
        let (_, loc) = router.resolve("example.com", "/anything").unwrap();
        assert!(loc.is_none());
    }

    #[test]
    fn test_empty_path() {
        let locs = vec![make_location("/", "prefix")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts, &[]);
        let (_, loc) = router.resolve("example.com", "").unwrap();
        assert!(loc.is_none()); // Empty string doesn't start with "/"
    }

    #[test]
    fn test_null_bytes_in_path() {
        let locs = vec![make_location("/api", "prefix")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts, &[]);
        let (_, loc) = router.resolve("example.com", "/api\0/admin").unwrap();
        // Prefix "/api" still matches the beginning
        assert!(loc.is_some());
    }

    // ─── Security: duplicate domains / domain conflicts ─────

    #[test]
    fn test_duplicate_domain_last_wins() {
        // If two hosts claim the same domain, the last one in the list wins
        let hosts = vec![
            make_host(1, &["dup.com"], vec![], true),
            make_host(2, &["dup.com"], vec![], true),
        ];
        let router = Router::build(&hosts, &[]);
        let (host, _) = router.resolve("dup.com", "/").unwrap();
        assert_eq!(host.id, 2);
    }

    #[test]
    fn test_host_and_redirect_same_domain() {
        // Host should take priority (resolve returns host, redirect is separate)
        let hosts = vec![make_host(1, &["clash.com"], vec![], true)];
        let redirects = vec![make_redirect(1, &["clash.com"], true)];
        let router = Router::build(&hosts, &redirects);
        assert!(router.resolve("clash.com", "/").is_some());
        assert!(router.resolve_redirect("clash.com").is_some());
    }

    #[test]
    fn test_has_domain_with_empty_router() {
        let router = Router::build(&[], &[]);
        assert!(!router.has_domain("anything.com"));
    }

    #[test]
    fn test_very_long_domain() {
        let long_domain = format!("{}.com", "a".repeat(1000));
        let hosts = vec![make_host(1, &[&long_domain], vec![], true)];
        let router = Router::build(&hosts, &[]);
        assert!(router.resolve(&long_domain, "/").is_some());
    }
}
