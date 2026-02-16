mod access_control;
mod config;
mod error_pages;
mod router;
mod ssl;
mod static_files;
mod streams;
mod log_writer;
mod upstream;

use async_trait::async_trait;
use config::AppConfig;
use pingora_core::prelude::*;
use pingora_core::upstreams::peer::Peer;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_proxy::{http_proxy_service, ProxyHttp, Session};
use router::Router;
use ssl::SslCertManager;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::Arc;
use std::time::Duration;
use upstream::UpstreamSelector;

const CONFIGS_DIR: &str = "/data/configs";

/// Shared application state that can be reloaded via SIGHUP.
/// Uses Arc<str> for frequently-cloned strings to avoid allocation.
struct SharedState {
    config: AppConfig,
    router: Router,
    ssl_manager: SslCertManager,
    /// Location-level load balancers keyed by (host_id, location_index)
    location_lbs: std::collections::HashMap<(u64, usize), UpstreamSelector>,
    /// Pre-formatted upstream addresses: SocketAddr → Arc<str>
    /// Avoids per-request to_string() allocation in resolve_request
    addr_cache: std::collections::HashMap<SocketAddr, Arc<str>>,
    /// Admin upstream address (Arc<str> to avoid cloning String per admin request)
    admin_upstream: Arc<str>,
    /// Cached error_pages_dir (Arc<str>)
    error_pages_dir: Arc<str>,
    /// Cached default_page path (Arc<str>)
    default_page: Arc<str>,
    /// Cached logs_dir (Arc<str>)
    logs_dir: Arc<str>,
    log_sender: log_writer::LogSender,
}

impl SharedState {
    fn build(config: AppConfig, log_sender: log_writer::LogSender) -> Self {
        let router = Router::build(&config.hosts);
        let ssl_manager = SslCertManager::build(&config);

        let mut location_lbs = std::collections::HashMap::new();

        for host in &config.hosts {
            if !host.enabled {
                continue;
            }
            // Build location-level load balancers
            for (i, loc) in host.locations.iter().enumerate() {
                if !loc.upstreams.is_empty() {
                    if let Some(lb) = upstream::create_upstream_selector(&loc.upstreams, &loc.balance_method) {
                        location_lbs.insert((host.id, i), lb);
                    }
                }
            }
        }

        let mut addr_cache = std::collections::HashMap::new();
        for host in &config.hosts {
            if !host.enabled { continue; }
            for loc in &host.locations {
                for upstream_cfg in &loc.upstreams {
                    let addr_str = format!("{}:{}", upstream_cfg.server, upstream_cfg.port);
                    if let Ok(mut addrs) = addr_str.to_socket_addrs() {
                        if let Some(addr) = addrs.next() {
                            addr_cache.entry(addr).or_insert_with(|| Arc::from(addr.to_string().as_str()));
                        }
                    }
                }
            }
        }

        let admin_upstream: Arc<str> = config.global.admin_upstream.as_str().into();
        let error_pages_dir: Arc<str> = config.global.error_pages_dir.as_str().into();
        let default_page: Arc<str> = config.global.default_page.as_str().into();
        let logs_dir: Arc<str> = config.global.logs_dir.as_str().into();

        SharedState {
            config,
            router,
            ssl_manager,
            location_lbs,
            addr_cache,
            admin_upstream,
            error_pages_dir,
            default_page,
            logs_dir,
            log_sender,
        }
    }
}

/// Outcome of the synchronous request routing phase (no borrows held after this)
enum RequestAction {
    /// Proxy to the given upstream address
    Proxy {
        upstream_addr: Arc<str>,
        host_id: Option<u64>,
        group_id: Option<u64>,
        hsts: bool,
        /// Pre-compiled custom headers from the matched location (cheap Arc clones)
        custom_headers: Vec<(http::header::HeaderName, Arc<str>)>,
    },
    /// Send a redirect response (from a redirect-type location)
    Redirect {
        status_code: u16,
        location: String,
    },
    /// Force-HTTPS redirect
    ForceHttps {
        location: String,
    },
    /// Serve a static file
    ServeStatic {
        static_dir: Arc<str>,
        location_path: Arc<str>,
        cache_expires: Option<Arc<str>>,
        host_id: Option<u64>,
        group_id: Option<u64>,
        error_pages_dir: Arc<str>,
        /// Pre-compiled custom headers from the matched location (cheap Arc clones)
        custom_headers: Vec<(http::header::HeaderName, Arc<str>)>,
    },
    /// Serve a single file (file-type location)
    ServeFile {
        file_path: Arc<str>,
        cache_expires: Option<Arc<str>>,
        host_id: Option<u64>,
        group_id: Option<u64>,
        error_pages_dir: Arc<str>,
        /// Pre-compiled custom headers from the matched location (cheap Arc clones)
        custom_headers: Vec<(http::header::HeaderName, Arc<str>)>,
    },
    /// Serve the default page (no matching host)
    ServeDefault {
        default_page: Arc<str>,
        error_pages_dir: Arc<str>,
    },
    /// Access denied (403)
    AccessDenied {
        error_pages_dir: Arc<str>,
        host_id: Option<u64>,
        group_id: Option<u64>,
    },
    /// Auth required (401)
    AuthRequired,
    /// Serve ACME challenge response
    AcmeChallenge {
        token: String,
    },
    /// No upstream available (502)
    NoUpstream {
        error_pages_dir: Arc<str>,
        host_id: Option<u64>,
        group_id: Option<u64>,
    },
}

/// Per-request context passed through the ProxyHttp callbacks
pub struct ProxyCtx {
    /// The selected upstream address (host:port) — Arc<str> avoids String clone
    upstream_addr: Option<Arc<str>>,
    /// Whether this request should use TLS to upstream
    upstream_tls: bool,
    /// SNI for upstream TLS
    upstream_sni: String,
    /// Host ID for error page resolution
    host_id: Option<u64>,
    /// Group ID for error page resolution
    group_id: Option<u64>,
    /// Whether to add HSTS header
    hsts: bool,
    /// Pre-compiled custom headers from the matched location
    custom_headers: Vec<(http::header::HeaderName, Arc<str>)>,
    /// Cached error_pages_dir for fail_to_proxy
    error_pages_dir: Arc<str>,
    /// Logs directory for per-host file logging
    logs_dir: Arc<str>,
    /// Async log sender (non-blocking channel send instead of file I/O)
    log_sender: log_writer::LogSender,
}

