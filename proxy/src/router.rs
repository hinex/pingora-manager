use crate::config::{HostConfig, LocationConfig};
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
    /// Host ID -> compiled location matchers
    locations: HashMap<u64, Vec<CompiledLocation>>,
}

impl Router {
    /// Build a new router from host configs
    pub fn build(hosts: &[HostConfig]) -> Self {
        let mut host_map: HashMap<String, Arc<HostConfig>> = HashMap::new();
        let mut location_map: HashMap<u64, Vec<CompiledLocation>> = HashMap::new();

        for host in hosts {
            if !host.enabled {
                continue;
            }
            let host_arc = Arc::new(host.clone());
            for domain in &host.domains {
                let domain_lower = domain.to_lowercase();
                host_map.insert(domain_lower.clone(), host_arc.clone());
                // Auto-register www.{domain} for redirect_www hosts
                if host.redirect_www && !domain_lower.starts_with("www.") {
                    host_map.insert(format!("www.{}", domain_lower), host_arc.clone());
                }
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
            // Sort by specificity: exact first, then prefix by longest path, then regex
            compiled.sort_by(|a, b| {
                fn priority(m: &MatchType) -> (u8, usize) {
                    match m {
                        MatchType::Exact(p) => (0, usize::MAX - p.len()),
                        MatchType::Prefix(p) => (1, usize::MAX - p.len()),
                        MatchType::Regex(_) => (2, 0),
                    }
                }
                priority(&a.match_type).cmp(&priority(&b.match_type))
            });
            location_map.insert(host.id, compiled);
        }

        Router {
            hosts: host_map,
            locations: location_map,
        }
    }

    /// Resolve a request to a host config and optionally a matched location with its index.
    pub fn resolve<'a>(
        &'a self,
        host: &str,
        path: &str,
    ) -> Option<(&'a HostConfig, Option<&'a LocationConfig>, Option<usize>)> {
        let host_name = Self::normalize_host(host);
        let host_config = self.hosts.get(host_name.as_ref())?;
        let (location, loc_idx) = self.match_location(host_config, path);
        Some((host_config, location, loc_idx))
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

    /// Match a path against the compiled locations for a host.
    /// Returns the matched location and its index (eliminates ptr::eq scan in resolve_request).
    fn match_location<'a>(
        &'a self,
        host_config: &'a HostConfig,
        path: &str,
    ) -> (Option<&'a LocationConfig>, Option<usize>) {
        let compiled = match self.locations.get(&host_config.id) {
            Some(c) => c,
            None => return (None, None),
        };

        for cl in compiled {
            let matched = match &cl.match_type {
                MatchType::Exact(p) => path == p,
                MatchType::Prefix(p) => path.starts_with(p),
                MatchType::Regex(re) => re.is_match(path),
            };
            if matched {
                return (host_config.locations.get(cl.index), Some(cl.index));
            }
        }

        (None, None)
    }

    /// Check if a host has any entry
    #[allow(dead_code)] // public API, tested
    pub fn has_domain(&self, host: &str) -> bool {
        let host_name = Self::normalize_host(host);
        self.hosts.contains_key(host_name.as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::*;
    use std::collections::HashMap;

    fn make_host(id: u64, domains: &[&str], locations: Vec<LocationConfig>, enabled: bool) -> HostConfig {
        HostConfig {
            id,
            domains: domains.iter().map(|s| s.to_string()).collect(),
            group_id: None,
            ssl: None,
            locations,
            stream_ports: vec![],
            hsts: false,
            http2: false,
            enabled,
            compression: true,
            redirect_www: false,
        }
    }

    fn make_location(path: &str, match_type: &str) -> LocationConfig {
        LocationConfig {
            path: path.to_string(),
            match_type: match_type.to_string(),
            location_type: Some("proxy".to_string()),
            upstreams: vec![],
            balance_method: "round_robin".to_string(),
            static_dir: None,
            cache_expires: None,
            forward_scheme: None,
            forward_domain: None,
            forward_path: None,
            preserve_path: false,
            status_code: None,
            headers: HashMap::new(),
            access_list_id: None,
            compiled_headers: Vec::new(),
        }
    }

    #[test]
    fn test_resolve_known_domain() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts);
        let result = router.resolve("example.com", "/");
        assert!(result.is_some());
        assert_eq!(result.unwrap().0.id, 1);
    }

