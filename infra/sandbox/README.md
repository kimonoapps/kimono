# Kimono Code sandbox image

`ghcr.io/kimonoapps/kimono-sandbox` — the container a Kimono Code workspace runs
in: git, Node 22, Python 3, Go, Claude Code and headless Chromium (Playwright),
as user `agent`, with no credentials inside. `bin/` holds the helpers the agent
shows its work with: `kimono-shot`, `kimono-serve` and `kimono-unserve`. Built by `.github/workflows/sandbox-image.yml`; see
[docs/kimono-code.md](../../docs/kimono-code.md).

```bash
docker build -t ghcr.io/kimonoapps/kimono-sandbox:dev infra/sandbox
```
