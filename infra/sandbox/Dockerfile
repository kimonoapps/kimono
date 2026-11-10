# Kimono AI's sandbox: what the agent works in. It carries tools and no
# credentials — the node brokers the model, Kimono Git and Composio from
# outside — and it has no internet, so everything it uses is baked in here.
# Every version is pinned; bump them together with the image tag in
# cli/internal/sandbox/config.go.
FROM node:22.23.4-bookworm-slim AS node
FROM golang:1.26.10-bookworm AS go

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
      # Photo work: libvips for very large images, tracing to SVG and drawing SVG,
      # web formats and optimisers, and sound editing.
      libvips-tools potrace librsvg2-bin webp jpegoptim optipng gifsicle sox \
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
      # kimono-say's voice engine (Kokoro on onnxruntime, espeak for spelling sounds).
      kokoro-onnx==0.6.1 onnxruntime==1.31.1 espeakng-loader==0.2.4 phonemizer==3.6.0 \
      attrs==26.1.0 cloudpickle==3.1.2 dlinfo==2.0.0 flatbuffers==25.12.19 joblib==1.6.0 \
      packaging==26.3 protobuf==7.36.2 typing-extensions==4.16.0 \
      # Photo editing: computer vision (OpenCV 4: 5 dropped the classic detectors), scikit-image,
      # background removal (rembg, on the same onnxruntime) and camera RAW files.
      opencv-python-headless==4.14.0.94 scikit-image==0.26.0 rembg==2.0.87 rawpy==0.28.0 \
      scipy==1.18.1 numba==0.68.1 llvmlite==0.50.0 pymatting==1.1.16 imageio==2.38.1 tifffile==2026.10.15 \
      lazy-loader==0.6 pooch==1.9.0 platformdirs==4.14.5 tqdm==4.70.1 requests==2.34.2 \
      certifi==2026.10.23 idna==3.20 urllib3==2.8.0 \
 && chmod -R a+rX /opt/kimono

# rembg's model (ISNet, general use), checked against its sum, so cutting out a
# background needs no download. numba (for rembg's edge matting) caches where
# the agent can write.
ARG REMBG_MODEL=https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx
ENV U2NET_HOME=/opt/kimono/rembg NUMBA_CACHE_DIR=/tmp/numba-cache
RUN mkdir -p /opt/kimono/rembg \
 && curl -fsSL --retry 5 -o /opt/kimono/rembg/isnet-general-use.onnx "${REMBG_MODEL}" \
 && echo "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a  /opt/kimono/rembg/isnet-general-use.onnx" | sha256sum -c - \
 && chmod -R a+rX /opt/kimono/rembg

# The voice kimono-say reads aloud with: Kokoro v1.0 (Apache-2.0), its int8
# model and voices, checked against their sums. Five times faster than real
# time on one CPU; nothing is fetched when it runs.
ARG KOKORO_FILES=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
RUN mkdir -p /opt/kimono/voice \
 && curl -fsSL --retry 5 -o /opt/kimono/voice/kokoro-v1.0.int8.onnx "${KOKORO_FILES}/kokoro-v1.0.int8.onnx" \
 && curl -fsSL --retry 5 -o /opt/kimono/voice/voices-v1.0.bin "${KOKORO_FILES}/voices-v1.0.bin" \
 && printf '%s  %s\n' \
      6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb /opt/kimono/voice/kokoro-v1.0.int8.onnx \
      bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d /opt/kimono/voice/voices-v1.0.bin \
    | sha256sum -c - \
 && chmod -R a+rX /opt/kimono/voice

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
COPY bin/kimono-shot bin/kimono-serve bin/kimono-unserve bin/kimono-access bin/kimono-remember bin/kimono-show bin/kimono-send bin/kimono-fetch bin/kimono-link bin/kimono-progress bin/kimono-say bin/kimono-chats bin/kimono-quran bin/kimono-hadith /usr/local/bin/
# How to make artifacts: the kit, scenes and maths (read by the agent; see docs/kimono-ai.md).
COPY artifacts.md media.md /opt/kimono/
COPY bin/shot.cjs bin/supervise /usr/local/lib/kimono/

ENV PATH=/opt/kimono/python/bin:/home/agent/go/bin:/usr/local/go/bin:$PATH \
    GOPATH=/home/agent/go \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_PATH=/usr/local/lib/node_modules \
    DISABLE_AUTOUPDATER=1

# Skills a person can turn on for Kimono AI (infra/sandbox/vendor-skills.sh
# copies them, with their licences, from the commits it pins). A turn links
# the ones they chose into ~/.claude/skills. Anthropic's document skills
# expect docx, pptxgenjs and markitdown to be here already.
COPY skills /opt/kimono/skills
RUN chmod -R a+rX /opt/kimono/skills \
 && npm install -g --no-fund --no-audit docx@9.15.3 pptxgenjs@4.0.1 \
 && npm cache clean --force \
 && uv pip install --python /opt/kimono/python "markitdown[docx,pptx,xlsx]==0.1.9"

RUN useradd --create-home --uid 1000 --shell /bin/bash agent \
 && mkdir -p /workspace/artifacts /attachments /outbox/shots /outbox/access /outbox/memories \
 && ln -s /workspace/.kimono/files /files \
 && chown -R agent:agent /workspace /attachments /outbox

USER agent
WORKDIR /workspace
CMD ["sleep", "infinity"]