    #[test]
    fn test_resolve_unknown_domain() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts);
        assert!(router.resolve("unknown.com", "/").is_none());
    }

    #[test]
    fn test_resolve_case_insensitive() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts);
        assert!(router.resolve("Example.COM", "/").is_some());
    }

    #[test]
    fn test_resolve_strips_port() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts);
        assert!(router.resolve("example.com:8080", "/").is_some());
    }

    #[test]
    fn test_disabled_host_skipped() {
        let hosts = vec![make_host(1, &["example.com"], vec![], false)];
        let router = Router::build(&hosts);
        assert!(router.resolve("example.com", "/").is_none());
    }

    #[test]
    fn test_longer_prefix_wins_over_root() {
        // "/" is first in array, but "/api" should win for /api/users
        let locs = vec![
            make_location("/", "prefix"),
            make_location("/api", "prefix"),
        ];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts);

        let (_, loc, _) = router.resolve("example.com", "/api/users").unwrap();
        assert!(loc.is_some());
        assert_eq!(loc.unwrap().path, "/api");

        // "/" should still match for non-api paths
        let (_, loc, _) = router.resolve("example.com", "/about").unwrap();
        assert!(loc.is_some());
        assert_eq!(loc.unwrap().path, "/");
    }

    #[test]
    fn test_exact_wins_over_prefix() {
        let locs = vec![
            make_location("/api", "prefix"),
            make_location("/api", "exact"),
        ];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts);

        // exact "/api" should win
        let (_, loc, _) = router.resolve("example.com", "/api").unwrap();
        assert!(loc.is_some());
        assert_eq!(loc.unwrap().match_type, "exact");

        // "/api/users" should NOT match exact, falls through to prefix
        let (_, loc, _) = router.resolve("example.com", "/api/users").unwrap();
        assert!(loc.is_some());
        assert_eq!(loc.unwrap().match_type, "prefix");
    }

    #[test]
    fn test_prefix_match() {
        let locs = vec![make_location("/api", "prefix")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts);
        let (_, loc, _) = router.resolve("example.com", "/api/users").unwrap();
        assert!(loc.is_some());
        assert_eq!(loc.unwrap().path, "/api");
    }

    #[test]
    fn test_prefix_no_match() {
        let locs = vec![make_location("/api", "prefix")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts);
        let (_, loc, _) = router.resolve("example.com", "/other").unwrap();
        assert!(loc.is_none());
    }

    #[test]
    fn test_exact_match() {
        let locs = vec![make_location("/health", "exact")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts);

        let (_, loc, _) = router.resolve("example.com", "/health").unwrap();
        assert!(loc.is_some());

        let (_, loc, _) = router.resolve("example.com", "/health/check").unwrap();
        assert!(loc.is_none());
    }

    #[test]
    fn test_regex_match() {
        let locs = vec![make_location(r"^/files/.*\.pdf$", "regex")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts);
        let (_, loc, _) = router.resolve("example.com", "/files/report.pdf").unwrap();
        assert!(loc.is_some());
    }

    // ─── Security: host header injection / malformed domains ─

    #[test]
    fn test_empty_host_header() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts);
        assert!(router.resolve("", "/").is_none());
    }

    #[test]
    fn test_host_with_null_byte() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts);
        assert!(router.resolve("example.com\0.evil.com", "/").is_none());
    }

    #[test]
    fn test_host_with_path_injection() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts);
        assert!(router.resolve("example.com/admin", "/").is_none());
    }

    #[test]
    fn test_host_with_at_sign_injection() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts);
        assert!(router.resolve("attacker@example.com", "/").is_none());
    }

    #[test]
    fn test_host_with_unicode_homoglyph() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts);
        assert!(router.resolve("exаmple.com", "/").is_none()); // 'а' is U+0430
    }

    #[test]
    fn test_host_only_port() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts);
        assert!(router.resolve(":8080", "/").is_none());
    }

    #[test]
    fn test_host_multiple_colons() {
        let hosts = vec![make_host(1, &["example.com"], vec![], true)];
        let router = Router::build(&hosts);
        assert!(router.resolve("example.com:80:extra", "/").is_some());
    }

    // ─── Security: path traversal / malicious paths ─────────

    #[test]
    fn test_path_traversal_in_prefix_match() {
        let locs = vec![make_location("/api", "prefix")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts);
        let (_, loc, _) = router.resolve("example.com", "/api/../admin").unwrap();
        assert!(loc.is_some());
    }

    #[test]
    fn test_exact_match_rejects_traversal() {
        let locs = vec![make_location("/health", "exact")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts);
        let (_, loc, _) = router.resolve("example.com", "/health/../secret").unwrap();
        assert!(loc.is_none());
    }

    #[test]
    fn test_regex_catastrophic_backtracking_resilience() {
        let locs = vec![make_location(r"^/files/\d+$", "regex")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts);
        let long_path = format!("/files/{}", "1".repeat(10000));
        let (_, loc, _) = router.resolve("example.com", &long_path).unwrap();
        assert!(loc.is_some());
    }

    #[test]
    fn test_invalid_regex_is_skipped() {
        let locs = vec![make_location("[invalid", "regex")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts);
        let (_, loc, _) = router.resolve("example.com", "/anything").unwrap();
        assert!(loc.is_none());
    }

    #[test]
    fn test_empty_path() {
        let locs = vec![make_location("/", "prefix")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts);
        let (_, loc, _) = router.resolve("example.com", "").unwrap();
        assert!(loc.is_none());
    }

    #[test]
    fn test_null_bytes_in_path() {
        let locs = vec![make_location("/api", "prefix")];
        let hosts = vec![make_host(1, &["example.com"], locs, true)];
        let router = Router::build(&hosts);
        let (_, loc, _) = router.resolve("example.com", "/api\0/admin").unwrap();
        assert!(loc.is_some());
    }

    // ─── Security: duplicate domains / domain conflicts ─────

    #[test]
    fn test_duplicate_domain_last_wins() {
        let hosts = vec![
            make_host(1, &["dup.com"], vec![], true),
            make_host(2, &["dup.com"], vec![], true),
        ];
        let router = Router::build(&hosts);
        let (host, _, _) = router.resolve("dup.com", "/").unwrap();
        assert_eq!(host.id, 2);
    }

    #[test]
    fn test_has_domain_with_empty_router() {
        let router = Router::build(&[]);
        assert!(!router.has_domain("anything.com"));
    }

    #[test]
    fn test_very_long_domain() {
        let long_domain = format!("{}.com", "a".repeat(1000));
        let hosts = vec![make_host(1, &[&long_domain], vec![], true)];
        let router = Router::build(&hosts);
        assert!(router.resolve(&long_domain, "/").is_some());
    }
}