impl ProxyCtx {
    fn new(error_pages_dir: Arc<str>, logs_dir: Arc<str>, log_sender: log_writer::LogSender) -> Self {
        ProxyCtx {
            upstream_addr: None,
            upstream_tls: false,
            upstream_sni: String::new(),
            host_id: None,
            group_id: None,
            hsts: false,
            custom_headers: Vec::new(),
            error_pages_dir,
            logs_dir,
            log_sender,
        }
    }
}

/// The main proxy application.
/// Uses arc_swap::ArcSwap for lock-free read access on the hot path.
pub struct ProxyApp {
    state: Arc<arc_swap::ArcSwap<SharedState>>,
}

impl ProxyApp {
    fn new(state: Arc<arc_swap::ArcSwap<SharedState>>) -> Self {
        ProxyApp { state }
    }

    /// Determine the action for this request. Lock-free read via ArcSwap.
    fn resolve_request(
        &self,
        host_header: Option<&str>,
        path: &str,
        server_port: Option<u16>,
        client_ip: Option<IpAddr>,
        auth_header: Option<&str>,
    ) -> RequestAction {
        let state = self.state.load();
        let host_str = host_header.unwrap_or("");

        // Check if this is an admin port request
        if let Some(port) = server_port {
            if port == state.config.global.listen.admin {
                return RequestAction::Proxy {
                    upstream_addr: Arc::clone(&state.admin_upstream),
                    host_id: None,
                    group_id: None,
                    hsts: false,
                    custom_headers: Vec::new(),
                };
            }
        }

        // Serve ACME challenge responses (/.well-known/acme-challenge/)
        if let Some(token) = path.strip_prefix("/.well-known/acme-challenge/") {
            if !token.is_empty() {
                return RequestAction::AcmeChallenge {
                    token: token.to_string(),
                };
            }
        }

        // Resolve host and location (router returns index directly, no ptr::eq scan needed)
        let resolved = state.router.resolve(host_str, path);
        if resolved.is_none() {
            return RequestAction::ServeDefault {
                default_page: Arc::clone(&state.default_page),
                error_pages_dir: Arc::clone(&state.error_pages_dir),
            };
        }

        let (host_config, location, loc_idx) = resolved.unwrap();
        let host_id = Some(host_config.id);
        let group_id = host_config.group_id;
        let hsts = host_config.hsts;

        // Check SSL force_https redirect
        if let Some(ref ssl_conf) = host_config.ssl {
            if ssl_conf.force_https {
                if let Some(port) = server_port {
                    if port == state.config.global.listen.http {
                        let location_url = format!("https://{}{}", host_str, path);
                        return RequestAction::ForceHttps {
                            location: location_url,
                        };
                    }
                }
            }
        }

        // Access control check (from matched location)
        let access_list_id = location.and_then(|l| l.access_list_id);

        if let Some(acl_id) = access_list_id {
            if let Some(acl) = state.config.access_lists.get(&acl_id) {
                let result =
                    access_control::check_access(acl, client_ip.as_ref(), auth_header);
                match result {
                    access_control::AccessResult::Denied => {
                        return RequestAction::AccessDenied {
                            error_pages_dir: Arc::clone(&state.error_pages_dir),
                            host_id,
                            group_id,
                        };
                    }
                    access_control::AccessResult::AuthRequired => {
                        return RequestAction::AuthRequired;
                    }
                    access_control::AccessResult::Allowed => {}
                }
            }
        }

        // Check location type
        if let Some(loc) = location {
            let loc_type = loc.location_type.as_deref().unwrap_or("proxy");
            // Use pre-compiled headers (cheap Arc clones instead of String clones)
            let custom_headers = loc.compiled_headers.clone();

            match loc_type {
                "redirect" => {
                    let scheme = loc.forward_scheme.as_deref().unwrap_or("https");
                    let domain = loc.forward_domain.as_deref().unwrap_or("");
                    let fwd_path = loc.forward_path.as_deref().unwrap_or("/");
                    let status = loc.status_code.unwrap_or(301);
                    let target_path = if loc.preserve_path { path } else { fwd_path };
                    let location_url = format!("{}://{}{}", scheme, domain, target_path);
                    return RequestAction::Redirect {
                        status_code: status,
                        location: location_url,
                    };
                }
                "static" => {
                    if let Some(ref static_dir) = loc.static_dir {
                        return RequestAction::ServeStatic {
                            static_dir: Arc::from(static_dir.as_str()),
                            location_path: Arc::from(loc.path.as_str()),
                            cache_expires: loc.cache_expires.as_deref().map(Arc::from),
                            host_id,
                            group_id,
                            error_pages_dir: Arc::clone(&state.error_pages_dir),
                            custom_headers,
                        };
                    }
                }
                "file" => {
                    if let Some(ref file_path) = loc.static_dir {
                        return RequestAction::ServeFile {
                            file_path: Arc::from(file_path.as_str()),
                            cache_expires: loc.cache_expires.as_deref().map(Arc::from),
                            host_id,
                            group_id,
                            error_pages_dir: Arc::clone(&state.error_pages_dir),
                            custom_headers,
                        };
                    }
                }
                _ => {
                    // Proxy type — determine upstream from location-level LB
                    // Use raw IP octets as key (zero-alloc) instead of ip.to_string()
                    let mut key_buf = [0u8; 16];
                    let key_bytes: &[u8] = match client_ip {
                        Some(std::net::IpAddr::V4(ip)) => { key_buf[..4].copy_from_slice(&ip.octets()); &key_buf[..4] }
                        Some(std::net::IpAddr::V6(ip)) => { key_buf.copy_from_slice(&ip.octets()); &key_buf }
                        None => &[],
                    };

                    let upstream_addr = loc_idx.and_then(|idx| {
                        state.location_lbs.get(&(host_config.id, idx))
                    }).and_then(|lb| {
                        lb.select(key_bytes)
                            .and_then(|b| b.addr.as_inet().map(|a| {
                                state.addr_cache.get(&a)
                                    .map(Arc::clone)
                                    .unwrap_or_else(|| Arc::from(a.to_string().as_str()))
                            }))
                    });

                    if let Some(addr) = upstream_addr {
                        return RequestAction::Proxy {
                            upstream_addr: addr,
                            host_id,
                            group_id,
                            hsts,
                            custom_headers,
                        };
                    } else {
                        return RequestAction::NoUpstream {
                            error_pages_dir: Arc::clone(&state.error_pages_dir),
                            host_id,
                            group_id,
                        };
                    }
                }
            }
        }

        // No location matched — no upstream
        RequestAction::NoUpstream {
            error_pages_dir: Arc::clone(&state.error_pages_dir),
            host_id,
            group_id,
        }
    }
}

#[async_trait]
impl ProxyHttp for ProxyApp {
    type CTX = ProxyCtx;

