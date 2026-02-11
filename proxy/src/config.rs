use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

/// Global proxy configuration from global.yaml
#[derive(Debug, Clone, Deserialize)]
pub struct GlobalConfig {
    pub listen: ListenConfig,
    pub admin_upstream: String,
    #[serde(default = "default_page")]
    pub default_page: String,
    #[serde(default = "error_pages_dir")]
    pub error_pages_dir: String,
    #[serde(default = "logs_dir")]
    pub logs_dir: String,
    #[serde(default = "ssl_dir")]
    pub ssl_dir: String,
}

fn default_page() -> String {
    "/data/default-page/index.html".to_string()
}
fn error_pages_dir() -> String {
    "/data/error-pages".to_string()
}
fn logs_dir() -> String {
    "/data/logs".to_string()
}
fn ssl_dir() -> String {
    "/etc/letsencrypt".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListenConfig {
    #[serde(default = "default_http_port")]
    pub http: u16,
    #[serde(default = "default_https_port")]
    pub https: u16,
    #[serde(default = "default_admin_port")]
    pub admin: u16,
}

fn default_http_port() -> u16 {
    80
}
fn default_https_port() -> u16 {
    443
}
fn default_admin_port() -> u16 {
    81
}

/// Host (proxy host) configuration from host-{id}.yaml
#[derive(Debug, Clone, Deserialize)]
pub struct HostConfig {
    pub id: u64,
    #[serde(default)]
    pub domains: Vec<String>,
    pub group_id: Option<u64>,
    pub ssl: Option<SslConfig>,
    #[serde(default)]
    pub upstreams: Vec<UpstreamConfig>,
    #[serde(default = "default_balance_method")]
    pub balance_method: String,
    #[serde(default)]
    pub locations: Vec<LocationConfig>,
    #[serde(default)]
    pub hsts: bool,
    #[serde(default)]
    pub http2: bool,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(alias = "accessListId")]
    pub access_list_id: Option<u64>,
}

fn default_balance_method() -> String {
    "round_robin".to_string()
}

fn default_enabled() -> bool {
    true
}

/// SSL/TLS configuration for a host
#[derive(Debug, Clone, Deserialize)]
pub struct SslConfig {
    #[serde(rename = "type", default = "default_ssl_type")]
    pub ssl_type: String,
    #[serde(default)]
    pub force_https: bool,
    pub cert_path: Option<String>,
    pub key_path: Option<String>,
}

fn default_ssl_type() -> String {
    "none".to_string()
}

/// Upstream server configuration
#[derive(Debug, Clone, Deserialize)]
pub struct UpstreamConfig {
    pub server: String,
    pub port: u16,
    #[serde(default = "default_weight")]
    pub weight: usize,
}

fn default_weight() -> usize {
    1
}

/// Location (route) configuration within a host.
/// The admin UI generates camelCase field names (matchType, staticDir, cacheExpires, accessListId),
/// so we use serde `alias` to accept both snake_case and camelCase.
#[derive(Debug, Clone, Deserialize)]
pub struct LocationConfig {
    pub path: String,
    #[serde(alias = "matchType", default = "default_match_type")]
    pub match_type: String,
    /// Location type: "proxy" or "static"
    #[serde(alias = "type", default = "default_location_type")]
    pub location_type: Option<String>,
    #[serde(default)]
    pub upstreams: Vec<UpstreamConfig>,
    #[serde(alias = "staticDir")]
    pub static_dir: Option<String>,
    #[serde(alias = "cacheExpires")]
    pub cache_expires: Option<String>,
    #[serde(alias = "accessListId")]
    pub access_list_id: Option<u64>,
    #[serde(default)]
    pub balance_method: Option<String>,
}

fn default_match_type() -> String {
    "prefix".to_string()
}

fn default_location_type() -> Option<String> {
    Some("proxy".to_string())
}

