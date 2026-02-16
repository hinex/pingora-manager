use crate::config::StreamPortConfig;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Start TCP stream proxies for all configured stream ports.
/// Each stream listens on its `port` and forwards to its upstreams.
/// Returns a vector of JoinHandles for the spawned tasks.
pub fn start_stream_proxies(
    stream_ports: &[StreamPortConfig],
) -> Vec<tokio::task::JoinHandle<()>> {
    let mut handles = Vec::new();

    for sp in stream_ports {
        let sp_config = Arc::new(sp.clone());
        let handle = tokio::spawn(async move {
            if let Err(e) = run_stream_proxy(sp_config).await {
                log::error!("Stream proxy error on port {}: {}", e, e);
            }
        });
        handles.push(handle);
    }

    handles
}

/// Run a single TCP stream proxy that listens on the configured port
/// and forwards connections to the upstream servers.
async fn run_stream_proxy(config: Arc<StreamPortConfig>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listen_addr = format!("0.0.0.0:{}", config.port);
    let listener = TcpListener::bind(&listen_addr).await?;
    log::info!(
        "Stream proxy listening on port {} ({})",
        config.port,
        config.protocol
    );

    let upstream_index = std::sync::atomic::AtomicUsize::new(0);

    loop {
        let (client_stream, client_addr) = listener.accept().await?;
        log::debug!(
            "Stream port {}: new connection from {}",
            config.port,
            client_addr
        );

        // Simple round-robin upstream selection
        if config.upstreams.is_empty() {
            log::warn!("Stream port {}: no upstreams configured", config.port);
            continue;
        }

        let idx = upstream_index.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            % config.upstreams.len();
        let upstream = &config.upstreams[idx];
        let upstream_addr = format!("{}:{}", upstream.server, upstream.port);

        let port = config.port;
        tokio::spawn(async move {
            if let Err(e) = proxy_tcp_stream(client_stream, &upstream_addr).await {
                log::debug!("Stream port {}: connection error: {}", port, e);
            }
        });
    }
}

/// Proxy a single TCP connection by copying data bidirectionally
async fn proxy_tcp_stream(
    mut client: TcpStream,
    upstream_addr: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut upstream = TcpStream::connect(upstream_addr).await?;

    let (mut client_reader, mut client_writer) = client.split();
    let (mut upstream_reader, mut upstream_writer) = upstream.split();

    let client_to_upstream = async {
        let mut buf = vec![0u8; 8192];
        loop {
            let n = client_reader.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            upstream_writer.write_all(&buf[..n]).await?;
        }
        upstream_writer.shutdown().await?;
        Ok::<_, std::io::Error>(())
    };

    let upstream_to_client = async {
        let mut buf = vec![0u8; 8192];
        loop {
            let n = upstream_reader.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            client_writer.write_all(&buf[..n]).await?;
        }
        client_writer.shutdown().await?;
        Ok::<_, std::io::Error>(())
    };

    tokio::select! {
        r = client_to_upstream => { r?; }
        r = upstream_to_client => { r?; }
    }

    Ok(())
}
