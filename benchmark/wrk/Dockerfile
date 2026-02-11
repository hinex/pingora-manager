FROM golang:1.24-bookworm AS builder

RUN go install github.com/rakyll/hey@latest

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl jq bc ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /go/bin/hey /usr/local/bin/hey

CMD ["sleep", "infinity"]