/// Redirect configuration from redirect-{id}.yaml
#[derive(Debug, Clone, Deserialize)]
pub struct RedirectConfig {
    pub id: u64,
    #[serde(default)]
    pub domains: Vec<String>,
    pub forward_scheme: String,
    pub forward_domain: String,
    #[serde(default = "default_forward_path")]
    pub forward_path: String,
    #[serde(default)]
    pub preserve_path: bool,
    #[serde(default = "default_status_code")]
    pub status_code: u16,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_forward_path() -> String {
    "/".to_string()
}

fn default_status_code() -> u16 {
    301
}

/// TCP stream proxy configuration from stream-{id}.yaml
#[derive(Debug, Clone, Deserialize)]
pub struct StreamConfig {
    pub id: u64,
    pub incoming_port: u16,
    #[serde(default = "default_stream_protocol")]
    pub protocol: String,
    #[serde(default)]
    pub upstreams: Vec<UpstreamConfig>,
    #[serde(default = "default_balance_method")]
    pub balance_method: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_stream_protocol() -> String {
    "tcp".to_string()
}

/// Access list configuration from access-lists.yaml
#[derive(Debug, Clone, Deserialize)]
pub struct AccessListConfig {
    pub id: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_satisfy")]
    pub satisfy: String,
    #[serde(default)]
    pub clients: Vec<AccessListClient>,
    #[serde(default)]
    pub auth: Vec<AccessListAuthEntry>,
}

fn default_satisfy() -> String {
    "any".to_string()
}

/// Client IP rule in an access list
#[derive(Debug, Clone, Deserialize)]
pub struct AccessListClient {
    pub address: String,
    #[serde(default = "default_directive")]
    pub directive: String,
}

fn default_directive() -> String {
    "allow".to_string()
}

/// Basic auth entry in an access list
#[derive(Debug, Clone, Deserialize)]
pub struct AccessListAuthEntry {
    pub username: String,
    pub password: String,
}

/// Aggregated application config loaded from all YAML files
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub global: GlobalConfig,
    pub hosts: Vec<HostConfig>,
    pub redirects: Vec<RedirectConfig>,
    pub streams: Vec<StreamConfig>,
    pub access_lists: HashMap<u64, AccessListConfig>,
}

impl AppConfig {
    /// Load all configuration from the given directory
    pub fn load(configs_dir: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = Path::new(configs_dir);

        // Load global config
        let global_path = dir.join("global.yaml");
        let global: GlobalConfig = if global_path.exists() {
            let content = std::fs::read_to_string(&global_path)?;
            serde_yaml::from_str(&content)?
        } else {
            log::warn!("global.yaml not found, using defaults");
            serde_yaml::from_str(
                "listen:\n  http: 80\n  https: 443\n  admin: 81\nadmin_upstream: '127.0.0.1:3001'",
            )?
        };

        // Load host configs
        let hosts = Self::load_glob(configs_dir, "host-*.yaml")?;

        // Load redirect configs
        let redirects = Self::load_glob(configs_dir, "redirect-*.yaml")?;

        // Load stream configs
        let streams = Self::load_glob(configs_dir, "stream-*.yaml")?;

        // Load access lists
        let access_lists_path = dir.join("access-lists.yaml");
        let access_lists_vec: Vec<AccessListConfig> = if access_lists_path.exists() {
            let content = std::fs::read_to_string(&access_lists_path)?;
            serde_yaml::from_str(&content)?
        } else {
            Vec::new()
        };
        let access_lists: HashMap<u64, AccessListConfig> =
            access_lists_vec.into_iter().map(|a| (a.id, a)).collect();

        Ok(AppConfig {
            global,
            hosts,
            redirects,
            streams,
            access_lists,
        })
    }

    /// Reload all configuration (re-reads from disk)
    pub fn reload(&mut self, configs_dir: &str) -> Result<(), Box<dyn std::error::Error>> {
        let new_config = Self::load(configs_dir)?;
        *self = new_config;
        Ok(())
    }

    /// Load all files matching a glob pattern and deserialize them
    fn load_glob<T: serde::de::DeserializeOwned>(
        configs_dir: &str,
        pattern: &str,
    ) -> Result<Vec<T>, Box<dyn std::error::Error>> {
        let full_pattern = format!("{}/{}", configs_dir, pattern);
        let mut items = Vec::new();
        for entry in glob::glob(&full_pattern)? {
            match entry {
                Ok(path) => {
                    let content = std::fs::read_to_string(&path)?;
                    match serde_yaml::from_str::<T>(&content) {
                        Ok(item) => items.push(item),
                        Err(e) => {
                            log::error!("Failed to parse {}: {}", path.display(), e);
                        }
                    }
                }
                Err(e) => {
                    log::error!("Glob error: {}", e);
                }
            }
        }
        Ok(items)
    }
}