    fn new_ctx(&self) -> Self::CTX {
        let state = self.state.load();
        ProxyCtx::new(
            Arc::clone(&state.error_pages_dir),
            Arc::clone(&state.logs_dir),
            state.log_sender.clone(),
        )
    }

    /// Handle the incoming request: access control, redirects, static files
    async fn request_filter(&self, session: &mut Session, ctx: &mut Self::CTX) -> Result<bool> {
        // Extract host header without allocating if possible
        let host_header: Option<&str> = session
            .req_header()
            .headers
            .get("host")
            .and_then(|v| v.to_str().ok());

        let path = session.req_header().uri.path();
        let client_ip = session
            .downstream_session
            .client_addr()
            .and_then(|addr| addr.as_inet())
            .map(|inet| inet.ip());
        let auth_header: Option<&str> = session
            .req_header()
            .headers
            .get(http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok());
        let server_port = session
            .downstream_session
            .server_addr()
            .and_then(|a| a.as_inet())
            .map(|inet| inet.port());

        // Resolve the request action (lock-free via ArcSwap)
        let action = self.resolve_request(
            host_header,
            path,
            server_port,
            client_ip,
            auth_header,
        );

        match action {
            RequestAction::Proxy {
                upstream_addr,
                host_id,
                group_id,
                hsts,
                custom_headers,
            } => {
                ctx.upstream_addr = Some(upstream_addr);
                ctx.host_id = host_id;
                ctx.group_id = group_id;
                ctx.hsts = hsts;
                ctx.custom_headers = custom_headers;
                Ok(false)
            }

            RequestAction::Redirect {
                status_code,
                location,
            } => {
                let mut resp = ResponseHeader::build(status_code, Some(2)).unwrap();
                let _ = resp.insert_header(http::header::LOCATION, &location);
                let _ = resp.insert_header(http::header::CONTENT_LENGTH, 0);
                session
                    .write_response_header(Box::new(resp), true)
                    .await?;
                Ok(true)
            }

            RequestAction::ForceHttps { location } => {
                let mut resp = ResponseHeader::build(301, Some(2)).unwrap();
                let _ = resp.insert_header(http::header::LOCATION, &location);
                let _ = resp.insert_header(http::header::CONTENT_LENGTH, 0);
                session
                    .write_response_header(Box::new(resp), true)
                    .await?;
                Ok(true)
            }

            RequestAction::ServeStatic {
                static_dir,
                location_path,
                cache_expires,
                host_id,
                group_id,
                error_pages_dir,
                custom_headers,
            } => {
                let path_owned = path.to_string();
                let ims: Option<&str> = session
                    .req_header()
                    .headers
                    .get(http::header::IF_MODIFIED_SINCE)
                    .and_then(|v| v.to_str().ok());
                if let Some(mut file_resp) = static_files::serve_static_file(
                    &static_dir,
                    &path_owned,
                    &location_path,
                    cache_expires.as_deref(),
                    ims,
                ).await {
                    // Add pre-compiled custom headers from location
                    for (name, value) in &custom_headers {
                        let _ = file_resp.header.insert_header(name.clone(), value.as_ref());
                    }
                    session
                        .write_response_header(Box::new(file_resp.header), false)
                        .await?;
                    if !file_resp.body.is_empty() {
                        session
                            .write_response_body(Some(file_resp.body), true)
                            .await?;
                    } else {
                        session.write_response_body(None, true).await?;
                    }
                } else {
                    let err_resp = error_pages::serve_error_page(
                        &error_pages_dir,
                        404,
                        host_id,
                        group_id,
                    );
                    session
                        .write_response_header(Box::new(err_resp.header), false)
                        .await?;
                    session
                        .write_response_body(Some(err_resp.body), true)
                        .await?;
                }
                Ok(true)
            }

            RequestAction::ServeFile {
                file_path,
                cache_expires,
                host_id,
                group_id,
                error_pages_dir,
                custom_headers,
            } => {
                let ims: Option<&str> = session
                    .req_header()
                    .headers
                    .get(http::header::IF_MODIFIED_SINCE)
                    .and_then(|v| v.to_str().ok());
                if let Some(mut file_resp) = static_files::serve_single_file(
                    &file_path,
                    cache_expires.as_deref(),
                    ims,
                ).await {
                    for (name, value) in &custom_headers {
                        let _ = file_resp.header.insert_header(name.clone(), value.as_ref());
                    }
                    session
                        .write_response_header(Box::new(file_resp.header), false)
                        .await?;
                    if !file_resp.body.is_empty() {
                        session
                            .write_response_body(Some(file_resp.body), true)
                            .await?;
                    } else {
                        session.write_response_body(None, true).await?;
                    }
                } else {
                    let err_resp = error_pages::serve_error_page(
                        &error_pages_dir,
                        404,
                        host_id,
                        group_id,
                    );
                    session
                        .write_response_header(Box::new(err_resp.header), false)
                        .await?;
                    session
                        .write_response_body(Some(err_resp.body), true)
                        .await?;
                }
                Ok(true)
            }

            RequestAction::ServeDefault {
                default_page,
                error_pages_dir,
            } => {
                if let Some(resp) = static_files::serve_default_page(&default_page) {
                    session
                        .write_response_header(Box::new(resp.header), false)
                        .await?;
                    session
                        .write_response_body(Some(resp.body), true)
                        .await?;
                } else {
                    let err_resp =
                        error_pages::serve_error_page(&error_pages_dir, 404, None, None);
                    session
                        .write_response_header(Box::new(err_resp.header), false)
                        .await?;
                    session
                        .write_response_body(Some(err_resp.body), true)
                        .await?;
                }
                Ok(true)
            }

            RequestAction::AccessDenied {
                error_pages_dir,
                host_id,
                group_id,
            } => {
                let err_resp = error_pages::serve_error_page(
                    &error_pages_dir,
                    403,
                    host_id,
                    group_id,
                );
                session
                    .write_response_header(Box::new(err_resp.header), false)
                    .await?;
                session
                    .write_response_body(Some(err_resp.body), true)
                    .await?;
                Ok(true)
            }

            RequestAction::AcmeChallenge { token } => {
                let challenge_path =
                    std::path::PathBuf::from("/data/acme-challenge").join(&token);
                if challenge_path.is_file() {
                    if let Ok(body) = std::fs::read(&challenge_path) {
                        let mut resp = ResponseHeader::build(200, Some(3)).unwrap();
                        let _ = resp.insert_header(
                            http::header::CONTENT_TYPE,
                            "text/plain",
                        );
                        let _ =
                            resp.insert_header(http::header::CONTENT_LENGTH, body.len());
                        session
                            .write_response_header(Box::new(resp), false)
                            .await?;
                        session
                            .write_response_body(Some(bytes::Bytes::from(body)), true)
                            .await?;
                        return Ok(true);
                    }
                }
                let mut resp = ResponseHeader::build(404, Some(1)).unwrap();
                let _ = resp.insert_header(http::header::CONTENT_LENGTH, 0);
                session
                    .write_response_header(Box::new(resp), true)
                    .await?;
                Ok(true)
            }

            RequestAction::AuthRequired => {
                let mut resp = ResponseHeader::build(401, Some(2)).unwrap();
                let _ = resp.insert_header(
                    http::header::WWW_AUTHENTICATE,
                    "Basic realm=\"Restricted\"",
                );
                let _ = resp.insert_header(http::header::CONTENT_LENGTH, 0);
                session
                    .write_response_header(Box::new(resp), true)
                    .await?;
                Ok(true)
            }

            RequestAction::NoUpstream {
                error_pages_dir,
                host_id,
                group_id,
            } => {
                let err_resp =
                    error_pages::serve_error_page(&error_pages_dir, 502, host_id, group_id);
                session
                    .write_response_header(Box::new(err_resp.header), false)
                    .await?;
                session
                    .write_response_body(Some(err_resp.body), true)
                    .await?;
                Ok(true)
            }
        }
    }

