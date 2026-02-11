FROM rust:1.85-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends cmake protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY proxy/ ./
RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /data/configs /data/logs /data/error-pages/global /data/default-page /data/ssl

COPY --from=builder /build/target/release/pingora-manager-proxy /usr/local/bin/pingora-proxy
COPY defaults/default-page.html /data/default-page/index.html
COPY defaults/error-pages/ /data/error-pages/global/

EXPOSE 8080

CMD ["/usr/local/bin/pingora-proxy"]
