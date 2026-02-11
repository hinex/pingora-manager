# ─── Stage 1: Build Rust proxy ───────────────────────────
FROM rust:1.85-bookworm AS build-proxy

RUN apt-get update && apt-get install -y --no-install-recommends cmake && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY proxy/ ./
RUN cargo build --release

# ─── Stage 2: Build Web Admin ────────────────────────────
FROM oven/bun:1 AS build-web

WORKDIR /build
COPY web/package.json web/bun.lock* ./
RUN bun install

COPY web/ ./
RUN bun run build

# ─── Stage 3: Runtime ────────────────────────────────────
FROM debian:bookworm-slim

# Install runtime dependencies + s6-overlay prerequisites
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    xz-utils \
    logrotate \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install s6-overlay
ARG S6_OVERLAY_VERSION=3.2.0.0
RUN curl -fsSL -o /tmp/s6-overlay-noarch.tar.xz \
      https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz && \
    curl -fsSL -o /tmp/s6-overlay-x86_64.tar.xz \
      https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm /tmp/s6-overlay-*.tar.xz

# Install Bun runtime
RUN curl -fsSL https://bun.sh/install | bash \
    && ln -sf /root/.bun/bin/bun /usr/local/bin/bun

# Create data directories
RUN mkdir -p /data/configs /data/logs /data/error-pages/global /data/default-page /data/ssl/custom /etc/letsencrypt

# Copy Rust binary
COPY --from=build-proxy /build/target/release/pingora-manager-proxy /opt/pingora-manager/proxy

# Copy web admin
COPY --from=build-web /build/build /opt/pingora-manager/web/build
COPY --from=build-web /build/node_modules /opt/pingora-manager/web/node_modules
COPY --from=build-web /build/package.json /opt/pingora-manager/web/package.json
COPY --from=build-web /build/drizzle /opt/pingora-manager/web/drizzle
COPY --from=build-web /build/init-db.mjs /opt/pingora-manager/web/init-db.mjs

# Copy default page template
COPY defaults/default-page.html /data/default-page/index.html

# Copy default error pages
COPY defaults/error-pages/ /data/error-pages/global/

# Copy logrotate config
COPY s6/logrotate.conf /etc/logrotate.d/pingora-manager

# Copy s6 service definitions
COPY s6/services /etc/s6-overlay/s6-rc.d
RUN mkdir -p /etc/s6-overlay/s6-rc.d/user/contents.d && \
    touch /etc/s6-overlay/s6-rc.d/user/contents.d/pingora && \
    touch /etc/s6-overlay/s6-rc.d/user/contents.d/web

# Environment
ENV NODE_ENV=production \
    DB_PATH=/data/db.sqlite \
    CONFIGS_DIR=/data/configs \
    PORT=3001

EXPOSE 80 81 443

VOLUME ["/data", "/etc/letsencrypt"]

ENTRYPOINT ["/init"]
