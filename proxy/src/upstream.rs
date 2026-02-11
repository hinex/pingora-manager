use crate::config::UpstreamConfig;
use pingora_load_balancing::selection::{Consistent, Random, RoundRobin};
use pingora_load_balancing::{discovery, Backend, Backends, LoadBalancer};
use std::collections::BTreeSet;
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
        match Backend::new_with_weight(&addr_str, upstream.weight) {
            Ok(backend) => {
                backend_set.insert(backend);
            }
            Err(e) => {
                log::error!("Failed to create backend for {}: {}", addr_str, e);
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
