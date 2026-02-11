#[allow(dead_code)]
mod access_control;
#[allow(dead_code)]
mod config;
#[allow(dead_code)]
mod error_pages;
#[allow(dead_code)]
mod router;
#[allow(dead_code)]
mod ssl;
#[allow(dead_code)]
mod static_files;
#[allow(dead_code)]
mod streams;
#[allow(dead_code)]
mod upstream;

use async_trait::async_trait;
use config::AppConfig;
use pingora_core::prelude::*;
use pingora_core::upstreams::peer::Peer;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_proxy::{http_proxy_service, ProxyHttp, Session};
use router::Router;
use ssl::SslCertManager;
use std::net::IpAddr;
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
    /// Host-level load balancers keyed by host ID
    host_lbs: std::collections::HashMap<u64, UpstreamSelector>,
    /// Location-level load balancers keyed by (host_id, location_index)
    location_lbs: std::collections::HashMap<(u64, usize), UpstreamSelector>,
    /// Admin upstream address (Arc<str> to avoid cloning String per admin request)
    admin_upstream: Arc<str>,
    /// Cached error_pages_dir (Arc<str>)
    error_pages_dir: Arc<str>,
    /// Cached default_page path (Arc<str>)
    default_page: Arc<str>,
}

impl SharedState {
    fn build(config: AppConfig) -> Self {
        let router = Router::build(&config.hosts, &config.redirects);
        let ssl_manager = SslCertManager::build(&config);

        let mut host_lbs = std::collections::HashMap::new();
        let mut location_lbs = std::collections::HashMap::new();

        for host in &config.hosts {
            if !host.enabled {
                continue;
            }
            // Build host-level load balancer
            if !host.upstreams.is_empty() {
                if let Some(lb) =
                    upstream::create_upstream_selector(&host.upstreams, &host.balance_method)
                {
                    host_lbs.insert(host.id, lb);
                }
            }
            // Build location-level load balancers
            for (i, loc) in host.locations.iter().enumerate() {
                if !loc.upstreams.is_empty() {
                    let method = loc
                        .balance_method
                        .as_deref()
                        .unwrap_or(&host.balance_method);
                    if let Some(lb) = upstream::create_upstream_selector(&loc.upstreams, method) {
                        location_lbs.insert((host.id, i), lb);
                    }
                }
            }
        }

        let admin_upstream: Arc<str> = config.global.admin_upstream.as_str().into();
        let error_pages_dir: Arc<str> = config.global.error_pages_dir.as_str().into();
        let default_page: Arc<str> = config.global.default_page.as_str().into();

        SharedState {
            config,
            router,
            ssl_manager,
            host_lbs,
            location_lbs,
            admin_upstream,
            error_pages_dir,
            default_page,
        }
    }
}

/// Outcome of the synchronous request routing phase (no borrows held after this)
enum RequestAction {
    /// Proxy to the given upstream address
    Proxy {
        upstream_addr: String,
        host_id: Option<u64>,
        group_id: Option<u64>,
        hsts: bool,
    },
    /// Send a redirect response
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
        static_dir: String,
        location_path: String,
        cache_expires: Option<String>,
        host_id: Option<u64>,
        group_id: Option<u64>,
        error_pages_dir: Arc<str>,
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
    /// The selected upstream address (host:port)
    upstream_addr: Option<String>,
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
    /// Cached error_pages_dir for fail_to_proxy
    error_pages_dir: Arc<str>,
}

