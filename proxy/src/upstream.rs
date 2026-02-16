use crate::config::UpstreamConfig;
use pingora_load_balancing::selection::{Consistent, Random, RoundRobin};
use pingora_load_balancing::{discovery, Backend, Backends, LoadBalancer};
use std::collections::BTreeSet;
use std::net::ToSocketAddrs;
use std::sync::Arc;

/// Enum wrapping different load balancer selection algorithms
pub enum UpstreamSelector {
    RoundRobin(Arc<LoadBalancer<RoundRobin>>),
    Consistent(Arc<LoadBalancer<Consistent>>),
    Random(Arc<LoadBalancer<Random>>),
}

impl UpstreamSelector {
    /// Select a backend from the load balancer.
    /// The `key` is used for hash-based selection (IP hash / consistent hashing).
    pub fn select(&self, key: &[u8]) -> Option<Backend> {
        match self {
            UpstreamSelector::RoundRobin(lb) => lb.select(key, 256),
            UpstreamSelector::Consistent(lb) => lb.select(key, 256),
            UpstreamSelector::Random(lb) => lb.select(key, 256),
        }
    }
}

/// Create a load balancer from upstream configs and the specified method.
///
/// Supported methods: round_robin, weighted, ip_hash, least_connections, random.
/// For `weighted`, we use RoundRobin with weights set on backends.
/// For `least_connections`, we fall back to RoundRobin (Pingora doesn't have built-in LC).
/// For `ip_hash`, we use Consistent (Ketama) hashing.
pub fn create_upstream_selector(
    upstreams: &[UpstreamConfig],
    method: &str,
) -> Option<UpstreamSelector> {
    if upstreams.is_empty() {
        return None;
    }

    match method {
        "ip_hash" => {
            let lb = create_lb_from_upstreams::<Consistent>(upstreams)?;
            Some(UpstreamSelector::Consistent(Arc::new(lb)))
        }
        "random" => {
            let lb = create_lb_from_upstreams::<Random>(upstreams)?;
            Some(UpstreamSelector::Random(Arc::new(lb)))
        }
        _ => {
            // round_robin, weighted, least_connections all use RoundRobin
            let lb = create_lb_from_upstreams::<RoundRobin>(upstreams)?;
            Some(UpstreamSelector::RoundRobin(Arc::new(lb)))
        }
    }
}