    /// Select the upstream peer based on the resolved upstream address
    async fn upstream_peer(
        &self,
        _session: &mut Session,
        ctx: &mut Self::CTX,
    ) -> Result<Box<HttpPeer>> {
        let addr = ctx
            .upstream_addr
            .as_ref()
            .ok_or_else(|| {
                pingora_core::Error::because(
                    pingora_core::ErrorType::ConnectNoRoute,
                    "no upstream address resolved",
                    pingora_core::Error::new(pingora_core::ErrorType::ConnectNoRoute),
                )
            })?;

        let mut peer = HttpPeer::new(
            addr.as_ref(),
            ctx.upstream_tls,
            ctx.upstream_sni.clone(),
        );

        // Configure connection pooling and keepalive for better performance
        let options = peer.get_mut_peer_options().unwrap();
        options.connection_timeout = Some(Duration::from_secs(5));
        options.total_connection_timeout = Some(Duration::from_secs(10));
        options.read_timeout = Some(Duration::from_secs(60));
        options.write_timeout = Some(Duration::from_secs(60));
        options.idle_timeout = Some(Duration::from_secs(60));

        Ok(Box::new(peer))
    }

    /// Modify the request before sending to upstream
    async fn upstream_request_filter(
        &self,
        session: &mut Session,
        upstream_request: &mut RequestHeader,
        _ctx: &mut Self::CTX,
    ) -> Result<()> {
        // Forward the original Host header
        if let Some(host) = session
            .req_header()
            .headers
            .get("host")
            .cloned()
        {
            upstream_request.insert_header("Host", host)?;
        }

        // Add X-Forwarded-For and X-Real-IP
        if let Some(client_ip) = session
            .downstream_session
            .client_addr()
            .and_then(|addr| addr.as_inet())
            .map(|inet| inet.ip())
        {
            let ip_str = client_ip.to_string();

            let xff = upstream_request
                .headers
                .get("X-Forwarded-For")
                .and_then(|v| v.to_str().ok())
                .map(|s| format!("{}, {}", s, ip_str))
                .unwrap_or_else(|| ip_str.clone());
            upstream_request.insert_header("X-Forwarded-For", &xff)?;
            upstream_request.insert_header("X-Real-IP", &ip_str)?;
        }

        Ok(())
    }

    /// Modify the response before sending to downstream
    async fn response_filter(
        &self,
        _session: &mut Session,
        upstream_response: &mut ResponseHeader,
        ctx: &mut Self::CTX,
    ) -> Result<()> {
        // Add HSTS header if configured
        if ctx.hsts {
            let _ = upstream_response.insert_header(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            );
        }

        // Add pre-compiled custom headers from the matched location
        for (name, value) in &ctx.custom_headers {
            let _ = upstream_response.insert_header(name.clone(), value.as_ref());
        }

        // Add server header
        let _ = upstream_response.insert_header("Server", "pingora-manager");

        Ok(())
    }

    /// Handle errors that occur during proxying
    async fn fail_to_proxy(
        &self,
        session: &mut Session,
        e: &pingora_core::Error,
        ctx: &mut Self::CTX,
    ) -> pingora_proxy::FailToProxy {
        let code = match e.etype() {
            pingora_core::ErrorType::HTTPStatus(code) => *code,
            _ => match e.esource() {
                pingora_core::ErrorSource::Upstream => 502,
                pingora_core::ErrorSource::Downstream => 0,
                _ => 500,
            },
        };

        if code > 0 {
            let err_resp =
                error_pages::serve_error_page(&ctx.error_pages_dir, code, ctx.host_id, ctx.group_id);
            let _ = session
                .write_response_header(Box::new(err_resp.header), false)
                .await;
            let _ = session
                .write_response_body(Some(err_resp.body), true)
                .await;
        }

        pingora_proxy::FailToProxy {
            error_code: code,
            can_reuse_downstream: false,
        }
    }

    /// Log completed requests
    async fn logging(
        &self,
        session: &mut Session,
        e: Option<&pingora_core::Error>,
        ctx: &mut Self::CTX,
    ) {
        let status = session
            .response_written()
            .map(|r| r.status.as_u16())
            .unwrap_or(0);
        let method = session.req_header().method.as_str();
        let path = session.req_header().uri.path();
        let host = session
            .req_header()
            .headers
            .get("host")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-");

        let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");

        if let Some(err) = e {
            log::error!("{} {} {} {} - error: {}", method, host, path, status, err);

            let log_file = match ctx.host_id {
                Some(id) => format!("{}/proxy-host-{}_error.log", ctx.logs_dir, id),
                None => format!("{}/proxy_general.log", ctx.logs_dir),
            };
            let line = format!("{} {} {} {} {} - error: {}\n", now, method, host, path, status, err);
            let _ = ctx.log_sender.send(log_writer::LogEntry { file_path: log_file, line });
        } else {
            log::info!("{} {} {} {}", method, host, path, status);
        }

        let log_file = match ctx.host_id {
            Some(id) => format!("{}/proxy-host-{}_access.log", ctx.logs_dir, id),
            None => format!("{}/proxy_general.log", ctx.logs_dir),
        };
        let line = format!("{} {} {} {} {}\n", now, method, host, path, status);
        let _ = ctx.log_sender.send(log_writer::LogEntry { file_path: log_file, line });
    }
}