impl ProxyCtx {
    fn new(error_pages_dir: Arc<str>) -> Self {
        ProxyCtx {
            upstream_addr: None,
            upstream_tls: false,
            upstream_sni: String::new(),
            host_id: None,
            group_id: None,
            hsts: false,
            error_pages_dir,
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
                    upstream_addr: state.admin_upstream.to_string(),
                    host_id: None,
                    group_id: None,
                    hsts: false,
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

        // Check for redirects first
        if let Some(redirect) = state.router.resolve_redirect(host_str) {
            let target_path = if redirect.preserve_path {
                path
            } else {
                &redirect.forward_path
            };
            let location = format!(
                "{}://{}{}",
                redirect.forward_scheme, redirect.forward_domain, target_path
            );
            return RequestAction::Redirect {
                status_code: redirect.status_code,
                location,
            };
        }

        // Resolve host and location
        let resolved = state.router.resolve(host_str, path);
        if resolved.is_none() {
            return RequestAction::ServeDefault {
                default_page: Arc::clone(&state.default_page),
                error_pages_dir: Arc::clone(&state.error_pages_dir),
            };
        }

        let (host_config, location) = resolved.unwrap();
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

        // Access control check
        let access_list_id = location
            .and_then(|l| l.access_list_id)
            .or(host_config.access_list_id);

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

        // Check if this is a static file location
        if let Some(loc) = location {
            let is_static = loc
                .location_type
                .as_deref()
                .map(|t| t == "static")
                .unwrap_or(false);

            if is_static {
                if let Some(ref static_dir) = loc.static_dir {
                    return RequestAction::ServeStatic {
                        static_dir: static_dir.clone(),
                        location_path: loc.path.clone(),
                        cache_expires: loc.cache_expires.clone(),
                        host_id,
                        group_id,
                        error_pages_dir: Arc::clone(&state.error_pages_dir),
                    };
                }
            }
        }

        // Determine upstream for proxy
        let key = client_ip
            .map(|ip| ip.to_string())
            .unwrap_or_default();
        let key_bytes = key.as_bytes();

        // Try location-level LB first, then host-level LB
        let mut upstream_addr: Option<String> = None;

        if let Some(loc) = location {
            let loc_idx = host_config
                .locations
                .iter()
                .position(|l| std::ptr::eq(l, loc));

            if let Some(idx) = loc_idx {
                if let Some(lb) = state.location_lbs.get(&(host_config.id, idx)) {
                    upstream_addr = lb
                        .select(key_bytes)
                        .and_then(|b| b.addr.as_inet().map(|a| a.to_string()));
                }
            }
        }

        // Fall back to host-level LB
        if upstream_addr.is_none() {
            upstream_addr = state
                .host_lbs
                .get(&host_config.id)
                .and_then(|lb| lb.select(key_bytes))
                .and_then(|b| b.addr.as_inet().map(|a| a.to_string()));
        }

        if let Some(addr) = upstream_addr {
            RequestAction::Proxy {
                upstream_addr: addr,
                host_id,
                group_id,
                hsts,
            }
        } else {
            RequestAction::NoUpstream {
                error_pages_dir: Arc::clone(&state.error_pages_dir),
                host_id,
                group_id,
            }
        }
    }
}

#[async_trait]
impl ProxyHttp for ProxyApp {
    type CTX = ProxyCtx;

    fn new_ctx(&self) -> Self::CTX {
        let state = self.state.load();
        ProxyCtx::new(Arc::clone(&state.error_pages_dir))
    }

    /// Handle the incoming request: access control, redirects, static files
    async fn request_filter(&self, session: &mut Session, ctx: &mut Self::CTX) -> Result<bool> {
        // Extract host header without allocating if possible
        let host_header: Option<String> = session
            .req_header()
            .headers
            .get("host")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

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
        let ims: Option<&str> = session
            .req_header()
            .headers
            .get(http::header::IF_MODIFIED_SINCE)
            .and_then(|v| v.to_str().ok());

        // We need owned copies of borrowed values for resolve_request
        // since it accesses shared state
        let ims_owned = ims.map(|s| s.to_string());
        let auth_owned = auth_header.map(|s| s.to_string());
        let path_owned = path.to_string();

        // Resolve the request action (lock-free via ArcSwap)
        let action = self.resolve_request(
            host_header.as_deref(),
            &path_owned,
            server_port,
            client_ip,
            auth_owned.as_deref(),
        );

        match action {
            RequestAction::Proxy {
                upstream_addr,
                host_id,
                group_id,
                hsts,
            } => {
                ctx.upstream_addr = Some(upstream_addr);
                ctx.host_id = host_id;
                ctx.group_id = group_id;
                ctx.hsts = hsts;
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
            } => {
                if let Some(file_resp) = static_files::serve_static_file(
                    &static_dir,
                    &path_owned,
                    &location_path,
                    cache_expires.as_deref(),
                    ims_owned.as_deref(),
                ) {
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
            addr.as_str(),
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
        _ctx: &mut Self::CTX,
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

        if let Some(err) = e {
            log::error!(
                "{} {} {} {} - error: {}",
                method,
                host,
                path,
                status,
                err
            );
        } else {
            log::info!("{} {} {} {}", method, host, path, status);
        }
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
                redirects: Vec::new(),
                streams: Vec::new(),
                access_lists: std::collections::HashMap::new(),
            })
            .expect("Failed to create default config")
        }
    };

    let http_port = config.global.listen.http;
    let https_port = config.global.listen.https;
    let admin_port = config.global.listen.admin;
    let stream_configs = config.streams.clone();

    // Build shared state with ArcSwap for lock-free reads
    let shared_state = Arc::new(arc_swap::ArcSwap::from_pointee(SharedState::build(config)));

    // Check SSL before moving shared_state
    let has_ssl_certs = shared_state.load().ssl_manager.has_certs();

    // Create the proxy apps (both share the same ArcSwap)
    let proxy_app = ProxyApp::new(Arc::clone(&shared_state));
    let admin_proxy_app = ProxyApp::new(Arc::clone(&shared_state));

    // Set up SIGHUP handler for config reload
    let reload_state = Arc::clone(&shared_state);
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
                        let new_state = Arc::new(SharedState::build(new_config));
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
    if !stream_configs.is_empty() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        std::thread::spawn(move || {
            rt.block_on(async {
                let handles = streams::start_stream_proxies(&stream_configs);
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

    server.run_forever();
}
