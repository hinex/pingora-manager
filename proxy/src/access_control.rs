use crate::config::{AccessListConfig, ParsedCidr};
use std::net::IpAddr;

/// Result of access control check
#[derive(Debug)]
pub enum AccessResult {
    /// Access is allowed
    Allowed,
    /// Access is denied (403)
    Denied,
    /// Authentication required (401)
    AuthRequired,
}

/// Check access control for a request.
///
/// Evaluates IP rules and Basic Auth credentials against the access list.
/// Respects the `satisfy` mode:
/// - "any": access is granted if EITHER IP rules pass OR auth passes
/// - "all": access is granted only if BOTH IP rules pass AND auth passes
pub fn check_access(
    access_list: &AccessListConfig,
    client_ip: Option<&IpAddr>,
    auth_header: Option<&str>,
) -> AccessResult {
    let ip_ok = check_ip_access(access_list, client_ip);
    let auth_ok = check_auth_access(access_list, auth_header);

    match access_list.satisfy.as_str() {
        "all" => {
            // Both must pass
            if !ip_ok {
                return AccessResult::Denied;
            }
            if !access_list.auth.is_empty() && !auth_ok {
                return AccessResult::AuthRequired;
            }
            AccessResult::Allowed
        }
        _ => {
            // "any" - either one passing is sufficient
            if access_list.clients.is_empty() && access_list.auth.is_empty() {
                return AccessResult::Allowed;
            }
            if ip_ok && !access_list.clients.is_empty() {
                return AccessResult::Allowed;
            }
            if auth_ok && !access_list.auth.is_empty() {
                return AccessResult::Allowed;
            }
            // Neither passed
            if !access_list.auth.is_empty() {
                AccessResult::AuthRequired
            } else {
                AccessResult::Denied
            }
        }
    }
}

/// Check IP against the client rules in the access list.
/// Returns true if the IP is allowed (or if there are no client rules).
fn check_ip_access(access_list: &AccessListConfig, client_ip: Option<&IpAddr>) -> bool {
    if access_list.clients.is_empty() {
        return true;
    }

    let ip = match client_ip {
        Some(ip) => ip,
        None => return false,
    };

    // Evaluate rules in order. Last matching rule wins (like nginx).
    let mut result = false; // default deny if there are rules
    for client in &access_list.clients {
        // Use pre-parsed CIDR for zero-parse matching, fall back to string parsing
        let matched = if let Some(ref parsed) = client.parsed_cidr {
            ip_matches_parsed(ip, parsed)
        } else {
            ip_matches_cidr(ip, &client.address)
        };
        if matched {
            result = client.directive == "allow";
        }
    }
    result
}

/// Fast CIDR matching using pre-parsed IP and prefix length (zero parsing at request time)
fn ip_matches_parsed(client_ip: &IpAddr, parsed: &ParsedCidr) -> bool {
    match (client_ip, &parsed.ip) {
        (IpAddr::V4(client), IpAddr::V4(network)) => {
            if parsed.prefix_len > 32 {
                return false;
            }
            if parsed.prefix_len == 0 {
                return true;
            }
            let mask = u32::MAX.checked_shl(32 - parsed.prefix_len).unwrap_or(0);
            (u32::from(*client) & mask) == (u32::from(*network) & mask)
        }
        (IpAddr::V6(client), IpAddr::V6(network)) => {
            if parsed.prefix_len > 128 {
                return false;
            }
            if parsed.prefix_len == 0 {
                return true;
            }
            let mask = u128::MAX.checked_shl(128 - parsed.prefix_len).unwrap_or(0);
            (u128::from(*client) & mask) == (u128::from(*network) & mask)
        }
        _ => false,
    }
}

/// Check whether a given IP matches a CIDR notation address.
/// Supports single IPs (e.g., "192.168.1.1") and CIDR ranges (e.g., "192.168.1.0/24").
fn ip_matches_cidr(ip: &IpAddr, cidr: &str) -> bool {
    // Handle "all" special keyword
    if cidr == "all" {
        return true;
    }

    if let Some((network_str, prefix_str)) = cidr.split_once('/') {
        // CIDR notation
        let network_ip: IpAddr = match network_str.parse() {
            Ok(ip) => ip,
            Err(_) => return false,
        };
        let prefix_len: u32 = match prefix_str.parse() {
            Ok(p) => p,
            Err(_) => return false,
        };

        match (ip, &network_ip) {
            (IpAddr::V4(client), IpAddr::V4(network)) => {
                if prefix_len > 32 {
                    return false;
                }
                if prefix_len == 0 {
                    return true;
                }
                let mask = u32::MAX.checked_shl(32 - prefix_len).unwrap_or(0);
                let client_bits = u32::from(*client);
                let network_bits = u32::from(*network);
                (client_bits & mask) == (network_bits & mask)
            }
            (IpAddr::V6(client), IpAddr::V6(network)) => {
                if prefix_len > 128 {
                    return false;
                }
                if prefix_len == 0 {
                    return true;
                }
                let mask = u128::MAX.checked_shl(128 - prefix_len).unwrap_or(0);
                let client_bits = u128::from(*client);
                let network_bits = u128::from(*network);
                (client_bits & mask) == (network_bits & mask)
            }
            _ => false, // Mismatched IP versions
        }
    } else {
        // Single IP
        match cidr.parse::<IpAddr>() {
            Ok(addr) => ip == &addr,
            Err(_) => false,
        }
    }
}

