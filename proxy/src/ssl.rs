use crate::config::{AppConfig, HostConfig, SslConfig};
use std::collections::HashMap;
use std::path::PathBuf;

/// Certificate and key file paths for a domain
#[derive(Debug, Clone)]
pub struct CertPair {
    pub cert_path: String,
    pub key_path: String,
}

/// SSL certificate manager that maps SNI hostnames to certificate paths
pub struct SslCertManager {
    /// Domain -> CertPair mapping
    certs: HashMap<String, CertPair>,
}

impl SslCertManager {
    /// Build the SSL certificate manager from the application config
    pub fn build(config: &AppConfig) -> Self {
        let ssl_dir = &config.global.ssl_dir;
        let mut certs = HashMap::new();

        for host in &config.hosts {
            if !host.enabled {
                continue;
            }
            if let Some(ref ssl) = host.ssl {
                if ssl.ssl_type == "none" {
                    continue;
                }
                if let Some(pair) = resolve_cert_pair(host, ssl, ssl_dir) {
                    for domain in &host.domains {
                        certs.insert(domain.to_lowercase(), pair.clone());
                    }
                }
            }
        }

        SslCertManager { certs }
    }

    /// Look up the certificate pair for a given SNI hostname
    pub fn get_cert(&self, sni: &str) -> Option<&CertPair> {
        let sni_lower = sni.to_lowercase();
        self.certs.get(&sni_lower)
    }

    /// Check if any SSL certificates are configured
    pub fn has_certs(&self) -> bool {
        !self.certs.is_empty()
    }

    /// Get all unique certificate pairs for pre-loading
    pub fn all_cert_pairs(&self) -> Vec<&CertPair> {
        let mut seen = Vec::new();
        let mut result = Vec::new();
        for pair in self.certs.values() {
            let key = (&pair.cert_path, &pair.key_path);
            if !seen.contains(&key) {
                seen.push(key);
                result.push(pair);
            }
        }
        result
    }
}

/// Resolve the certificate and key paths for a host's SSL configuration.
/// For Let's Encrypt, looks in ssl_dir/live/{domain}/
/// For custom certs, uses the explicit paths from config.
fn resolve_cert_pair(host: &HostConfig, ssl: &SslConfig, ssl_dir: &str) -> Option<CertPair> {
    match ssl.ssl_type.as_str() {
        "letsencrypt" => {
            // Let's Encrypt certs are stored in ssl_dir/live/{domain}/
            let primary_domain = host.domains.first()?;
            let cert_path = PathBuf::from(ssl_dir)
                .join("live")
                .join(primary_domain)
                .join("fullchain.pem");
            let key_path = PathBuf::from(ssl_dir)
                .join("live")
                .join(primary_domain)
                .join("privkey.pem");

            // Only return if the files actually exist
            if cert_path.exists() && key_path.exists() {
                Some(CertPair {
                    cert_path: cert_path.to_string_lossy().to_string(),
                    key_path: key_path.to_string_lossy().to_string(),
                })
            } else {
                log::warn!(
                    "Let's Encrypt cert not found for domain '{}': {} or {}",
                    primary_domain,
                    cert_path.display(),
                    key_path.display()
                );
                None
            }
        }
        "custom" => {
            // Custom certs use explicit paths
            let cert = ssl.cert_path.as_ref()?;
            let key = ssl.key_path.as_ref()?;

            if PathBuf::from(cert).exists() && PathBuf::from(key).exists() {
                Some(CertPair {
                    cert_path: cert.clone(),
                    key_path: key.clone(),
                })
            } else {
                log::warn!(
                    "Custom cert not found for host {}: cert={}, key={}",
                    host.id,
                    cert,
                    key
                );
                None
            }
        }
        _ => None,
    }
}
