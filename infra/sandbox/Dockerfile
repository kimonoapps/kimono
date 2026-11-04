# Kimono Code's sandbox: what a coding agent works in. It carries tools and no
# credentials — the node brokers the model and Kimono Git from outside.
# Every version is pinned; bump them together with the image tag in
# cli/internal/sandbox/config.go.
FROM node:22.20.0-bookworm-slim AS node
FROM golang:1.25.3-bookworm AS go

FROM debian:bookworm-slim

ARG CLAUDE_CODE_VERSION=2.1.306
ARG PLAYWRIGHT_VERSION=1.48.2

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client build-essential pkg-config \
      python3 python3-pip python3-venv ripgrep jq less procps unzip xz-utils file socat \
 && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=go /usr/local/go /usr/local/go
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
 && npm install -g --no-fund --no-audit "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm install -g --no-fund --no-audit "playwright@${PLAYWRIGHT_VERSION}" \
 && PLAYWRIGHT_BROWSERS_PATH=/ms-playwright playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* \
 && npm cache clean --force

# What the agent shows people: screenshots (kimono-shot) and a running app
# behind a link (kimono-serve, kimono-unserve). See docs/kimono-code.md.
COPY bin/kimono-shot bin/kimono-serve bin/kimono-unserve /usr/local/bin/
COPY bin/shot.cjs /usr/local/lib/kimono/shot.cjs

ENV PATH=/home/agent/go/bin:/usr/local/go/bin:$PATH \
    GOPATH=/home/agent/go \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_PATH=/usr/local/lib/node_modules \
    DISABLE_AUTOUPDATER=1

RUN useradd --create-home --uid 1000 --shell /bin/bash agent \
 && mkdir -p /workspace /attachments /outbox/shots \
 && chown -R agent:agent /workspace /attachments /outbox

USER agent
WORKDIR /workspace
CMD ["sleep", "infinity"]