/// Check Basic Auth credentials against the access list.
/// Returns true if auth passes (or if there are no auth entries).
fn check_auth_access(access_list: &AccessListConfig, auth_header: Option<&str>) -> bool {
    if access_list.auth.is_empty() {
        return true;
    }

    let header = match auth_header {
        Some(h) => h,
        None => return false,
    };

    // Parse "Basic <base64>" header
    let encoded = match header.strip_prefix("Basic ") {
        Some(e) => e,
        None => return false,
    };

    let decoded = match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
    {
        Ok(d) => d,
        Err(_) => return false,
    };

    let credentials = match String::from_utf8(decoded) {
        Ok(c) => c,
        Err(_) => return false,
    };

    let (username, password) = match credentials.split_once(':') {
        Some((u, p)) => (u, p),
        None => return false,
    };

    // Check against all auth entries
    for entry in &access_list.auth {
        if entry.username == username {
            // The password in config may be:
            // 1. A plain text password (simple comparison)
            // 2. An htpasswd-style hash (we do a simple comparison for now)
            // In production, you would use bcrypt/argon2 verification
            if entry.password == password {
                return true;
            }
            // Try htpasswd-style: if the stored password starts with $,
            // it might be a hash. For simplicity, we just compare directly.
            // A real implementation would use a proper password verification library.
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AccessListAuthEntry, AccessListClient, AccessListConfig};

    fn make_acl(
        satisfy: &str,
        clients: Vec<(&str, &str)>,
        auth: Vec<(&str, &str)>,
    ) -> AccessListConfig {
        AccessListConfig {
            id: 1,
            name: "test".to_string(),
            satisfy: satisfy.to_string(),
            clients: clients
                .into_iter()
                .map(|(addr, dir)| AccessListClient {
                    address: addr.to_string(),
                    directive: dir.to_string(),
                    parsed_cidr: None,
                })
                .collect(),
            auth: auth
                .into_iter()
                .map(|(u, p)| AccessListAuthEntry {
                    username: u.to_string(),
                    password: p.to_string(),
                })
                .collect(),
        }
    }

    fn basic_auth(user: &str, pass: &str) -> String {
        use base64::Engine;
        let encoded =
            base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", user, pass));
        format!("Basic {}", encoded)
    }

    // ─── ip_matches_cidr ─────────────────────────────────────

    #[test]
    fn test_ipv4_exact_match() {
        let ip: IpAddr = "192.168.1.1".parse().unwrap();
        assert!(ip_matches_cidr(&ip, "192.168.1.1"));
    }

    #[test]
    fn test_ipv4_exact_no_match() {
        let ip: IpAddr = "192.168.1.2".parse().unwrap();
        assert!(!ip_matches_cidr(&ip, "192.168.1.1"));
    }

    #[test]
    fn test_ipv4_cidr_24_match() {
        let ip: IpAddr = "192.168.1.55".parse().unwrap();
        assert!(ip_matches_cidr(&ip, "192.168.1.0/24"));
    }

    #[test]
    fn test_ipv4_cidr_24_no_match() {
        let ip: IpAddr = "192.168.2.1".parse().unwrap();
        assert!(!ip_matches_cidr(&ip, "192.168.1.0/24"));
    }

    #[test]
    fn test_ipv4_cidr_32() {
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        assert!(ip_matches_cidr(&ip, "10.0.0.1/32"));
        assert!(!ip_matches_cidr(&ip, "10.0.0.2/32"));
    }

    #[test]
    fn test_ipv4_cidr_0_matches_all() {
        let ip: IpAddr = "8.8.8.8".parse().unwrap();
        assert!(ip_matches_cidr(&ip, "0.0.0.0/0"));
    }

    #[test]
    fn test_ipv6_cidr_match() {
        let ip: IpAddr = "::1".parse().unwrap();
        assert!(ip_matches_cidr(&ip, "::1/128"));
    }

    #[test]
    fn test_all_keyword() {
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        assert!(ip_matches_cidr(&ip, "all"));
    }

    // ─── check_auth_access ───────────────────────────────────

    #[test]
    fn test_basic_auth_valid() {
        let acl = make_acl("any", vec![], vec![("user", "pass")]);
        let header = basic_auth("user", "pass");
        assert!(check_auth_access(&acl, Some(&header)));
    }

    #[test]
    fn test_basic_auth_invalid_password() {
        let acl = make_acl("any", vec![], vec![("user", "pass")]);
        let header = basic_auth("user", "wrong");
        assert!(!check_auth_access(&acl, Some(&header)));
    }

    #[test]
    fn test_basic_auth_no_header() {
        let acl = make_acl("any", vec![], vec![("user", "pass")]);
        assert!(!check_auth_access(&acl, None));
    }

    // ─── check_access (satisfy logic) ────────────────────────

    #[test]
    fn test_satisfy_any_ip_allowed() {
        let acl = make_acl("any", vec![("192.168.1.0/24", "allow")], vec![("u", "p")]);
        let ip: IpAddr = "192.168.1.10".parse().unwrap();
        assert!(matches!(
            check_access(&acl, Some(&ip), None),
            AccessResult::Allowed
        ));
    }

    #[test]
    fn test_satisfy_any_auth_allowed() {
        let acl = make_acl("any", vec![("10.0.0.0/8", "allow")], vec![("u", "p")]);
        let ip: IpAddr = "192.168.1.10".parse().unwrap();
        let header = basic_auth("u", "p");
        assert!(matches!(
            check_access(&acl, Some(&ip), Some(&header)),
            AccessResult::Allowed
        ));
    }

    #[test]
    fn test_satisfy_all_both_required() {
        let acl = make_acl("all", vec![("0.0.0.0/0", "allow")], vec![("u", "p")]);
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        assert!(matches!(
            check_access(&acl, Some(&ip), None),
            AccessResult::AuthRequired
        ));
    }

    #[test]
    fn test_satisfy_all_both_pass() {
        let acl = make_acl("all", vec![("0.0.0.0/0", "allow")], vec![("u", "p")]);
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        let header = basic_auth("u", "p");
        assert!(matches!(
            check_access(&acl, Some(&ip), Some(&header)),
            AccessResult::Allowed
        ));
    }

    // ─── Security: malformed / malicious CIDR inputs ────────

    #[test]
    fn test_cidr_invalid_network_address() {
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        assert!(!ip_matches_cidr(&ip, "not-an-ip/24"));
    }

    #[test]
    fn test_cidr_invalid_prefix_length() {
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        assert!(!ip_matches_cidr(&ip, "10.0.0.0/abc"));
    }

    #[test]
    fn test_cidr_prefix_too_large_ipv4() {
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        assert!(!ip_matches_cidr(&ip, "10.0.0.0/33"));
    }

    #[test]
    fn test_cidr_prefix_too_large_ipv6() {
        let ip: IpAddr = "::1".parse().unwrap();
        assert!(!ip_matches_cidr(&ip, "::0/129"));
    }

    #[test]
    fn test_cidr_ipv4_vs_ipv6_mismatch() {
        let ipv4: IpAddr = "10.0.0.1".parse().unwrap();
        assert!(!ip_matches_cidr(&ipv4, "::0/0"));
        let ipv6: IpAddr = "::1".parse().unwrap();
        assert!(!ip_matches_cidr(&ipv6, "0.0.0.0/0"));
    }

    #[test]
    fn test_cidr_empty_string() {
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        assert!(!ip_matches_cidr(&ip, ""));
    }

    #[test]
    fn test_cidr_garbage_input() {
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        assert!(!ip_matches_cidr(&ip, "../../etc/passwd"));
        assert!(!ip_matches_cidr(&ip, "<script>alert(1)</script>"));
        assert!(!ip_matches_cidr(&ip, "10.0.0.0/24; DROP TABLE"));
    }

    #[test]
    fn test_cidr_double_slash() {
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        // "10.0.0.0/24/8" — split_once('/') yields ("10.0.0.0", "24/8"), prefix "24/8" fails parse
        assert!(!ip_matches_cidr(&ip, "10.0.0.0/24/8"));
    }

    #[test]
    fn test_cidr_negative_prefix() {
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        // u32 parse of "-1" fails → returns false
        assert!(!ip_matches_cidr(&ip, "10.0.0.0/-1"));
    }

    // ─── Security: malformed Basic Auth headers ─────────────

    #[test]
    fn test_auth_bearer_instead_of_basic() {
        let acl = make_acl("any", vec![], vec![("user", "pass")]);
        assert!(!check_auth_access(&acl, Some("Bearer some-jwt-token")));
    }

    #[test]
    fn test_auth_empty_basic_header() {
        let acl = make_acl("any", vec![], vec![("user", "pass")]);
        assert!(!check_auth_access(&acl, Some("Basic ")));
    }

    #[test]
    fn test_auth_invalid_base64() {
        let acl = make_acl("any", vec![], vec![("user", "pass")]);
        assert!(!check_auth_access(&acl, Some("Basic !!!not-base64!!!")));
    }

    #[test]
    fn test_auth_base64_no_colon() {
        // "userpass" without colon separator
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode("userpass");
        let acl = make_acl("any", vec![], vec![("user", "pass")]);
        assert!(!check_auth_access(&acl, Some(&format!("Basic {}", encoded))));
    }

    #[test]
    fn test_auth_password_with_colons() {
        // Password "p:a:s:s" — split_once(':') should yield ("user", "p:a:s:s")
        let acl = make_acl("any", vec![], vec![("user", "p:a:s:s")]);
        let header = basic_auth("user", "p:a:s:s");
        assert!(check_auth_access(&acl, Some(&header)));
    }

    #[test]
    fn test_auth_empty_username_and_password() {
        let acl = make_acl("any", vec![], vec![("", "")]);
        let header = basic_auth("", "");
        assert!(check_auth_access(&acl, Some(&header)));
    }

    #[test]
    fn test_auth_unicode_credentials() {
        let acl = make_acl("any", vec![], vec![("юзер", "пароль")]);
        let header = basic_auth("юзер", "пароль");
        assert!(check_auth_access(&acl, Some(&header)));
    }

    #[test]
    fn test_auth_non_utf8_base64() {
        use base64::Engine;
        // Encode raw bytes that are not valid UTF-8
        let bad_bytes: &[u8] = &[0xff, 0xfe, 0x3a, 0xff]; // invalid UTF-8 with colon
        let encoded = base64::engine::general_purpose::STANDARD.encode(bad_bytes);
        let acl = make_acl("any", vec![], vec![("user", "pass")]);
        assert!(!check_auth_access(&acl, Some(&format!("Basic {}", encoded))));
    }

    #[test]
    fn test_auth_case_sensitive_header_prefix() {
        // "basic " lowercase should not match "Basic "
        let acl = make_acl("any", vec![], vec![("user", "pass")]);
        let header = basic_auth("user", "pass").replace("Basic ", "basic ");
        assert!(!check_auth_access(&acl, Some(&header)));
    }

    #[test]
    fn test_auth_username_injection_attempt() {
        let acl = make_acl("any", vec![], vec![("admin", "secret")]);
        // Try injecting a different username via extra colons
        let header = basic_auth("admin:fake", "secret");
        // split_once(':') yields ("admin", "fake:secret") — password won't match
        assert!(!check_auth_access(&acl, Some(&header)));
    }

    // ─── Security: access control logic edge cases ──────────

    #[test]
    fn test_no_client_ip_with_ip_rules() {
        // If client_ip is None but there are IP rules, should deny
        let acl = make_acl("any", vec![("10.0.0.0/8", "allow")], vec![]);
        assert!(matches!(
            check_access(&acl, None, None),
            AccessResult::Denied
        ));
    }

    #[test]
    fn test_satisfy_any_neither_passes() {
        let acl = make_acl("any", vec![("10.0.0.0/8", "allow")], vec![("u", "p")]);
        let ip: IpAddr = "192.168.1.1".parse().unwrap();
        let bad_auth = basic_auth("u", "wrong");
        assert!(matches!(
            check_access(&acl, Some(&ip), Some(&bad_auth)),
            AccessResult::AuthRequired
        ));
    }

    #[test]
    fn test_satisfy_all_ip_denied() {
        let acl = make_acl("all", vec![("10.0.0.0/8", "allow")], vec![("u", "p")]);
        let ip: IpAddr = "192.168.1.1".parse().unwrap();
        let header = basic_auth("u", "p");
        // IP doesn't match → Denied even though auth passes
        assert!(matches!(
            check_access(&acl, Some(&ip), Some(&header)),
            AccessResult::Denied
        ));
    }

    #[test]
    fn test_deny_rule_overrides_allow() {
        // "allow all" then "deny 10.0.0.0/8" — last matching rule wins
        let acl = make_acl(
            "any",
            vec![("all", "allow"), ("10.0.0.0/8", "deny")],
            vec![],
        );
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        assert!(matches!(
            check_access(&acl, Some(&ip), None),
            AccessResult::Denied
        ));
    }

    #[test]
    fn test_allow_after_deny() {
        // "deny all" then "allow 10.0.0.0/8" — last matching rule wins
        let acl = make_acl(
            "any",
            vec![("all", "deny"), ("10.0.0.1/32", "allow")],
            vec![],
        );
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        assert!(matches!(
            check_access(&acl, Some(&ip), None),
            AccessResult::Allowed
        ));
    }

    #[test]
    fn test_empty_acl_allows_all() {
        // No clients, no auth → "any" mode should allow
        let acl = make_acl("any", vec![], vec![]);
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        assert!(matches!(
            check_access(&acl, Some(&ip), None),
            AccessResult::Allowed
        ));
    }
}
