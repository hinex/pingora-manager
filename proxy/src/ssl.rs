use crate::config::{AppConfig, HostConfig, SslConfig};
use std::collections::HashMap;
use std::path::PathBuf;

/// Certificate and key file paths for a domain
#[derive(Debug, Clone)]
#[allow(dead_code)] // fields read in all_cert_pairs() and tests
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
    #[allow(dead_code)] // public API for TLS listener setup, tested
    pub fn get_cert(&self, sni: &str) -> Option<&CertPair> {
        let sni_lower = sni.to_lowercase();
        self.certs.get(&sni_lower)
    }

    /// Check if any SSL certificates are configured
    pub fn has_certs(&self) -> bool {
        !self.certs.is_empty()
    }

    /// Get all unique certificate pairs for pre-loading
    #[allow(dead_code)] // public API for TLS cert pre-loading, tested
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
/// For Let's Encrypt, looks in `ssl_dir/live/{domain}/`
/// For custom certs, uses the explicit paths from config.
fn resolve_cert_pair(host: &HostConfig, ssl: &SslConfig, ssl_dir: &str) -> Option<CertPair> {
    match ssl.ssl_type.as_str() {
        "letsencrypt" => {
            // Let's Encrypt certs are stored in ssl_dir/live/{domain}/
            let primary_domain = host.domains.first()?;
            let domain_lower = primary_domain.to_lowercase();
            let cert_path = PathBuf::from(ssl_dir)
                .join("live")
                .join(&domain_lower)
                .join("fullchain.pem");
            let key_path = PathBuf::from(ssl_dir)
                .join("live")
                .join(&domain_lower)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::*;
    use std::fs;

    fn make_global(ssl_dir: &str) -> GlobalConfig {
        GlobalConfig {
            listen: ListenConfig {
                http: 80,
                https: 443,
                admin: 81,
            },
            admin_upstream: "127.0.0.1:3001".to_string(),
            default_page: "/data/default-page/index.html".to_string(),
            error_pages_dir: "/data/error-pages".to_string(),
            logs_dir: "/data/logs".to_string(),
            ssl_dir: ssl_dir.to_string(),
        }
    }

    fn make_host(
        id: u64,
        domains: &[&str],
        ssl: Option<SslConfig>,
        enabled: bool,
    ) -> HostConfig {
        HostConfig {
            id,
            domains: domains.iter().map(|s| s.to_string()).collect(),
            group_id: None,
            ssl,
            locations: vec![],
            stream_ports: vec![],
            hsts: false,
            http2: false,
            enabled,
            compression: true,
        }
    }

    fn make_app_config(ssl_dir: &str, hosts: Vec<HostConfig>) -> AppConfig {
        AppConfig {
            global: make_global(ssl_dir),
            hosts,
            access_lists: std::collections::HashMap::new(),
        }
    }

    // ─── SslCertManager::build ──────────────────────────────

    #[test]
    fn test_build_no_hosts() {
        let config = make_app_config("/nonexistent", vec![]);
        let mgr = SslCertManager::build(&config);
        assert!(!mgr.has_certs());
        assert!(mgr.all_cert_pairs().is_empty());
    }

    #[test]
    fn test_build_host_without_ssl() {
        let host = make_host(1, &["example.com"], None, true);
        let config = make_app_config("/nonexistent", vec![host]);
        let mgr = SslCertManager::build(&config);
        assert!(!mgr.has_certs());
    }

    #[test]
    fn test_build_host_ssl_type_none_skipped() {
        let ssl = SslConfig {
            ssl_type: "none".to_string(),
            force_https: false,
            cert_path: None,
            key_path: None,
        };
        let host = make_host(1, &["example.com"], Some(ssl), true);
        let config = make_app_config("/nonexistent", vec![host]);
        let mgr = SslCertManager::build(&config);
        assert!(!mgr.has_certs());
    }

    #[test]
    fn test_build_disabled_host_skipped() {
        let ssl = SslConfig {
            ssl_type: "letsencrypt".to_string(),
            force_https: true,
            cert_path: None,
            key_path: None,
        };
        let host = make_host(1, &["example.com"], Some(ssl), false);
        let config = make_app_config("/nonexistent", vec![host]);
        let mgr = SslCertManager::build(&config);
        assert!(!mgr.has_certs());
    }

    #[test]
    fn test_build_letsencrypt_certs_missing_returns_none() {
        let ssl = SslConfig {
            ssl_type: "letsencrypt".to_string(),
            force_https: true,
            cert_path: None,
            key_path: None,
        };
        let host = make_host(1, &["example.com"], Some(ssl), true);
        let config = make_app_config("/tmp/nonexistent-ssl-dir", vec![host]);
        let mgr = SslCertManager::build(&config);
        assert!(!mgr.has_certs());
    }

    #[test]
    fn test_build_letsencrypt_with_real_files() {
        let dir = std::env::temp_dir().join("pingora-test-ssl-le");
        let _ = fs::remove_dir_all(&dir);
        let cert_dir = dir.join("live").join("example.com");
        fs::create_dir_all(&cert_dir).unwrap();
        fs::write(cert_dir.join("fullchain.pem"), "FAKE CERT").unwrap();
        fs::write(cert_dir.join("privkey.pem"), "FAKE KEY").unwrap();

        let ssl = SslConfig {
            ssl_type: "letsencrypt".to_string(),
            force_https: true,
            cert_path: None,
            key_path: None,
        };
        let host = make_host(1, &["example.com", "www.example.com"], Some(ssl), true);
        let config = make_app_config(dir.to_str().unwrap(), vec![host]);
        let mgr = SslCertManager::build(&config);

        assert!(mgr.has_certs());
        assert!(mgr.get_cert("example.com").is_some());
        assert!(mgr.get_cert("www.example.com").is_some());
        assert!(mgr.get_cert("other.com").is_none());

        let pair = mgr.get_cert("example.com").unwrap();
        assert!(pair.cert_path.contains("fullchain.pem"));
        assert!(pair.key_path.contains("privkey.pem"));

        // all_cert_pairs deduplicates
        assert_eq!(mgr.all_cert_pairs().len(), 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_build_custom_certs_files_missing() {
        let ssl = SslConfig {
            ssl_type: "custom".to_string(),
            force_https: false,
            cert_path: Some("/nonexistent/cert.pem".to_string()),
            key_path: Some("/nonexistent/key.pem".to_string()),
        };
        let host = make_host(1, &["custom.com"], Some(ssl), true);
        let config = make_app_config("/nonexistent", vec![host]);
        let mgr = SslCertManager::build(&config);
        assert!(!mgr.has_certs());
    }

    #[test]
    fn test_build_custom_certs_with_real_files() {
        let dir = std::env::temp_dir().join("pingora-test-ssl-custom");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let cert_path = dir.join("cert.pem");
        let key_path = dir.join("key.pem");
        fs::write(&cert_path, "FAKE CERT").unwrap();
        fs::write(&key_path, "FAKE KEY").unwrap();

        let ssl = SslConfig {
            ssl_type: "custom".to_string(),
            force_https: false,
            cert_path: Some(cert_path.to_str().unwrap().to_string()),
            key_path: Some(key_path.to_str().unwrap().to_string()),
        };
        let host = make_host(1, &["custom.com"], Some(ssl), true);
        let config = make_app_config("/whatever", vec![host]);
        let mgr = SslCertManager::build(&config);
        assert!(mgr.has_certs());
        assert!(mgr.get_cert("custom.com").is_some());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_build_custom_missing_cert_path_field() {
        let ssl = SslConfig {
            ssl_type: "custom".to_string(),
            force_https: false,
            cert_path: None,
            key_path: Some("/some/key.pem".to_string()),
        };
        let host = make_host(1, &["x.com"], Some(ssl), true);
        let config = make_app_config("/whatever", vec![host]);
        let mgr = SslCertManager::build(&config);
        assert!(!mgr.has_certs());
    }

    #[test]
    fn test_build_custom_missing_key_path_field() {
        let ssl = SslConfig {
            ssl_type: "custom".to_string(),
            force_https: false,
            cert_path: Some("/some/cert.pem".to_string()),
            key_path: None,
        };
        let host = make_host(1, &["x.com"], Some(ssl), true);
        let config = make_app_config("/whatever", vec![host]);
        let mgr = SslCertManager::build(&config);
        assert!(!mgr.has_certs());
    }

    #[test]
    fn test_build_unknown_ssl_type_ignored() {
        let ssl = SslConfig {
            ssl_type: "magic-ssl-that-doesnt-exist".to_string(),
            force_https: false,
            cert_path: None,
            key_path: None,
        };
        let host = make_host(1, &["x.com"], Some(ssl), true);
        let config = make_app_config("/whatever", vec![host]);
        let mgr = SslCertManager::build(&config);
        assert!(!mgr.has_certs());
    }

    // ─── get_cert: case insensitivity ───────────────────────

    #[test]
    fn test_get_cert_case_insensitive() {
        let dir = std::env::temp_dir().join("pingora-test-ssl-case");
        let _ = fs::remove_dir_all(&dir);
        let cert_dir = dir.join("live").join("example.com");
        fs::create_dir_all(&cert_dir).unwrap();
        fs::write(cert_dir.join("fullchain.pem"), "CERT").unwrap();
        fs::write(cert_dir.join("privkey.pem"), "KEY").unwrap();

        let ssl = SslConfig {
            ssl_type: "letsencrypt".to_string(),
            force_https: false,
            cert_path: None,
            key_path: None,
        };
        let host = make_host(1, &["Example.COM"], Some(ssl), true);
        let config = make_app_config(dir.to_str().unwrap(), vec![host]);
        let mgr = SslCertManager::build(&config);

        // Domain stored lowercase, lookup is also lowercase
        assert!(mgr.get_cert("example.com").is_some());
        assert!(mgr.get_cert("EXAMPLE.COM").is_some());
        assert!(mgr.get_cert("Example.Com").is_some());

        let _ = fs::remove_dir_all(&dir);
    }

    // ─── Security: path traversal in domain names ───────────

    #[test]
    fn test_letsencrypt_domain_path_traversal() {
        // A domain like "../../etc" would produce ssl_dir/live/../../etc/fullchain.pem
        // The files won't exist so resolve_cert_pair returns None, but verify no panic
        let ssl = SslConfig {
            ssl_type: "letsencrypt".to_string(),
            force_https: false,
            cert_path: None,
            key_path: None,
        };
        let host = make_host(1, &["../../etc/passwd"], Some(ssl), true);
        let config = make_app_config("/tmp", vec![host]);
        let mgr = SslCertManager::build(&config);
        // Should not find certs (files don't exist as PEM)
        assert!(!mgr.has_certs());
    }

    #[test]
    fn test_letsencrypt_empty_domains() {
        let ssl = SslConfig {
            ssl_type: "letsencrypt".to_string(),
            force_https: false,
            cert_path: None,
            key_path: None,
        };
        // No domains → domains.first() returns None → resolve_cert_pair returns None
        let host = make_host(1, &[], Some(ssl), true);
        let config = make_app_config("/tmp", vec![host]);
        let mgr = SslCertManager::build(&config);
        assert!(!mgr.has_certs());
    }

    #[test]
    fn test_custom_cert_path_with_null_bytes() {
        let ssl = SslConfig {
            ssl_type: "custom".to_string(),
            force_https: false,
            cert_path: Some("/etc/\x00/cert.pem".to_string()),
            key_path: Some("/etc/\x00/key.pem".to_string()),
        };
        let host = make_host(1, &["x.com"], Some(ssl), true);
        let config = make_app_config("/whatever", vec![host]);
        let mgr = SslCertManager::build(&config);
        assert!(!mgr.has_certs());
    }

    // ─── all_cert_pairs deduplication ───────────────────────

    #[test]
    fn test_all_cert_pairs_deduplicates_shared_certs() {
        let dir = std::env::temp_dir().join("pingora-test-ssl-dedup");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let cert_path = dir.join("shared.pem");
        let key_path = dir.join("shared.key");
        fs::write(&cert_path, "CERT").unwrap();
        fs::write(&key_path, "KEY").unwrap();

        let ssl1 = SslConfig {
            ssl_type: "custom".to_string(),
            force_https: false,
            cert_path: Some(cert_path.to_str().unwrap().to_string()),
            key_path: Some(key_path.to_str().unwrap().to_string()),
        };
        let ssl2 = ssl1.clone();

        let hosts = vec![
            make_host(1, &["a.com"], Some(ssl1), true),
            make_host(2, &["b.com"], Some(ssl2), true),
        ];
        let config = make_app_config("/whatever", hosts);
        let mgr = SslCertManager::build(&config);

        assert!(mgr.has_certs());
        assert!(mgr.get_cert("a.com").is_some());
        assert!(mgr.get_cert("b.com").is_some());
        // Same cert pair should be deduplicated
        assert_eq!(mgr.all_cert_pairs().len(), 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_get_cert_nonexistent_sni() {
        let config = make_app_config("/nonexistent", vec![]);
        let mgr = SslCertManager::build(&config);
        assert!(mgr.get_cert("anything.com").is_none());
        assert!(mgr.get_cert("").is_none());
        assert!(mgr.get_cert("\x00").is_none());
    }
}
