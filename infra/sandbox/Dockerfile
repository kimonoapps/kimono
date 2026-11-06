# Kimono AI's sandbox: what the agent works in. It carries tools and no
# credentials — the node brokers the model, Kimono Git and Composio from
# outside — and it has no internet, so everything it uses is baked in here.
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
      # Files people bring: PDFs, pictures, sound and video, office documents, scans.
      poppler-utils qpdf ghostscript mupdf-tools \
      imagemagick libimage-exiftool-perl ffmpeg \
      pandoc libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-jpn tesseract-ocr-fra \
      sqlite3 zip p7zip-full rsync tree fd-find bc \
      # Fonts, so what it renders reads right in any language.
      fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji fonts-dejavu-core \
 && ln -s /usr/bin/fdfind /usr/local/bin/fd \
 && rm -rf /var/lib/apt/lists/*

# Python 3.13 with the libraries for working on files, in one venv that comes
# first on PATH. The sandbox has no internet, so what isn't here can't be had.
ARG UV_VERSION=0.13.7
ARG PYTHON_VERSION=3.13
ENV UV_PYTHON_INSTALL_DIR=/opt/kimono/pythons UV_NO_CACHE=1
RUN curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-$(uname -m)-unknown-linux-gnu.tar.gz" \
      | tar -xz --strip-components=1 -C /usr/local/bin \
 && uv python install "${PYTHON_VERSION}" \
 && uv venv /opt/kimono/python --python "${PYTHON_VERSION}" \
 && uv pip install --python /opt/kimono/python \
      pypdf==6.21.4 pdfplumber==0.11.10 pymupdf==2.1 reportlab==5.1.0 weasyprint==70.0 \
      img2pdf==0.6.3 ocrmypdf==17.13.0 \
      python-docx==1.2.0 openpyxl==3.1.5 xlsxwriter==3.3.1 python-pptx==1.0.2 \
      pandas==3.1.1 numpy==2.5.4 matplotlib==3.11.2 tabulate==0.10.0 csvkit==2.2.0 \
      pillow==13.0.0 pillow-heif==1.8.1 \
      markdown==3.11.3 beautifulsoup4==4.15.0 lxml==6.1.3 pyyaml==6.0.3 python-dateutil==4.0.0 \
 && chmod -R a+rX /opt/kimono

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
# behind a link (kimono-serve, kimono-unserve, which run it under supervise).
# See docs/kimono-code.md.
COPY bin/kimono-shot bin/kimono-serve bin/kimono-unserve bin/kimono-access bin/kimono-remember bin/kimono-show /usr/local/bin/
# How to make artifacts: the kit, scenes and maths (read by the agent; see docs/kimono-ai.md).
COPY artifacts.md /opt/kimono/artifacts.md
COPY bin/shot.cjs bin/supervise /usr/local/lib/kimono/

ENV PATH=/opt/kimono/python/bin:/home/agent/go/bin:/usr/local/go/bin:$PATH \
    GOPATH=/home/agent/go \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_PATH=/usr/local/lib/node_modules \
    DISABLE_AUTOUPDATER=1

RUN useradd --create-home --uid 1000 --shell /bin/bash agent \
 && mkdir -p /workspace/artifacts /attachments /outbox/shots /outbox/access /outbox/memories \
 && ln -s /workspace/.kimono/files /files \
 && chown -R agent:agent /workspace /attachments /outbox

USER agent
WORKDIR /workspace
CMD ["sleep", "infinity"]