fn main() {
    env_logger::init();
    log::info!("Pingora Manager Proxy starting...");

    // Load configuration
    let config = match AppConfig::load(CONFIGS_DIR) {
        Ok(c) => c,
        Err(e) => {
            log::warn!("Failed to load config from {}: {}. Using defaults.", CONFIGS_DIR, e);
            // Create minimal default config
            serde_yaml::from_str::<config::GlobalConfig>(
                "listen:\n  http: 80\n  https: 443\n  admin: 81\nadmin_upstream: '127.0.0.1:3001'",
            )
            .map(|global| AppConfig {
                global,
                hosts: Vec::new(),
                access_lists: std::collections::HashMap::new(),
            })
            .expect("Failed to create default config")
        }
    };

    let http_port = config.global.listen.http;
    let https_port = config.global.listen.https;
    let admin_port = config.global.listen.admin;

    // Collect all stream ports from all enabled hosts
    let stream_port_configs: Vec<config::StreamPortConfig> = config.hosts.iter()
        .filter(|h| h.enabled)
        .flat_map(|h| h.stream_ports.clone())
        .collect();

    // Build shared state with ArcSwap for lock-free reads
    let (log_sender, log_receiver) = log_writer::create_log_channel();
    let shared_state = Arc::new(arc_swap::ArcSwap::from_pointee(SharedState::build(config, log_sender.clone())));

    // Check SSL before moving shared_state
    let has_ssl_certs = shared_state.load().ssl_manager.has_certs();

    // Create the proxy apps (both share the same ArcSwap)
    let proxy_app = ProxyApp::new(Arc::clone(&shared_state));
    let admin_proxy_app = ProxyApp::new(Arc::clone(&shared_state));

    // Set up SIGHUP handler for config reload
    let reload_state = Arc::clone(&shared_state);
    let log_sender_reload = log_sender.clone();
    std::thread::spawn(move || {
        use std::sync::atomic::{AtomicBool, Ordering};
        static SIGHUP_RECEIVED: AtomicBool = AtomicBool::new(false);

        // Register SIGHUP signal handler
        unsafe {
            libc::signal(libc::SIGHUP, sighup_handler as *const () as libc::sighandler_t);
        }

        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            if SIGHUP_RECEIVED.swap(false, Ordering::SeqCst) {
                log::info!("SIGHUP received, reloading configuration...");
                match AppConfig::load(CONFIGS_DIR) {
                    Ok(new_config) => {
                        let new_state = Arc::new(SharedState::build(new_config, log_sender_reload.clone()));
                        reload_state.store(new_state);
                        log::info!("Configuration reloaded successfully");
                    }
                    Err(e) => {
                        log::error!("Failed to reload config: {}", e);
                    }
                }
            }
        }

        extern "C" fn sighup_handler(_sig: libc::c_int) {
            SIGHUP_RECEIVED.store(true, Ordering::SeqCst);
        }
    });

    // Create Pingora server with optimized configuration
    let mut server_conf = pingora_core::server::configuration::ServerConf::default();
    server_conf.upstream_keepalive_pool_size = 128;
    let opt = pingora_core::server::configuration::Opt::default();
    let mut server = Server::new_with_opt_and_conf(opt, server_conf);
    server.bootstrap();

    // Create HTTP proxy service
    let mut http_service = http_proxy_service(&server.configuration, proxy_app);

    // Add HTTP listener
    http_service.add_tcp(&format!("0.0.0.0:{}", http_port));

    // Add HTTPS listener if SSL certs are available
    if has_ssl_certs {
        log::info!("HTTPS port {} configured (TLS certs found)", https_port);
        http_service.add_tcp(&format!("0.0.0.0:{}", https_port));
    } else {
        log::info!("No TLS certificates found, HTTPS listener not started");
    }

    // Add admin listener
    let mut admin_service = http_proxy_service(&server.configuration, admin_proxy_app);
    admin_service.add_tcp(&format!("0.0.0.0:{}", admin_port));

    // Register services
    server.add_service(http_service);
    server.add_service(admin_service);

    // Start TCP stream proxies in the background
    if !stream_port_configs.is_empty() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        std::thread::spawn(move || {
            rt.block_on(async {
                let handles = streams::start_stream_proxies(&stream_port_configs);
                for handle in handles {
                    let _ = handle.await;
                }
            });
        });
    }

    log::info!(
        "Starting proxy: HTTP={}, HTTPS={}, Admin={}",
        http_port,
        https_port,
        admin_port
    );

    // Spawn async log writer on a background runtime
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(log_writer::run_log_writer(log_receiver));
    });

    server.run_forever();
}

#[cfg(test)]
mod tests {
    use super::*;
    use config::*;
    use std::collections::HashMap;
    use std::net::IpAddr;

    /// Build a ProxyApp with the given hosts and access lists.
    fn build_app(
        hosts: Vec<HostConfig>,
        access_lists: HashMap<u64, AccessListConfig>,
    ) -> ProxyApp {
        let global = GlobalConfig {
            listen: ListenConfig { http: 80, https: 443, admin: 81 },
            admin_upstream: "127.0.0.1:3001".to_string(),
            default_page: "/data/default-page/index.html".to_string(),
            error_pages_dir: "/data/error-pages".to_string(),
            logs_dir: "/data/logs".to_string(),
            ssl_dir: "/etc/letsencrypt".to_string(),
        };
        let config = AppConfig {
            global,
            hosts,
            access_lists,
        };
        let (log_sender, _log_receiver) = log_writer::create_log_channel();
        let state = SharedState::build(config, log_sender);
        let swap = Arc::new(arc_swap::ArcSwap::from_pointee(state));
        ProxyApp::new(swap)
    }