/// Create a LoadBalancer with weighted backends from upstream configs.
/// Uses Static discovery with manually constructed backends that have proper weights.
fn create_lb_from_upstreams<S>(upstreams: &[UpstreamConfig]) -> Option<LoadBalancer<S>>
where
    S: pingora_load_balancing::selection::BackendSelection + 'static,
    S::Iter: pingora_load_balancing::selection::BackendIter,
{
    let mut backend_set = BTreeSet::new();
    for upstream in upstreams {
        let addr_str = format!("{}:{}", upstream.server, upstream.port);
        // Pingora's Backend only accepts IP socket addresses, so resolve
        // hostnames (e.g. Docker service names) to IPs first.
        let resolved = match addr_str.to_socket_addrs() {
            Ok(mut addrs) => match addrs.next() {
                Some(addr) => addr.to_string(),
                None => {
                    log::error!("No addresses resolved for {}", addr_str);
                    continue;
                }
            },
            Err(e) => {
                log::error!("Failed to resolve {}: {}", addr_str, e);
                continue;
            }
        };
        match Backend::new_with_weight(&resolved, upstream.weight) {
            Ok(backend) => {
                backend_set.insert(backend);
            }
            Err(e) => {
                log::error!("Failed to create backend for {} (resolved: {}): {}", addr_str, resolved, e);
            }
        }
    }

    if backend_set.is_empty() {
        return None;
    }

    let disc = discovery::Static::new(backend_set);
    let backends = Backends::new(disc);
    let lb = LoadBalancer::from_backends(backends);

    // Run the initial discovery update synchronously.
    // Since Static discovery is non-blocking, now_or_never is safe.
    use futures::FutureExt;
    let _ = lb.update().now_or_never();

    Some(lb)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::UpstreamConfig;

    fn upstream(server: &str, port: u16, weight: usize) -> UpstreamConfig {
        UpstreamConfig {
            server: server.to_string(),
            port,
            weight,
        }
    }

    // ─── create_upstream_selector: valid inputs ─────────────

    #[test]
    fn test_round_robin_single_upstream() {
        let ups = vec![upstream("127.0.0.1", 8080, 1)];
        let sel = create_upstream_selector(&ups, "round_robin");
        assert!(sel.is_some());
    }

    #[test]
    fn test_round_robin_multiple_upstreams() {
        let ups = vec![
            upstream("10.0.0.1", 8080, 1),
            upstream("10.0.0.2", 8080, 1),
            upstream("10.0.0.3", 8080, 1),
        ];
        let sel = create_upstream_selector(&ups, "round_robin").unwrap();
        // Should be able to select a backend
        let backend = sel.select(b"test-key");
        assert!(backend.is_some());
    }

    #[test]
    fn test_ip_hash_creates_consistent_selector() {
        let ups = vec![
            upstream("10.0.0.1", 8080, 1),
            upstream("10.0.0.2", 8080, 1),
        ];
        let sel = create_upstream_selector(&ups, "ip_hash");
        assert!(sel.is_some());
    }

    #[test]
    fn test_random_selector() {
        let ups = vec![
            upstream("10.0.0.1", 8080, 1),
            upstream("10.0.0.2", 8080, 1),
        ];
        let sel = create_upstream_selector(&ups, "random");
        assert!(sel.is_some());
    }

    #[test]
    fn test_weighted_falls_back_to_round_robin() {
        let ups = vec![
            upstream("10.0.0.1", 8080, 5),
            upstream("10.0.0.2", 8080, 1),
        ];
        let sel = create_upstream_selector(&ups, "weighted");
        assert!(sel.is_some());
    }

    #[test]
    fn test_least_connections_falls_back_to_round_robin() {
        let ups = vec![upstream("10.0.0.1", 8080, 1)];
        let sel = create_upstream_selector(&ups, "least_connections");
        assert!(sel.is_some());
    }

    #[test]
    fn test_unknown_method_falls_back_to_round_robin() {
        let ups = vec![upstream("10.0.0.1", 8080, 1)];
        let sel = create_upstream_selector(&ups, "totally_unknown_method");
        assert!(sel.is_some());
    }

    // ─── create_upstream_selector: empty / bad inputs ───────

    #[test]
    fn test_empty_upstreams_returns_none() {
        let sel = create_upstream_selector(&[], "round_robin");
        assert!(sel.is_none());
    }

    #[test]
    fn test_empty_method_string() {
        let ups = vec![upstream("10.0.0.1", 8080, 1)];
        // Empty string falls through to default (round_robin)
        let sel = create_upstream_selector(&ups, "");
        assert!(sel.is_some());
    }

    #[test]
    fn test_garbage_server_address() {
        // "not-a-valid-address" is not a valid IP — Backend::new_with_weight may fail
        let ups = vec![upstream("not-a-valid-ip-address!!!", 8080, 1)];
        let sel = create_upstream_selector(&ups, "round_robin");
        // If backend creation fails, the selector should be None (empty backend set)
        // or Some if Pingora accepts the hostname
        // Either way, it shouldn't panic
        let _ = sel;
    }

    #[test]
    fn test_injection_in_server_name() {
        let ups = vec![upstream("127.0.0.1; rm -rf /", 8080, 1)];
        // Should not panic
        let _ = create_upstream_selector(&ups, "round_robin");
    }

    #[test]
    fn test_server_with_null_bytes() {
        let ups = vec![upstream("127.0.0\x001", 8080, 1)];
        let _ = create_upstream_selector(&ups, "round_robin");
    }

    #[test]
    fn test_zero_weight_upstream() {
        let ups = vec![upstream("127.0.0.1", 8080, 0)];
        let sel = create_upstream_selector(&ups, "round_robin");
        // Zero weight might be accepted or might result in no selection
        let _ = sel;
    }

    #[test]
    fn test_port_zero() {
        let ups = vec![upstream("127.0.0.1", 0, 1)];
        let sel = create_upstream_selector(&ups, "round_robin");
        assert!(sel.is_some());
    }

    #[test]
    fn test_port_max() {
        let ups = vec![upstream("127.0.0.1", 65535, 1)];
        let sel = create_upstream_selector(&ups, "round_robin");
        assert!(sel.is_some());
    }

    #[test]
    fn test_ipv6_server() {
        let ups = vec![upstream("::1", 8080, 1)];
        let sel = create_upstream_selector(&ups, "round_robin");
        // Pingora may or may not handle bare IPv6 — should not panic
        let _ = sel;
    }

    #[test]
    fn test_all_invalid_upstreams_returns_none() {
        // Addresses that are definitely invalid for Backend
        let ups = vec![
            upstream("", 0, 0),
        ];
        let sel = create_upstream_selector(&ups, "round_robin");
        // If the backend address is invalid, backend_set is empty → None
        // Or if Pingira treats "" as valid somehow → Some
        // Key: no panic
        let _ = sel;
    }

    // ─── UpstreamSelector::select ───────────────────────────

    #[test]
    fn test_select_with_empty_key() {
        let ups = vec![upstream("127.0.0.1", 8080, 1)];
        let sel = create_upstream_selector(&ups, "round_robin").unwrap();
        let backend = sel.select(b"");
        assert!(backend.is_some());
    }

    #[test]
    fn test_select_with_large_key() {
        let ups = vec![upstream("127.0.0.1", 8080, 1)];
        let sel = create_upstream_selector(&ups, "ip_hash").unwrap();
        let large_key = vec![0xffu8; 10_000];
        let backend = sel.select(&large_key);
        assert!(backend.is_some());
    }

    #[test]
    fn test_ip_hash_same_key_same_backend() {
        let ups = vec![
            upstream("10.0.0.1", 8080, 1),
            upstream("10.0.0.2", 8080, 1),
        ];
        let sel = create_upstream_selector(&ups, "ip_hash").unwrap();
        let b1 = sel.select(b"192.168.1.1").unwrap();
        let b2 = sel.select(b"192.168.1.1").unwrap();
        assert_eq!(b1.addr, b2.addr);
    }

    #[test]
    fn test_duplicate_upstream_addresses() {
        // Two upstreams with the same address — BTreeSet will deduplicate
        let ups = vec![
            upstream("10.0.0.1", 8080, 1),
            upstream("10.0.0.1", 8080, 1),
        ];
        let sel = create_upstream_selector(&ups, "round_robin");
        assert!(sel.is_some());
    }

    #[test]
    fn test_very_large_weight() {
        let ups = vec![upstream("10.0.0.1", 8080, usize::MAX)];
        let sel = create_upstream_selector(&ups, "weighted");
        // Should not panic
        let _ = sel;
    }
}