    fn make_proxy_location(path: &str, server: &str, port: u16) -> LocationConfig {
        LocationConfig {
            path: path.to_string(),
            match_type: "prefix".to_string(),
            location_type: Some("proxy".to_string()),
            upstreams: vec![UpstreamConfig {
                server: server.to_string(),
                port,
                weight: 1,
            }],
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

    fn host_with_upstream(id: u64, domains: &[&str]) -> HostConfig {
        HostConfig {
            id,
            domains: domains.iter().map(|s| s.to_string()).collect(),
            group_id: None,
            ssl: None,
            locations: vec![make_proxy_location("/", "10.0.0.1", 8080)],
            stream_ports: vec![],
            hsts: false,
            http2: false,
            enabled: true,
        }
    }

    fn host_with_ssl_force_https(id: u64, domains: &[&str]) -> HostConfig {
        HostConfig {
            id,
            domains: domains.iter().map(|s| s.to_string()).collect(),
            group_id: None,
            ssl: Some(SslConfig {
                ssl_type: "letsencrypt".to_string(),
                force_https: true,
                cert_path: None,
                key_path: None,
            }),
            locations: vec![make_proxy_location("/", "10.0.0.1", 8080)],
            stream_ports: vec![],
            hsts: true,
            http2: false,
            enabled: true,
        }
    }

    fn host_with_acl(id: u64, domains: &[&str], acl_id: u64) -> HostConfig {
        let mut loc = make_proxy_location("/", "10.0.0.1", 8080);
        loc.access_list_id = Some(acl_id);
        HostConfig {
            id,
            domains: domains.iter().map(|s| s.to_string()).collect(),
            group_id: None,
            ssl: None,
            locations: vec![loc],
            stream_ports: vec![],
            hsts: false,
            http2: false,
            enabled: true,
        }
    }

    fn host_with_static_location(id: u64, domains: &[&str]) -> HostConfig {
        HostConfig {
            id,
            domains: domains.iter().map(|s| s.to_string()).collect(),
            group_id: Some(10),
            ssl: None,
            locations: vec![LocationConfig {
                path: "/static".to_string(),
                match_type: "prefix".to_string(),
                location_type: Some("static".to_string()),
                upstreams: vec![],
                balance_method: "round_robin".to_string(),
                static_dir: Some("/var/www/static".to_string()),
                cache_expires: Some("30d".to_string()),
                forward_scheme: None,
                forward_domain: None,
                forward_path: None,
                preserve_path: false,
                status_code: None,
                headers: HashMap::new(),
                access_list_id: None,
                compiled_headers: Vec::new(),
            }],
            stream_ports: vec![],
            hsts: false,
            http2: false,
            enabled: true,
        }
    }

    fn host_with_redirect_location(id: u64, domains: &[&str]) -> HostConfig {
        HostConfig {
            id,
            domains: domains.iter().map(|s| s.to_string()).collect(),
            group_id: None,
            ssl: None,
            locations: vec![LocationConfig {
                path: "/".to_string(),
                match_type: "prefix".to_string(),
                location_type: Some("redirect".to_string()),
                upstreams: vec![],
                balance_method: "round_robin".to_string(),
                static_dir: None,
                cache_expires: None,
                forward_scheme: Some("https".to_string()),
                forward_domain: Some("new.example.com".to_string()),
                forward_path: Some("/".to_string()),
                preserve_path: true,
                status_code: Some(301),
                headers: HashMap::new(),
                access_list_id: None,
                compiled_headers: Vec::new(),
            }],
            stream_ports: vec![],
            hsts: false,
            http2: false,
            enabled: true,
        }
    }

    fn host_no_upstream(id: u64, domains: &[&str]) -> HostConfig {
        HostConfig {
            id,
            domains: domains.iter().map(|s| s.to_string()).collect(),
            group_id: None,
            ssl: None,
            locations: vec![],
            stream_ports: vec![],
            hsts: false,
            http2: false,
            enabled: true,
        }
    }

    fn make_acl_deny_all(id: u64) -> AccessListConfig {
        AccessListConfig {
            id,
            name: "deny-all".to_string(),
            satisfy: "any".to_string(),
            clients: vec![AccessListClient {
                address: "all".to_string(),
                directive: "deny".to_string(),
                parsed_cidr: None,
            }],
            auth: vec![],
        }
    }

    fn make_acl_with_auth(id: u64) -> AccessListConfig {
        AccessListConfig {
            id,
            name: "auth-required".to_string(),
            satisfy: "any".to_string(),
            clients: vec![],
            auth: vec![AccessListAuthEntry {
                username: "admin".to_string(),
                password: "secret".to_string(),
            }],
        }
    }

    // ─── Admin port routing ─────────────────────────────────

    #[test]
    fn test_admin_port_routes_to_admin_upstream() {
        let app = build_app(vec![], HashMap::new());
        let action = app.resolve_request(Some("anything.com"), "/", Some(81), None, None);
        match action {
            RequestAction::Proxy { upstream_addr, .. } => {
                assert_eq!(&*upstream_addr, "127.0.0.1:3001");
            }
            _ => panic!("expected Proxy for admin port"),
        }
    }

    #[test]
    fn test_admin_port_ignores_host_header() {
        let app = build_app(
            vec![host_with_upstream(1, &["evil.com"])],
            HashMap::new(),
        );
        let action = app.resolve_request(Some("evil.com"), "/", Some(81), None, None);
        match action {
            RequestAction::Proxy { upstream_addr, .. } => {
                assert_eq!(&*upstream_addr, "127.0.0.1:3001");
            }
            _ => panic!("expected admin Proxy"),
        }
    }

    // ─── ACME challenge ─────────────────────────────────────

    #[test]
    fn test_acme_challenge_path() {
        let app = build_app(vec![], HashMap::new());
        let action = app.resolve_request(
            Some("example.com"),
            "/.well-known/acme-challenge/some-token-123",
            Some(80),
            None,
            None,
        );
        match action {
            RequestAction::AcmeChallenge { token } => {
                assert_eq!(token, "some-token-123");
            }
            _ => panic!("expected AcmeChallenge"),
        }
    }

    #[test]
    fn test_acme_challenge_empty_token_not_matched() {
        let app = build_app(vec![], HashMap::new());
        let action = app.resolve_request(
            Some("example.com"),
            "/.well-known/acme-challenge/",
            Some(80),
            None,
            None,
        );
        assert!(!matches!(action, RequestAction::AcmeChallenge { .. }));
    }

    #[test]
    fn test_acme_challenge_path_traversal_token() {
        let app = build_app(vec![], HashMap::new());
        let action = app.resolve_request(
            Some("example.com"),
            "/.well-known/acme-challenge/../../etc/passwd",
            Some(80),
            None,
            None,
        );
        match action {
            RequestAction::AcmeChallenge { token } => {
                assert!(token.contains(".."));
            }
            _ => panic!("expected AcmeChallenge"),
        }
    }

    // ─── Redirect location routing ──────────────────────────

    #[test]
    fn test_redirect_location_matched() {
        let app = build_app(
            vec![host_with_redirect_location(1, &["old.com"])],
            HashMap::new(),
        );
        let action = app.resolve_request(Some("old.com"), "/path", Some(80), None, None);
        match action {
            RequestAction::Redirect { status_code, location } => {
                assert_eq!(status_code, 301);
                assert_eq!(location, "https://new.example.com/path");
            }
            _ => panic!("expected Redirect, got {:?}", std::mem::discriminant(&action)),
        }
    }

    // ─── Unknown host → ServeDefault ────────────────────────

    #[test]
    fn test_unknown_host_serves_default() {
        let app = build_app(vec![], HashMap::new());
        let action = app.resolve_request(Some("unknown.com"), "/", Some(80), None, None);
        assert!(matches!(action, RequestAction::ServeDefault { .. }));
    }

    #[test]
    fn test_no_host_header_serves_default() {
        let app = build_app(
            vec![host_with_upstream(1, &["example.com"])],
            HashMap::new(),
        );
        let action = app.resolve_request(None, "/", Some(80), None, None);
        assert!(matches!(action, RequestAction::ServeDefault { .. }));
    }

    #[test]
    fn test_empty_host_header_serves_default() {
        let app = build_app(
            vec![host_with_upstream(1, &["example.com"])],
            HashMap::new(),
        );
        let action = app.resolve_request(Some(""), "/", Some(80), None, None);
        assert!(matches!(action, RequestAction::ServeDefault { .. }));
    }

    // ─── Force HTTPS ────────────────────────────────────────

    #[test]
    fn test_force_https_on_http_port() {
        let app = build_app(
            vec![host_with_ssl_force_https(1, &["secure.com"])],
            HashMap::new(),
        );
        let action = app.resolve_request(Some("secure.com"), "/page", Some(80), None, None);
        match action {
            RequestAction::ForceHttps { location } => {
                assert_eq!(location, "https://secure.com/page");
            }
            _ => panic!("expected ForceHttps"),
        }
    }

    #[test]
    fn test_force_https_not_on_https_port() {
        let app = build_app(
            vec![host_with_ssl_force_https(1, &["secure.com"])],
            HashMap::new(),
        );
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        let action = app.resolve_request(Some("secure.com"), "/page", Some(443), Some(ip), None);
        assert!(matches!(action, RequestAction::Proxy { .. }));
    }

    // ─── Access control ─────────────────────────────────────

    #[test]
    fn test_access_denied_by_acl() {
        let mut acls = HashMap::new();
        acls.insert(1, make_acl_deny_all(1));

        let app = build_app(
            vec![host_with_acl(1, &["protected.com"], 1)],
            acls,
        );
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        let action = app.resolve_request(Some("protected.com"), "/", Some(80), Some(ip), None);
        assert!(matches!(action, RequestAction::AccessDenied { .. }));
    }

    #[test]
    fn test_auth_required_by_acl() {
        let mut acls = HashMap::new();
        acls.insert(1, make_acl_with_auth(1));

        let app = build_app(
            vec![host_with_acl(1, &["auth.com"], 1)],
            acls,
        );
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        let action = app.resolve_request(Some("auth.com"), "/", Some(80), Some(ip), None);
        assert!(matches!(action, RequestAction::AuthRequired));
    }

    #[test]
    fn test_auth_passes_with_valid_credentials() {
        let mut acls = HashMap::new();
        acls.insert(1, make_acl_with_auth(1));

        let app = build_app(
            vec![host_with_acl(1, &["auth.com"], 1)],
            acls,
        );
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode("admin:secret");
        let auth = format!("Basic {}", encoded);
        let action = app.resolve_request(Some("auth.com"), "/", Some(80), Some(ip), Some(&auth));
        assert!(matches!(action, RequestAction::Proxy { .. }));
    }

    #[test]
    fn test_auth_fails_with_wrong_password() {
        let mut acls = HashMap::new();
        acls.insert(1, make_acl_with_auth(1));

        let app = build_app(
            vec![host_with_acl(1, &["auth.com"], 1)],
            acls,
        );
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode("admin:WRONG");
        let auth = format!("Basic {}", encoded);
        let action = app.resolve_request(Some("auth.com"), "/", Some(80), Some(ip), Some(&auth));
        assert!(matches!(action, RequestAction::AuthRequired));
    }

    #[test]
    fn test_acl_id_not_found_allows_access() {
        let mut loc = make_proxy_location("/", "10.0.0.1", 8080);
        loc.access_list_id = Some(999);
        let host = HostConfig {
            id: 1,
            domains: vec!["x.com".to_string()],
            group_id: None,
            ssl: None,
            locations: vec![loc],
            stream_ports: vec![],
            hsts: false,
            http2: false,
            enabled: true,
        };
        let app = build_app(vec![host], HashMap::new());
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        let action = app.resolve_request(Some("x.com"), "/", Some(80), Some(ip), None);
        assert!(matches!(action, RequestAction::Proxy { .. }));
    }

    // ─── Static file routing ────────────────────────────────

    #[test]
    fn test_static_location_matched() {
        let app = build_app(
            vec![host_with_static_location(1, &["static.com"])],
            HashMap::new(),
        );
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        let action = app.resolve_request(Some("static.com"), "/static/file.js", Some(80), Some(ip), None);
        match action {
            RequestAction::ServeStatic { static_dir, location_path, cache_expires, .. } => {
                assert_eq!(&*static_dir, "/var/www/static");
                assert_eq!(&*location_path, "/static");
                assert_eq!(&*cache_expires.unwrap(), "30d");
            }
            _ => panic!("expected ServeStatic"),
        }
    }

    // ─── No upstream → NoUpstream (502) ─────────────────────

    #[test]
    fn test_no_upstream_returns_502() {
        let app = build_app(
            vec![host_no_upstream(1, &["empty.com"])],
            HashMap::new(),
        );
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        let action = app.resolve_request(Some("empty.com"), "/", Some(80), Some(ip), None);
        assert!(matches!(action, RequestAction::NoUpstream { .. }));
    }

    // ─── Security: malicious inputs to resolve_request ──────

    #[test]
    fn test_null_bytes_in_host() {
        let app = build_app(
            vec![host_with_upstream(1, &["example.com"])],
            HashMap::new(),
        );
        let action = app.resolve_request(
            Some("example.com\0.evil.com"),
            "/",
            Some(80),
            None,
            None,
        );
        assert!(matches!(action, RequestAction::ServeDefault { .. }));
    }

    #[test]
    fn test_very_long_host_header() {
        let app = build_app(vec![], HashMap::new());
        let long_host = "a".repeat(100_000);
        let action = app.resolve_request(Some(&long_host), "/", Some(80), None, None);
        assert!(matches!(action, RequestAction::ServeDefault { .. }));
    }

    #[test]
    fn test_very_long_path() {
        let app = build_app(
            vec![host_with_upstream(1, &["x.com"])],
            HashMap::new(),
        );
        let long_path = format!("/{}", "a".repeat(100_000));
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        let action = app.resolve_request(Some("x.com"), &long_path, Some(80), Some(ip), None);
        assert!(matches!(action, RequestAction::Proxy { .. }));
    }

    #[test]
    fn test_path_traversal_in_request() {
        let app = build_app(
            vec![host_with_upstream(1, &["x.com"])],
            HashMap::new(),
        );
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        let action = app.resolve_request(Some("x.com"), "/../../../etc/passwd", Some(80), Some(ip), None);
        assert!(matches!(action, RequestAction::Proxy { .. }));
    }

    #[test]
    fn test_xss_in_host_header() {
        let app = build_app(vec![], HashMap::new());
        let action = app.resolve_request(
            Some("<script>alert(1)</script>"),
            "/",
            Some(80),
            None,
            None,
        );
        assert!(matches!(action, RequestAction::ServeDefault { .. }));
    }

    #[test]
    fn test_sql_injection_in_host() {
        let app = build_app(vec![], HashMap::new());
        let action = app.resolve_request(
            Some("'; DROP TABLE hosts; --"),
            "/",
            Some(80),
            None,
            None,
        );
        assert!(matches!(action, RequestAction::ServeDefault { .. }));
    }

    #[test]
    fn test_malformed_auth_header_doesnt_crash() {
        let mut acls = HashMap::new();
        acls.insert(1, make_acl_with_auth(1));

        let app = build_app(
            vec![host_with_acl(1, &["x.com"], 1)],
            acls,
        );
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        let action = app.resolve_request(
            Some("x.com"),
            "/",
            Some(80),
            Some(ip),
            Some("NotBasic garbage!!!"),
        );
        assert!(matches!(action, RequestAction::AuthRequired));
    }

    #[test]
    fn test_no_server_port_no_force_https() {
        let app = build_app(
            vec![host_with_ssl_force_https(1, &["secure.com"])],
            HashMap::new(),
        );
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        let action = app.resolve_request(Some("secure.com"), "/", None, Some(ip), None);
        assert!(matches!(action, RequestAction::Proxy { .. }));
    }

    #[test]
    fn test_no_client_ip_for_lb() {
        let app = build_app(
            vec![host_with_upstream(1, &["x.com"])],
            HashMap::new(),
        );
        let action = app.resolve_request(Some("x.com"), "/", Some(80), None, None);
        assert!(matches!(action, RequestAction::Proxy { .. }));
    }

    #[test]
    fn test_ipv6_client_ip() {
        let app = build_app(
            vec![host_with_upstream(1, &["x.com"])],
            HashMap::new(),
        );
        let ip: IpAddr = "::1".parse().unwrap();
        let action = app.resolve_request(Some("x.com"), "/", Some(80), Some(ip), None);
        assert!(matches!(action, RequestAction::Proxy { .. }));
    }

    #[test]
    fn test_hsts_flag_propagated() {
        let app = build_app(
            vec![host_with_ssl_force_https(1, &["secure.com"])],
            HashMap::new(),
        );
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        let action = app.resolve_request(Some("secure.com"), "/", Some(443), Some(ip), None);
        match action {
            RequestAction::Proxy { hsts, .. } => {
                assert!(hsts);
            }
            _ => panic!("expected Proxy"),
        }
    }

    // ─── SharedState::build ─────────────────────────────────

    #[test]
    fn test_shared_state_build_empty_config() {
        let config = AppConfig {
            global: GlobalConfig {
                listen: ListenConfig { http: 80, https: 443, admin: 81 },
                admin_upstream: "127.0.0.1:3001".to_string(),
                default_page: "/data/default-page/index.html".to_string(),
                error_pages_dir: "/data/error-pages".to_string(),
                logs_dir: "/data/logs".to_string(),
                ssl_dir: "/etc/letsencrypt".to_string(),
            },
            hosts: vec![],
            access_lists: HashMap::new(),
        };
        let (log_sender, _) = log_writer::create_log_channel();
        let state = SharedState::build(config, log_sender);
        assert!(!state.ssl_manager.has_certs());
        assert!(state.location_lbs.is_empty());
    }

    #[test]
    fn test_shared_state_build_with_hosts_and_lbs() {
        let host = HostConfig {
            id: 1,
            domains: vec!["x.com".to_string()],
            group_id: None,
            ssl: None,
            locations: vec![LocationConfig {
                path: "/api".to_string(),
                match_type: "prefix".to_string(),
                location_type: Some("proxy".to_string()),
                upstreams: vec![UpstreamConfig {
                    server: "10.0.0.2".to_string(),
                    port: 9090,
                    weight: 1,
                }],
                balance_method: "ip_hash".to_string(),
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
            }],
            stream_ports: vec![],
            hsts: false,
            http2: false,
            enabled: true,
        };
        let config = AppConfig {
            global: GlobalConfig {
                listen: ListenConfig { http: 80, https: 443, admin: 81 },
                admin_upstream: "127.0.0.1:3001".to_string(),
                default_page: "/data/default-page/index.html".to_string(),
                error_pages_dir: "/data/error-pages".to_string(),
                logs_dir: "/data/logs".to_string(),
                ssl_dir: "/etc/letsencrypt".to_string(),
            },
            hosts: vec![host],
            access_lists: HashMap::new(),
        };
        let (log_sender, _) = log_writer::create_log_channel();
        let state = SharedState::build(config, log_sender);
        assert!(state.location_lbs.contains_key(&(1, 0)));
    }

    // ─── File location routing ─────────────────────────────

    fn host_with_file_location(id: u64, domains: &[&str]) -> HostConfig {
        HostConfig {
            id,
            domains: domains.iter().map(|s| s.to_string()).collect(),
            group_id: Some(10),
            ssl: None,
            locations: vec![LocationConfig {
                path: "/sitemap.xml".to_string(),
                match_type: "exact".to_string(),
                location_type: Some("file".to_string()),
                upstreams: vec![],
                balance_method: "round_robin".to_string(),
                static_dir: Some("/var/www/sitemap.xml".to_string()),
                cache_expires: Some("1h".to_string()),
                forward_scheme: None,
                forward_domain: None,
                forward_path: None,
                preserve_path: false,
                status_code: None,
                headers: HashMap::new(),
                access_list_id: None,
                compiled_headers: Vec::new(),
            }],
            stream_ports: vec![],
            hsts: false,
            http2: false,
            enabled: true,
        }
    }

    #[test]
    fn test_file_location_matched() {
        let app = build_app(
            vec![host_with_file_location(1, &["files.com"])],
            HashMap::new(),
        );
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        let action = app.resolve_request(Some("files.com"), "/sitemap.xml", Some(80), Some(ip), None);
        match action {
            RequestAction::ServeFile { file_path, cache_expires, .. } => {
                assert_eq!(&*file_path, "/var/www/sitemap.xml");
                assert_eq!(&*cache_expires.unwrap(), "1h");
            }
            _ => panic!("expected ServeFile"),
        }
    }
}
